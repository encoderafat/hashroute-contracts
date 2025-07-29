import { expect } from "chai";
import { ethers } from "hardhat";
import { Signer } from "ethers";
import { Shipment, ShipmentFactory, OracleRegistry } from "../typechain-types";

describe("Full Supply Chain Workflow (Universal Factory)", function () {
    // --- Actors & Agents ---
    let owner: Signer;
    let shipper: Signer, distributor: Signer, retailer: Signer, recipient: Signer;
    let fraudAgent: Signer, routingAgent: Signer;

    // --- Contracts ---
    let oracleRegistry: OracleRegistry;
    let shipmentFactory: ShipmentFactory;
    let electronicsShipments: Shipment; // Our first collection
    let pharmaShipments: Shipment;      // Our second collection

    const AgentType = { ROUTING: 0, ARBITRATION: 1, FRAUD_DETECTION: 2 };

    before(async function () {
        [owner, shipper, distributor, retailer, recipient, fraudAgent, routingAgent] = await ethers.getSigners();

        // 1. Deploy Universal Factory and Oracle Registry
        const OracleRegistryFactory = await ethers.getContractFactory("OracleRegistry");
        oracleRegistry = await OracleRegistryFactory.deploy();
        const UniversalFactory = await ethers.getContractFactory("ShipmentFactory");
        shipmentFactory = await UniversalFactory.deploy();
        
        // Register Agents
        await oracleRegistry.connect(owner).registerAgent(await fraudAgent.getAddress(), AgentType.FRAUD_DETECTION);
        await oracleRegistry.connect(owner).registerAgent(await routingAgent.getAddress(), AgentType.ROUTING);

        // 2. Deploy two separate Shipment Collections
        const ShipmentContractFactory = await ethers.getContractFactory("Shipment");
        electronicsShipments = await ShipmentContractFactory.deploy(await oracleRegistry.getAddress());
        pharmaShipments = await ShipmentContractFactory.deploy(await oracleRegistry.getAddress());

        // 3. Link collections to the factory
        await electronicsShipments.setFactory(await shipmentFactory.getAddress());
        await pharmaShipments.setFactory(await shipmentFactory.getAddress());
        
        // 4. Register collections with the factory so it can mint them
        await shipmentFactory.registerShipmentContract(await electronicsShipments.getAddress());
        await shipmentFactory.registerShipmentContract(await pharmaShipments.getAddress());
    });

    it("Should execute a successful multi-node electronics shipment", async function () {
        const tokenId = 0; // First token in the electronics collection
        const payment = ethers.parseEther("5.0");
        const plannedRoute = [
            await shipper.getAddress(),
            await distributor.getAddress(),
            await retailer.getAddress(),
            await recipient.getAddress()
        ];

        // === Step 1: Create an electronics shipment via the universal factory ===
        await shipmentFactory.connect(shipper).createShipment(
            await electronicsShipments.getAddress(), // Specify which collection
            await recipient.getAddress(),
            "High-Value Electronics",
            plannedRoute,
            payment,
            { value: payment }
        );

        // === Step 2: Shipper -> Distributor Handover ===
        await electronicsShipments.connect(shipper).initiateHandover(tokenId);
        await electronicsShipments.connect(distributor).requestVerification(tokenId, ethers.toUtf8Bytes("SCAN_DATA_1"));
        await electronicsShipments.connect(fraudAgent).confirmVerification(tokenId, await distributor.getAddress());
        expect(await electronicsShipments.ownerOf(tokenId)).to.equal(await distributor.getAddress());

        // === Step 3: Distributor -> Retailer Handover ===
        await electronicsShipments.connect(distributor).initiateHandover(tokenId);
        await electronicsShipments.connect(retailer).requestVerification(tokenId, ethers.toUtf8Bytes("SCAN_DATA_2"));
        await electronicsShipments.connect(fraudAgent).confirmVerification(tokenId, await retailer.getAddress());
        expect(await electronicsShipments.ownerOf(tokenId)).to.equal(await retailer.getAddress());
        
        // === Step 4: Final Delivery ===
        await electronicsShipments.connect(retailer).initiateHandover(tokenId);
        await electronicsShipments.connect(recipient).requestVerification(tokenId, ethers.toUtf8Bytes("SCAN_DATA_3"));
        await electronicsShipments.connect(fraudAgent).confirmVerification(tokenId, await recipient.getAddress());
        expect(await electronicsShipments.ownerOf(tokenId)).to.equal(await recipient.getAddress());

        // === Step 5: Payout ===
        const initialBalance = await ethers.provider.getBalance(shipper);
        const tx = await electronicsShipments.connect(shipper).finalizeAndPay(tokenId);
        const receipt = await tx.wait();
        const gasUsed = receipt!.gasUsed * tx.gasPrice!;
        expect(await ethers.provider.getBalance(shipper)).to.equal(initialBalance - gasUsed + payment);
    });

    it("Should create another shipment in a different collection without interference", async function () {
        const tokenId = 0; // First token in the *pharma* collection
        const payment = ethers.parseEther("20.0");
        const pharmaRoute = [await shipper.getAddress(), await recipient.getAddress()];

        // Create a pharma shipment
        await shipmentFactory.connect(shipper).createShipment(
            await pharmaShipments.getAddress(), // Specify the pharma collection
            await recipient.getAddress(),
            "Temperature-Sensitive Medicine",
            pharmaRoute,
            payment,
            { value: payment }
        );

        // Verify it exists in the correct collection
        expect(await pharmaShipments.ownerOf(tokenId)).to.equal(await shipper.getAddress());
        const details = await pharmaShipments.shipmentDetails(tokenId);
        expect(details.cargoDetails).to.equal("Temperature-Sensitive Medicine");

        // Verify the electronics collection is untouched (it should not have a token with ID 1)
       await expect(electronicsShipments.ownerOf(1))
        .to.be.revertedWithCustomError(electronicsShipments, "ERC721NonexistentToken")
        .withArgs(1);
    });
});