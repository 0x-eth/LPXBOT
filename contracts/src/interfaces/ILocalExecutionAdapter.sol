// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

interface ILocalExecutionAdapter {
    enum PositionAction {
        Mint,
        Increase,
        Collect,
        Decrease
    }

    struct SwapRequest {
        address tokenIn;
        address tokenOut;
        uint256 amountIn;
        uint256 minAmountOut;
        uint256 deadline;
        address recipient;
        address refundRecipient;
    }

    struct PositionRequest {
        PositionAction action;
        address token0;
        address token1;
        uint256 tokenId;
        uint256 amount0;
        uint256 amount1;
        uint256 minAmount0;
        uint256 minAmount1;
        uint256 deadline;
        address nftRecipient;
        address outputRecipient;
        address refundRecipient;
    }

    function executeSwap(SwapRequest calldata request) external returns (uint256 amountOut);

    function executePosition(PositionRequest calldata request)
        external
        returns (uint256 tokenId, uint256 amount0, uint256 amount1);
}
