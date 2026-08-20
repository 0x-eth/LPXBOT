// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {ILocalExecutionAdapter} from "../src/interfaces/ILocalExecutionAdapter.sol";
import {LocalExecutionAdapter} from "../src/LocalExecutionAdapter.sol";
import {TestOnlyERC20} from "../src/TestOnlyERC20.sol";
import {TestOnlyPermit2} from "../src/TestOnlyPermit2.sol";
import {TestOnlyPositionManager} from "../src/TestOnlyPositionManager.sol";
import {TestOnlySwapRouter} from "../src/TestOnlySwapRouter.sol";
import {WalletHelperV2} from "../src/WalletHelperV2.sol";

contract WalletHelperV2UntrustedCaller {
    function callHelper(address helper, bytes calldata data) external returns (bool, bytes memory) {
        return helper.call(data);
    }
}

contract WalletHelperV2Test {
    LocalExecutionAdapter private adapter;
    TestOnlyERC20 private tokenA;
    TestOnlyERC20 private tokenB;
    TestOnlyPermit2 private permit2;
    WalletHelperV2 private helper;

    receive() external payable {}

    function setUp() public {
        tokenA = new TestOnlyERC20(type(uint128).max);
        tokenB = new TestOnlyERC20(type(uint128).max);
        permit2 = new TestOnlyPermit2();
        adapter = new LocalExecutionAdapter(address(new TestOnlySwapRouter()), address(new TestOnlyPositionManager()));
        helper = new WalletHelperV2(
            address(this),
            address(adapter),
            address(permit2),
            address(tokenA),
            address(tokenA).codehash,
            address(tokenB),
            address(tokenB).codehash
        );
    }

    function testFreezesImmutableIdentityAndAtomicGateClosed() public view {
        require(helper.owner() == address(this), "owner");
        require(helper.adapter() == address(adapter), "adapter");
        require(helper.permit2() == address(permit2), "permit2");
        require(helper.allowedTokenA() == address(tokenA), "token-a");
        require(helper.allowedTokenACodeHash() == address(tokenA).codehash, "token-a-hash");
        require(helper.allowedTokenB() == address(tokenB), "token-b");
        require(helper.allowedTokenBCodeHash() == address(tokenB).codehash, "token-b-hash");
        require(!helper.ATOMIC_LIQUIDITY_EXECUTION_ENABLED(), "atomic gate");
    }

    function testAtomicLiquidityTypedEntryIsClosedAndOwnerOnly() public {
        WalletHelperV2.AtomicLiquidityPlan memory plan = WalletHelperV2.AtomicLiquidityPlan({
            action: ILocalExecutionAdapter.PositionAction.Mint,
            tokenIn: address(tokenA),
            tokenOut: address(tokenB),
            amountIn: 1,
            minSwapAmountOut: 1,
            tokenId: 0,
            amount0Min: 1,
            amount1Min: 1,
            deadline: block.timestamp + 600,
            serviceFeeBps: 0
        });
        WalletHelperV2.Permit2Authorization memory authorization;
        bytes memory callData =
            abi.encodeCall(WalletHelperV2.executeAtomicLiquidity, (keccak256("atomic"), plan, authorization));
        (bool ownerSuccess, bytes memory ownerResult) = address(helper).call(callData);
        require(!ownerSuccess, "owner atomic call succeeded");
        require(_selector(ownerResult) == WalletHelperV2.AtomicLiquidityExecutionClosed.selector, "atomic error");

        WalletHelperV2UntrustedCaller caller = new WalletHelperV2UntrustedCaller();
        (bool callerSuccess, bytes memory callerResult) = caller.callHelper(address(helper), callData);
        require(!callerSuccess, "untrusted atomic call succeeded");
        require(_selector(callerResult) == WalletHelperV2.Unauthorized.selector, "owner gate");
    }

    function testKeepsZeroFeeAndFixedOwnerSweepConstraints() public {
        tokenA.transfer(address(helper), 101);
        helper.sweepToken(keccak256("sweep"), address(tokenA), 100);
        require(tokenA.balanceOf(address(helper)) == 1, "dust");
        require(tokenA.balanceOf(address(this)) == type(uint128).max - 1, "recipient");

        WalletHelperV2.SwapPlan memory plan = WalletHelperV2.SwapPlan({
            tokenIn: address(tokenA),
            tokenOut: address(tokenB),
            amountIn: 1,
            minAmountOut: 1,
            deadline: block.timestamp + 600,
            serviceFeeBps: 1
        });
        WalletHelperV2.Permit2Authorization memory authorization;
        (bool success, bytes memory result) =
            address(helper).call(abi.encodeCall(WalletHelperV2.executeSwap, (keccak256("fee"), plan, authorization)));
        require(!success, "fee call succeeded");
        require(_selector(result) == WalletHelperV2.NonZeroServiceFeeForbidden.selector, "fee gate");
    }

    function _selector(bytes memory data) private pure returns (bytes4 selector) {
        require(data.length >= 4, "missing selector");
        assembly ("memory-safe") {
            selector := mload(add(data, 32))
        }
    }
}
