// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {IERC20} from "../vendor/openzeppelin-contracts-v5.4.0/token/ERC20/IERC20.sol";
import {SafeERC20} from "../vendor/openzeppelin-contracts-v5.4.0/token/ERC20/utils/SafeERC20.sol";
import {ILocalExecutionAdapter} from "./interfaces/ILocalExecutionAdapter.sol";

interface ITestOnlyPositionManager {
    function executePosition(ILocalExecutionAdapter.PositionRequest calldata request)
        external
        returns (uint256 tokenId, uint256 amount0, uint256 amount1);
}

contract TestOnlyPositionManager is ITestOnlyPositionManager {
    using SafeERC20 for IERC20;

    uint256 public nextTokenId = 1;
    mapping(uint256 tokenId => address owner) public ownerOf;

    event Transfer(address indexed from, address indexed to, uint256 indexed tokenId);

    function executePosition(ILocalExecutionAdapter.PositionRequest calldata request)
        external
        returns (uint256 tokenId, uint256 amount0, uint256 amount1)
    {
        require(block.timestamp <= request.deadline, "position deadline expired");
        if (
            request.action == ILocalExecutionAdapter.PositionAction.Mint
                || request.action == ILocalExecutionAdapter.PositionAction.Increase
        ) {
            amount0 = (request.amount0 * 9) / 10;
            amount1 = (request.amount1 * 9) / 10;
            require(amount0 >= request.minAmount0 && amount1 >= request.minAmount1, "position minimum not met");
            if (amount0 > 0) IERC20(request.token0).safeTransferFrom(msg.sender, address(this), amount0);
            if (amount1 > 0) IERC20(request.token1).safeTransferFrom(msg.sender, address(this), amount1);
            if (request.action == ILocalExecutionAdapter.PositionAction.Mint) {
                tokenId = nextTokenId++;
                ownerOf[tokenId] = request.nftRecipient;
                emit Transfer(address(0), request.nftRecipient, tokenId);
            } else {
                tokenId = request.tokenId;
                require(ownerOf[tokenId] == request.nftRecipient, "position owner mismatch");
            }
            return (tokenId, amount0, amount1);
        }

        tokenId = request.tokenId;
        require(ownerOf[tokenId] == request.nftRecipient, "position owner mismatch");
        amount0 = request.minAmount0;
        amount1 = request.minAmount1;
        if (amount0 > 0) IERC20(request.token0).safeTransfer(request.outputRecipient, amount0);
        if (amount1 > 0) IERC20(request.token1).safeTransfer(request.outputRecipient, amount1);
        if (request.action == ILocalExecutionAdapter.PositionAction.Decrease) {
            ownerOf[tokenId] = address(0);
            emit Transfer(request.nftRecipient, address(0), tokenId);
        }
    }
}
