// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {IERC20} from "../vendor/openzeppelin-contracts-v5.4.0/token/ERC20/IERC20.sol";
import {SafeERC20} from "../vendor/openzeppelin-contracts-v5.4.0/token/ERC20/utils/SafeERC20.sol";
import {IAllowanceTransfer} from "../vendor/permit2-cc56ad0f/interfaces/IAllowanceTransfer.sol";
import {ILocalExecutionAdapter} from "../src/interfaces/ILocalExecutionAdapter.sol";
import {LocalExecutionAdapter} from "../src/LocalExecutionAdapter.sol";
import {TestOnlyERC20} from "../src/TestOnlyERC20.sol";
import {TestOnlyPermit2} from "../src/TestOnlyPermit2.sol";
import {TestOnlyPositionManager} from "../src/TestOnlyPositionManager.sol";
import {TestOnlySwapRouter} from "../src/TestOnlySwapRouter.sol";
import {WalletHelperV1} from "../src/WalletHelperV1.sol";

interface Vm {
    function deal(address account, uint256 newBalance) external;
    function targetContract(address target) external;
    function warp(uint256 newTimestamp) external;
}

contract UntrustedHelperCaller {
    function callHelper(address helper, bytes calldata data) external payable returns (bool, bytes memory) {
        return helper.call{value: msg.value}(data);
    }
}

contract AdversarialToken {
    enum Mode {
        Standard,
        FalseReturn,
        NoReturn,
        UsdtApprove,
        FeeOnTransfer,
        Callback
    }

    Mode public immutable mode;
    uint256 public totalSupply;
    address public callbackTarget;
    bytes public callbackData;

    mapping(address account => uint256) public balanceOf;
    mapping(address owner => mapping(address spender => uint256)) public allowance;

    event Approval(address indexed owner, address indexed spender, uint256 value);
    event Transfer(address indexed from, address indexed to, uint256 value);

    constructor(Mode mode_, uint256 supply) {
        mode = mode_;
        totalSupply = supply;
        balanceOf[msg.sender] = supply;
        emit Transfer(address(0), msg.sender, supply);
    }

    function configureCallback(address target, bytes calldata data) external {
        callbackTarget = target;
        callbackData = data;
    }

    function approve(address spender, uint256 amount) external returns (bool) {
        if (mode == Mode.UsdtApprove && amount != 0 && allowance[msg.sender][spender] != 0) {
            return false;
        }
        allowance[msg.sender][spender] = amount;
        emit Approval(msg.sender, spender, amount);
        return true;
    }

    function transfer(address to, uint256 amount) external returns (bool) {
        _transfer(msg.sender, to, amount);
        return _returnValue();
    }

    function transferFrom(address from, address to, uint256 amount) external returns (bool) {
        uint256 allowed = allowance[from][msg.sender];
        require(allowed >= amount, "allowance");
        if (allowed != type(uint256).max) allowance[from][msg.sender] = allowed - amount;
        _transfer(from, to, amount);
        if (mode == Mode.Callback && callbackTarget != address(0)) {
            (bool success,) = callbackTarget.call(callbackData);
            require(success, "callback rejected");
        }
        return _returnValue();
    }

    function _returnValue() private view returns (bool) {
        if (mode == Mode.FalseReturn) return false;
        if (mode == Mode.NoReturn) {
            assembly ("memory-safe") {
                return(0, 0)
            }
        }
        return true;
    }

    function _transfer(address from, address to, uint256 amount) private {
        uint256 balance = balanceOf[from];
        require(balance >= amount, "balance");
        balanceOf[from] = balance - amount;
        uint256 received = mode == Mode.FeeOnTransfer ? (amount * 9) / 10 : amount;
        balanceOf[to] += received;
        totalSupply -= amount - received;
        emit Transfer(from, to, received);
    }
}

contract FakeOutputAdapter is ILocalExecutionAdapter {
    using SafeERC20 for IERC20;

    function executeSwap(SwapRequest calldata request) external returns (uint256) {
        IERC20(request.tokenIn).safeTransferFrom(msg.sender, address(this), request.amountIn);
        return request.minAmountOut;
    }

    function executePosition(PositionRequest calldata)
        external
        pure
        returns (uint256 tokenId, uint256 amount0, uint256 amount1)
    {
        return (tokenId, amount0, amount1);
    }
}

contract ReentrantOwner {
    WalletHelperV1 public helper;
    bytes4 public callbackError;
    bool private attacking;

    receive() external payable {
        if (!attacking) return;
        attacking = false;
        (bool success, bytes memory data) =
            address(helper).call(abi.encodeCall(WalletHelperV1.sweepNative, (keccak256("reentrant-plan"), 1)));
        require(!success, "reentrant call succeeded");
        if (data.length >= 4) {
            bytes4 selector;
            assembly ("memory-safe") {
                selector := mload(add(data, 32))
            }
            callbackError = selector;
        }
    }

    function configure(WalletHelperV1 helper_) external {
        require(address(helper) == address(0), "configured");
        helper = helper_;
    }

    function deposit(uint256 amount) external {
        helper.depositNative{value: amount}();
    }

    function sweep(uint256 amount) external {
        attacking = true;
        helper.sweepNative(keccak256("outer-plan"), amount);
    }
}

contract WalletHelperInvariantHandler {
    TestOnlyERC20 public tokenIn;
    TestOnlyERC20 public tokenOut;
    TestOnlySwapRouter public router;
    LocalExecutionAdapter public adapter;
    WalletHelperV1 public helper;

    uint256 private sequence;

    constructor() {
        tokenIn = new TestOnlyERC20(type(uint128).max);
        tokenOut = new TestOnlyERC20(type(uint128).max);
        TestOnlyPermit2 permit2 = new TestOnlyPermit2();
        router = new TestOnlySwapRouter();
        TestOnlyPositionManager manager = new TestOnlyPositionManager();
        adapter = new LocalExecutionAdapter(address(router), address(manager));
        helper = new WalletHelperV1(
            address(this),
            address(adapter),
            address(permit2),
            address(tokenIn),
            address(tokenIn).codehash,
            address(tokenOut),
            address(tokenOut).codehash
        );
        tokenIn.approve(address(helper), type(uint256).max);
        tokenOut.transfer(address(router), type(uint128).max / 2);
    }

    function execute(uint96 rawAmount) external {
        uint256 balance = tokenIn.balanceOf(address(this));
        if (balance == 0) return;
        uint256 amount = (uint256(rawAmount) % balance) + 1;
        sequence += 1;
        WalletHelperV1.SwapPlan memory plan = WalletHelperV1.SwapPlan({
            tokenIn: address(tokenIn),
            tokenOut: address(tokenOut),
            amountIn: amount,
            minAmountOut: amount,
            deadline: block.timestamp + 100,
            serviceFeeBps: 0
        });
        WalletHelperV1.Permit2Authorization memory authorization;
        try helper.executeSwap(keccak256(abi.encode(sequence)), plan, authorization) {} catch {}
    }
}

contract WalletHelperV1Test {
    Vm private constant vm = Vm(address(uint160(uint256(keccak256("hevm cheat code")))));

    TestOnlyERC20 private tokenIn;
    TestOnlyERC20 private tokenOut;
    TestOnlyPermit2 private permit2;
    TestOnlySwapRouter private router;
    TestOnlyPositionManager private manager;
    LocalExecutionAdapter private adapter;
    WalletHelperV1 private helper;

    receive() external payable {}

    function setUp() public {
        vm.warp(1_000_000);
        vm.deal(address(this), 100 ether);
        tokenIn = new TestOnlyERC20(10 ** 30);
        tokenOut = new TestOnlyERC20(10 ** 30);
        permit2 = new TestOnlyPermit2();
        router = new TestOnlySwapRouter();
        manager = new TestOnlyPositionManager();
        adapter = new LocalExecutionAdapter(address(router), address(manager));
        helper = _helper(address(this), address(adapter), address(tokenIn), address(tokenOut));
        tokenIn.approve(address(helper), type(uint256).max);
        tokenOut.transfer(address(router), 10 ** 29);
    }

    function testOwnerAndTypedSelectorsDoNotReuseObservedBusinessSelectors() public view {
        require(helper.owner() == address(this), "owner mismatch");
        require(helper.adapter() == address(adapter), "adapter mismatch");
        bytes4[4] memory localSelectors = [
            WalletHelperV1.executeSwap.selector,
            WalletHelperV1.executePosition.selector,
            WalletHelperV1.sweepToken.selector,
            WalletHelperV1.sweepNative.selector
        ];
        bytes4[4] memory observedSelectors = [bytes4(0xadc3f25c), 0xfb691fd9, 0x71fa74ed, 0x5dfd8e50];
        for (uint256 localIndex = 0; localIndex < localSelectors.length; localIndex++) {
            for (uint256 observedIndex = 0; observedIndex < observedSelectors.length; observedIndex++) {
                require(localSelectors[localIndex] != observedSelectors[observedIndex], "observed selector reused");
            }
        }
    }

    function testSwapUsesExactAllowanceAndPaysOwner() public {
        uint256 beforeOut = tokenOut.balanceOf(address(this));
        uint256 amountOut = helper.executeSwap(
            keccak256("swap-1"), _swapPlan(address(tokenIn), address(tokenOut), 10_000, 9_900), _emptyPermit()
        );
        require(amountOut == 10_000, "amount out mismatch");
        require(tokenOut.balanceOf(address(this)) - beforeOut == 10_000, "output recipient mismatch");
        require(tokenIn.allowance(address(helper), address(adapter)) == 0, "helper allowance remains");
        require(tokenIn.allowance(address(adapter), address(router)) == 0, "adapter allowance remains");
        require(tokenIn.balanceOf(address(helper)) == 0, "helper input dust");
        require(tokenIn.balanceOf(address(adapter)) == 0, "adapter input dust");
    }

    function testDuplicatePlanRevertsWithoutFurtherBalanceChange() public {
        bytes32 digest = keccak256("duplicate");
        WalletHelperV1.SwapPlan memory plan = _swapPlan(address(tokenIn), address(tokenOut), 1_000, 1_000);
        helper.executeSwap(digest, plan, _emptyPermit());
        uint256 inputAfter = tokenIn.balanceOf(address(this));
        (bool success, bytes memory data) =
            address(helper).call(abi.encodeCall(WalletHelperV1.executeSwap, (digest, plan, _emptyPermit())));
        require(!success, "duplicate succeeded");
        require(_selector(data) == WalletHelperV1.PlanAlreadyExecuted.selector, "wrong duplicate error");
        require(tokenIn.balanceOf(address(this)) == inputAfter, "duplicate changed balance");
    }

    function testNonOwnerCannotEnterAnyAssetFunction() public {
        UntrustedHelperCaller caller = new UntrustedHelperCaller();
        WalletHelperV1.SwapPlan memory swapPlan = _swapPlan(address(tokenIn), address(tokenOut), 1, 1);
        WalletHelperV1.PositionPlan memory positionPlan = _positionPlan();
        bytes[] memory calls = new bytes[](5);
        calls[0] = abi.encodeCall(WalletHelperV1.executeSwap, (keccak256("u1"), swapPlan, _emptyPermit()));
        calls[1] = abi.encodeCall(WalletHelperV1.executePosition, (keccak256("u2"), positionPlan));
        calls[2] = abi.encodeCall(WalletHelperV1.sweepToken, (keccak256("u3"), address(tokenIn), 1));
        calls[3] = abi.encodeCall(WalletHelperV1.sweepNative, (keccak256("u4"), 1));
        calls[4] = abi.encodeCall(WalletHelperV1.depositNative, ());
        for (uint256 index = 0; index < calls.length; index++) {
            (bool success, bytes memory data) = caller.callHelper(address(helper), calls[index]);
            require(!success, "unauthorized call succeeded");
            require(_selector(data) == WalletHelperV1.Unauthorized.selector, "wrong unauthorized error");
        }
        (bool receiveSuccess, bytes memory receiveData) = caller.callHelper{value: 1}(address(helper), "");
        require(!receiveSuccess, "unauthorized receive succeeded");
        require(_selector(receiveData) == WalletHelperV1.Unauthorized.selector, "wrong receive error");
    }

    function testReentrantOwnerCallbackIsRejectedButOuterSweepCompletes() public {
        ReentrantOwner owner = new ReentrantOwner();
        WalletHelperV1 ownedHelper = _helper(address(owner), address(adapter), address(tokenIn), address(tokenOut));
        owner.configure(ownedHelper);
        (bool funded,) = address(owner).call{value: 2 ether}("");
        require(funded, "owner funding failed");
        owner.deposit(1 ether);
        owner.sweep(1 ether);
        require(owner.callbackError() == WalletHelperV1.ReentrantCall.selector, "reentrancy not rejected");
        require(address(ownedHelper).balance == 0, "native balance remains");
    }

    function testMaliciousAdapterFakeOutputRevertsAtomically() public {
        FakeOutputAdapter fake = new FakeOutputAdapter();
        WalletHelperV1 guarded = _helper(address(this), address(fake), address(tokenIn), address(tokenOut));
        tokenIn.approve(address(guarded), type(uint256).max);
        uint256 beforeIn = tokenIn.balanceOf(address(this));
        bytes32 digest = keccak256("fake-output");
        (bool success, bytes memory data) = address(guarded)
            .call(
                abi.encodeCall(
                    WalletHelperV1.executeSwap,
                    (digest, _swapPlan(address(tokenIn), address(tokenOut), 100, 100), _emptyPermit())
                )
            );
        require(!success, "fake output succeeded");
        require(_selector(data) == WalletHelperV1.AmountOutTooLow.selector, "wrong fake output error");
        require(tokenIn.balanceOf(address(this)) == beforeIn, "input not rolled back");
        require(!guarded.executedPlans(digest), "failed plan persisted");
    }

    function testFalseReturnAndFeeOnTransferRevertAtomically() public {
        _assertAdversarialTokenReverts(AdversarialToken.Mode.FalseReturn, "false-return");
        _assertAdversarialTokenReverts(AdversarialToken.Mode.FeeOnTransfer, "fee-on-transfer");
    }

    function testNoReturnAndUsdtStyleApproveAreHandledSafely() public {
        _assertAdversarialTokenSucceeds(AdversarialToken.Mode.NoReturn, "no-return-1");
        _assertAdversarialTokenSucceeds(AdversarialToken.Mode.UsdtApprove, "usdt-1");
        _assertAdversarialTokenSucceeds(AdversarialToken.Mode.UsdtApprove, "usdt-2");
    }

    function testCallbackTokenCannotReenterAndEverythingRollsBack() public {
        AdversarialToken callbackToken = new AdversarialToken(AdversarialToken.Mode.Callback, 1_000_000);
        WalletHelperV1 guarded = _helper(address(this), address(adapter), address(callbackToken), address(tokenOut));
        callbackToken.approve(address(guarded), type(uint256).max);
        callbackToken.configureCallback(
            address(guarded),
            abi.encodeCall(WalletHelperV1.sweepToken, (keccak256("callback"), address(callbackToken), 1))
        );
        uint256 beforeBalance = callbackToken.balanceOf(address(this));
        bytes32 digest = keccak256("callback-plan");
        (bool success,) = address(guarded)
            .call(
                abi.encodeCall(
                    WalletHelperV1.executeSwap,
                    (digest, _swapPlan(address(callbackToken), address(tokenOut), 100, 100), _emptyPermit())
                )
            );
        require(!success, "callback token succeeded");
        require(callbackToken.balanceOf(address(this)) == beforeBalance, "callback changed balance");
        require(!guarded.executedPlans(digest), "callback plan persisted");
    }

    function testPermit2ExactAmountAndExpiration() public {
        tokenIn.approve(address(permit2), type(uint256).max);
        uint256 amount = 5_000;
        WalletHelperV1.Permit2Authorization memory authorization = _permitAuthorization(amount, 300);
        uint256 amountOut = helper.executeSwap(
            keccak256("permit2"), _swapPlan(address(tokenIn), address(tokenOut), amount, amount), authorization
        );
        require(amountOut == amount, "permit amount mismatch");
        (uint160 remaining,, uint48 nonce) = permit2.allowance(address(this), address(tokenIn), address(helper));
        require(remaining == 0, "permit allowance remains");
        require(nonce == 1, "permit nonce mismatch");
    }

    function testPermit2OverlongExpirationRevertsBeforeAssetMovement() public {
        tokenIn.approve(address(permit2), type(uint256).max);
        bytes32 digest = keccak256("permit2-long");
        uint256 beforeBalance = tokenIn.balanceOf(address(this));
        (bool success, bytes memory data) = address(helper)
            .call(
                abi.encodeCall(
                    WalletHelperV1.executeSwap,
                    (digest, _swapPlan(address(tokenIn), address(tokenOut), 100, 100), _permitAuthorization(100, 1_801))
                )
            );
        require(!success, "overlong permit succeeded");
        require(_selector(data) == WalletHelperV1.InvalidPermit2Authorization.selector, "wrong permit error");
        require(tokenIn.balanceOf(address(this)) == beforeBalance, "permit moved assets");
        require(!helper.executedPlans(digest), "permit plan persisted");
    }

    function testPositionMintsNftToOwnerAndRefundsUnusedTokens() public {
        tokenOut.approve(address(helper), type(uint256).max);
        uint256 before0 = tokenIn.balanceOf(address(this));
        uint256 before1 = tokenOut.balanceOf(address(this));
        (uint256 tokenId, uint256 used0, uint256 used1) = helper.executePosition(keccak256("position"), _positionPlan());
        require(manager.ownerOf(tokenId) == address(this), "nft recipient mismatch");
        require(used0 == 900 && used1 == 1_800, "position amounts mismatch");
        require(before0 - tokenIn.balanceOf(address(this)) == used0, "token0 refund mismatch");
        require(before1 - tokenOut.balanceOf(address(this)) == used1, "token1 refund mismatch");
        require(tokenIn.balanceOf(address(helper)) == 0, "helper token0 dust");
        require(tokenOut.balanceOf(address(helper)) == 0, "helper token1 dust");
        require(tokenIn.balanceOf(address(adapter)) == 0, "adapter token0 dust");
        require(tokenOut.balanceOf(address(adapter)) == 0, "adapter token1 dust");
        require(tokenIn.allowance(address(helper), address(adapter)) == 0, "token0 allowance remains");
        require(tokenOut.allowance(address(helper), address(adapter)) == 0, "token1 allowance remains");
    }

    function testMinOutDeadlineFeeAndUnknownTokenFailClosed() public {
        router.setAmountOutBps(9_000);
        _expectSwapError(_swapPlan(address(tokenIn), address(tokenOut), 1_000, 1_000), bytes4(0x08c379a0), "min-out");
        WalletHelperV1.SwapPlan memory expired = _swapPlan(address(tokenIn), address(tokenOut), 1, 1);
        expired.deadline = block.timestamp - 1;
        _expectSwapError(expired, WalletHelperV1.DeadlineExpired.selector, "deadline");
        WalletHelperV1.SwapPlan memory fee = _swapPlan(address(tokenIn), address(tokenOut), 1, 1);
        fee.serviceFeeBps = 1;
        _expectSwapError(fee, WalletHelperV1.NonZeroServiceFeeForbidden.selector, "fee");
        TestOnlyERC20 unknown = new TestOnlyERC20(100);
        _expectSwapError(
            _swapPlan(address(unknown), address(tokenOut), 1, 1),
            WalletHelperV1.TokenNotAllowed.selector,
            "unknown-token"
        );
    }

    function testSweepLeavesConfiguredDustAndNativeRecipientIsOwner() public {
        tokenIn.transfer(address(helper), 101);
        helper.sweepToken(keccak256("sweep-token"), address(tokenIn), 100);
        require(tokenIn.balanceOf(address(helper)) == 1, "dust mismatch");
        helper.depositNative{value: 1 ether}();
        uint256 beforeNative = address(this).balance;
        helper.sweepNative(keccak256("sweep-native"), 1 ether);
        require(address(this).balance == beforeNative + 1 ether, "native recipient mismatch");
        require(address(helper).balance == 0, "native dust remains");
    }

    function testFuzzSwapPreservesExactApprovalAndNoDust(uint96 rawAmount) public {
        uint256 amount = (uint256(rawAmount) % 10 ** 20) + 1;
        helper.executeSwap(
            keccak256(abi.encode("fuzz", amount)),
            _swapPlan(address(tokenIn), address(tokenOut), amount, amount),
            _emptyPermit()
        );
        require(tokenIn.balanceOf(address(helper)) == 0, "helper dust");
        require(tokenIn.balanceOf(address(adapter)) == 0, "adapter dust");
        require(tokenIn.allowance(address(helper), address(adapter)) == 0, "helper approval");
        require(tokenIn.allowance(address(adapter), address(router)) == 0, "adapter approval");
    }

    function _helper(address owner, address adapterAddress, address firstToken, address secondToken)
        private
        returns (WalletHelperV1)
    {
        return new WalletHelperV1(
            owner, adapterAddress, address(permit2), firstToken, firstToken.codehash, secondToken, secondToken.codehash
        );
    }

    function _swapPlan(address firstToken, address secondToken, uint256 amount, uint256 minOut)
        private
        view
        returns (WalletHelperV1.SwapPlan memory)
    {
        return WalletHelperV1.SwapPlan({
            tokenIn: firstToken,
            tokenOut: secondToken,
            amountIn: amount,
            minAmountOut: minOut,
            deadline: block.timestamp + 600,
            serviceFeeBps: 0
        });
    }

    function _positionPlan() private view returns (WalletHelperV1.PositionPlan memory) {
        return WalletHelperV1.PositionPlan({
            action: ILocalExecutionAdapter.PositionAction.Mint,
            token0: address(tokenIn),
            token1: address(tokenOut),
            tokenId: 0,
            amount0: 1_000,
            amount1: 2_000,
            minAmount0: 800,
            minAmount1: 1_700,
            deadline: block.timestamp + 600,
            serviceFeeBps: 0
        });
    }

    function _emptyPermit() private pure returns (WalletHelperV1.Permit2Authorization memory authorization) {
        authorization.enabled = false;
    }

    function _permitAuthorization(uint256 amount, uint48 expirationDelta)
        private
        view
        returns (WalletHelperV1.Permit2Authorization memory authorization)
    {
        authorization.enabled = true;
        authorization.permitSingle = IAllowanceTransfer.PermitSingle({
            details: IAllowanceTransfer.PermitDetails({
                token: address(tokenIn),
                amount: uint160(amount),
                expiration: uint48(block.timestamp) + expirationDelta,
                nonce: 0
            }),
            spender: address(helper),
            sigDeadline: block.timestamp + 600
        });
        authorization.signature = hex"01";
    }

    function _assertAdversarialTokenReverts(AdversarialToken.Mode mode, string memory salt) private {
        AdversarialToken adversarial = new AdversarialToken(mode, 1_000_000);
        WalletHelperV1 guarded = _helper(address(this), address(adapter), address(adversarial), address(tokenOut));
        adversarial.approve(address(guarded), type(uint256).max);
        uint256 beforeBalance = adversarial.balanceOf(address(this));
        bytes32 digest = keccak256(bytes(salt));
        (bool success,) = address(guarded)
            .call(
                abi.encodeCall(
                    WalletHelperV1.executeSwap,
                    (digest, _swapPlan(address(adversarial), address(tokenOut), 100, 100), _emptyPermit())
                )
            );
        require(!success, "adversarial token succeeded");
        require(adversarial.balanceOf(address(this)) == beforeBalance, "adversarial balance changed");
        require(!guarded.executedPlans(digest), "adversarial plan persisted");
    }

    function _assertAdversarialTokenSucceeds(AdversarialToken.Mode mode, string memory salt) private {
        AdversarialToken adversarial = new AdversarialToken(mode, 1_000_000);
        WalletHelperV1 guarded = _helper(address(this), address(adapter), address(adversarial), address(tokenOut));
        adversarial.approve(address(guarded), type(uint256).max);
        guarded.executeSwap(
            keccak256(bytes(salt)), _swapPlan(address(adversarial), address(tokenOut), 100, 100), _emptyPermit()
        );
        require(adversarial.balanceOf(address(guarded)) == 0, "safe token helper dust");
        require(adversarial.allowance(address(guarded), address(adapter)) == 0, "safe token allowance");
    }

    function _expectSwapError(WalletHelperV1.SwapPlan memory plan, bytes4 expected, string memory salt) private {
        bytes32 digest = keccak256(bytes(salt));
        (bool success, bytes memory data) =
            address(helper).call(abi.encodeCall(WalletHelperV1.executeSwap, (digest, plan, _emptyPermit())));
        require(!success, "expected swap failure");
        require(_selector(data) == expected, "unexpected swap error");
        require(!helper.executedPlans(digest), "failed swap plan persisted");
    }

    function _selector(bytes memory data) private pure returns (bytes4 selector) {
        require(data.length >= 4, "missing revert selector");
        assembly ("memory-safe") {
            selector := mload(add(data, 32))
        }
    }
}

contract WalletHelperV1InvariantTest {
    Vm private constant vm = Vm(address(uint160(uint256(keccak256("hevm cheat code")))));

    WalletHelperInvariantHandler private handler;

    function setUp() public {
        vm.warp(2_000_000);
        handler = new WalletHelperInvariantHandler();
    }

    function targetContracts() public view returns (address[] memory targets) {
        targets = new address[](1);
        targets[0] = address(handler);
    }

    function invariantNoHelperOrAdapterDustAndNoResidualAllowance() public view {
        TestOnlyERC20 token = handler.tokenIn();
        WalletHelperV1 helper = handler.helper();
        LocalExecutionAdapter adapter = handler.adapter();
        TestOnlySwapRouter router = handler.router();
        require(token.balanceOf(address(helper)) == 0, "invariant helper dust");
        require(token.balanceOf(address(adapter)) == 0, "invariant adapter dust");
        require(token.allowance(address(helper), address(adapter)) == 0, "invariant helper allowance");
        require(token.allowance(address(adapter), address(router)) == 0, "invariant adapter allowance");
    }
}
