// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/token/ERC721/ERC721.sol";
import "@openzeppelin/contracts/access/Ownable.sol";
import "./OracleRegistry.sol"; 
/**
 * @title Shipment
 * @author Rafat Hussain
 * @notice An ERC721 contract where each token represents a unique, trackable shipment.
 * This contract acts as the on-chain state machine for a shipment's journey,
 * managed by custodians and trusted autonomous agents.
 */
contract Shipment is ERC721, Ownable {
    
    //==============================================================
    // State Variables
    //==============================================================

    address public factoryAddress;
    OracleRegistry public immutable oracleRegistry;

    enum Status { Created, InTransit, AwaitingVerification, Delivered, Completed, Disputed, ReroutingRequested }

    struct Details {
        address shipper;
        address recipient;
        Status status;
        string cargoDetails;
        uint256 paymentAmount;
        address[] plannedRoute;
        uint256 currentRouteIndex;
        address pendingCustodian;
    }

    mapping(uint256 => Details) public shipmentDetails;

    //==============================================================
    // Events
    //==============================================================

    event ShipmentInitialized(uint256 indexed tokenId, address indexed shipper, address indexed recipient);
    event HandoverInitiated(uint256 indexed tokenId, address indexed from, address indexed to);
    event VerificationRequested(uint256 indexed tokenId, address indexed custodian, bytes data);
    event ShipmentVerifiedAndReceived(uint256 indexed tokenId, address indexed newCustodian);
    event RerouteRequested(uint256 indexed tokenId, address indexed requestor, string reason);
    event RouteUpdated(uint256 indexed tokenId);
    event ShipmentFlagged(uint256 indexed tokenId, string reason);
    event DisputeRaised(uint256 indexed tokenId, address indexed raisedBy, string reason);
    event DisputeResolved(uint256 indexed tokenId, address indexed beneficiary, uint256 amount);
    event PaymentReleased(uint256 indexed tokenId, address indexed shipper, uint256 amount);


    //==============================================================
    // Modifiers
    //==============================================================

    modifier onlyFactory() {
        require(msg.sender == factoryAddress, "Caller is not the factory");
        _;
    }

    modifier onlyRegisteredAgent(OracleRegistry.AgentType _type) {
        require(oracleRegistry.isAgent(_type, msg.sender), "Caller is not a registered agent of this type");
        _;
    }

    modifier onlyOwnerOf(uint256 tokenId) {
        require(msg.sender == ownerOf(tokenId), "Caller is not the owner of this shipment");
        _;
    }


    //==============================================================
    // Constructor
    //==============================================================
    
    constructor(address _oracleRegistryAddress) 
        ERC721("HBARgo Shipment", "HGO") 
        // The deployer is the initial owner, who can then set the factory
        Ownable(msg.sender) 
    {
        require(_oracleRegistryAddress != address(0), "Oracle Registry address cannot be zero");
        oracleRegistry = OracleRegistry(_oracleRegistryAddress);
    }


    //==============================================================
    // External Functions (Core Workflow)
    //==============================================================

    /**
     * @notice Mints and initializes a new shipment. Called only by the factory.
     * @dev This function is payable to receive and hold the escrowed payment.
     * @param tokenId The new token ID to mint.
     * @param shipper The original shipper of the goods.
     * @param recipient The final destination address.
     * @param cargoDetails A description of the cargo.
     * @param plannedRoute The multi-node route for the shipment.
     */
    function mintAndInitialize(
        uint256 tokenId,
        address shipper,
        address recipient,
        string calldata cargoDetails,
        address[] calldata plannedRoute
    ) external payable onlyFactory {
        _mint(shipper, tokenId);

        shipmentDetails[tokenId] = Details({
            shipper: shipper,
            recipient: recipient,
            status: Status.Created,
            cargoDetails: cargoDetails,
            paymentAmount: msg.value,
            plannedRoute: plannedRoute,
            currentRouteIndex: 0,
            pendingCustodian: address(0)
        });

        emit ShipmentInitialized(tokenId, shipper, recipient);
    }

    /**
     * @notice Initiates the handover from the current custodian to the next node in the route.
     * @dev Sets the shipment status to 'InTransit' and designates the next custodian.
     * @param tokenId The ID of the shipment to hand over.
     */
    function initiateHandover(uint256 tokenId) external onlyOwnerOf(tokenId) {
        Details storage shipment = shipmentDetails[tokenId];
        require(shipment.status == Status.Created, "Shipment not in a state for handover");
        require(shipment.currentRouteIndex < shipment.plannedRoute.length - 1, "End of route reached");

        shipment.pendingCustodian = shipment.plannedRoute[shipment.currentRouteIndex + 1];
        shipment.status = Status.InTransit;
        emit HandoverInitiated(tokenId, ownerOf(tokenId), shipment.pendingCustodian);
    }

    /**
     * @notice The designated recipient requests verification from the Fraud Detection Agent.
     * @dev This signals the off-chain agent to begin its multi-factor checks.
     * @param tokenId The ID of the shipment being received.
     * @param physicalScanData The raw data from the physical scan (e.g., QR code, NFC tap).
     */
    function requestVerification(uint256 tokenId, bytes calldata physicalScanData) external {
        Details storage shipment = shipmentDetails[tokenId];
        require(msg.sender == shipment.pendingCustodian, "Not the designated recipient");
        require(shipment.status == Status.InTransit, "Handover not initiated");

        shipment.status = Status.AwaitingVerification;
        emit VerificationRequested(tokenId, msg.sender, physicalScanData);
    }

    /**
     * @notice Finalizes a successful shipment and releases the escrowed payment to the shipper.
     * @dev Can only be called by the original shipper after the package has been delivered.
     * @param tokenId The ID of the shipment to finalize.
     */
    function finalizeAndPay(uint256 tokenId) external {
        Details storage shipment = shipmentDetails[tokenId];
        require(msg.sender == shipment.shipper, "Only the original shipper can finalize payment");
        require(shipment.status == Status.Delivered, "Shipment not yet delivered");

        uint256 payment = shipment.paymentAmount;
        shipment.paymentAmount = 0; // Prevent re-entrancy
        shipment.status = Status.Completed;

        payable(shipment.shipper).transfer(payment);
        emit PaymentReleased(tokenId, shipment.shipper, payment);
    }


    //==============================================================
    // External Functions (Agent Hooks & Dispute Management)
    //==============================================================

    /**
     * @notice Called by a trusted Fraud Detection Agent to confirm successful verification.
     * @dev Transfers NFT ownership to the new custodian and updates the shipment's state.
     * @param tokenId The ID of the shipment being verified.
     * @param receivingCustodian The address of the custodian whose verification was successful.
     */
    function confirmVerification(uint256 tokenId, address receivingCustodian) external onlyRegisteredAgent(OracleRegistry.AgentType.FRAUD_DETECTION) {
        Details storage shipment = shipmentDetails[tokenId];
        require(shipment.status == Status.AwaitingVerification, "Verification not requested");
        require(receivingCustodian == shipment.pendingCustodian, "Agent confirmed wrong custodian");

        shipment.currentRouteIndex++;
        
        if (shipment.currentRouteIndex == shipment.plannedRoute.length - 1) {
            shipment.status = Status.Delivered;
        } else {
            shipment.status = Status.Created; // Reset for the next leg of the journey
        }
        shipment.pendingCustodian = address(0);

        _transfer(ownerOf(tokenId), receivingCustodian, tokenId);
        emit ShipmentVerifiedAndReceived(tokenId, receivingCustodian);
    }

    /**
     * @notice Called by a Fraud Detection Agent to flag a shipment due to failed verification.
     * @dev Puts the shipment into a 'Disputed' state, freezing it.
     * @param tokenId The ID of the shipment to flag.
     * @param reason A string explaining why the shipment was flagged.
     */
    function flagShipment(uint256 tokenId, string calldata reason) external onlyRegisteredAgent(OracleRegistry.AgentType.FRAUD_DETECTION) {
        shipmentDetails[tokenId].status = Status.Disputed;
        emit ShipmentFlagged(tokenId, reason);
    }

    /**
     * @notice The current owner of the shipment requests a reroute from the Routing Agent.
     * @param tokenId The ID of the shipment to reroute.
     * @param reason The reason for the rerouting request (e.g., "Port closure").
     */
    function requestReroute(uint256 tokenId, string calldata reason) external onlyOwnerOf(tokenId) {
        shipmentDetails[tokenId].status = Status.ReroutingRequested;
        emit RerouteRequested(tokenId, msg.sender, reason);
    }
    
    /**
     * @notice Called by a trusted Routing Agent to execute a new route for a shipment.
     * @param tokenId The ID of the shipment.
     * @param newRoute The new array of addresses for the updated route.
     */
    function executeReroute(uint256 tokenId, address[] calldata newRoute) external onlyRegisteredAgent(OracleRegistry.AgentType.ROUTING) {
        Details storage shipment = shipmentDetails[tokenId];
        require(shipment.status == Status.ReroutingRequested, "Reroute not requested");
        // Business logic: Ensure the new route is valid and starts from the current location.
        require(newRoute.length > shipment.currentRouteIndex, "New route is shorter than current progress");
        require(newRoute[shipment.currentRouteIndex] == ownerOf(tokenId), "New route must start from current custodian");
        
        shipment.plannedRoute = newRoute;
        shipment.status = Status.Created;
        emit RouteUpdated(tokenId);
    }

    /**
     * @notice Allows the shipper or final recipient to raise a dispute.
     * @param tokenId The ID of the shipment in dispute.
     * @param reason A string explaining the reason for the dispute.
     */
    function disputeShipment(uint256 tokenId, string calldata reason) external {
        Details storage shipment = shipmentDetails[tokenId];
        require(msg.sender == shipment.shipper || msg.sender == shipment.recipient, "Only shipper or recipient can raise a dispute");
        require(shipment.status != Status.Completed, "Cannot dispute a completed shipment");

        shipment.status = Status.Disputed;
        emit DisputeRaised(tokenId, msg.sender, reason);
    }

    /**
     * @notice Called by a trusted Arbitration Agent to resolve a dispute.
     * @dev Releases the escrowed funds to either the shipper or recipient based on the verdict.
     * @param tokenId The ID of the disputed shipment.
     * @param releaseToShipper A boolean indicating the winner. True for shipper, false for recipient.
     */
    function resolveDispute(uint256 tokenId, bool releaseToShipper) external onlyRegisteredAgent(OracleRegistry.AgentType.ARBITRATION) {
        Details storage shipment = shipmentDetails[tokenId];
        require(shipment.status == Status.Disputed, "Shipment not in dispute");

        uint256 payment = shipment.paymentAmount;
        shipment.paymentAmount = 0; // Prevent re-entrancy
        shipment.status = Status.Completed;

        address beneficiary = releaseToShipper ? shipment.shipper : shipment.recipient;
        payable(beneficiary).transfer(payment);

        emit DisputeResolved(tokenId, beneficiary, payment);
    }

    //==============================================================
    // Administrative Functions
    //==============================================================

    /**
     * @notice Called by the owner to set the trusted factory address.
     * @dev This is a one-time setup step after deployment to link this collection to the factory.
     * @param _factoryAddress The address of the deployed ShipmentFactory contract.
     */
    function setFactory(address _factoryAddress) public onlyOwner {
        require(factoryAddress == address(0), "Factory address already set"); // Optional: Make it a one-time call
        require(_factoryAddress != address(0), "Factory address cannot be zero");
        factoryAddress = _factoryAddress;
    }
}