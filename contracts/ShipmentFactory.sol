// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/access/Ownable.sol";
import "./Shipment.sol";

/**
 * @title ShipmentFactory (Universal Registry Model)
 * @author Rafat Hussain
 * @notice A single, universal factory to create Shipment NFTs across multiple, registered
 * Shipment collection contracts. This provides maximum flexibility and gas efficiency.
 */
contract ShipmentFactory is Ownable {

    //==============================================================
    // State Variables
    //==============================================================

    /// @notice Mapping from a Shipment contract address to whether it is registered and active.
    mapping(address => bool) public isShipmentContractRegistered;

    /// @notice Mapping from a Shipment contract address to a counter for its specific token IDs.
    mapping(address => uint256) public shipmentNonce;

    //==============================================================
    // Events
    //==============================================================

    event ShipmentCollectionRegistered(address indexed collectionAddress);
    event ShipmentCollectionDeregistered(address indexed collectionAddress);
    event ShipmentCreated(address indexed collectionAddress, uint256 indexed tokenId, address indexed shipper);

    /**
     * @notice Initializes the contract, setting the deployer as the initial owner.
     */
    constructor() Ownable(msg.sender) { 
        // The deployer is the initial owner, who can then register Shipment contracts
        // No additional setup needed at deployment
    }

    //==============================================================
    // Administrative Functions (Registry Management)
    //==============================================================

    /**
     * @notice Allows the owner to register a new Shipment collection contract.
     * @dev The registered contract can then be used to mint new shipment NFTs.
     * @param _collectionAddress The address of the new Shipment.sol contract to register.
     */
    function registerShipmentContract(address _collectionAddress) public onlyOwner {
        require(_collectionAddress != address(0), "Factory: Address cannot be zero");
        require(!isShipmentContractRegistered[_collectionAddress], "Factory: Contract already registered");
        isShipmentContractRegistered[_collectionAddress] = true;
        emit ShipmentCollectionRegistered(_collectionAddress);
    }

    /**
     * @notice Allows the owner to deregister a Shipment collection contract.
     * @dev This prevents any new shipments from being minted in this collection via the factory.
     * @param _collectionAddress The address of the Shipment.sol contract to deregister.
     */
    function deregisterShipmentContract(address _collectionAddress) public onlyOwner {
        require(isShipmentContractRegistered[_collectionAddress], "Factory: Contract not registered");
        isShipmentContractRegistered[_collectionAddress] = false;
        emit ShipmentCollectionDeregistered(_collectionAddress);
    }


    //==============================================================
    // Core Functionality
    //==============================================================

    /**
     * @notice Creates a new Shipment NFT within a specific, registered collection contract.
     * @param _collectionAddress The target Shipment.sol contract to mint the NFT in.
     * @param _recipient The final recipient's address.
     * @param _cargoDetails A description of the shipment's contents.
     * @param _plannedRoute The multi-node journey of the shipment.
     * @param _paymentAmount The amount of HBAR to be held in escrow.
     * @param _keyHash Optional secret hash for future verification (not used in this version). 
     * @return tokenId The ID of the newly created Shipment NFT within its collection.
     */
    function createShipment(
        address _collectionAddress, // <-- NEW PARAMETER
        address _recipient,
        string calldata _cargoDetails,
        address[] calldata _plannedRoute,
        uint256 _paymentAmount,
        bytes32 _keyHash
    ) public payable returns (uint256) {
        // --- Input Validations ---
        require(isShipmentContractRegistered[_collectionAddress], "Factory: Target contract is not registered");
        require(_paymentAmount > 0, "Factory: Payment amount must be greater than zero");
        require(msg.value == _paymentAmount, "Factory: HBAR sent does not match payment amount for escrow");
        require(_plannedRoute[0] == msg.sender, "Factory: Route must start with the shipper");
        require(_plannedRoute[_plannedRoute.length - 1] == _recipient, "Factory: Route must end with the recipient");
        require(_keyHash != bytes32(0), "Factory: Secret hash cannot be empty");

        // --- Interaction with Target Shipment Contract ---
        Shipment shipmentContract = Shipment(_collectionAddress);

        // Use a collection-specific nonce to generate unique token IDs for that collection
        uint256 newTokenId = shipmentNonce[_collectionAddress]++;
        
        shipmentContract.mintAndInitialize{value: _paymentAmount}(
            newTokenId,
            msg.sender,
            _recipient,
            _cargoDetails,
            _plannedRoute,
            _keyHash
        );

        // --- Emit Event and Return ---
        emit ShipmentCreated(_collectionAddress, newTokenId, msg.sender);
        
        return newTokenId;
    }
}