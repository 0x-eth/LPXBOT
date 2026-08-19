// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {IERC20} from "../vendor/openzeppelin-contracts-v5.4.0/token/ERC20/IERC20.sol";
import {SafeERC20} from "../vendor/openzeppelin-contracts-v5.4.0/token/ERC20/utils/SafeERC20.sol";

interface ITestOnlySwapRouter {
    struct ExactInput {
        address tokenIn;
        address tokenOut;
        uint256 amountIn;
        uint256 minAmountOut;
        uint256 deadline;
        address recipient;
    }

    function swapExactInput(ExactInput calldata input) external returns (uint256 amountOut);
}

contract TestOnlySwapRouter is ITestOnlySwapRouter {
    using SafeERC20 for IERC20;

    uint256 public amountOutBps = 10_000;

    function setAmountOutBps(uint256 value) external {
        require(value <= 20_000, "rate too high");
        amountOutBps = value;
    }

    function swapExactInput(ExactInput calldata input) external returns (uint256 amountOut) {
        require(block.timestamp <= input.deadline, "router deadline expired");
        require(input.tokenIn != input.tokenOut, "identical tokens");
        amountOut = (input.amountIn * amountOutBps) / 10_000;
        require(amountOut >= input.minAmountOut, "router minimum not met");
        IERC20(input.tokenIn).safeTransferFrom(msg.sender, address(this), input.amountIn);
        IERC20(input.tokenOut).safeTransfer(input.recipient, amountOut);
    }
}
