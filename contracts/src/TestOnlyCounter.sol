// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

contract TestOnlyCounter {
    error Unauthorized(address caller);

    address public immutable owner;
    uint256 public count;

    constructor(uint256 initialCount) {
        owner = msg.sender;
        count = initialCount;
    }

    function increment() external {
        if (msg.sender != owner) revert Unauthorized(msg.sender);
        count += 1;
    }
}
