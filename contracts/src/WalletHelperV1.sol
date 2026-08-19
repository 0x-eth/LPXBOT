// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {IERC20} from "../vendor/openzeppelin-contracts-v5.4.0/token/ERC20/IERC20.sol";
import {SafeERC20} from "../vendor/openzeppelin-contracts-v5.4.0/token/ERC20/utils/SafeERC20.sol";
import {IAllowanceTransfer} from "../vendor/permit2-cc56ad0f/interfaces/IAllowanceTransfer.sol";
import {ILocalExecutionAdapter} from "./interfaces/ILocalExecutionAdapter.sol";

contract WalletHelperV1 {
    using SafeERC20 for IERC20;

    uint256 public constant MAX_AMOUNT = type(uint128).max;
    uint256 public constant MAX_DEADLINE_WINDOW = 1 days;
    uint256 public constant MAX_PERMIT2_EXPIRATION = 30 minutes;

    address public immutable adapter;
    address public immutable allowedTokenA;
    bytes32 public immutable allowedTokenACodeHash;
    address public immutable allowedTokenB;
    bytes32 public immutable allowedTokenBCodeHash;
    address public immutable owner;
    address public immutable permit2;

    mapping(bytes32 planDigest => bool executed) public executedPlans;

    uint256 private reentrancyStatus = 1;

    error AmountOutTooLow(uint256 actual, uint256 minimum);
    error DeadlineExpired();
    error DeadlineTooFar();
    error InvalidAmount();
    error InvalidConfiguration();
    error InvalidPermit2Authorization();
    error InvalidPlanDigest();
    error NativeTransferFailed();
    error NonZeroServiceFeeForbidden();
    error PlanAlreadyExecuted(bytes32 planDigest);
    error ReentrantCall();
    error TokenNotAllowed(address token);
    error Unauthorized(address caller);

    event NativeDeposited(uint256 amount);
    event PlanExecuted(bytes32 indexed planDigest, bytes4 indexed selector);
    event PositionExecuted(bytes32 indexed planDigest, uint256 indexed tokenId);
    event SwapExecuted(bytes32 indexed planDigest, address indexed tokenIn, address indexed tokenOut, uint256 amountOut);
    event Swept(bytes32 indexed planDigest, address indexed asset, uint256 amount);

    struct Permit2Authorization {
        bool enabled;
        IAllowanceTransfer.PermitSingle permitSingle;
        bytes signature;
    }

    struct SwapPlan {
        address tokenIn;
        address tokenOut;
        uint256 amountIn;
        uint256 minAmountOut;
        uint256 deadline;
        uint16 serviceFeeBps;
    }

    struct PositionPlan {
        ILocalExecutionAdapter.PositionAction action;
        address token0;
        address token1;
        uint256 tokenId;
        uint256 amount0;
        uint256 amount1;
        uint256 minAmount0;
        uint256 minAmount1;
        uint256 deadline;
        uint16 serviceFeeBps;
    }

    modifier onlyOwner() {
        if (msg.sender != owner) revert Unauthorized(msg.sender);
        _;
    }

    modifier nonReentrant() {
        if (reentrancyStatus != 1) revert ReentrantCall();
        reentrancyStatus = 2;
        _;
        reentrancyStatus = 1;
    }

    constructor(
        address owner_,
        address adapter_,
        address permit2_,
        address allowedTokenA_,
        bytes32 allowedTokenACodeHash_,
        address allowedTokenB_,
        bytes32 allowedTokenBCodeHash_
    ) {
        if (
            owner_ == address(0) || adapter_.code.length == 0 || permit2_.code.length == 0
                || allowedTokenA_ == allowedTokenB_ || allowedTokenA_.codehash != allowedTokenACodeHash_
                || allowedTokenB_.codehash != allowedTokenBCodeHash_
        ) {
            revert InvalidConfiguration();
        }
        owner = owner_;
        adapter = adapter_;
        permit2 = permit2_;
        allowedTokenA = allowedTokenA_;
        allowedTokenACodeHash = allowedTokenACodeHash_;
        allowedTokenB = allowedTokenB_;
        allowedTokenBCodeHash = allowedTokenBCodeHash_;
    }

    receive() external payable onlyOwner nonReentrant {
        emit NativeDeposited(msg.value);
    }

    function depositNative() external payable onlyOwner nonReentrant {
        emit NativeDeposited(msg.value);
    }

    function executeSwap(bytes32 planDigest, SwapPlan calldata plan, Permit2Authorization calldata authorization)
        external
        onlyOwner
        nonReentrant
        returns (uint256 amountOut)
    {
        _startPlan(planDigest);
        _validateToken(plan.tokenIn);
        _validateToken(plan.tokenOut);
        if (plan.tokenIn == plan.tokenOut) revert TokenNotAllowed(plan.tokenOut);
        _validateAmount(plan.amountIn);
        if (plan.minAmountOut == 0 || plan.minAmountOut > MAX_AMOUNT) revert InvalidAmount();
        _validateDeadline(plan.deadline);
        if (plan.serviceFeeBps != 0) revert NonZeroServiceFeeForbidden();

        uint256 ownerOutputBefore = IERC20(plan.tokenOut).balanceOf(owner);
        _pullToken(plan.tokenIn, plan.amountIn, plan.deadline, authorization);
        IERC20(plan.tokenIn).forceApprove(adapter, plan.amountIn);
        amountOut = ILocalExecutionAdapter(adapter).executeSwap(
            ILocalExecutionAdapter.SwapRequest({
                tokenIn: plan.tokenIn,
                tokenOut: plan.tokenOut,
                amountIn: plan.amountIn,
                minAmountOut: plan.minAmountOut,
                deadline: plan.deadline,
                recipient: owner,
                refundRecipient: owner
            })
        );
        IERC20(plan.tokenIn).forceApprove(adapter, 0);
        _refundToken(plan.tokenIn);
        uint256 ownerOutputDelta = IERC20(plan.tokenOut).balanceOf(owner) - ownerOutputBefore;
        if (amountOut < plan.minAmountOut) revert AmountOutTooLow(amountOut, plan.minAmountOut);
        if (ownerOutputDelta < plan.minAmountOut) {
            revert AmountOutTooLow(ownerOutputDelta, plan.minAmountOut);
        }
        emit SwapExecuted(planDigest, plan.tokenIn, plan.tokenOut, amountOut);
        emit PlanExecuted(planDigest, msg.sig);
    }

    function executePosition(bytes32 planDigest, PositionPlan calldata plan)
        external
        onlyOwner
        nonReentrant
        returns (uint256 tokenId, uint256 amount0, uint256 amount1)
    {
        _startPlan(planDigest);
        _validateToken(plan.token0);
        _validateToken(plan.token1);
        if (plan.token0 == plan.token1) revert TokenNotAllowed(plan.token1);
        _validateDeadline(plan.deadline);
        if (plan.serviceFeeBps != 0) revert NonZeroServiceFeeForbidden();
        bool hasInput = plan.action == ILocalExecutionAdapter.PositionAction.Mint
            || plan.action == ILocalExecutionAdapter.PositionAction.Increase;
        if (hasInput) {
            if (plan.amount0 == 0 && plan.amount1 == 0) revert InvalidAmount();
            if (plan.amount0 > 0) {
                _validateAmount(plan.amount0);
                IERC20(plan.token0).safeTransferFrom(owner, address(this), plan.amount0);
                IERC20(plan.token0).forceApprove(adapter, plan.amount0);
            }
            if (plan.amount1 > 0) {
                _validateAmount(plan.amount1);
                IERC20(plan.token1).safeTransferFrom(owner, address(this), plan.amount1);
                IERC20(plan.token1).forceApprove(adapter, plan.amount1);
            }
        }
        (tokenId, amount0, amount1) = ILocalExecutionAdapter(adapter).executePosition(
            ILocalExecutionAdapter.PositionRequest({
                action: plan.action,
                token0: plan.token0,
                token1: plan.token1,
                tokenId: plan.tokenId,
                amount0: plan.amount0,
                amount1: plan.amount1,
                minAmount0: plan.minAmount0,
                minAmount1: plan.minAmount1,
                deadline: plan.deadline,
                nftRecipient: owner,
                outputRecipient: owner,
                refundRecipient: owner
            })
        );
        if (plan.amount0 > 0) IERC20(plan.token0).forceApprove(adapter, 0);
        if (plan.amount1 > 0) IERC20(plan.token1).forceApprove(adapter, 0);
        _refundToken(plan.token0);
        _refundToken(plan.token1);
        emit PositionExecuted(planDigest, tokenId);
        emit PlanExecuted(planDigest, msg.sig);
    }

    function sweepToken(bytes32 planDigest, address token, uint256 amount) external onlyOwner nonReentrant {
        _startPlan(planDigest);
        _validateToken(token);
        _validateAmount(amount);
        IERC20(token).safeTransfer(owner, amount);
        emit Swept(planDigest, token, amount);
        emit PlanExecuted(planDigest, msg.sig);
    }

    function sweepNative(bytes32 planDigest, uint256 amount) external onlyOwner nonReentrant {
        _startPlan(planDigest);
        _validateAmount(amount);
        if (amount > address(this).balance) revert InvalidAmount();
        (bool success,) = payable(owner).call{value: amount}("");
        if (!success) revert NativeTransferFailed();
        emit Swept(planDigest, address(0), amount);
        emit PlanExecuted(planDigest, msg.sig);
    }

    function _pullToken(
        address token,
        uint256 amount,
        uint256 deadline,
        Permit2Authorization calldata authorization
    ) private {
        if (!authorization.enabled) {
            if (authorization.signature.length != 0) revert InvalidPermit2Authorization();
            IERC20(token).safeTransferFrom(owner, address(this), amount);
            return;
        }
        IAllowanceTransfer.PermitSingle calldata permitSingle = authorization.permitSingle;
        if (
            amount > type(uint160).max || permitSingle.details.token != token
                || permitSingle.details.amount != uint160(amount) || permitSingle.spender != address(this)
                || permitSingle.details.expiration < block.timestamp
                || permitSingle.details.expiration > block.timestamp + MAX_PERMIT2_EXPIRATION
                || permitSingle.sigDeadline < block.timestamp || permitSingle.sigDeadline > deadline
                || authorization.signature.length == 0
        ) {
            revert InvalidPermit2Authorization();
        }
        IAllowanceTransfer(permit2).permit(owner, permitSingle, authorization.signature);
        IAllowanceTransfer(permit2).transferFrom(owner, address(this), uint160(amount), token);
    }

    function _refundToken(address token) private {
        uint256 balance = IERC20(token).balanceOf(address(this));
        if (balance > 0) IERC20(token).safeTransfer(owner, balance);
    }

    function _startPlan(bytes32 planDigest) private {
        if (planDigest == bytes32(0)) revert InvalidPlanDigest();
        if (executedPlans[planDigest]) revert PlanAlreadyExecuted(planDigest);
        executedPlans[planDigest] = true;
    }

    function _validateAmount(uint256 amount) private pure {
        if (amount == 0 || amount > MAX_AMOUNT) revert InvalidAmount();
    }

    function _validateDeadline(uint256 deadline) private view {
        if (deadline < block.timestamp) revert DeadlineExpired();
        if (deadline > block.timestamp + MAX_DEADLINE_WINDOW) revert DeadlineTooFar();
    }

    function _validateToken(address token) private view {
        if (token == allowedTokenA && token.codehash == allowedTokenACodeHash) return;
        if (token == allowedTokenB && token.codehash == allowedTokenBCodeHash) return;
        revert TokenNotAllowed(token);
    }
}
