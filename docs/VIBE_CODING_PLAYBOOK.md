# LPBot 复现 Vibe Coding 开发手册

> 适用范围：使用 Codex、Claude Code、Cursor 等代码助手执行本项目。  
> 产品范围：[功能矩阵](./FUNCTION_MATRIX.md)  
> 架构约束：[目标架构与工作流](./ARCHITECTURE_AND_WORKFLOWS.md)  
> 开发顺序：[路线图](./DEVELOPMENT_ROADMAP.md)  
> 验收映射：[追踪矩阵](./TRACEABILITY_MATRIX.md)

## 1. 正确使用方式

Vibe Coding 在本项目中是“证据驱动的受约束实现”：人确定范围、证据、风险和完成定义，助手负责读取代码、写失败测试、实现、验证和整理差异。每次任务只处理可独立验收的一小组功能 ID。

标准循环：

```text
冻结证据 -> 写任务卡 -> 助手复述已知/未知 -> 失败测试
-> 最小实现 -> 单元/契约/视觉/链上测试 -> 独立审查
-> 保存证据 -> 更新追踪矩阵 -> 合并
```

以下情况不开始实现：没有功能 ID、没有可检查的完成条件、R3/R4 没有测试环境、接口所有权冲突、把 Bundle 推断误写成生产事实。

## 2. 每次必须提供给助手的信息

| 信息 | 最低内容 | 示例 |
|---|---|---|
| 任务身份 | 阶段、功能 ID、标题 | `P02 / POOL-01..05 / 热门池基本表格` |
| 目标行为 | 用户动作和可观察结果 | 选择 5m+BSC 后按 fees 稳定排序 |
| 一手证据 | UI/API/BUNDLE/CHAIN/INFERRED 及路径 | screenshot、HTTP fixture、tx receipt |
| 当前状态 | 已有代码、失败测试、已知 bug | `packages/api-contract` 已有 schema |
| 范围边界 | 本次做什么、哪些留待后续 | 做表格和 SSE reducer，不做标签算法 |
| 接口 | 输入、输出、错误、SSE、权限 | JSON fixture 和 401/403/422 样本 |
| UI 基线 | route、viewport、theme、全部状态 | 1440x900/390x844、light/dark |
| 链信息 | chain/protocol/version/registry/fixture | BSC 56、platform 2、fork block |
| 风险门禁 | R0-R4、允许的环境/动作 | R3，只允许 Anvil 和 BSC Testnet |
| 验收 | Test ID、Evidence ID、命令 | `T-API,T-SSE,T-VIS`; `E-API,E-SSE,E-VIS` |
| 完成定义 | 可判定的逐条条件 | diff 阈值、重连结果、无 console error |
| 修改范围 | 允许目录和明确禁止碰触的公共契约 | `apps/web`, `packages/ui`; contract 只读 |

不要把生产私钥、Telegram Bot Token、API secret、助记词或用户密码发给助手。使用 `.env.example` 占位符和专用 secret store；测试私钥只注入隔离测试进程。

## 3. 项目上下文包

每个任务在 issue/任务目录中准备以下清单；大文件给绝对路径和读取条件，不把所有资料粘进单个 prompt。

```text
tasks/<FEATURE-ID>/
  TASK.md                 # 唯一任务卡
  evidence/
    target-ui/            # 目标站截图、viewport、theme、时间
    api/                  # request/response/error/SSE transcript
    chain/                # raw tx、receipt、logs、trace、balance、block
  fixtures/               # 去敏后的可执行输入
  acceptance.md           # Test/Evidence checklist
  decisions.md            # 本任务新增的设计决定和未知项
```

`TASK.md` 模板：

```markdown
# <Pxx> <FEATURE_IDS> <标题>

## 目标
<一句话描述可观察行为>

## 证据
- UI: <绝对路径/URL、时间、账号角色、状态>
- API: <fixture 路径或 docs 条目>
- BUNDLE: <chunk/hash/符号；仅候选规格>
- CHAIN: <chainId、block、tx/receipt fixture>

## 已知与未知
- 已确认：...
- 推断：...，验收状态最多为 implemented-assumed

## 范围
- 包含：...
- 后续阶段：...

## 契约
- 输入/输出/错误/权限/SSE：...

## 风险
- 等级：R0/R1/R2/R3/R4
- 允许环境：mock/fork/testnet/mainnet-readonly
- 广播权限：无；如需 R4，停在 READY_FOR_APPROVAL

## 测试和证据
- Test IDs: ...
- Evidence IDs: ...
- 命令：...

## 完成定义
- [ ] ...

## 修改边界
- 可修改：...
- 接口 owner：...
```

## 4. 建议的仓库级助手规则

代码仓库初始化后，把下列内容精简为根 `AGENTS.md`。正文只保留始终适用的步骤，把产品细节通过明确触发条件指向本目录文档。

```markdown
# LPBot Engineering Rules

## Before editing
1. Read the task card and extract every feature ID, risk level, test ID, evidence ID, and allowed path.
2. For product behavior, read docs/FUNCTION_MATRIX.md and the cited research evidence. For architecture or chain workflows, read docs/ARCHITECTURE_AND_WORKFLOWS.md. For phase gates, read docs/DEVELOPMENT_ROADMAP.md.
3. Inspect existing code and tests. Report facts, assumptions, and conflicts before editing.

## Implementation loop
1. Add a failing test that proves the requested behavior or regression.
2. Make the smallest coherent implementation using existing contracts and patterns.
3. Run focused tests, then affected package tests, then required acceptance suites.
4. Save evidence under artifacts/acceptance/<FEATURE-ID>/ and update docs/TRACEABILITY_MATRIX.md.

## Evidence
- Label claims UI, API, BUNDLE, CHAIN, or INFERRED.
- BUNDLE-only Pro/admin behavior stays implemented-assumed until role evidence exists.
- Preserve integer token amounts, chain registry versions, idempotency, nonce serialization, receipt reconciliation, and secret redaction.

## Risk gates
- R0/R1 use fixtures or test accounts. R2 requires isolated secrets and security tests. R3 runs fork before testnet.
- Stop any R4 operation at READY_FOR_APPROVAL and report chain, wallet, action, assets, USD cap, gas cap, expected result, and recovery plan.

## Completion
- A feature is complete only when its specified tests pass and reproducible evidence exists. Report commands and results, remaining assumptions, and no unrelated edits.
```

## 5. 每轮通用主提示词

将以下提示词放在任务卡路径之后使用。它要求助手先调查再编码，并给出可检查的结束条件。

```text
你正在实现 LPBot 复现项目的 <PHASE> / <FEATURE_IDS>。

先读取：
1. <ABSOLUTE_PATH>/tasks/<FEATURE_ID>/TASK.md
2. docs/FUNCTION_MATRIX.md 中对应 ID
3. docs/ARCHITECTURE_AND_WORKFLOWS.md 中对应边界/工作流
4. docs/DEVELOPMENT_ROADMAP.md 的 <PHASE>
5. docs/TRACEABILITY_MATRIX.md 中对应行

先探索仓库和现有测试，输出不超过 12 行的：已确认事实、仍是推断、拟修改文件、测试顺序、风险门禁。发现契约冲突时先说明并以一手证据和现有公共契约为准。

然后直接执行：
- 先增加能稳定失败的测试；展示失败原因。
- 做最小但完整的实现，沿用现有模块和 schema，不创建第二套重复契约。
- 金额用整数 base units；链地址来自版本化 registry；command 使用幂等键；交易按钱包/链串行 nonce；成功以 receipt+余额/NFT 对账为准。
- BUNDLE/INFERRED 行为在代码和证据中保留 assumption 标签。
- 依次运行任务卡中的 focused、package、acceptance tests。
- 将验收产物放到 artifacts/acceptance/<FEATURE_ID>/ 对应目录，更新追踪矩阵状态和链接。

只修改任务卡允许的路径。不要提交真实秘密，不调用生产写接口，不签名或广播未批准的 R4 交易。若工作到达 R4，停止在 READY_FOR_APPROVAL 并输出审批模板。

结束时报告：修改、测试命令与结果、Evidence 路径、仍待验证项、下一依赖。完成定义未全部满足时明确保持进行中。
```

## 6. 红绿重构与验收循环

### 6.1 Red

1. 从功能 ID 的可观察结果写测试，不从预想实现写测试。
2. UI 先建立状态 fixture，再写交互和 screenshot assertion。
3. API 先保存目标 request/response/error golden，再写 provider/consumer contract。
4. SSE 先保存完整 transcript，覆盖 snapshot、diff、heartbeat、duplicate、gap、reconnect。
5. 链上先保存 fork block、raw tx/receipt/log/balance，再写 Foundry/TypeScript assertions。
6. 运行测试并确认因缺少目标行为而失败，不是 fixture、环境或拼写错误。

### 6.2 Green

- 实现最小纵向行为，包括错误、权限、空态和日志；不要用只满足单个截图的硬编码。
- 所有异步 command 返回 operation，所有多交易动作使用可恢复 step。
- 未知算法放在版本化 strategy/adapter 中，保留 golden 校准入口。

### 6.3 Refactor

- 仅在绿色后合并真正重复的 domain 逻辑；UI 视觉相似但语义不同的控件不强行抽象。
- 公共 schema、chain registry、状态机只有一个 source of truth。
- 重构后运行相同验收集，证据路径不变化。

### 6.4 Review

由未参与实现的助手或工程师分两轴审查：

1. **Spec review**：逐条对功能 ID、证据、角色、状态和完成定义。
2. **Engineering review**：资金正确性、幂等、nonce、恢复、精度、密钥、SSRF、reorg、可观测性和测试质量。

审查输出先列问题并带文件/行号和严重度；无问题时仍说明剩余证据缺口和未执行的测试。

## 7. UI 1:1 工作法

### 7.1 先建立状态矩阵

每个路由记录：角色、viewport、theme、数据状态、权限状态、操作阶段。最低视口为目标桌面基线、宽桌面、平板、`390x844` 和一个窄屏；截图同时保存 DPR、浏览器和时间。

### 7.2 实现顺序

1. 提取颜色、字体、间距、边框、阴影、尺寸和 breakpoints 为 design tokens。
2. 复现应用壳和固定尺寸控件，确认动态文本不引起布局跳动。
3. 使用去敏 fixture 复现 loading/empty/error/stale/有数据/禁用/权限状态。
4. 接真实兼容 API/SSE；验证重连和长数据。
5. Playwright 截图目标和复刻页面，生成像素 diff；人工复核动态内容区域。

### 7.3 UI 专用提示词

```text
实现 <FEATURE_IDS> 的 1:1 UI。证据位于 <TARGET_UI_DIR>，每张图的 route/viewport/theme/role/state 记录在 manifest.json。

先用浏览器只读检查目标页面和现有本地页面，列出 DOM/布局/字体/颜色/间距/交互差异。读取现有 design tokens 和组件，不另建平行组件库。

先写 Playwright：路由、键盘/鼠标交互、loading/empty/error/data/permission 状态，以及指定 viewport/theme 截图。确认测试在实现前失败，再实现。动态金额/时间使用固定 fixture；遮罩区域不参与像素阈值。

完成时运行 accessibility、console/network error、desktop/mobile screenshots 和 pixel diff。保存 E-UI/E-VIS，按每个功能 ID 报告差异；没有目标角色证据的 Pro/admin 页面标 implemented-assumed。
```

## 8. API、SSE 与数据提示词

### 8.1 公开 API 兼容

```text
实现 <FEATURE_IDS> 对应的 API 兼容切片。目标 OpenAPI/HTTP fixtures 位于 <FIXTURE_DIR>。

先比较 packages/api-contract、目标 docs fixture 和当前 handler/domain，列出 method/path/字段 casing/default/error/auth 差异。先写 provider contract 和 Web consumer contract，覆盖成功、validation、401、403、409、429、503。

DTO adapter 与 domain 分离；金额/ID 精度不丢失；响应不泄露 secret。实现后重新生成 OpenAPI 并做语义 diff，不手改生成文件。保存 E-API，更新对应功能 ID。
```

### 8.2 SSE

```text
实现 <FEATURE_IDS> 的 SSE stream。使用 <TRANSCRIPT> 作为目标行为证据。

先写 transcript test：initial snapshot、ordered diff、heartbeat、duplicate、sequence gap、Last-Event-ID replay、buffer expired snapshot、断线重连。服务端和前端 reducer 共用 versioned schema；每个 stream 独立 sequence。

注入慢客户端、Redis 重启和重复事件。断言无数据丢失、旧 diff 不覆盖新 entity、连接清理无泄漏。保存 E-SSE 和性能数据。
```

### 8.3 Indexer/排行

```text
实现 <FEATURE_IDS> 的 <CHAIN/DEX/WINDOW> 数据切片。输入为 <BLOCK_RANGE_RAW_LOGS>，目标输出为 <TARGET_GOLDEN>。

先写 decoder、去重、reorg、window boundary、stable sort 和 metricVersion tests。保留 raw integer amounts、block/hash/logIndex 和 source timestamps。派生指标必须从可重放事件生成。

对于 aTVL/标签等未知公式，提供 versioned calculator、reasons 和 golden calibration test，状态保持 implemented-assumed。输出从 raw event 到 UI row 的追踪记录并保存 E-DATA。
```

## 9. 钱包、合约与资金工作流提示词

### 9.1 钱包/signer

```text
实现 <FEATURE_IDS> 的钱包/签名切片，风险 <RISK>，仅允许 <ENVIRONMENTS>。

先画出 API -> worker -> signer -> KMS/DB 信任边界，检查现有 secret redaction 和 IAM。先写 crypto known-answer、ciphertext tamper、lock/expiry/restart、跨用户权限、日志泄密和并发 nonce 测试。

API 和 worker不得拥有解密权限；队列不得含私钥/密码/DEK。用户密码模式使用版本化 Argon2id 参数，服务端模式使用 envelope encryption。测试只使用专用 fixture key。

完成后运行 T-SEC/T-REC。涉及测试网广播时先确认 R3 门禁；涉及主网时停在 READY_FOR_APPROVAL。
```

### 9.2 Helper/adapter

```text
实现 <FEATURE_IDS> 的 <CHAIN>/<PROTOCOL>/<VERSION> adapter/Helper。读取 chain fixture <FIXTURE_DIR> 和版本 registry。

事实边界：0x71fa74ed/0x5dfd8e50 仅可称为已观察 V4 路径，0xfb691fd9/0xadc3f25c 仅可称为 V3 路径；函数原名未知。先复用 ObservedHelperCodec 对生产 calldata 做 encode==raw 的字节回归，不凭 selector 猜函数名。

先写 Foundry unit/fuzz/invariant 和 Anvil fork tests：owner-only、reentrancy、platform/manager/code hash、router/selector/token/minOut/deadline、Permit2/approve、NFT recipient/approval、fee recipient/bps、native wrap、refund/dust、revert atomicity。

实现用 registry 解析地址，成功以 receipt/log+余额+allowance+NFT owner 对账。保存 E-CHAIN/E-SEC。测试网前冻结 ABI/registry；主网停在 READY_FOR_APPROVAL。
```

### 9.3 通用 saga

```text
实现 <FEATURE_IDS> 的 <WORKFLOW> operation saga：<STEPS>。

先写状态转换表和每个 step 的 precondition/postcondition/dedupe key/compensation-or-recovery。为每个边界注入失败：验证、模拟、签名、广播、pending、confirmed、reconcile、worker/DB/Redis 重启、RPC 分歧、reorg。

同一 idempotency key+request 返回原 operation；不同 request 返回 409。按 chain+wallet 串行 nonce。恢复先查 receipt/chain state，已成功 step 不再发送。前端必须显示资产当前所在位置和下一恢复动作。

只有 receipt、余额/NFT 和 ledger 对账后才 SUCCEEDED。执行 fork 和测试网 fixture，保存 E-CHAIN/E-REC；R4 停在 READY_FOR_APPROVAL。
```

## 10. 分阶段可直接投喂的指令

以下提示词要和第 5 节通用主提示词一起使用；把尖括号替换为本地路径和本次子范围。

### P00 工程底座

```text
实现 P00 的 <SUBTASK>。先检查当前仓库，不覆盖用户已有改动。建立 pnpm/Turborepo 的最小可运行纵向结构，Node/TS 版本固定，strict typecheck。

本次只修改 <PATHS>，产物包括 <APPS/PACKAGES>、可重复 migration/seed、focused tests 和 CI job。先写失败的 workspace smoke/migration contract，再实现。不要预建空洞业务抽象；所有包必须有明确 owner 和使用方。完成时给出新机器启动命令及其实际结果。
```

### P01 登录与应用壳

```text
实现 P01 / <AUTH_OR_SHELL_IDS>。证据为 <UI_API_FIXTURES>。先写 auth state/RBAC contracts 和目标 route 的 Playwright 状态测试。

Telegram initData、一次性 token、wallet nonce 均需过期和重放测试；user/pro/admin/blocked/maintenance/region 状态由服务端授权。实现 desktop/mobile shell、theme/navigation/status bar 时复用 tokens，保存 E-UI/E-VIS/E-RBAC。
```

### P02 市场数据与排行

```text
实现 P02 / <POOL_FLOW_STATS_IDS> 的 BSC tracer slice：raw log -> normalized event -> <WINDOW> metric -> SSE -> UI。

先写 fork block fixture、decoder/reorg/window/stable-rank tests 和 SSE transcript。实现一条完整纵向路径后再扩 DEX/窗口/列。未知 aTVL/标签算法使用 metricVersion 并保留目标 golden 校准。保存 E-DATA/E-SSE/E-VIS。
```

### P03 监控通知

```text
实现 P03 / <MON_NOTIFY_IDS>。先用固定 market snapshots 写条件真值表、dedupe 和 outbox tests，再实现 CRUD/UI/投递。

Webhook 必须经 egress policy，覆盖 DNS/redirect/private IP/timeout/size/retry/signature。测试目标只允许 <LOCAL_SINK>. 保存 E-API/E-UI/E-SEC。
```

### P04 钱包与 signer

```text
实现 P04 / <WALLET_SET_IDS> 的 <SUBFLOW>，只允许 mock/Anvil。先完成 signer 信任边界和 crypto/secret/nonce 失败测试。

私钥不离开 signer，不进入队列/日志/错误。实现生成/导入/锁定/转账的一条纵向路径，receipt 后对账。安全测试未通过时不接测试网。保存 E-SEC/E-CHAIN/E-REC。
```

### P05 链协议与 Helper

```text
实现 P05 / <SWAP_POS_HELPER_IDS> 的 <PROTOCOL_VERSION> slice。以 <TX_FIXTURES> 为事实，chain registry 为地址唯一来源。

先完成 calldata byte regression 和 Foundry/fork red tests，再实现 adapter/Helper/operation handler。逐项断言 owner、NFT、allowance、fee、refund、dust 和恶意输入。保存 E-CHAIN/E-SEC。
```

### P06 任务与配置 UI

```text
实现 P06 / <TASK_TCFG_IDS> 的 <ROUTE_OR_WIZARD_STEP>。目标截图/网络 fixture 位于 <EVIDENCE>。

先写字段 default/boundary/dependency、tick math、金额精度、loading/empty/error/data 和 desktop/mobile Playwright。domain schema 是配置唯一来源。链动作先接 mock operation preview，不放入静态假成功。保存 E-API/E-UI/E-VIS。
```

### P07 核心 LP 交易

```text
实现 P07 / <TOP_IDS> 的 <WORKFLOW> saga，仅 fork/testnet。步骤为 <STEPS>，fixture 为 <CHAIN_FIXTURE>。

先写每个 step 前后条件和故障矩阵，再写状态机/恢复测试。已确认步骤不得重发；每钱包/链 nonce 串行；task、position、segment、ledger 由 receipt 对账更新。完成 fork 后才申请测试网，主网停在 READY_FOR_APPROVAL。保存 E-CHAIN/E-REC/E-UI。
```

### P08 风控与自动策略

```text
实现 P08 / <RISK_STRAT_IDS> 的 <RULE_OR_TRIGGER>，自动广播保持关闭。

以固定 market event stream 写 DSL/property/restart/fencing/budget red tests。count/since/confirmation/cooldown 持久化；陈旧/缺失数据不产生资金动作。先 shadow mode 输出决策 reasons，再接 P07 标准 operation。保存 E-DATA/E-REC/E-RBAC。
```

### P09 建池与 Hook

```text
实现 P09 / <CREATE_IDS> 的 <V3_V4_OR_HOOK> 流程。先写 token order/decimals/price direction/sqrtPrice/tickSpacing 和两阶段恢复测试。

create/initialize 成功后 quick-liquidity 失败必须可继续且不重建池。Pro/Hook 能力基于 Bundle 时标 implemented-assumed；owner/fee/allowlist 链上校验。仅 fork/testnet，保存 E-CHAIN/E-REC/E-RBAC。
```

### P10 聊天与红包

```text
实现 P10 / <CHAT_IDS> 的 <CHAT_OR_REDPACKET_SUBFLOW>。先写多租户权限、SSE 顺序/重连、幂等反应/领取、媒体安全或金额守恒测试。

消息删除保留 tombstone/audit；媒体发布前校验；红包合约做 fuzz/reentrancy/expiry/refund。生产资金停在 READY_FOR_APPROVAL。保存 E-SSE/E-SEC/E-CHAIN。
```

### P11 开发者 API 与管理后台

```text
实现 P11 / <LOG_FEED_DEV_ADMIN_IDS> 的 <SUBMODULE>。先写普通用户 403、管理员 resource scope、敏感遮蔽、before/after audit 和目标 API golden。

API Key 完整值只显示一次且 hash 存储；管理配置写入有 preview/reason/audit/rollback。Bundle-only 行为保持 implemented-assumed。保存 E-API/E-RBAC/E-SEC/E-OPS。
```

### P12 全量验收

```text
审计 P12 / <FEATURE_ID_SET>，以 docs/TRACEABILITY_MATRIX.md 为清单。不要修改代码直到列出缺失的 spec/implementation/test/evidence 和可复现失败。

按严重度修复：资金/权限/数据正确性 -> 契约/恢复 -> 交互/视觉。运行 T-UNIT/API/SSE/UI/VIS/CHAIN/REC/SEC/PERF/MIG。每个 ID 只依据实际证据更新状态；输出 196 项覆盖统计和 implemented-assumed 清单。
```

### P13 更新监测

```text
分析目标站基线 <OLD_ARTIFACT> 与 <NEW_ARTIFACT>。先验证下载完整性和 hash，语义比较 routes、API、SSE、feature gates、chain/protocol/address/calldata/fee、UI 文案和样式。

输出新增/删除/变化及影响功能 ID，按 P0-P3 分级。P0 生成关闭受影响资金 feature flag 的变更和 fork 回归任务；先更新功能矩阵/契约/追踪表，再改实现。保存更新报告和兼容窗口计划。
```

## 11. 调试和修复提示词

```text
诊断 <BUG>，关联 <FEATURE_IDS>。先复现并保存最小失败 fixture；不要先改代码。

沿 requestId/operationId/jobId/txId 或 SSE eventId 建时间线，区分输入、状态、外部 RPC、数据库和 UI reducer。提出 2-4 个可证伪假设，为每个增加观测或测试，逐个排除。找到根因后先固定回归测试，再做最小修复并运行受影响验收集。

资金 bug 额外对比 nonce lineage、raw tx、receipt/log、余额/NFT/allowance、ledger；链上事实与数据库冲突时进入 reconciliation，不手工篡改成功状态。输出根因、修复、测试、数据修复/回滚和剩余风险。
```

## 12. 独立代码审查提示词

```text
审查 <BASE>..<HEAD> 对 <FEATURE_IDS> 的实现。读取任务卡、功能矩阵、架构、追踪表和实际 diff；不要根据 PR 描述假定完成。

先列 findings，按 P0-P3 排序并给文件/行号、触发条件、后果和缺失测试。重点检查：
- 规格/角色/状态/错误/UI 是否遗漏；
- 金额精度、tick/price 方向、幂等、nonce、replacement、reorg、部分完成恢复；
- secret、RBAC/IDOR、任意 calldata/router、SSRF、日志泄露；
- fixture 是否真实证明行为，测试是否可能假绿；
- Evidence 和 parity 状态是否夸大。

最后给测试缺口和简短 change summary。没有 finding 时明确说明仍未执行或无法验证的部分。
```

## 13. 子代理、工作树和分支协作

### 13.1 何时拆给子代理

适合并行的独立任务：

- 目标站只读 UI/API/Bundle 取证；
- 一条链或一个协议 adapter 的 fixture 分析；
- 前端视觉基线与后端契约测试；
- 实现完成后的独立 spec/security review。

共享 migration、公共 schema、chain registry、同一状态机核心不交给多个代理同时修改。指定一个 owner，其他代理只读分析或在 owner 发布契约后工作。

### 13.2 子代理任务格式

```text
任务：<FEATURE_IDS / 单一可交付物>
输入：<任务卡和证据绝对路径>
允许修改：<明确目录；只读则写明>
输出：<文件、测试、证据或 findings>
风险：<R0-R4 和环境>
完成条件：<可检查条目>
回报：事实/推断、命令结果、冲突、未完成项
```

### 13.3 工作树和合并顺序

- 分支命名：`feat/P02-POOL-01-05-top-fees`、`fix/TOP-10-reconcile`。
- 一个 worktree 对应一个任务卡和一组不重叠的文件 ownership。
- 公共契约先合并：migration/schema/registry -> domain/API -> worker -> web -> acceptance artifacts。
- 每次 rebase 后重跑 consumer/provider contracts；链 fixture hash 变化必须人工解释。
- 合并前由独立代理跑第 12 节审查，不让实现代理自行给出唯一验收结论。

## 14. 常见失败模式

| 失败模式 | 修正动作 |
|---|---|
| 一次提示“实现整个项目” | 按一个纵向切片和 1-5 个紧密相关 ID 拆分 |
| 只给截图不给状态/API | 补 route、role、viewport、状态矩阵和网络 fixture |
| 让助手猜 Pro/admin | 标 BUNDLE/INFERRED，隔离 feature flag，保持 implemented-assumed |
| 前端先造假数据后忘记替换 | mock 只能通过 contract provider 注入，生产构建禁止 fixture import |
| 用浮点算 token/tick | base units + bigint/decimal + property tests |
| tx hash 出现就标成功 | 等确认、解码 receipt、余额/NFT/allowance/ledger 对账 |
| worker 重启后重复执行 | operation step dedupe + nonce ledger + receipt-first recovery |
| 多助手同时改公共 schema | 单 owner 发布契约，其他工作树消费固定版本 |
| 测试通过但无目标对照 | 保存目标 fixture和 diff，状态不能超过 implemented-assumed |
| 把研究账号/生产钱包当测试资源 | 使用隔离 test wallet；R4 每笔审批 |

## 15. 每轮结束报告模板

```markdown
## 完成范围
- 阶段 / 功能 ID：
- 状态：implemented-assumed / parity-verified / released

## 修改
- <文件/模块及行为>

## 验证
- `<command>`: pass/fail（数量、耗时）
- Evidence: <绝对路径>

## 证据边界
- 已确认：
- 仍为 BUNDLE/INFERRED：

## 风险与下一步
- 当前风险等级：
- 阻塞/依赖：
- 资金状态：未签名 / READY_FOR_APPROVAL / testnet tx hash
```

报告中不写“应该可以”。只写实际执行过的命令、产物、状态和未闭环条件。
