import { ethers, network } from "hardhat";
import "dotenv/config";

// --- Configuration ---
// These are the Hedera account addresses for your off-chain agents.
// IMPORTANT: Make sure these are funded with some test HBAR.
const FRAUD_DETECTION_AGENT_ADDRESS = "0x1819041757d7dE6e7C9fa9D1556161F626186de4"; 
const ROUTING_AGENT_ADDRESS = "0xA43637EE69556DAfb3afA49CD0c57fC314B848bE"; 
const ARBITRATION_AGENT_ADDRESS = "0x2dDd663e7891991bdFcd4aB6b045c7E92CC12273"; 

// Agent type enums from the OracleRegistry contract
const AgentType = {
    ROUTING: 0,
    ARBITRATION: 1,
    FRAUD_DETECTION: 2,
};

async function main() {
    console.log(`\nDeploying contracts to **${network.name}**...`);

    const [deployer] = await ethers.getSigners();
    console.log(`\nDeployer Account: ${deployer.address}`);
    console.log(`Deployer Balance: ${(await ethers.provider.getBalance(deployer.address)).toString()} tinybar`);

    // --- 1. Deploy OracleRegistry ---
    console.log("\n1. Deploying OracleRegistry...");
    const oracleRegistryFactory = await ethers.getContractFactory("OracleRegistry");
    const oracleRegistry = await oracleRegistryFactory.deploy();
    await oracleRegistry.waitForDeployment();
    const oracleRegistryAddress = await oracleRegistry.getAddress();
    console.log(`   ✅ OracleRegistry deployed to: ${oracleRegistryAddress}`);

    // --- 2. Deploy Shipment Collection (e.g., for Electronics) ---
    console.log("\n2. Deploying Shipment collection contract (for 'Electronics')...");
    const shipmentContractFactory = await ethers.getContractFactory("Shipment");
    const electronicsShipments = await shipmentContractFactory.deploy(oracleRegistryAddress);
    await electronicsShipments.waitForDeployment();
    const electronicsShipmentsAddress = await electronicsShipments.getAddress();
    console.log(`   ✅ Electronics Shipment (ERC721) collection deployed to: ${electronicsShipmentsAddress}`);

    // --- 3. Deploy Universal ShipmentFactory ---
    console.log("\n3. Deploying universal ShipmentFactory...");
    const factoryContractFactory = await ethers.getContractFactory("ShipmentFactory");
    const shipmentFactory = await factoryContractFactory.deploy();
    await shipmentFactory.waitForDeployment();
    const shipmentFactoryAddress = await shipmentFactory.getAddress();
    console.log(`   ✅ ShipmentFactory deployed to: ${shipmentFactoryAddress}`);

    // --- 4. Link Contracts (Post-Deployment Setup) ---
    console.log("\n4. Linking contracts and setting permissions...");

    // a. Tell the Shipment collection which factory is allowed to mint
    process.stdout.write("   - Setting factory address on Shipment contract... ");
    const setFactoryTx = await electronicsShipments.setFactory(shipmentFactoryAddress);
    await setFactoryTx.wait();
    process.stdout.write("Done\n");

    // b. Register the Shipment collection with the Factory
    process.stdout.write("   - Registering Shipment collection with Factory... ");
    const registerTx = await shipmentFactory.registerShipmentContract(electronicsShipmentsAddress);
    await registerTx.wait();
    process.stdout.write("Done\n");
    console.log("   ✅ Contracts successfully linked.");

    // --- 5. Register Autonomous Agents ---
    console.log("\n5. Registering autonomous agent addresses...");

    // a. Fraud Detection Agent
    process.stdout.write(`   - Registering Fraud Detection Agent (${FRAUD_DETECTION_AGENT_ADDRESS})... `);
    const fraudAgentTx = await oracleRegistry.registerAgent(FRAUD_DETECTION_AGENT_ADDRESS, AgentType.FRAUD_DETECTION);
    await fraudAgentTx.wait();
    process.stdout.write("Done\n");
    
    // b. Routing Agent
    process.stdout.write(`   - Registering Routing Agent (${ROUTING_AGENT_ADDRESS})... `);
    const routingAgentTx = await oracleRegistry.registerAgent(ROUTING_AGENT_ADDRESS, AgentType.ROUTING);
    await routingAgentTx.wait();
    process.stdout.write("Done\n");
    
    // c. Arbitration Agent
    process.stdout.write(`   - Registering Arbitration Agent (${ARBITRATION_AGENT_ADDRESS})... `);
    const arbitrationAgentTx = await oracleRegistry.registerAgent(ARBITRATION_AGENT_ADDRESS, AgentType.ARBITRATION);
    await arbitrationAgentTx.wait();
    process.stdout.write("Done\n");
    console.log("   ✅ Agents successfully registered.");

    console.log("\n\n🚀 Deployment complete! 🚀\n");
    console.log("----------------------------------------------------");
    console.log("Deployed Contract Addresses:");
    console.log(`  - OracleRegistry:        ${oracleRegistryAddress}`);
    console.log(`  - ShipmentFactory:       ${shipmentFactoryAddress}`);
    console.log(`  - ElectronicsShipments:  ${electronicsShipmentsAddress}`);
    console.log("----------------------------------------------------");
}

main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
});