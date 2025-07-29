import { expect } from "chai";
import { ethers } from "hardhat";
import { Signer } from "ethers";
import { ShipmentFactory, Shipment, OracleRegistry } from "../typechain-types";

describe("ShipmentFactory (Universal)", function () {
    let factory: ShipmentFactory;
    let shipmentCollection1: Shipment;
    let shipmentCollection2: Shipment;
    let oracleRegistry: OracleRegistry;
    let owner: Signer, user: Signer;

    beforeEach(async function () {
        [owner, user] = await ethers.getSigners();

        // Deploy the dependencies
        const OracleRegistryFactory = await ethers.getContractFactory("OracleRegistry");
        oracleRegistry = await OracleRegistryFactory.deploy();

        const ShipmentFactory = await ethers.getContractFactory("Shipment");
        shipmentCollection1 = await ShipmentFactory.deploy(await oracleRegistry.getAddress());
        shipmentCollection2 = await ShipmentFactory.deploy(await oracleRegistry.getAddress());

        // Deploy the main factory contract
        const UniversalFactory = await ethers.getContractFactory("ShipmentFactory");
        factory = await UniversalFactory.deploy();

        // Link collections to factory for minting
        await shipmentCollection1.setFactory(await factory.getAddress());
        await shipmentCollection2.setFactory(await factory.getAddress());
    });

    describe("Collection Registry Management", function () {
        it("Should allow the owner to register a new shipment collection", async function () {
            const collectionAddr = await shipmentCollection1.getAddress();
            await expect(factory.connect(owner).registerShipmentContract(collectionAddr))
                .to.emit(factory, "ShipmentCollectionRegistered")
                .withArgs(collectionAddr);
            
            expect(await factory.isShipmentContractRegistered(collectionAddr)).to.be.true;
        });

        it("Should prevent non-owners from registering a collection", async function () {
            const collectionAddr = await shipmentCollection1.getAddress();
            await expect(factory.connect(user).registerShipmentContract(collectionAddr))
                .to.be.revertedWithCustomError(factory, "OwnableUnauthorizedAccount");
        });

        it("Should allow the owner to deregister a collection", async function () {
            const collectionAddr = await shipmentCollection1.getAddress();
            await factory.connect(owner).registerShipmentContract(collectionAddr);
            expect(await factory.isShipmentContractRegistered(collectionAddr)).to.be.true;

            await expect(factory.connect(owner).deregisterShipmentContract(collectionAddr))
                .to.emit(factory, "ShipmentCollectionDeregistered")
                .withArgs(collectionAddr);
            
            expect(await factory.isShipmentContractRegistered(collectionAddr)).to.be.false;
        });
    });

    describe("Shipment Creation", function () {
        beforeEach(async function () {
            // Register collection 1 for minting
            await factory.connect(owner).registerShipmentContract(await shipmentCollection1.getAddress());
        });

        it("Should create a shipment in a registered collection", async function () {
            const collectionAddr = await shipmentCollection1.getAddress();
            const recipientAddr = await user.getAddress();
            const payment = ethers.parseEther("1.0");

            await expect(factory.connect(user).createShipment(
                collectionAddr,
                recipientAddr,
                "Test Cargo",
                [await user.getAddress(), recipientAddr],
                payment,
                { value: payment }
            )).to.emit(factory, "ShipmentCreated")
              .withArgs(collectionAddr, 0, await user.getAddress()); // TokenID 0 for the first mint in this collection
            
            expect(await shipmentCollection1.ownerOf(0)).to.equal(await user.getAddress());
        });

        it("Should fail to create a shipment in an unregistered collection", async function () {
            const unregCollectionAddr = await shipmentCollection2.getAddress();
            const recipientAddr = await user.getAddress();
            const payment = ethers.parseEther("1.0");

            await expect(factory.connect(user).createShipment(
                unregCollectionAddr,
                recipientAddr,
                "Test Cargo",
                [await user.getAddress(), recipientAddr],
                payment,
                { value: payment }
            )).to.be.revertedWith("Factory: Target contract is not registered");
        });
    });
});