// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/access/Ownable.sol";

contract OracleRegistry is Ownable {
    
    // Different types of trusted agents in our system
    enum AgentType { ROUTING, ARBITRATION, FRAUD_DETECTION }

    mapping(AgentType => mapping(address => bool)) public isAgent;

    event AgentRegistered(address indexed agentAddress, AgentType indexed agentType);
    event AgentRevoked(address indexed agentAddress, AgentType indexed agentType);

    constructor() Ownable(msg.sender) {}

    modifier onlyRegisteredAgent(AgentType _type) {
        require(isAgent[_type][msg.sender], "Caller is not a registered agent of this type");
        _;
    }

    function registerAgent(address _agentAddress, AgentType _agentType) public onlyOwner {
        isAgent[_agentType][_agentAddress] = true;
        emit AgentRegistered(_agentAddress, _agentType);
    }

    function revokeAgent(address _agentAddress, AgentType _agentType) public onlyOwner {
        isAgent[_agentType][_agentAddress] = false;
        emit AgentRevoked(_agentAddress, _agentType);
    }
}