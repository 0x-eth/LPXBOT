// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {IERC20} from "../vendor/openzeppelin-contracts-v5.4.0/token/ERC20/IERC20.sol";
import {SafeERC20} from "../vendor/openzeppelin-contracts-v5.4.0/token/ERC20/utils/SafeERC20.sol";
import {ILocalExecutionAdapter} from "./interfaces/ILocalExecutionAdapter.sol";
import {ITestOnlyPositionManager} from "./TestOnlyPositionManager.sol";
import {ITestOnlySwapRouter} from "./TestOnlySwapRouter.sol";

contract LocalExecutionAdapter is ILocalExecutionAdapter {
    using SafeERC20 for IERC20;

    address public immutable positionManager;
    address public immutable router;

    error InvalidAdapterConfiguration();
    error InvalidRecipient();

    constructor(address router_, address positionManager_) {
        if (router_.code.length == 0 || positionManager_.code.length == 0) {
            revert InvalidAdapterConfiguration();
        }
        router = router_;
        positionManager = positionManager_;
    }

    function executeSwap(SwapRequest calldata request) external returns (uint256 amountOut) {
        if (request.recipient == address(0) || request.refundRecipient == address(0)) {
            revert InvalidRecipient();
        }
        IERC20 tokenIn = IERC20(request.tokenIn);
        tokenIn.safeTransferFrom(msg.sender, address(this), request.amountIn);
        tokenIn.forceApprove(router, request.amountIn);
        amountOut = ITestOnlySwapRouter(router)
            .swapExactInput(
                ITestOnlySwapRouter.ExactInput({
                tokenIn: request.tokenIn,
                tokenOut: request.tokenOut,
                amountIn: request.amountIn,
                minAmountOut: request.minAmountOut,
                deadline: request.deadline,
                recipient: request.recipient
            })
            );
        tokenIn.forceApprove(router, 0);
        uint256 refund = tokenIn.balanceOf(address(this));
        if (refund > 0) tokenIn.safeTransfer(request.refundRecipient, refund);
    }

    function executePosition(PositionRequest calldata request)
        external
        returns (uint256 tokenId, uint256 amount0, uint256 amount1)
    {
        if (
            request.nftRecipient == address(0) || request.outputRecipient == address(0)
                || request.refundRecipient == address(0)
        ) {
            revert InvalidRecipient();
        }
        IERC20 token0 = IERC20(request.token0);
        IERC20 token1 = IERC20(request.token1);
        bool hasInput = request.action == PositionAction.Mint || request.action == PositionAction.Increase;
        if (hasInput && request.amount0 > 0) {
            token0.safeTransferFrom(msg.sender, address(this), request.amount0);
            token0.forceApprove(positionManager, request.amount0);
        }
        if (hasInput && request.amount1 > 0) {
            token1.safeTransferFrom(msg.sender, address(this), request.amount1);
            token1.forceApprove(positionManager, request.amount1);
        }
        (tokenId, amount0, amount1) = ITestOnlyPositionManager(positionManager).executePosition(request);
        if (request.amount0 > 0) token0.forceApprove(positionManager, 0);
        if (request.amount1 > 0) token1.forceApprove(positionManager, 0);
        uint256 refund0 = token0.balanceOf(address(this));
        uint256 refund1 = token1.balanceOf(address(this));
        if (refund0 > 0) token0.safeTransfer(request.refundRecipient, refund0);
        if (refund1 > 0) token1.safeTransfer(request.refundRecipient, refund1);
    }
}
