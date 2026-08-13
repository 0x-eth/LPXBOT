# LPBot 复现项目研究与开发索引

> 基线日期：2026-08-13（Asia/Shanghai）  
> 当前阶段：产品取证、范围冻结与工程路线设计已完成；尚未开始产品代码开发  
> 操作边界：本轮仅执行公开资料读取、登录态页面只读浏览和链上 RPC 查询，未提交表单、未签名、未广播交易、未执行资金操作。

## 交付物

| 文档 | 用途 |
|---|---|
| [FUNCTION_MATRIX.md](./FUNCTION_MATRIX.md) | 按域、权限、证据和风险整理的完整功能基线 |
| [ARCHITECTURE_AND_WORKFLOWS.md](./ARCHITECTURE_AND_WORKFLOWS.md) | 推荐技术架构、数据边界、任务状态机和链上工作流 |
| [DEVELOPMENT_ROADMAP.md](./DEVELOPMENT_ROADMAP.md) | 可独立验收的分阶段开发计划、依赖、测试和完成定义 |
| [VIBE_CODING_PLAYBOOK.md](./VIBE_CODING_PLAYBOOK.md) | Vibe Coding 协作规范、上下文包、逐模块提示词和验收循环 |
| [TRACEABILITY_MATRIX.md](./TRACEABILITY_MATRIX.md) | 196 个功能 ID 到阶段、最低测试和验收证据的全量映射 |

## 一手研究

| 文档 | 范围 |
|---|---|
| [research/public-surface.md](./research/public-surface.md) | 站点 UI、路由、公开 API 59 个端点、生产 Bundle、Pro/管理员门控、多链矩阵 |
| [research/onchain-helper.md](./research/onchain-helper.md) | 四份 BSC Helper 的部署、owner、字节码、交易 receipt、授权、收费和退款 |
| [research/prior-thread.md](./research/prior-thread.md) | 历史任务中的 selector、calldata、参考实现和未验证边界 |

主要第一方来源：

- [LPBot 主站](https://www.lpbot.cc/)
- [LPBot API 文档](https://api.lpbot.cc/api/docs)
- [LPBot API JSON](https://api.lpbot.cc/api/docs.json)
- 用户提供的 BscScan Helper、owner 和交易地址

## 证据规则

所有复现需求必须带证据等级，不允许把 Bundle 中的候选代码或架构推断写成生产事实。

| 等级 | 定义 | 能否作为兼容性验收依据 |
|---|---|---|
| `UI` | 已在正常登录账户的现网页面看到 | 可以，需补桌面/移动和状态截图 |
| `API` | 第一方 API 文档明确描述 | 可以，按请求/响应契约测试 |
| `BUNDLE` | 当前生产前端 Bundle 中存在 | 候选；还需验证角色、服务端权限与可用性 |
| `CHAIN` | RPC、字节码、交易 input/receipt/log 直接支持 | 可以，需保存可重放 fixture |
| `INFERRED` | 根据客户端调用或常见架构推导 | 不可以，必须先转化为验证任务 |

## “1:1”验收含义

本项目的最终验收不能只比较截图。每个功能至少同时满足：

1. **视觉一致**：桌面/移动、明暗主题、空态、加载、错误、有数据、禁用和权限状态均有基线。
2. **交互一致**：字段默认值、校验、联动、确认框、Toast、重试和路由行为一致。
3. **契约一致**：公开 API 的方法、路径、字段、错误码、SSE 事件和心跳节奏有契约测试。
4. **业务一致**：任务状态转换、幂等、恢复、收费、通知和权限行为有状态机测试。
5. **链上一致**：余额变化、NFT owner、allowance、receipt/log、退款、dust 和失败回滚有 fixture 对照。
6. **运行一致**：断线重连、RPC 故障、nonce 冲突、重启恢复、重复事件和 reorg 场景可恢复。

无法用当前账号验证的 Pro/管理员能力必须保留为“候选规格”，直至获得对应角色证据或由本项目自行定义并标记为扩展。

## 资金与环境门禁

- 默认只使用 mock、Anvil 主网 fork 和官方测试网。
- 测试钱包与生产钱包、研究账号完全隔离；测试私钥只进入本地 secret store。
- 任何主网签名或资金动作都必须逐笔给出：链、钱包、动作、代币、最大 USD、最大 gas、预期结果、失败退出方案，并等待明确批准。
- 用户提出的 10-20 USD 只是可申请的上限示例，不构成持续授权。
- 自动策略、红包、收费 Hook、Helper sweep 和管理员基础设施写操作在主网默认关闭。

## 当前结论

- 已建立正常用户产品面的高覆盖基线。
- 已把 196 个稳定功能 ID 全部映射到开发阶段、最低测试和验收证据，当前均为 `planned`。
- 已确认公开 API 为 10 类、59 个端点；生产 Bundle 还包含站内认证、自动策略、聊天、管理、收费 Hook 和 Helper 残留等接口。
- 未发现可证实的第二份独立“隐藏 Bundle”。条件功能代码主要位于公开主 Bundle/懒加载 Chunk，由角色、套餐和 `allowedChains`/`off-pro-all` 门控。
- 已确认五条生产链配置：BSC、Base、Ethereum、Robinhood Chain、X Layer；协议为 Uniswap/PancakeSwap V3/V4 的链上可用子集。
- 已链上确认所给四份 BSC Helper 为 owner EOA 直接部署的完整合约，不是常见 proxy/clone；可执行组合操作、授权、Mint/Increase、收费和退款。
- 退出、移仓、换池在历史证据中包含链下编排的多笔交易，不能假定全部由旧 Helper 单笔原子完成。
