// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {TestOnlyCounter} from "../src/TestOnlyCounter.sol";

contract UntrustedCounterCaller {
    function increment(TestOnlyCounter counter) external returns (bool success, bytes memory data) {
        return address(counter).call(abi.encodeCall(TestOnlyCounter.increment, ()));
    }
}

contract TestOnlyCounterTest {
    function testDeploysWithInitialState() public {
        TestOnlyCounter counter = new TestOnlyCounter(41);

        require(counter.owner() == address(this), "unexpected owner");
        require(counter.count() == 41, "unexpected initial count");
    }

    function testOwnerCanIncrementState() public {
        TestOnlyCounter counter = new TestOnlyCounter(41);

        counter.increment();

        require(counter.count() == 42, "increment did not change state");
    }

    function testUnauthorizedCallerRevertsWithoutStateChange() public {
        TestOnlyCounter counter = new TestOnlyCounter(41);
        UntrustedCounterCaller caller = new UntrustedCounterCaller();

        (bool success, bytes memory data) = caller.increment(counter);

        require(!success, "unauthorized increment succeeded");
        require(data.length >= 4, "missing revert selector");
        bytes4 selector;
        assembly {
            selector := mload(add(data, 32))
        }
        require(selector == TestOnlyCounter.Unauthorized.selector, "unexpected revert");
        require(counter.count() == 41, "failed call changed state");
    }
}
