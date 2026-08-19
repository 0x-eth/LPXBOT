// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {TestOnlyERC20} from "../src/TestOnlyERC20.sol";
import {TestOnlyPositionManagerV2} from "../src/TestOnlyPositionManagerV2.sol";

interface VmPositionV2 {
    function prank(address sender) external;
    function warp(uint256 timestamp) external;
}

contract PositionV2Caller {
    function collect(TestOnlyPositionManagerV2 manager, TestOnlyPositionManagerV2.CollectParams calldata params)
        external
        returns (uint256, uint256)
    {
        return manager.collect(params);
    }
}

contract TestOnlyPositionManagerV2Test {
    VmPositionV2 private constant vm = VmPositionV2(address(uint160(uint256(keccak256("hevm cheat code")))));

    TestOnlyERC20 private token0;
    TestOnlyERC20 private token1;
    TestOnlyPositionManagerV2 private manager;
    uint256 private tokenId;

    function setUp() public {
        vm.warp(1_000_000);
        token0 = new TestOnlyERC20(1_000_000);
        token1 = new TestOnlyERC20(1_000_000);
        manager = new TestOnlyPositionManagerV2();
        token0.approve(address(manager), type(uint256).max);
        token1.approve(address(manager), type(uint256).max);
        tokenId = manager.mintFixture(
            TestOnlyPositionManagerV2.FixturePosition({
                owner: address(this),
                platformId: 1,
                token0: address(token0),
                token1: address(token1),
                poolAddress: address(0x1234),
                poolId: bytes32(0),
                tickLower: -120,
                tickUpper: 120,
                tickSpacing: 60,
                feePips: 3000,
                liquidity: 101,
                reserve0: 1_001,
                reserve1: 2_003,
                tokensOwed0: 11,
                tokensOwed1: 13
            })
        );
    }

    function testPartialDecreaseOnlyMovesPrincipalIntoOwedUntilCollect() public {
        uint256 before0 = token0.balanceOf(address(this));
        uint256 before1 = token1.balanceOf(address(this));
        (uint256 amount0, uint256 amount1) = manager.decreaseLiquidity(
            TestOnlyPositionManagerV2.DecreaseLiquidityParams({
                tokenId: tokenId, liquidity: 25, amount0Min: 247, amount1Min: 495, deadline: 1_000_100
            })
        );
        require(amount0 == 247 && amount1 == 495, "integer rounding mismatch");
        require(token0.balanceOf(address(this)) == before0, "principal available before collect");
        require(token1.balanceOf(address(this)) == before1, "principal available before collect");

        TestOnlyPositionManagerV2.Position memory position = manager.positions(tokenId);
        require(position.liquidity == 76, "remaining liquidity mismatch");
        require(position.tokensOwed0 == 258 && position.tokensOwed1 == 508, "owed mismatch");
        manager.collect(
            TestOnlyPositionManagerV2.CollectParams({
                tokenId: tokenId, recipient: address(this), amount0Max: type(uint128).max, amount1Max: type(uint128).max
            })
        );
        require(token0.balanceOf(address(this)) - before0 == 258, "token0 collect mismatch");
        require(token1.balanceOf(address(this)) - before1 == 508, "token1 collect mismatch");
    }

    function testFullExitCollectAndOptionalBurn() public {
        manager.decreaseLiquidity(
            TestOnlyPositionManagerV2.DecreaseLiquidityParams({
                tokenId: tokenId, liquidity: 101, amount0Min: 1_001, amount1Min: 2_003, deadline: 1_000_100
            })
        );
        TestOnlyPositionManagerV2.Position memory decreased = manager.positions(tokenId);
        require(decreased.liquidity == 0, "liquidity remains");
        require(decreased.reserve0 == 0 && decreased.reserve1 == 0, "reserve remains");

        (bool earlyBurn,) = address(manager).call(abi.encodeCall(manager.burn, (tokenId)));
        require(!earlyBurn, "burn before collect succeeded");
        manager.collect(
            TestOnlyPositionManagerV2.CollectParams({
                tokenId: tokenId, recipient: address(this), amount0Max: type(uint128).max, amount1Max: type(uint128).max
            })
        );
        manager.burn(tokenId);
        (bool ownerRead,) = address(manager).call(abi.encodeCall(manager.ownerOf, (tokenId)));
        require(!ownerRead, "burned owner remains");
    }

    function testZeroCollectIsCanonicalAndIdempotent() public {
        manager.collect(
            TestOnlyPositionManagerV2.CollectParams({
                tokenId: tokenId, recipient: address(this), amount0Max: type(uint128).max, amount1Max: type(uint128).max
            })
        );
        (uint256 amount0, uint256 amount1) = manager.collect(
            TestOnlyPositionManagerV2.CollectParams({
                tokenId: tokenId, recipient: address(this), amount0Max: type(uint128).max, amount1Max: type(uint128).max
            })
        );
        require(amount0 == 0 && amount1 == 0, "zero collect mismatch");
        require(manager.ownerOf(tokenId) == address(this), "owner changed");
        require(manager.positions(tokenId).liquidity == 101, "liquidity changed");
    }

    function testRecipientAndNonOwnerAreRejected() public {
        (bool recipientSuccess,) = address(manager)
            .call(
                abi.encodeCall(
                    manager.collect,
                    (TestOnlyPositionManagerV2.CollectParams({
                        tokenId: tokenId,
                        recipient: address(0xBEEF),
                        amount0Max: type(uint128).max,
                        amount1Max: type(uint128).max
                    }))
                )
            );
        require(!recipientSuccess, "recipient injection succeeded");

        PositionV2Caller caller = new PositionV2Caller();
        (bool ownerSuccess,) = address(caller)
            .call(
                abi.encodeCall(
                    caller.collect,
                    (
                        manager,
                        TestOnlyPositionManagerV2.CollectParams({
                        tokenId: tokenId,
                        recipient: address(this),
                        amount0Max: type(uint128).max,
                        amount1Max: type(uint128).max
                    })
                    )
                )
            );
        require(!ownerSuccess, "non-owner succeeded");
    }

    function testV4FixtureIdentity() public {
        uint256 v4TokenId = manager.mintFixture(
            TestOnlyPositionManagerV2.FixturePosition({
                owner: address(this),
                platformId: 5,
                token0: address(token0),
                token1: address(token1),
                poolAddress: address(0),
                poolId: keccak256("v4-pool"),
                tickLower: -20,
                tickUpper: 20,
                tickSpacing: 10,
                feePips: 500,
                liquidity: 5,
                reserve0: 10,
                reserve1: 20,
                tokensOwed0: 0,
                tokensOwed1: 0
            })
        );
        TestOnlyPositionManagerV2.Position memory position = manager.positions(v4TokenId);
        require(position.platformId == 5 && position.poolAddress == address(0), "v4 platform mismatch");
        require(position.poolId == keccak256("v4-pool"), "v4 pool mismatch");
    }
}
