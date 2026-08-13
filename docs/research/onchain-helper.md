# LPBot BSC Helper 链上研究

> 研究日期：2026-08-13（Asia/Shanghai）  
> 网络：BNB Smart Chain 主网，chain ID 56  
> 范围：用户给出的 4 个 Helper、4 个对应钱包、3 个“收费池钱包”  
> 方法：BscScan 可见页面、BSC JSON-RPC `eth_getCode` / `eth_call` / `eth_getTransactionByHash` / `eth_getTransactionReceipt`、公开接口规范。全程只读，未广播交易或签名。

## 结论摘要

1. **四个 Helper 均由对应钱包直接创建，且 `owner()` 返回同一个钱包。** 四次创建都是 EOA 的普通合约创建交易，receipt 中 `contractAddress` 与用户提供的 Helper 一致。不是由一个可见 factory 统一创建。
2. **它们不是常见 proxy/clone。** 每份 runtime code 都是 19,133 bytes；EIP-1967 implementation/admin storage slot 均为零；可执行字节码中没有 `DELEGATECALL`；代码也不具有 45/55-byte EIP-1167 clone 结构。
3. **四份合约来自相同 Solidity 构建，钱包/Helper 被编译为 immutable 常量。** 每份末尾元数据完全相同（Solidity `0.8.31`、同一个 IPFS metadata digest）；各自 owner 地址在 runtime 中出现 21 次。除 owner 常量、`keccak256(address(this))` 常量和随之变化的 metadata digest 外，可执行代码相同。
4. **入口访问控制已链上验证。** 对非 owner 发起只读模拟调用，受限入口回退 `Only owner`；合约同时含 reentrancy guard。`owner()` 的标准 selector 为 `0x8da5cb5b`。
5. **Helper 确实把多步操作放在单笔交易中。** 样本 receipt 显示：owner 的 token 先进入 Helper；同一交易内发生聚合 swap、手续费转账、V3/V4 位置创建或增仓；最后未使用余额转回 owner。部分授权通过 Permit2，带 expiration；不是只靠永久 ERC-20 allowance。
6. **已观察到 V3 与 V4 两大路径。** `0x71fa74ed` / `0x5dfd8e50` 样本走 Uniswap V4 Position Manager + Pool Manager；`0xfb691fd9` / `0xadc3f25c` 样本走 PancakeSwap V3 NFT Position Manager + V3 pool。
7. **三个所谓收费地址都是 EOA，但目前没有证据说明 Helper 直接向它们收费。** 它们没有 runtime bytecode；三者也没有硬编码在所分析 Helper 中。已采样交易里明确的 fee 收款地址是 `0x084b...e107`、`0xfa00...2a1b` 和 burn 地址 `0x...dEaD`。这只能证明样本交易里的资金去向，不能证明全局收费配置。

## 证据等级

- **已证实**：可由当前 block state、交易 input/receipt/log 或官方接口/源码直接复核。
- **强推断**：由多项独立链上特征支持，但缺少已验证 Helper ABI/源代码。
- **待验证**：当前样本不足，不能作为复刻规格直接实现。

## 1. 地址、部署与 owner 绑定

| Helper | 创建者 / `owner()` | 创建交易 | block | runtime bytes | runtime keccak256 |
|---|---|---|---:|---:|---|
| [`0x30DF...e0A5`](https://bscscan.com/address/0x30df22a0afb4167bad5c1af4aa0b6bf81506e0a5) | [`0xc623...3227`](https://bscscan.com/address/0xc623ab46fa6ff2f547e35f88679a9ebf0b823227) | [`0xf39e...4923`](https://bscscan.com/tx/0xf39ebe9e16dc2ef48fc8a39721c15426e72b2506d6097794fd1fbfba91c24923) | 111,620,738 | 19,133 | `0xaf866c44...6cd85` |
| [`0x1E2e...f100`](https://bscscan.com/address/0x1e2ed4697542219f06e66d465a9de69241d1f100) | [`0x8eeA...b885`](https://bscscan.com/address/0x8eeac170c9af31dcea2da5922eef687c3f1db885) | [`0x06b1...80a9`](https://bscscan.com/tx/0x06b1b496e2b96d9ec5d934f1249e5d1eb4c02e3a58b3e55952e88117476080a9) | 111,624,392 | 19,133 | `0xcee266f2...ff239` |
| [`0x8Dbf...732a`](https://bscscan.com/address/0x8dbfa4facbba05c158a8340e6a366dffb93d732a) | [`0x4051...325E`](https://bscscan.com/address/0x4051736687e78df58862bffbdd864f00143a325e) | [`0xebcb...a0c7`](https://bscscan.com/tx/0xebcbb9b7c3f41fbdbcd1f2e6795aa1025313973c1e9900c83434667e4662a0c7) | 112,042,191 | 19,133 | `0x9570172e...bd99` |
| [`0x0fEB...49dd`](https://bscscan.com/address/0x0feb053b2457d376e0d412888169e7fe1aca49dd) | [`0xD0De...89DC`](https://bscscan.com/address/0xd0de6b3099b048efa5ce4584a62d832f7bc489dc) | [`0xf532...95e7`](https://bscscan.com/tx/0xf5324b1a447f29753a04b30310c1aab5b1da13d49e16265c459ed554631b95e7) | 111,620,585 | 19,133 | `0x681afdc8...f42e` |

RPC 复核要点：

- 四个创建交易的 `to` 均为 `null`，`from` 就是上表钱包；receipt `status=0x1`，`contractAddress` 就是对应 Helper，`gasUsed=0x3fdfe8`。
- `eth_call({to: HELPER, data: 0x8da5cb5b})` 分别返回上述 owner。
- `0x3521ab9f` 为纯函数（4byte 数据库给出的名称 `z0()` 不是可信语义名）；返回值恰好等于 `keccak256(abi.encodePacked(address(this)))`。部署时 constructor 把 owner 和这一 self hash 写入 immutable 区域。
- 四份 runtime metadata 尾部均为 `...736f6c634300081f0033`，即 Solidity 0.8.31；IPFS digest 也相同。BscScan 页面显示源码未验证，因此不能把编译器生成的 selector 参数形状当成业务 ABI 名称。

### Proxy / clone / factory 判定

**已证实不是常见 proxy/clone：**

- EIP-1967 implementation slot `0x3608...2bbc` = 0；admin slot `0xb531...6103` = 0。
- 去除 metadata 后反汇编，无 `DELEGATECALL`、`CALLCODE`、`CREATE`、`CREATE2`、`SELFDESTRUCT`。
- runtime 大小 19,133 bytes，远大于 EIP-1167 minimal proxy。
- 四次部署均由 owner EOA 直接发出，不是同一 factory 的 create/create2 内部调用。

**设计含义：** 首次使用时可由钱包直接部署一份完整、immutable 绑定的 Helper；若复刻时使用 factory，则那是新的架构选择，不是对这些样本的 1:1 证明。

## 2. 可观察 ABI 与保护机制

`cast selectors(runtime)` 得到 9 个入口：

| selector | 可证实语义 | 备注 |
|---|---|---|
| `0x8da5cb5b` | `owner()` | 标准 selector，返回绑定钱包 |
| `0x3521ab9f` | self-hash getter | 返回 `keccak256(address(this))`；业务名称未知 |
| `0x1230fa51` | token/native balance helper（强推断） | 反汇编显示地址为零时返回 native balance，否则调用 ERC-20 `balanceOf(this)` |
| `0x5dfd8e50` | owner-only V4 组合入口，长参数版 | 实际样本含 swap + V4 仓位变更 + refund；原函数名/子类型未知 |
| `0x71fa74ed` | owner-only V4 组合入口，中参数版 | 近期最常见；实际样本含 V4 仓位变更 + refund；原函数名/子类型未知 |
| `0xadc3f25c` | owner-only V3 组合入口 | 实际样本覆盖一种 V3 参数布局；原函数名/子类型未知 |
| `0xfb691fd9` | owner-only V3 组合入口，短参数版 | 实际样本覆盖另一种 V3 参数布局；原函数名/子类型未知 |
| `0xca51c05d` | owner-only token sweep | 地址参数；读取 Helper 余额并转给 owner |
| `0xd9e70e41` | owner-only native sweep | 读取全部 native balance 并转给 owner |

四个组合入口的准确函数名仍是**未知**；不要根据随机 4byte 碰撞命名。字节码显示其首参是平台 ID，动态 `bytes` 是 swap calldata，后续包含 token、position manager/pool manager、fee/tick、amount、deadline、fee recipient/fee bps 等参数。外部公开 API 对平台 ID 给出：`1=UniV3, 2=PCSV3, 4=UniV4, 5=PCSV4`。[LPBot API 文档](https://api.lpbot.cc/api/docs)

可直接读取的保护：

- 所有资产变更入口先比较 `msg.sender == immutable owner`，否则回退 `Only owner`。
- storage slot 0 的低位用作 reentrancy 状态；字节码包含 `ReentrancyGuard: reentrant call`。
- V3 平台 ID 只接受若干枚举值，否则回退 `Invalid V3 liquidity platform ID`。
- swap payload 至少 4 bytes，并阻止 payload 直接使用 `transferFrom` 和 `approve` selector；字节码含 `Invalid swap data`、`Blocked: transferFrom`、`Blocked: approve`。
- 针对已有 NFT 操作会验证 position manager 的 `ownerOf(tokenId)` 或 `getApproved/isApprovedForAll`，否则回退 `Not NFT owner or approved`。

## 3. 交易工作链路

### 3.1 代表样本

| selector | 样本交易 | calldata bytes | gas used | logs | 可观察结果 |
|---|---|---:|---:|---:|---|
| `0x71fa74ed` | [`0xf5ae...ff74`](https://bscscan.com/tx/0xf5ae222e80cfe0e90304587ca8e890f6e7ddea51f38e16adb87b49cbb195ff74) | 612 | 493,589 | 10 | 两币转入、Uniswap V4 仓位事件、NFT 归 owner、余款退回 |
| `0x5dfd8e50` | [`0x920a...010e`](https://bscscan.com/tx/0x920a5ed8864ed70d6638dcc0bc035b51f6bcdf27c04c9688663a6127bc67010e) | 3,300 | 683,130 | 27 | 聚合 swap、多池事件、fee、Uniswap V4 仓位事件、refund |
| `0xfb691fd9` | [`0x802f...14db`](https://bscscan.com/tx/0x802fc3374da2fbde3a48a91f9895249935adb788e1af980599572ceb129514db) | 1,476 | 580,018 | 36 | 一侧资金转入、swap、Pancake V3 仓位事件、refund |
| `0xadc3f25c` | [`0xe093...4c63`](https://bscscan.com/tx/0xe0936775f9112e4930d72d51d9c974719a70e2d220c24266d1f4c07ffc644c63) | 1,540 | 765,597 | 47 | 双币转入、多 hop swap、Pancake V3 仓位事件、refund |

在 `0x30DF...e0A5` 的 BscScan 最新 100 条交易页中，调用分布为：`0x71fa74ed` 83 次、`0x5dfd8e50` 10 次、`0xfb691fd9` 4 次、`0xadc3f25c` 3 次。这是一个时间窗口统计，不代表全部历史。

### 3.2 原子执行顺序

以下顺序由上述 receipts 和字节码共同支持：

1. **校验 owner 与重入锁。** 非 owner 无法进入组合入口。
2. **校验平台和已有 NFT 权限。** 对 reinvest/增加仓位，Helper 会查 position NFT owner/approval。
3. **将 owner 的 token0/token1 拉入 Helper。** 代表交易中 ERC-20 `Transfer(owner, helper, amount)` 是首批日志。
4. **按需要执行 swap。** 动态 `bytes` 交给 allowlisted 聚合器/路由器；Helper 先阻断显然危险的 `approve/transferFrom` payload，再执行外部 call。日志可出现多 hop pools。
5. **计算两侧可投入额与服务费。** 字节码有 `Liquidity computation failed`、`Zero liquidity`、`Fee transfer token0/token1 failed`。样本中有 token 分别转至 fee recipient、burn 地址与 Helper。
6. **授权 position manager / router。** 样本出现 Permit2 `Approval`，owner 为 Helper，spender 为 position manager/router，amount 最大且含 expiration；也有普通 ERC-20 `Approval`。
7. **mint 或 increase liquidity。** position NFT 的 `Transfer(0x0, owner, tokenId)` 证明 NFT 直接归 owner，不留在 Helper。V4 Pool Manager 发出 `ModifyLiquidity`；Pancake V3 pool 发出 `Mint`，V3 position manager 发出 `IncreaseLiquidity`。
8. **退回未使用余额。** transaction 尾部出现 `Transfer(helper, owner, residual)`；字节码同时处理 token、wrapped-native unwrap 和 native refund，且存在明确错误字符串。
9. **释放重入锁。** 任何中间失败都会使整笔交易回滚，符合原子性。

### 3.3 授权与退款的直接证据

- Permit2 地址为 [`0x000000000022D473030F116dDEE9F6B43aC78BA3`](https://bscscan.com/address/0x000000000022d473030f116ddee9f6b43ac78ba3)。样本 `0xf5ae...ff74` 中两枚 token 都产生 Permit2 approval log，owner=Helper，spender=`0x7a4a...f95b`，amount=max，expiration 为有限时间。
- `0xf5ae...ff74`：两枚 token 先从 `0xc623...3227` 到 Helper；mint 后 NFT 从零地址到 owner；token0/token1 末尾均从 Helper 退回 owner。
- `0x920a...010e`：token0 先转入 Helper，动态 swap 产生多 hop transfer/swap；目标两币用于 position，最后 residual 退 owner。
- 字节码明确包含 `Refund wrapped token0 failed`、`Refund wrapped token1 failed`、`Refund wrapped native failed`、`Fee transfer ... failed`。

因此，“自动管理授权并退还剩余代币”是**已证实行为**；但 allowance 到期/撤销策略仍应通过更长时间窗口逐笔验证，不能仅凭一笔交易下结论。

## 4. DEX / position 组件识别

样本涉及的关键组件：

| 地址 | 链上角色（证据） |
|---|---|
| [`0x7a4a...f95b`](https://bscscan.com/address/0x7a4a5c919ae2541aed11041a1aeee68f1287f95b) | BscScan 标注 `Uniswap V4: Position Manager`；样本 mint NFT 给 owner |
| [`0x55f4...c226`](https://bscscan.com/address/0x55f4c8aba71a1e923edc303eb4feff14608cc226) | PancakeSwap Infinity `CLPositionManager`（平台 V4/Infinity 分支） |
| [`0x28e2...e9df`](https://bscscan.com/address/0x28e2ea090877bf75740558f6bfb36a5ffee9e9df) | BscScan 标注 `Uniswap V4: Pool Manager`；产生 V4 modify/swap 事件 |
| [`0x46a1...4364`](https://bscscan.com/address/0x46a15b0b27311cedf172ab29e4f4766fbe7f4364) | Pancake V3 NFT position manager；`Transfer(0, owner, tokenId)` + `IncreaseLiquidity` |
| [`0x33f6...7c9a`](https://bscscan.com/address/0x33f62721641fd3ea2f76a87a31285f3be2107c9a) | Pancake V3 pool；发出 `Mint` 与扩展 `Swap(...,protocolFees0,protocolFees1)` |
| [`0x62cc...27dc`](https://bscscan.com/address/0x62ccef0b4545166f721caa9fee13c1d3767e27dc) | 聚合 swap executor/router；样本 swap 的多 hop 事件集中来自这里及下游池 |

事件 topic 已用官方接口签名复核：

- Uniswap V4 Pool Manager：`ModifyLiquidity` / `Swap` 事件来自官方 `IPoolManager`。
- Uniswap/Pancake V3 position manager：`IncreaseLiquidity(uint256,uint128,uint256,uint256)` = `0x3067048b...e35f`。
- V3 pool：`Mint(address,address,int24,int24,uint128,uint256,uint256)` = `0x7a53080b...bde`。
- Pancake V3 扩展 Swap：`Swap(address,address,int256,int256,uint160,uint128,int24,uint128,uint128)` = `0x19b47279...c83`。
- 官方参考：[Uniswap V4 PositionManager](https://github.com/Uniswap/v4-periphery/blob/main/src/PositionManager.sol)、[Uniswap V4 IPoolManager](https://github.com/Uniswap/v4-core/blob/main/src/interfaces/IPoolManager.sol)、[Uniswap V3 position manager](https://github.com/Uniswap/v3-periphery/blob/main/contracts/interfaces/INonfungiblePositionManager.sol)、[Pancake V3 pool events](https://github.com/pancakeswap/pancake-v3-contracts/blob/main/projects/v3-core/contracts/interfaces/pool/IPancakeV3PoolEvents.sol)。

## 5. 快速建池 / 初始流动性地址

[`0xD0De...89DC`](https://bscscan.com/address/0xd0de6b3099b048efa5ce4584a62d832f7bc489dc) 是 EOA，并直接部署 [`0x0fEB...49dd`](https://bscscan.com/address/0x0feb053b2457d376e0d412888169e7fe1aca49dd)。Helper 的 `owner()` 也返回该 EOA。

最新 100 条 Helper 交易均为 `0x71fa74ed`。代表交易 [`0x039d...63f2`](https://bscscan.com/tx/0x039db2075d9c217616c0e96198fc1cb569e5c6f992f1e2d35e18cd2b31df63f2) 显示：

- EOA 将 token0/token1 转入 Helper；
- 同一交易内执行多 hop swap；
- position manager mint NFT，recipient 是 `0xD0De...89DC`；
- Helper 将剩余两币退回 EOA；
- receipt 没有 factory `PoolCreated` / pool `Initialize` 事件，因此这笔是**向现有池添加初始/后续流动性**，不是“创建池合约”本身。

公开 API 把创建池与快速加流动性分为两个 endpoint：`POST /api/pools/create` 和 `POST /api/pools/quick-liquidity`。因此产品链路应拆分为：先由 factory/pool manager 创建并初始化池，再调用 Helper 做金额配比、swap、mint 与 refund。[API 文档](https://api.lpbot.cc/api/docs)

## 6. 收费地址研究

用户提供：

- [`0xD70C...6e37`](https://bscscan.com/address/0xd70c7e33bc59040d252937b0c8d269ee55cf6e37)
- [`0x18dB...97A5`](https://bscscan.com/address/0x18dba9db5ec9178fa7ed085920a421bcca1e97a5)
- [`0x0675...9002`](https://bscscan.com/address/0x0675c903158f2cad150b8c49a921b4a946529002)

**已证实：** 三者 `eth_getCode = 0x`，是 EOA；BscScan 分别显示约 266、209、866 笔普通交易（研究时页面快照），且能看到 swap、approve、transfer 等出账活动。

**未证实：** 三地址并未硬编码在四份 Helper runtime 中；代表 Helper receipts 也没有直接向它们转账。不能据此写成 Helper 的固定 fee collector。

**样本中实际观察到的 fee 去向：**

- `0x084b8d9eE731F948ec8Eb3D87446aAD33D93E107`
- `0xfa00A9ED787F3793dB668BfF3E6e6E7Db0F92A1b`
- `0x000000000000000000000000000000000000dEaD`

这些收款地址来自 calldata 的 fee recipient/分润字段与事件，不是 Helper immutable。样本里也可见 fee bps（例如 15、20、30、50、100）等不同参数，说明费率/收款人至少部分由后端构造 calldata。要证明用户给出的三 EOA 与项目收费关系，需要从它们的 token-transfer 历史反查直接上游 Helper 或后台结算地址，并做聚类，当前证据不足。

## 7. 与自动 LP、移仓、复投、撤出的对应关系

公开 API 给出上层业务状态机，链上 Helper 给出原子执行层：

| 产品动作 | API 证据 | 链上实现推断 |
|---|---|---|
| 自动添加 LP | `POST /api/tasks/:id/start`、`POST /api/pools/quick-liquidity` | 拉币 → 必要 swap → mint NFT → refund |
| 超区间移仓 | `outOfRangeAction=rebalance`、`POST /api/tasks/:id/rebalance` | 后端监测 tick；撤旧仓/collect，再用组合入口 mint 新区间；是否跨 1 笔 tx 待验证 |
| 复投 | `POST /api/tasks/:id/reinvest` | 验证 NFT owner/approval → collect/钱包余额配比 → increase liquidity → refund |
| 换池 | `POST /api/tasks/:id/migrate` | 停旧任务/撤旧仓/必要 swap/创建新任务；API 明示 old/new task ID，属于编排级流程 |
| 撤 LP | `stop-withdraw`、`positions/remove-liquidity` | decrease → collect → 可选单币 swap；是否 Helper 原子完成须取对应 tx 验证 |
| 新建池 | `POST /api/pools/create` | factory/pool manager create+initialize；随后 quick-liquidity 使用 Helper |

重要边界：此次四类组合入口样本充分证明 V3/V4 仓位变更、授权、收费和 refund；selector 到 mint/increase 子类型的精确映射及原函数名仍未知。此次也没有拿到明确的 stop-withdraw、rebalance 或 migrate 交易哈希，所以“撤出 + swap 是否在同一 Helper 交易完成”仍是待验证项。

## 8. 测试网复现建议

### 8.1 合约拆分

1. `WalletHelperV1(owner)`：constructor immutable 绑定 owner；无 upgrade proxy。
2. `PlatformAdapter`：UniV3、PancakeV3、UniV4、PancakeV4 分开实现，Helper 只按 allowlist 选择 adapter/manager。
3. `SwapExecutor`：只接受后端签名/allowlist router，解析并拒绝 token `approve/transferFrom` 注入；设置 deadline、minOut 与 target allowlist。
4. `FeePolicy`：fee recipient/bps 明确进入签名域或链上 allowlist，不信任任意 calldata。
5. `TaskOrchestrator`：监测 tick、连续超区间计数、暂停/恢复、幂等交易提交，与 Helper 合约分离。

### 8.2 必测属性

- 非 owner 对每个资产入口均回退；owner getter 与部署钱包一致。
- 重入 token/router 回调不能再次进入组合入口。
- 任意成功交易结束后，Helper 的 token0、token1、native balance 为 0（dust 上限单独定义）。
- 新 NFT recipient 必须是 owner；已有 NFT 必须 owner 或显式授权。
- swap target、selector、tokens、minOut、deadline 被验证；fee recipient/bps 不能由不可信客户端任意改写。
- fee-on-transfer、rebasing、USDT-style approve(0) 代币均覆盖；失败时整笔回滚。
- Permit2 allowance 有 expiration，任务停止/删除时提供撤销策略。
- V3 tick 必须按 tickSpacing 对齐；V4 PoolKey/hook/tickSpacing 必须和池状态一致。
- 并发任务使用 per-wallet nonce 队列，API `idempotencyKey` 与链上 tx state 对齐。
- 任何 revert 后数据库任务状态可恢复，不把“已广播”误当作“已确认”。

### 8.3 验收交易矩阵

在 BSC Testnet（或本地主网 fork）每个平台至少产生并保存以下 tx fixture：

1. 创建/初始化池；
2. 双币直接 mint；
3. 单币 swap + mint；
4. collect + reinvest/increase；
5. 100% decrease + collect + 单币退出；
6. 超区间 rebalance；
7. 跨池 migrate；
8. swap/slippage/deadline 失败回滚；
9. 非 owner、恶意 router、重入回调失败；
10. 交易后 dust、allowance、NFT owner、fee recipient 精确断言。

每个 fixture 保存：raw tx、receipt、decoded logs、前后余额、allowance、NFT position、数据库 task state，并与本报告样本的事件序列做 golden comparison。

## 9. 复核命令

```bash
RPC=https://bsc-dataseed.binance.org
HELPER=0x30df22a0afb4167bad5c1af4aa0b6bf81506e0a5

# runtime、selector 与 owner
cast code "$HELPER" --rpc-url "$RPC"
cast selectors "$(cast code "$HELPER" --rpc-url "$RPC")"
cast rpc eth_call '{"to":"0x30df22a0afb4167bad5c1af4aa0b6bf81506e0a5","data":"0x8da5cb5b"}' latest --rpc-url "$RPC"

# EIP-1967 slots
cast storage "$HELPER" 0x360894a13ba1a3210667c828492db98dca3e2076cc3735a920a3ca505d382bbc --rpc-url "$RPC"
cast storage "$HELPER" 0xb53127684a568b3173ae13b9f8a6016e0198818aee7e0d6a7e8a4e00f6e8c49f --rpc-url "$RPC"

# 代表交易与 receipt/logs
TX=0xf5ae222e80cfe0e90304587ca8e890f6e7ddea51f38e16adb87b49cbb195ff74
cast rpc eth_getTransactionByHash "$TX" --rpc-url "$RPC" | jq .
cast rpc eth_getTransactionReceipt "$TX" --rpc-url "$RPC" | jq .
```

## 10. 已知限制与下一证据请求

- BscScan 匿名 V1 API 已停用；V2 对 BSC 免费访问受限。本文的结构化数据来自 BSC RPC，BscScan 页面仅用于创建者/交易列表交叉核验。
- Helper 源码在 BscScan 未验证；runtime metadata 指向的 IPFS CID 在研究时网关无 provider/超时。selector 业务名称因此保持未知。
- 若要闭合 rebalance、reinvest、stop-withdraw、migrate 的链路，下一步应由产品账户各触发一次只读可观察或测试网小额操作，并提供 tx hash。每类只需一个成功样本和一个失败样本即可完成 ABI/事件序列对照。
- 若要证明三个收费钱包，需要导出它们的 BEP-20 token transfer 全历史，按直接上游 Helper/结算地址、token、时间窗和金额比例聚类；普通交易页不足以支持归因。
