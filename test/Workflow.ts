import { expect } from "chai";
import { ethers } from "hardhat";
import { Signer } from "ethers";
import { Shipment, ShipmentFactory, OracleRegistry } from "../typechain-types";

describe("Full Supply Chain Workflow (Hybrid Verification)", function () {
    // --- Actors & Agents ---
    let owner: Signer;
    let shipper: Signer, distributor: Signer, retailer: Signer, recipient: Signer;
    let fraudAgent: Signer;

    // --- Contracts ---
    let oracleRegistry: OracleRegistry;
    let shipmentFactory: ShipmentFactory;
    let electronicsShipments: Shipment;

    const AgentType = { ROUTING: 0, ARBITRATION: 1, FRAUD_DETECTION: 2 };

    before(async function () {
        [owner, shipper, distributor, retailer, recipient, fraudAgent] = await ethers.getSigners();

        const OracleRegistryFactory = await ethers.getContractFactory("OracleRegistry");
        oracleRegistry = await OracleRegistryFactory.deploy();
        
        const UniversalFactory = await ethers.getContractFactory("ShipmentFactory");
        shipmentFactory = await UniversalFactory.deploy();
        
        await oracleRegistry.connect(owner).registerAgent(await fraudAgent.getAddress(), AgentType.FRAUD_DETECTION);

        const ShipmentContractFactory = await ethers.getContractFactory("Shipment");
        electronicsShipments = await ShipmentContractFactory.deploy(await oracleRegistry.getAddress());

        await electronicsShipments.setFactory(await shipmentFactory.getAddress());
        await shipmentFactory.registerShipmentContract(await electronicsShipments.getAddress());
    });

    it("Should execute a successful multi-node shipment using the hash verification model", async function () {
        const tokenId = 0;
        const payment = ethers.parseEther("5.0");
        const plannedRoute = [
            await shipper.getAddress(),
            await distributor.getAddress(),
            await retailer.getAddress(),
            await recipient.getAddress()
        ];
        
        // === Step 1: Generate Secret and Create Shipment ===
        // This simulates the frontend generating the secret and its hash
        const plaintextSecret = ethers.randomBytes(32);
        const keyHash = ethers.keccak256(plaintextSecret);

        await shipmentFactory.connect(shipper).createShipment(
            await electronicsShipments.getAddress(),
            await recipient.getAddress(),
            "High-Value Electronics",
            plannedRoute,
            payment,
            keyHash, // Pass the HASH on-chain
            { value: payment }
        );

        // This would be the point where the frontend calls the off-chain API
        // to store the PLAINTEXT secret in the secure keystore. We simulate this by just holding onto the variable.

        // === Step 2: Shipper -> Distributor Handover ===
        await electronicsShipments.connect(shipper).initiateHandover(tokenId);
        
        // The distributor scans the QR code, gets the plaintextSecret, hashes it, and submits the hash.
        const distributorProofHash = ethers.keccak256(plaintextSecret);
        await electronicsShipments.connect(distributor).requestVerification(tokenId, distributorProofHash);
        
        // Off-chain, the agent would now fetch the original secret, re-hash it, and see it matches.
        // It then confirms the verification on-chain.
        await electronicsShipments.connect(fraudAgent).confirmVerification(tokenId, await distributor.getAddress());
        expect(await electronicsShipments.ownerOf(tokenId)).to.equal(await distributor.getAddress());

        // === Step 3: Distributor -> Retailer Handover ===
        await electronicsShipments.connect(distributor).initiateHandover(tokenId);
        const retailerProofHash = ethers.keccak256(plaintextSecret); // Same secret used for the whole journey
        await electronicsShipments.connect(retailer).requestVerification(tokenId, retailerProofHash);
        await electronicsShipments.connect(fraudAgent).confirmVerification(tokenId, await retailer.getAddress());
        expect(await electronicsShipments.ownerOf(tokenId)).to.equal(await retailer.getAddress());
        
        // === Step 4: Final Delivery ===
        await electronicsShipments.connect(retailer).initiateHandover(tokenId);
        const recipientProofHash = ethers.keccak256(plaintextSecret);
        await electronicsShipments.connect(recipient).requestVerification(tokenId, recipientProofHash);
        await electronicsShipments.connect(fraudAgent).confirmVerification(tokenId, await recipient.getAddress());
        expect(await electronicsShipments.ownerOf(tokenId)).to.equal(await recipient.getAddress());

        // === Step 5: Payout ===
        const initialBalance = await ethers.provider.getBalance(shipper);
        const tx = await electronicsShipments.connect(shipper).finalizeAndPay(tokenId);
        const receipt = await tx.wait();
        const gasUsed = receipt!.gasUsed * tx.gasPrice!;
        expect(await ethers.provider.getBalance(shipper)).to.equal(initialBalance - gasUsed + payment);
    });

    it("Should be flagged by the agent if the wrong secret hash is provided", async function() {
        const tokenId = 1; // New shipment
        const payment = ethers.parseEther("1.0");
        const route = [await shipper.getAddress(), await recipient.getAddress()];

        const realSecret = ethers.randomBytes(32);
        const realSecretHash = ethers.keccak256(realSecret);
        
        await shipmentFactory.connect(shipper).createShipment(
            await electronicsShipments.getAddress(),
            await recipient.getAddress(), "Test Item", route, payment, realSecretHash, { value: payment }
        );

        await electronicsShipments.connect(shipper).initiateHandover(tokenId);

        // The recipient provides a hash of the WRONG secret
        const wrongSecret = ethers.randomBytes(32);
        const wrongProofHash = ethers.keccak256(wrongSecret);
        await electronicsShipments.connect(recipient).requestVerification(tokenId, wrongProofHash);
        
        // The off-chain agent would compare hashes, find they don't match, and flag the shipment.
        await expect(electronicsShipments.connect(fraudAgent).flagShipment(tokenId, "Proof hash mismatch"))
            .to.emit(electronicsShipments, "ShipmentFlagged")
            .withArgs(tokenId, "Proof hash mismatch");
        
        const details = await electronicsShipments.shipmentDetails(tokenId);
        expect(details.status).to.equal(5); // 5 is Disputed
    });
});