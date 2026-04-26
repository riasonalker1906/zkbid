// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

contract MockVerifier {
    bool public result = true;
    bytes32[] private expectedInputs;

    function setResult(bool result_) external {
        result = result_;
    }

    function setExpectedInputs(bytes32[] calldata inputs_) external {
        delete expectedInputs;
        for (uint256 i = 0; i < inputs_.length; i++) {
            expectedInputs.push(inputs_[i]);
        }
    }

    function verify(bytes calldata, bytes32[] calldata publicInputs) external view returns (bool) {
        if (!result) return false;
        if (expectedInputs.length == 0) return true;
        if (publicInputs.length != expectedInputs.length) return false;
        for (uint256 i = 0; i < publicInputs.length; i++) {
            if (publicInputs[i] != expectedInputs[i]) return false;
        }
        return true;
    }
}
