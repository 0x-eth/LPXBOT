// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {TestOnlyERC20} from "../src/TestOnlyERC20.sol";

contract TestOnlyERC20Test {
    function testTransfersExactBaseUnits() public {
        TestOnlyERC20 token = new TestOnlyERC20(1_000_000);
        address recipient = address(0xBEEF);

        require(token.transfer(recipient, 123_456), "transfer failed");

        require(token.balanceOf(address(this)) == 876_544, "sender balance mismatch");
        require(token.balanceOf(recipient) == 123_456, "recipient balance mismatch");
        require(token.totalSupply() == 1_000_000, "supply changed");
    }
}
