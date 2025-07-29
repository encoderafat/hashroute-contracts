import { expect } from "chai";
import { ethers } from "hardhat";
import { Signer } from "ethers";
import { OracleRegistry } from "../typechain-types";

describe("OracleRegistry", function () {
    let oracleRegistry: OracleRegistry;
    let owner: Signer;
    let agent1: Signer;
    let agent2: Signer;
    let nonOwner: Signer;

    // Agent type enums from the contract
    const AgentType = {
        ROUTING: 0,
        ARBITRATION: 1,
        FRAUD_DETECTION: 2,
    };

    beforeEach(async function () {
        [owner, agent1, agent2, nonOwner] = await ethers.getSigners();
        const OracleRegistryFactory = await ethers.getContractFactory("OracleRegistry");
        oracleRegistry = await OracleRegistryFactory.deploy();
        await oracleRegistry.waitForDeployment();
    });

    it("Should deploy with the correct owner", async function () {
        expect(await oracleRegistry.owner()).to.equal(await owner.getAddress());
    });

    describe("Agent Registration", function () {
        it("Should allow the owner to register a new agent", async function () {
            const agent1Address = await agent1.getAddress();
            await expect(oracleRegistry.connect(owner).registerAgent(agent1Address, AgentType.ROUTING))
                .to.emit(oracleRegistry, "AgentRegistered")
                .withArgs(agent1Address, AgentType.ROUTING);

            expect(await oracleRegistry.isAgent(AgentType.ROUTING, agent1Address)).to.be.true;
        });

        it("Should prevent non-owners from registering agents", async function () {
            const agent1Address = await agent1.getAddress();
            await expect(oracleRegistry.connect(nonOwner).registerAgent(agent1Address, AgentType.ROUTING))
                .to.be.revertedWithCustomError(oracleRegistry, "OwnableUnauthorizedAccount");
        });

        it("Should allow registering agents for different types", async function () {
            const agent1Address = await agent1.getAddress();
            const agent2Address = await agent2.getAddress();

            await oracleRegistry.connect(owner).registerAgent(agent1Address, AgentType.FRAUD_DETECTION);
            await oracleRegistry.connect(owner).registerAgent(agent2Address, AgentType.ARBITRATION);

            expect(await oracleRegistry.isAgent(AgentType.FRAUD_DETECTION, agent1Address)).to.be.true;
            expect(await oracleRegistry.isAgent(AgentType.ARBITRATION, agent1Address)).to.be.false;
            expect(await oracleRegistry.isAgent(AgentType.ARBITRATION, agent2Address)).to.be.true;
        });
    });

    describe("Agent Revocation", function () {
        it("Should allow the owner to revoke an agent", async function () {
            const agent1Address = await agent1.getAddress();
            await oracleRegistry.connect(owner).registerAgent(agent1Address, AgentType.ROUTING);
            expect(await oracleRegistry.isAgent(AgentType.ROUTING, agent1Address)).to.be.true;

            await expect(oracleRegistry.connect(owner).revokeAgent(agent1Address, AgentType.ROUTING))
                .to.emit(oracleRegistry, "AgentRevoked")
                .withArgs(agent1Address, AgentType.ROUTING);

            expect(await oracleRegistry.isAgent(AgentType.ROUTING, agent1Address)).to.be.false;
        });

        it("Should prevent non-owners from revoking agents", async function () {
            const agent1Address = await agent1.getAddress();
            await oracleRegistry.connect(owner).registerAgent(agent1Address, AgentType.ROUTING);
            await expect(oracleRegistry.connect(nonOwner).revokeAgent(agent1Address, AgentType.ROUTING))
                 .to.be.revertedWithCustomError(oracleRegistry, "OwnableUnauthorizedAccount");
        });
    });
});