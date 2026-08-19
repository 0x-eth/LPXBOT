// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {IERC20} from "../vendor/openzeppelin-contracts-v5.4.0/token/ERC20/IERC20.sol";
import {SafeERC20} from "../vendor/openzeppelin-contracts-v5.4.0/token/ERC20/utils/SafeERC20.sol";

/// @notice Synthetic position manager used only by the non-forked Anvil execution fixture.
contract TestOnlyPositionManagerV2 {
    using SafeERC20 for IERC20;

    struct FixturePosition {
        address owner;
        uint8 platformId;
        address token0;
        address token1;
        address poolAddress;
        bytes32 poolId;
        int24 tickLower;
        int24 tickUpper;
        int24 tickSpacing;
        uint24 feePips;
        uint128 liquidity;
        uint128 reserve0;
        uint128 reserve1;
        uint128 tokensOwed0;
        uint128 tokensOwed1;
    }

    struct Position {
        uint8 platformId;
        address token0;
        address token1;
        address poolAddress;
        bytes32 poolId;
        int24 tickLower;
        int24 tickUpper;
        int24 tickSpacing;
        uint24 feePips;
        uint128 liquidity;
        uint128 reserve0;
        uint128 reserve1;
        uint128 tokensOwed0;
        uint128 tokensOwed1;
    }

    struct CollectParams {
        uint256 tokenId;
        address recipient;
        uint128 amount0Max;
        uint128 amount1Max;
    }

    struct DecreaseLiquidityParams {
        uint256 tokenId;
        uint128 liquidity;
        uint256 amount0Min;
        uint256 amount1Min;
        uint256 deadline;
    }

    error InvalidFixture();
    error InvalidRecipient();
    error NotAuthorized();
    error PositionNotEmpty();
    error PositionUnknown();
    error SlippageCheckFailed();
    error TransactionExpired();
    error ZeroLiquidity();

    uint256 public nextTokenId = 1;
    mapping(uint256 tokenId => address owner) private _owners;
    mapping(uint256 tokenId => address operator) private _tokenApprovals;
    mapping(address owner => mapping(address operator => bool approved)) private _operatorApprovals;
    mapping(uint256 tokenId => Position position) private _positions;

    event Approval(address indexed owner, address indexed approved, uint256 indexed tokenId);
    event ApprovalForAll(address indexed owner, address indexed operator, bool approved);
    event Collect(uint256 indexed tokenId, address recipient, uint256 amount0, uint256 amount1);
    event DecreaseLiquidity(uint256 indexed tokenId, uint128 liquidity, uint256 amount0, uint256 amount1);
    event Transfer(address indexed from, address indexed to, uint256 indexed tokenId);

    function mintFixture(FixturePosition calldata fixture) external returns (uint256 tokenId) {
        bool v3 = fixture.platformId == 1 || fixture.platformId == 2;
        bool v4 = fixture.platformId == 4 || fixture.platformId == 5;
        if (
            fixture.owner == address(0) || fixture.token0 == address(0) || fixture.token1 == address(0)
                || fixture.token0 == fixture.token1 || fixture.liquidity == 0 || fixture.tickSpacing == 0
                || fixture.tickLower >= fixture.tickUpper || fixture.tickLower % fixture.tickSpacing != 0
                || fixture.tickUpper % fixture.tickSpacing != 0 || (!v3 && !v4)
                || (v3 && (fixture.poolAddress == address(0) || fixture.poolId != bytes32(0)))
                || (v4 && (fixture.poolAddress != address(0) || fixture.poolId == bytes32(0)))
        ) revert InvalidFixture();

        uint256 funding0 = uint256(fixture.reserve0) + fixture.tokensOwed0;
        uint256 funding1 = uint256(fixture.reserve1) + fixture.tokensOwed1;
        if (funding0 > 0) IERC20(fixture.token0).safeTransferFrom(msg.sender, address(this), funding0);
        if (funding1 > 0) IERC20(fixture.token1).safeTransferFrom(msg.sender, address(this), funding1);

        tokenId = nextTokenId++;
        _owners[tokenId] = fixture.owner;
        _positions[tokenId] = Position({
            platformId: fixture.platformId,
            token0: fixture.token0,
            token1: fixture.token1,
            poolAddress: fixture.poolAddress,
            poolId: fixture.poolId,
            tickLower: fixture.tickLower,
            tickUpper: fixture.tickUpper,
            tickSpacing: fixture.tickSpacing,
            feePips: fixture.feePips,
            liquidity: fixture.liquidity,
            reserve0: fixture.reserve0,
            reserve1: fixture.reserve1,
            tokensOwed0: fixture.tokensOwed0,
            tokensOwed1: fixture.tokensOwed1
        });
        emit Transfer(address(0), fixture.owner, tokenId);
    }

    function accrueFees(uint256 tokenId, uint128 amount0, uint128 amount1) external {
        Position storage position = _position(tokenId);
        if (amount0 > 0) IERC20(position.token0).safeTransferFrom(msg.sender, address(this), amount0);
        if (amount1 > 0) IERC20(position.token1).safeTransferFrom(msg.sender, address(this), amount1);
        position.tokensOwed0 += amount0;
        position.tokensOwed1 += amount1;
    }

    function approve(address approved, uint256 tokenId) external {
        address owner = ownerOf(tokenId);
        if (msg.sender != owner && !_operatorApprovals[owner][msg.sender]) revert NotAuthorized();
        _tokenApprovals[tokenId] = approved;
        emit Approval(owner, approved, tokenId);
    }

    function setApprovalForAll(address operator, bool approved) external {
        if (operator == msg.sender) revert NotAuthorized();
        _operatorApprovals[msg.sender][operator] = approved;
        emit ApprovalForAll(msg.sender, operator, approved);
    }

    function ownerOf(uint256 tokenId) public view returns (address owner) {
        owner = _owners[tokenId];
        if (owner == address(0)) revert PositionUnknown();
    }

    function getApproved(uint256 tokenId) external view returns (address) {
        ownerOf(tokenId);
        return _tokenApprovals[tokenId];
    }

    function isApprovedForAll(address owner, address operator) external view returns (bool) {
        return _operatorApprovals[owner][operator];
    }

    function positions(uint256 tokenId) external view returns (Position memory) {
        return _position(tokenId);
    }

    function decreaseLiquidity(DecreaseLiquidityParams calldata params)
        external
        returns (uint256 amount0, uint256 amount1)
    {
        if (block.timestamp > params.deadline) revert TransactionExpired();
        Position storage position = _authorizedPosition(params.tokenId);
        uint128 liquidityBefore = position.liquidity;
        if (params.liquidity == 0 || params.liquidity > liquidityBefore) revert ZeroLiquidity();

        if (params.liquidity == liquidityBefore) {
            amount0 = position.reserve0;
            amount1 = position.reserve1;
        } else {
            amount0 = (uint256(position.reserve0) * params.liquidity) / liquidityBefore;
            amount1 = (uint256(position.reserve1) * params.liquidity) / liquidityBefore;
        }
        if (amount0 < params.amount0Min || amount1 < params.amount1Min) {
            revert SlippageCheckFailed();
        }

        position.liquidity = liquidityBefore - params.liquidity;
        position.reserve0 -= uint128(amount0);
        position.reserve1 -= uint128(amount1);
        position.tokensOwed0 += uint128(amount0);
        position.tokensOwed1 += uint128(amount1);
        emit DecreaseLiquidity(params.tokenId, params.liquidity, amount0, amount1);
    }

    function collect(CollectParams calldata params) external returns (uint256 amount0, uint256 amount1) {
        Position storage position = _authorizedPosition(params.tokenId);
        address owner = _owners[params.tokenId];
        if (params.recipient != owner) revert InvalidRecipient();

        amount0 = position.tokensOwed0 < params.amount0Max ? position.tokensOwed0 : params.amount0Max;
        amount1 = position.tokensOwed1 < params.amount1Max ? position.tokensOwed1 : params.amount1Max;
        position.tokensOwed0 -= uint128(amount0);
        position.tokensOwed1 -= uint128(amount1);
        if (amount0 > 0) IERC20(position.token0).safeTransfer(owner, amount0);
        if (amount1 > 0) IERC20(position.token1).safeTransfer(owner, amount1);
        emit Collect(params.tokenId, owner, amount0, amount1);
    }

    function burn(uint256 tokenId) external {
        Position storage position = _authorizedPosition(tokenId);
        if (position.liquidity != 0 || position.tokensOwed0 != 0 || position.tokensOwed1 != 0) {
            revert PositionNotEmpty();
        }
        address owner = _owners[tokenId];
        delete _tokenApprovals[tokenId];
        delete _positions[tokenId];
        delete _owners[tokenId];
        emit Transfer(owner, address(0), tokenId);
    }

    function _position(uint256 tokenId) private view returns (Position storage position) {
        if (_owners[tokenId] == address(0)) revert PositionUnknown();
        return _positions[tokenId];
    }

    function _authorizedPosition(uint256 tokenId) private view returns (Position storage position) {
        address owner = ownerOf(tokenId);
        if (msg.sender != owner && _tokenApprovals[tokenId] != msg.sender && !_operatorApprovals[owner][msg.sender]) {
            revert NotAuthorized();
        }
        return _positions[tokenId];
    }
}
