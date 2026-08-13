# 历史 Codex 任务研究摘录：LPBot Helper 合约

> 来源任务：`codex://threads/019fc91f-d66c-7b40-8728-4f65783898fa`  
> 历史任务标题：`实现可部署 Helper 合约`  
> 历史分析时间边界：截至 2026-08-03  
> 本次整理日期：2026-08-13

## 1. 使用边界与证据等级

该历史任务只有一个完整回合，研究范围是 **BSC 上三份钱包专属 Helper 合约**，并非 lpbot.cc 的完整产品分析。它没有浏览或记录以下内容：

- lpbot.cc 前端 UI、登录与账号体系；
- 热门池、手续费排行、告警或监控数据管线；
- 自动 LP 任务的链下调度、超区间判断、重试、签名和密钥托管；
- 创建新池、添加/移除初始流动性的指定钱包和 Helper；
- PRO/管理员功能、公开/隐藏前端 Bundle；
- `api.lpbot.cc` 的接口、鉴权和 WebSocket/SSE 行为；
- 多链部署矩阵、数据库结构、队列和后台管理系统。

本文使用三种标记：

- **[直接证据]**：历史材料给出了具体链上地址、交易、字节码或本地原始抓取文件，可复核。
- **[历史推断]**：历史任务通过反编译、calldata、事件与交易顺序得出的语义解释；函数原名和产品侧含义仍需再验证。
- **[旧实现扩展]**：历史任务为了交付可部署源码而自行设计的能力，不应当作 lpbot 原实现事实。

注意：本次工作读取并整理了历史任务和其本地交付物，没有重新从 RPC 全量重放 1,056 笔交易。因此下文的“直接证据”表示 **存在可复核的一手证据定位**，不表示本次已独立重验所有结论。

## 2. 可直接复用的历史资产

旧工作目录：

```text
/Users/alpha/Documents/Codex/2026-08-04/helper-helper-swap-helper-helper-helper
```

关键交付物：

| 资产 | 路径 | 用途 |
|---|---|---|
| 详细分析 | `outputs/WalletAtomicLiquidityHelper/ANALYSIS.md` | 字节码、selector、ABI 布局、代表交易、地址映射 |
| 等价 Helper | `outputs/WalletAtomicLiquidityHelper/src/WalletAtomicLiquidityHelper.sol` | 可部署参考实现；不是原字节码伪源码 |
| 钱包 Factory | `outputs/WalletAtomicLiquidityHelper/src/WalletHelperFactory.sol` | CREATE2 一钱包/版本一 Helper 的参考设计 |
| 原合约编码器 | `outputs/WalletAtomicLiquidityHelper/src/ObservedHelperCodec.sol` | 四个已观测 selector 的 calldata 编码 |
| Foundry 测试 | `outputs/WalletAtomicLiquidityHelper/test/WalletAtomicLiquidityHelper.t.sol` | 6 个 mock 单元测试 |
| 归档 | `outputs/WalletAtomicLiquidityHelper.zip` | 历史完整交付包 |
| 原始创建字节码 | `work/h1_creation.bytecode`、`work/h2_creation.bytecode` | 创建代码比较与构造器分析 |
| 原始 runtime | `work/helper1.bytecode`、`work/helper2.bytecode`、`work/helper3.bytecode` | runtime 反编译与差异分析 |
| 交易抓取 | `work/h{1,2,3}_rows.json`、`work/h{1,2,3}_rpc_txs.json` | 三份 Helper 共 1,056 条记录 |
| 代表交易 | `work/representative_txs.json`、`work/sample*_receipt.json` | 四个核心入口的 calldata/receipt |
| 反编译结果 | `work/decomp1sol/Helper1-decompiled.sol`、`Helper1-abi.json` | 控制流与 ABI 恢复参考 |
| 移除流动性材料 | `work/direct_remove_receipt.json`、`analyze_direct_modify.py` | 直接调用 PositionManager 的退出路径 |

历史交付报告记录的构建结果：Solidity `0.8.31`，自建 Helper runtime 约 `12,750 bytes`，Foundry `6 passed, 0 failed`。归档 SHA-256 被记录为 `4c9fd4208fa27f9b6b35dbe0690d6166de9a76ffc6a4beeeaa33b24204dd78b9`。这些只证明旧参考项目当时的构建状态，不证明其与生产 Helper 完全等价或已经过审计。

## 3. 样本和钱包绑定

**[直接证据]** 历史任务分析了以下三组 Helper / owner：

| Helper | 对应 owner | 部署交易 |
|---|---|---|
| [`0x30df22a0afb4167bad5c1af4aa0b6bf81506e0a5`](https://bscscan.com/address/0x30df22a0afb4167bad5c1af4aa0b6bf81506e0a5) | [`0xc623Ab46FA6Ff2F547E35F88679a9EBF0b823227`](https://bscscan.com/address/0xc623Ab46FA6Ff2F547E35F88679a9EBF0b823227) | [`0xf39ebe9e...`](https://bscscan.com/tx/0xf39ebe9e16dc2ef48fc8a39721c15426e72b2506d6097794fd1fbfba91c24923) |
| [`0x1e2ed4697542219f06e66d465a9de69241d1f100`](https://bscscan.com/address/0x1e2ed4697542219f06e66d465a9de69241d1f100) | [`0x8eeAC170c9aF31dCEA2DA5922EEF687C3F1Db885`](https://bscscan.com/address/0x8eeAC170c9aF31dCEA2DA5922EEF687C3F1Db885) | [`0x06b1b496...`](https://bscscan.com/tx/0x06b1b496e2b96d9ec5d934f1249e5d1eb4c02e3a58b3e55952e88117476080a9) |
| [`0x8dbfa4facbba05c158a8340e6a366dffb93d732a`](https://bscscan.com/address/0x8dbfa4facbba05c158a8340e6a366dffb93d732a) | [`0x4051736687e78df58862BFFBDD864f00143A325E`](https://bscscan.com/address/0x4051736687e78df58862BFFBDD864f00143A325E) | [`0xebcbb9b7...`](https://bscscan.com/tx/0xebcbb9b7c3f41fbdbcd1f2e6795aa1025313973c1e9900c83434667e4662a0c7) |

历史原始 JSON 的条数分别为 440、490、126，总计 1,056（包含三笔部署交易）。历史报告称所有状态修改调用的 `from` 都是相应 immutable owner。

## 4. 字节码与合约骨架

### 4.1 高可信链上结论

- **[直接证据]** 三份 creation code 被记录为 `19,377 bytes`，逐字节一致，且没有 constructor ABI 尾参。旧目录中 `h1_creation.bytecode` 和 `h2_creation.bytecode` 当前 SHA-256 都是 `95370aa80216d0a3963471fcd0e16d6465417f1548ae24cad816ed31133c676c`。
- **[直接证据]** 三份 runtime 被记录为 `19,133 bytes`；本地 runtime 文件长度一致但 SHA-256 不同。
- **[历史推断]** runtime 差异仅来自两个 constructor patch 的 immutable：`owner` 与 `keccak256(abi.encodePacked(address(this)))`。
- **[直接证据]** metadata 尾部被识别为 Solidity `0.8.31`。
- **[历史推断]** storage slot 0 的低字节用于 `nonReentrant` 锁；四个 LP 操作和提币入口检查 immutable owner；空 calldata 可接收 BNB。
- **[历史推断]** selector `0x3521ab9f` 返回 `keccak256(address(this))`，不是数字语义版本。前端显示的版本因此更可能来自链下部署元数据，而非该 getter。

这部分支持“每钱包独立 Helper、仅 owner 可调用”的产品模型，但 **没有证明** Helper 是由何种链下服务部署、部署触发是否一定是“首次启动 LP 任务”、版本配置存储在哪里。

### 4.2 Getter 与应急入口

| Selector | 历史解释 | 等级 |
|---|---|---|
| `0x8da5cb5b` | `owner()` | [直接证据/标准 selector] |
| `0x3521ab9f` | `helperId()`，值为合约地址 hash | [历史推断，已有三份返回值验证记录] |
| `0x1230fa51` | 查询 Helper 的 ERC-20/BNB 余额；零地址代表 BNB | [历史推断] |
| `0xca51c05d` | owner 提走指定 ERC-20 全余额 | [历史推断；样本中见一次] |
| `0xd9e70e41` | owner 提走全部 BNB | [历史推断] |

## 5. 四个核心 LP 入口

函数名无法从未验证字节码中恢复。下列名称均为历史任务使用的 **描述性别名**。

| Selector | 描述性语义 | 三样本调用数 | 等级 |
|---|---|---:|---|
| `0x71fa74ed` | 已观察的 V4 组合路径 A；原函数名和子类型未知 | 767 | [历史推断，事件/receipt 支撑] |
| `0x5dfd8e50` | 已观察的 V4 组合路径 B；原函数名和子类型未知 | 258 | [历史推断，事件/receipt 支撑] |
| `0xadc3f25c` | 已观察的 V3 组合路径 A；原函数名和子类型未知 | 18 | [历史推断，事件/receipt 支撑] |
| `0xfb691fd9` | 已观察的 V3 组合路径 B；原函数名和子类型未知 | 9 | [历史推断，事件/receipt 支撑] |

此外 `0xca51c05d` 有 1 次，部署 3 次。

### 5.1 已恢复的公共外层参数

历史 `ObservedHelperCodec.sol` 将四个入口统一恢复为：

```solidity
(
    uint8 platformId,
    bytes swapData,
    address swapToken,
    address swapRouter,
    /* V3/V4 mint 或 increase 参数结构体 */,
    address feeRecipient,
    uint256 feeBps
)
```

**[历史推断]** 结构体字段：

- V4 Mint：`currency0, currency1, fee, tickSpacing, hooks, sqrtPriceX96, tickLower, tickUpper, amount0Desired, amount1Desired, deadline, slippageBps`。
- V4 Increase：在上述字段前增加 `tokenId`。
- V3 Mint：`token0, token1, fee, tickLower, tickUpper, amount0Desired, amount1Desired, deadline, slippageBps`。
- V3 Increase：`tokenId, token0, token1, amount0Desired, amount1Desired, deadline, slippageBps`。

该布局有现成编码器和代表 calldata 可用于回归，但在实现生产编码前仍应对多个样本做 `encode -> 原 calldata` 字节级对比。

### 5.2 代表交易

| 入口 | 代表交易 | 历史观测 |
|---|---|---|
| V4 路径 A | [`0xf5ae222e...`](https://bscscan.com/tx/0xf5ae222e80cfe0e90304587ca8e890f6e7ddea51f38e16adb87b49cbb195ff74) | token 转入 Helper、授权、V4 仓位事件、NFT 归 owner、余币退款 |
| V4 路径 B | [`0x920a5ed8...`](https://bscscan.com/tx/0x920a5ed8864ed70d6638dcc0bc035b51f6bcdf27c04c9688663a6127bc67010e) | 单边资产进入、OKX 多跳 Swap、收费、V4 仓位事件、退款 |
| V3 路径 A | [`0xe0936775...`](https://bscscan.com/tx/0xe0936775f9112e4930d72d51d9c974719a70e2d220c24266d1f4c07ffc644c63) | Pancake V3 仓位相关事件、NFT 归 owner、退款 |
| V3 路径 B | [`0x802fc337...`](https://bscscan.com/tx/0x802fc3374da2fbde3a48a91f9895249935adb788e1af980599572ceb129514db) | Pancake V3 仓位相关事件、Swap 和退款 |

## 6. 协议和地址映射

**[历史推断，有硬编码/交易目标佐证]** `platformId` 映射：

| ID | 平台 | PositionManager | Permit2（V4） |
|---:|---|---|---|
| 1 | Uniswap V3 | `0x7b8A01B39D58278b5DE7e48c8449c9f4F5170613` | - |
| 2 | PancakeSwap V3 | `0x46A15B0b27311cedF172AB29E4f4766fbE7F4364` | - |
| 4 | Uniswap V4 | `0x7A4a5c919aE2541AeD11041A1aeee68f1287f95B` | `0x000000000022D473030F116dDEE9F6B43aC78BA3` |
| 5 | Pancake Infinity CL | `0x55f4c8abA71A1e923eDc303eB4fEff14608cC226` | `0x31c2F6fcFF4F8759b3Bd5Bf0e1084A055615c768` |

其他历史识别地址：

- WBNB：`0xbb4CdB9CBd36B01bD1cBaEBF2De08d9173bc095c`。
- Pancake CL PoolManager：`0xA0FfB9c1CE1Fe56963B0321B32E7A0302114058b`。
- OKX DEX Router 2：`0x62CceF0B4545166F721CaA9fEe13c1D3767e27dc`。
- OKX Token Approval Proxy：`0x2c34A2Fb1d0b4F55De51E1D0bDEFaddce6b7cDD6`。

这些地址只适用于历史 BSC 样本时间点。新项目应使用带版本的链配置注册表，不应把它们直接泛化到其他链或后续版本。

## 7. Swap、授权、收费、退款工作链路

以下均为 **[历史推断]**，但有反编译分支和代表交易支撑：

1. owner 先将输入资产授权给自己的 Helper。
2. Helper 拉取资产，可调用传入的 `swapRouter + swapData` 调整双边比例。
3. 观察到的 Swap 主要通过 OKX Router，ERC-20 授权对象为固定 Approval Proxy。
4. Helper 拒绝把 `transfer` (`0xa9059cbb`)、`transferFrom` (`0x23b872dd`) 或 `approve` (`0x095ea7b3`) calldata 伪装为 Swap。
5. V3 直接临时授权 PositionManager；V4/Infinity 经相应 Permit2 再授权 PositionManager。
6. 对已有 NFT，Helper 检查 `ownerOf(tokenId)`，并要求 `getApproved` 或 `isApprovedForAll` 授权 Helper。
7. 存在 Swap 时，历史样本常见 `feeBps = 10` 或 `15`，费用从 Swap 后可用 token0/token1 转给 `feeRecipient`。
8. LP 操作结束后退回剩余 token0/token1，并处理 WBNB/BNB 退款；应急入口可取回异常滞留资产。

未证实事项：收费是否在所有产品功能/链/版本中一致，收费基数的精确定义，手续费地址如何链下选择，以及 swap quote/calldata 由 lpbot 后端还是第三方 SDK 生成。

## 8. 移除 LP 与“撤出后自动 Swap”

### 8.1 生产样本中实际观察到的路径

**[直接证据 + 历史推断]** 三份旧 Helper 没有观察到单独的 Decrease/Collect 外部 selector。历史任务找到钱包直接调用 PositionManager 的交易：

- [`0xc5c3cc34...`](https://bscscan.com/tx/0xc5c3cc34c6ae181e7e75157e4af4095364bb1e1dc20d83cbc2848a83f735e434)：直接 `modifyLiquidities(bytes,uint256)`，负 `liquidityDelta`，资产回 owner。

另一个连续交易序列：

1. [`0xd8677d6b...`](https://bscscan.com/tx/0xd8677d6b7fc62af441ef04693b45b0ee79a627eb407193c01a04211b0d335000)：直接从 Uniswap V4 PositionManager 移除。
2. [`0x27ff6983...`](https://bscscan.com/tx/0x27ff69835ebd80856c3b73f07f839d9eb245e4d92ef09838012e3787feb89b26)：调用 OKX Router Swap。
3. [`0x43cc73b1...`](https://bscscan.com/tx/0x43cc73b100e7a174600a27d9233b58c96de364d52f8aa9282a79f88e20439d5e)：再次调用 OKX Router Swap。

因此历史样本里的“移除并换币”更像 **链下编排的多笔交易工作流**，而不是旧 Helper 内单笔原子交易。产品复刻需要在任务状态机中建模 `DECREASE/COLLECT -> SWAP_TOKEN_0 -> SWAP_TOKEN_1 -> RECONCILE`，不能只实现一个原子 Helper 调用。

### 8.2 不应误认为生产事实的旧扩展

以下是 **[旧实现扩展]**：

- `removeV3AndSwap`：单笔 V3 Decrease + Collect + Swap + Refund。
- `atomicSwapAndModifyV4`：允许用通用 actions 实现 V4 Mint/Increase/Decrease/Collect/Burn。
- `collectV3AndSwap`、显式 swap target/spender 白名单、owner 可配置 manager。
- `WalletHelperFactory` 的 CREATE2 `(owner, version)` 映射。

它们可作为新系统设计候选，但不能用来声称 lpbot 生产站已经这样实现。

## 9. Helper 版本迭代线索

**[直接证据]** 截至历史分析时间，前两个 owner 被观察到使用新 Helper：

| owner | 新 Helper | 历史记录的 runtime size |
|---|---|---:|
| `0xc623...3227` | [`0x3d3de64d5b711b23cb387b6a8017045aac30d751`](https://bscscan.com/address/0x3d3de64d5b711b23cb387b6a8017045aac30d751) | 19,226 bytes |
| `0x8eeA...b885` | [`0xfc672d36466f18536eb5fc9ae15a9c376c3535cd`](https://bscscan.com/address/0xfc672d36466f18536eb5fc9ae15a9c376c3535cd) | 19,226 bytes |

历史报告称它们比旧 runtime 多 93 bytes，并保留相同核心 selector。新增 93 bytes 的具体行为没有完成语义定位，必须列为版本差异研究项。

## 10. 对新项目架构的可用结论

这些不是完整架构，而是历史证据支持的最小边界：

- 需要 **链/协议/Helper 版本注册表**：管理 PositionManager、PoolManager、Permit2、wrapped native、router/spender、部署 bytecode hash 和启用区块。
- 需要 **Wallet -> Helper deployment** 域模型：状态至少包括未部署、部署提交、已确认、版本迁移、故障/回滚。
- 需要 **链上交易编排状态机**：添加/复投可走 Helper；历史退出路径包含多笔直接协议调用和 Swap。
- 需要 **calldata 生成与模拟层**：按 V3/V4、Mint/Increase、链版本编码；广播前做 fork/`eth_call` 模拟、滑点和余额变化断言。
- 需要 **审批/授权管理**：ERC-20 -> Helper、NFT -> Helper，V4 内部 Permit2；记录当前 allowance、到期和清理策略。
- 需要 **交易对账**：按 receipt/logs 识别 Mint、Increase、ModifyLiquidity、token transfer、fee 和退款，而不是只依赖交易成功状态。
- 产品前端显示的 Helper “版本”应读取链下部署注册数据，不能把 `0x3521ab9f` 当数字版本 getter。

## 11. 优先待验证问题

### P0：在开发生产交易前必须验证

1. 使用当前 BSC RPC 对五份 Helper 重新抓取 `eth_getCode`、创建交易与最新交易，确认 2026-08-13 时版本和 selector 是否变化。
2. 对四类入口各抽取不少于 10 笔、覆盖 platformId 1/2/4/5 的交易，字节级验证 `ObservedHelperCodec` ABI。
3. 明确 Helper 部署者、CREATE/CREATE2 方式、部署触发事件和链下版本登记；历史任务只证明了 constructor 语义，没有证明部署服务。
4. 反编译两个 19,226-byte 新版本，定位新增 93 bytes 的真实功能与安全检查。
5. 用交易 trace 确认 Swap spender、fee 计算基数、退款顺序、授权是否清零以及失败时回滚路径。
6. 分别验证 V3/V4 的移除、collect、burn、撤出后 swap 是否随 Helper 版本或产品设置变化。

### P1：产品工作链路验证

1. lpbot 后端如何生成 OKX quote/calldata，slippage、deadline、gas 与 MEV 保护如何设置。
2. 自动复投、超区间移仓的触发条件、轮询频率、幂等键、并发锁、重试和部分完成恢复。
3. wallet 私钥/签名方式：服务端托管、浏览器签名、MPC 或其他方案；历史链上材料不能回答。
4. feeRecipient 与 `feeBps` 的套餐/链/功能映射，以及收费池地址的实际用途。
5. 新建池和初始流动性是否使用另一套 Helper/调用路径。

### P2：仍完全未覆盖

- UI 与路由清单、响应式状态、PRO/管理员界面；
- API schema、鉴权、限流、实时推送；
- 热门池和手续费排行的索引源、计算窗口与缓存；
- 多链支持矩阵、数据库/队列/可观测性；
- 测试网部署与端到端验收。

## 12. 避免重复工作的建议

1. 不要重新手工猜四个 selector 的参数，先复用 `ObservedHelperCodec.sol` 对当前样本回归。
2. 不要把旧 Helper 源码当原始源码；它是功能等价参考，并含多项主动扩展。
3. 不要再次全量抓取历史页面来证明 2026-08-03 以前的调用统计；原始 HTML/JSON 已保存在 `work/`。只补抓该时间点之后的数据，并保留区块游标。
4. 不要把退出流程强塞进旧 Helper；先按“直接 PositionManager + 两次 Swap”的历史多交易路径建立行为测试，再决定是否额外提供原子优化。
5. 不要把 BSC 地址写死在跨链业务代码；建立可审计、带生效区块和 bytecode hash 的版本注册表。
6. 下一轮研究应从站点/API/UI/后台调度入手，而不是重复 Helper 基础反编译。

## 13. 结论摘要

历史任务已较完整地覆盖了 **BSC 钱包专属 Helper 的 Mint/Increase/Compound 侧**：单 owner、四个主要入口、V3/V4 平台映射、OKX Swap、Permit2/PositionManager 授权、10/15 bps 常见收费及余币退款。它还提供了可复用的 calldata 编码器、原始交易资料和一个经过 6 个 mock 测试的参考合约。

最关键的边界是：历史链上证据显示旧 Helper 主要负责 **新建 LP 与增加/复投**；移除和撤出后换币由钱包直接调用协议并进行后续 Swap。旧交付中的原子退出、白名单和 CREATE2 Factory 是参考设计，不是 lpbot 生产行为的直接证据。站点 UI、热门池/手续费排行、自动任务调度、PRO/管理员功能和 API 架构仍需从零研究。
