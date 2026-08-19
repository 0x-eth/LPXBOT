// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {IERC20} from "../vendor/openzeppelin-contracts-v5.4.0/token/ERC20/IERC20.sol";
import {SafeERC20} from "../vendor/openzeppelin-contracts-v5.4.0/token/ERC20/utils/SafeERC20.sol";
import {IAllowanceTransfer} from "../vendor/permit2-cc56ad0f/interfaces/IAllowanceTransfer.sol";

contract TestOnlyPermit2 is IAllowanceTransfer {
    using SafeERC20 for IERC20;

    bytes32 public constant override DOMAIN_SEPARATOR = keccak256("LPBOT_TEST_ONLY_PERMIT2");

    mapping(address owner => mapping(address token => mapping(address spender => PackedAllowance)))
        private allowances;

    function allowance(address user, address token, address spender)
        external
        view
        override
        returns (uint160 amount, uint48 expiration, uint48 nonce)
    {
        PackedAllowance memory value = allowances[user][token][spender];
        return (value.amount, value.expiration, value.nonce);
    }

    function approve(address token, address spender, uint160 amount, uint48 expiration) external override {
        PackedAllowance storage value = allowances[msg.sender][token][spender];
        value.amount = amount;
        value.expiration = expiration == 0 ? uint48(block.timestamp) : expiration;
        emit Approval(msg.sender, token, spender, amount, value.expiration);
    }

    function permit(address owner, PermitSingle memory permitSingle, bytes calldata) external override {
        _permit(owner, permitSingle.details, permitSingle.spender, permitSingle.sigDeadline);
    }

    function permit(address owner, PermitBatch memory permitBatch, bytes calldata) external override {
        require(permitBatch.sigDeadline >= block.timestamp, "permit signature expired");
        for (uint256 index = 0; index < permitBatch.details.length; index++) {
            _permit(owner, permitBatch.details[index], permitBatch.spender, permitBatch.sigDeadline);
        }
    }

    function transferFrom(address from, address to, uint160 amount, address token) external override {
        _transferFrom(from, to, amount, token, msg.sender);
    }

    function transferFrom(AllowanceTransferDetails[] calldata transferDetails) external override {
        for (uint256 index = 0; index < transferDetails.length; index++) {
            AllowanceTransferDetails calldata detail = transferDetails[index];
            _transferFrom(detail.from, detail.to, detail.amount, detail.token, msg.sender);
        }
    }

    function lockdown(TokenSpenderPair[] calldata approvals) external override {
        for (uint256 index = 0; index < approvals.length; index++) {
            TokenSpenderPair calldata pair = approvals[index];
            allowances[msg.sender][pair.token][pair.spender].amount = 0;
            emit Lockdown(msg.sender, pair.token, pair.spender);
        }
    }

    function invalidateNonces(address token, address spender, uint48 newNonce) external override {
        PackedAllowance storage value = allowances[msg.sender][token][spender];
        uint48 oldNonce = value.nonce;
        if (newNonce <= oldNonce || newNonce - oldNonce > type(uint16).max) {
            revert ExcessiveInvalidation();
        }
        value.nonce = newNonce;
        emit NonceInvalidation(msg.sender, token, spender, newNonce, oldNonce);
    }

    function _permit(address owner, PermitDetails memory details, address spender, uint256 sigDeadline) private {
        require(sigDeadline >= block.timestamp, "permit signature expired");
        PackedAllowance storage value = allowances[owner][details.token][spender];
        require(details.nonce == value.nonce, "permit nonce mismatch");
        value.amount = details.amount;
        value.expiration = details.expiration;
        value.nonce = details.nonce + 1;
        emit Permit(owner, details.token, spender, details.amount, details.expiration, details.nonce);
    }

    function _transferFrom(address from, address to, uint160 amount, address token, address spender) private {
        PackedAllowance storage value = allowances[from][token][spender];
        if (value.expiration < block.timestamp) revert AllowanceExpired(value.expiration);
        if (value.amount < amount) revert InsufficientAllowance(value.amount);
        if (value.amount != type(uint160).max) value.amount -= amount;
        IERC20(token).safeTransferFrom(from, to, amount);
    }
}
