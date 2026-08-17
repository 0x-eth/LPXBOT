# LPBot 复现功能矩阵

> 基线：2026-08-13  
> 目标：将当前可观察产品面冻结成可追踪、可分工、可验收的复现规格。  
> 详细证据：[公开产品面](./research/public-surface.md) · [链上 Helper](./research/onchain-helper.md) · [历史任务](./research/prior-thread.md)

## 1. 使用方法

每条能力分配稳定 ID。需求、代码、测试、截图和验收报告都必须引用这些 ID；新增功能只能新增 ID，不得悄悄改变旧条目的语义。

### 证据

| 标记 | 含义 |
|---|---|
| `UI` | 正常登录账户的现网页面已观察 |
| `API` | 第一方公开 API 文档已确认 |
| `BUNDLE` | 当前生产 Bundle/Chunk 中存在调用或 UI |
| `CHAIN` | RPC、字节码、交易或 receipt/log 已确认 |
| `INFERRED` | 为完成系统而提出的设计推断，尚非现网事实 |

### 权限

| 标记 | 含义 |
|---|---|
| `PUB` | 无登录或公开文档 |
| `USER` | 普通已批准用户 |
| `PRO` | Pro 用户或管理员；实际套餐差异仍待 Pro 账号验证 |
| `ADMIN` | 管理员 |

### 写入风险

| 标记 | 示例 | 验收门禁 |
|---|---|---|
| `R0` | 页面、只读查询、本地偏好 | mock/只读生产均可 |
| `R1` | 账号偏好、监控、反馈、聊天文本 | 本地或测试账号；禁止污染生产运营数据 |
| `R2` | 钱包密钥、API Key、服务配置 | 隔离 secrets、审计、最小权限 |
| `R3` | 测试网链上写入 | fork 通过后使用专用测试钱包 |
| `R4` | 主网资产或生产配置写入 | 每笔单独申请，批准中明确上限和退出方案 |

## 2. 身份、权限与应用壳

| ID | 功能 | 证据 | 权限 | 风险 | 复现与验收要点 |
|---|---|---|---|---|---|
| AUTH-01 | Telegram Mini App `initData` 登录 | UI+BUNDLE | USER | R1 | 校验签名、时间窗、重放；成功进入受保护壳 |
| AUTH-02 | Telegram Bot 一次性链接登录与轮询 | UI+BUNDLE | USER | R1 | token 单次使用、过期、取消、跨标签页状态 |
| AUTH-03 | 钱包 nonce + 消息签名登录 | UI+BUNDLE | USER | R1 | nonce 一次性、域/链/过期绑定、签名恢复地址 |
| AUTH-04 | 登录钱包绑定、标签、列表与解绑 | UI+BUNDLE | USER | R1 | 与自动交易钱包严格区分 |
| AUTH-05 | JWT/Bearer 会话恢复与退出 | BUNDLE | USER | R1 | 401 清理登录态并回 `/login` |
| AUTH-06 | 待审批、拒绝、封禁页面 | UI+BUNDLE | USER | R0 | `/blocked` 的各原因和恢复路径 |
| AUTH-07 | 维护页和全局维护跳转 | UI+BUNDLE | PUB | R0 | 503 `MAINTENANCE` 进入 `/maintenance`；管理员放行 |
| AUTH-08 | 地区阻断页 | BUNDLE | PUB | R0 | 403 `REGION_BLOCKED` 的专用状态 |
| AUTH-09 | 角色：user/pro/admin | BUNDLE | USER | R0 | 前后端都做授权，不以隐藏按钮代替权限检查 |
| AUTH-10 | 链访问：`off / pro / all` | UI+BUNDLE | ADMIN | R2 | `off` 阻止新建但允许监控/撤池；`pro` 只开放 Pro/admin |
| SHELL-01 | 桌面侧栏、移动导航和响应式壳 | UI | USER | R0 | 任务、池子、策略、钱包、日志、聊天室；管理员增加管理 |
| SHELL-02 | 任务状态徽标和底部实时状态栏 | UI+BUNDLE | USER | R0 | 在线、运行/暂停/停止数、推荐池、Base/ETH gas、FPS、ping |
| SHELL-03 | 明暗/系统主题与强调色 | UI+BUNDLE | USER | R0 | PWA `theme-color` 同步；刷新后保留 |
| SHELL-04 | 可排序/隐藏的导航项 | UI+BUNDLE | USER | R1 | 任务锁定不可隐藏；管理员项受角色约束 |
| SHELL-05 | 全局 Toast、确认框、错误重试 | UI | USER | R0 | 成功、失败、长任务和危险动作语义一致 |
| SHELL-06 | PWA/Telegram Web App 集成 | BUNDLE | USER | R0 | manifest、viewport、安全区和 Telegram 环境 |

## 3. LP 任务

### 3.1 列表、详情与分析

| ID | 功能 | 证据 | 权限 | 风险 | 复现与验收要点 |
|---|---|---|---|---|---|
| TASK-01 | 运行/暂停/停止三类任务页 | UI+API | USER | R0 | `/tasks/running|paused|stopped`，兼容 `/all/:status` |
| TASK-02 | 网格/列表视图 | UI+BUNDLE | USER | R0 | 用户偏好持久化；响应式无布局跳动 |
| TASK-03 | 任务搜索、筛选、按池折叠 | UI+BUNDLE | USER | R0 | 状态/链/用户（admin）过滤不丢 SSE 增量 |
| TASK-04 | 多选与批量删除 | UI+API | USER | R1 | 运行任务先停止；逐项错误和删除计数 |
| TASK-05 | 任务详情 | UI+API | USER | R0 | 基本信息、核心参数、运行状态、进阶设置、NFT/Hook/平台 |
| TASK-06 | 余额、仓位、未领 Fee 与总资产 | UI+BUNDLE | USER | R0 | token/wallet/position/fee 小计与 USD 对账 |
| TASK-07 | K 线、资产、盈利走势 | UI+BUNDLE | USER | R0 | 1m/5m/15m/1H/1D、区间上下限、建仓/移仓/撤出标记 |
| TASK-08 | Segment/周期账本 | UI+BUNDLE | USER | R0 | totalIn、autoTopUp、totalOut、已结算和未结算 PnL 公式可测试 |
| TASK-09 | 任务操作日志与错误详情 | UI+API | USER | R0 | 单任务日志、链上 hash、失败分类、恢复提示 |
| TASK-10 | 收益分享图生成、复制、下载 | UI+BUNDLE | USER | R0 | Canvas 输出、空数据、移动端分享行为 |
| TASK-11 | 数据分析抽屉 | UI+BUNDLE | USER/ADMIN | R0 | 资金、仓位、钱包、Fee、池、用户、PnL 排名和时间范围 |
| TASK-12 | 观察列表 | UI+BUNDLE | USER | R1 | 收录外部 LP、无流动性移出台账、定价位置流式更新 |
| TASK-13 | 扫描任意地址 LP | UI+BUNDLE | USER | R0 | V3/V4、链、收藏/最近地址、导入观察；可在设置隐藏入口 |

### 3.2 创建、编辑与配置模板

| ID | 功能 | 证据 | 权限 | 风险 | 复现与验收要点 |
|---|---|---|---|---|---|
| TCFG-01 | 识别 V3 池地址和 V4 Pool ID | UI+API | USER | R0 | 42/66 字符、跨链探测、无效 token 转快速建池 |
| TCFG-02 | 选择可用链、协议与钱包 | UI+BUNDLE | USER | R0 | `allowedChains`、平台 ID 1/2/4/5、余额联动 |
| TCFG-03 | 对称/非对称价格区间 | UI+API | USER | R1 | `3` 或 `1-2`，Tick 对齐，预览上下界 |
| TCFG-04 | 单边区间订单 | UI+BUNDLE | USER | R1 | 两边界同侧，例如 `-5/-1` 或 `1/5`；穿越状态文案 |
| TCFG-05 | 固定 USD / All-in | UI+API | USER | R3 | 余额估算、投入占比、大额风险确认、余额不足 |
| TCFG-06 | 初始定价模式 | UI+BUNDLE | USER | R3 | 高风险提示、价格方向与 token 排序验证 |
| TCFG-07 | 滑点与检查间隔 | UI+API | USER | R1 | 默认 1.5% / 1000ms；边界与单位一致 |
| TCFG-08 | 超区间次数阈值 | UI+API | USER | R1 | 默认 15，重启后计数恢复规则明确 |
| TCFG-09 | 价格偏差容差 | UI+BUNDLE | USER | R1 | 与 fee/报价偏差的计算需校准现网 |
| TCFG-10 | 价格影响上限 | UI+BUNDLE | USER | R1 | 报价缺失和超限阻断 |
| TCFG-11 | 超区间持续时间 | UI+BUNDLE | USER | R1 | 次数与持续时间组合语义测试 |
| TCFG-12 | 移仓冷却 | UI+BUNDLE | USER | R1 | 避免频繁移仓；手动动作是否越过冷却需验证 |
| TCFG-13 | 创建后立即启动 | UI+BUNDLE | USER | R3 | 创建成功、启动失败时保留可手动启动任务 |
| TCFG-14 | 创建/编辑配置模板 | UI+API | USER | R1 | CRUD、默认模板、扩展参数、复制任务配置 |
| TCFG-15 | 运行中编辑自动暂停再恢复 | UI+API | USER | R3 | 保存失败恢复原状态；Tick 变化可仅保存或立即重建 |
| TCFG-16 | 冷池保护 | UI+BUNDLE | USER/ADMIN | R1 | 近 5 分钟全平台 Fee 阈值；被拦截时禁止创建 |
| TCFG-17 | 产品抽佣报价与投入拥挤档位 | UI+BUNDLE | USER/ADMIN | R1 | 基础费率、分档、免佣/自定义费率优先级 |

### 3.3 生命周期和资金动作

| ID | 功能 | 证据 | 权限 | 风险 | 复现与验收要点 |
|---|---|---|---|---|---|
| TOP-01 | 启动任务 | UI+API | USER | R3/R4 | 首次 Helper、建仓、确认、监控启动的 saga |
| TOP-02 | 暂停/恢复 | UI+API | USER | R1 | 不改变 LP；worker 停止/恢复且不重复触发 |
| TOP-03 | 停止并保留 LP | UI+API | USER | R1 | 停止监控，仓位继续链上存在 |
| TOP-04 | 停止并撤出 | UI+API | USER | R3/R4 | decrease/collect；空仓幂等成功 |
| TOP-05 | 撤出后 Swap 单币 | UI+BUNDLE+CHAIN | USER | R3/R4 | token0/token1/保持双币，多笔 saga 可恢复 |
| TOP-06 | 收取手续费 | UI+API | USER | R3/R4 | V3/V4 collect、零 Fee、收据与余额 |
| TOP-07 | 收费后 Swap | UI+BUNDLE | USER | R3/R4 | collect 成功、swap 失败时可继续恢复 |
| TOP-08 | 立即移仓 | UI+API | USER | R3/R4 | 撤旧仓、按当前价重建、区间和账本 Segment 更新 |
| TOP-09 | 自动超区间移仓 | UI+API+BUNDLE | USER | R3/R4 | 次数/持续/偏差/冷却、并发锁、重复触发 |
| TOP-10 | 复投 | UI+API+CHAIN | USER | R3/R4 | all/token0/token1/both/custom/usd、Increase、退款 |
| TOP-11 | 换池 | UI+API | USER | R3/R4 | old/new task、撤旧、可选换币、新池建仓、配置继承告警 |
| TOP-12 | 复制配置新建任务 | UI+BUNDLE | USER | R1 | 不复制钱包秘密；进阶字段覆盖率明确 |
| TOP-13 | 删除任务 | UI+API | USER | R1/R3 | 运行中先停止；不得隐式撤池，除非用户明确选择 |

### 3.4 进阶风控与关仓

| ID | 功能 | 证据 | 权限 | 风险 | 复现与验收要点 |
|---|---|---|---|---|---|
| RISK-01 | 超范围：重新平衡/撤池停止 | UI+BUNDLE | USER | R3/R4 | 状态机分支和日志理由 |
| RISK-02 | 移仓失败：自动卖出/留钱包 | UI+BUNDLE | USER | R3/R4 | 部分完成恢复、不能重复卖出 |
| RISK-03 | 止损/止盈价格 | UI+BUNDLE | USER | R3/R4 | 止损低于现价、止盈高于现价；基准 token |
| RISK-04 | TVL 最低/下降 | UI+BUNDLE | USER | R3/R4 | 滑窗、基准、连续确认 |
| RISK-05 | 交易量最低 | UI+BUNDLE | USER | R3/R4 | 数据陈旧时不得误关仓 |
| RISK-06 | Fee/TVL 与 Fee/aTVL 最低 | UI+BUNDLE | USER | R3/R4 | 公式版本化、连续确认 |
| RISK-07 | 盈亏目标 | UI+BUNDLE | USER | R3/R4 | 可正可负，含已结算/未结算口径 |
| RISK-08 | 最长运行 | UI+BUNDLE | USER | R3/R4 | 服务重启后的时间基准 |
| RISK-09 | 无常损失阈值 | UI+BUNDLE | USER | R3/R4 | 基准价格与缺失报价处理 |
| RISK-10 | 简单规则与组合规则 | UI+BUNDLE | USER | R1 | 组内 AND、组间 OR；最多 10 组/组内 8 条 |
| RISK-11 | 连续确认次数 | UI+BUNDLE | USER | R1 | 1-100；简单和每组独立计数 |
| RISK-12 | 监听地址自动撤池 | UI+BUNDLE | USER | R3/R4 | 最多 10 地址；仅发起/任意涉及；mempool 不可用时明确停用 |
| RISK-13 | 锁定撤池 gas | UI+BUNDLE | USER | R3/R4 | 0-5 Gwei；不足或过时价格的失败策略 |
| RISK-14 | 用户冷静期 | UI+API | USER/ADMIN | R1 | 最长 7 天、用户不可提前解除；停止/撤池仍允许；admin 可解除 |
| RISK-15 | 貔貅币/不可卖检测 | UI+BUNDLE | USER | R1 | 新建前模拟；误报/超时不能静默放行 |

## 4. 池子发现、排行和实时数据

| ID | 功能 | 证据 | 权限 | 风险 | 复现与验收要点 |
|---|---|---|---|---|---|
| POOL-01 | 多链手续费热门池排行 | UI+API+BUNDLE | USER | R0 | SSE 快照/增量、断线重连、排序稳定 |
| POOL-02 | 时间窗 1/5/15/30/60 分钟 | API+BUNDLE | USER | R0 | UI 当前快捷窗与 API 均覆盖 |
| POOL-03 | DEX/V3/V4 过滤 | UI+API | USER | R0 | pcsv3/univ3/pcsv4/univ4；按链裁剪；`implemented-assumed`（P02-04） |
| POOL-04 | Fees/Vol/TVL/Txs/FDV | UI+API | USER | R0 | 单位、空值、趋势和精度 |
| POOL-05 | Fee/TVL 与 Fee/aTVL | UI+API | USER | R0 | Fee/TVL 当前窗口口径；Fee/aTVL 保持 unresolved；`implemented-assumed`（P02-07） |
| POOL-06 | 高级范围筛选 | UI+BUNDLE | USER | R0 | 量、Fee、收益率、aTVL、TVL、交易数、协议、Hook/中文排除；`implemented-assumed`（P02-07） |
| POOL-07 | 标签信号 | UI+BUNDLE | USER | R0 | 高费率、量稳价稳、收益稳定/飙升/衰退、拥挤、波动、LP 动向；`implemented-assumed`（P02-08，locally-defined；`GAP-LABEL-ALGORITHM` unresolved） |
| POOL-08 | 地址/Token 搜索 | UI+API | USER | R0 | 池地址、token 关联池；清除和无结果状态；`implemented-assumed`（P02-06，BSC only） |
| POOL-09 | 同 token 池折叠与分组 | UI+BUNDLE | USER | R0 | 组内展开、排序、`+N` 标记；`implemented-assumed`（P02-06） |
| POOL-10 | 列显隐、拖动排序与重置 | UI+BUNDLE | USER | R1 | Pool/操作锁定，偏好跨设备同步；`implemented-assumed`（P02-06） |
| POOL-11 | 池对比 | UI+BUNDLE | USER | R0 | Fees、Volume、TVL、活跃 TVL、Fee/TVL、Txs、Fee Tier；`implemented-assumed`（P02-07） |
| POOL-12 | K 线和 Tick 流动性 | UI+API | USER | R0 | V4 PoolKey/tickSpacing，历史加载、自动刷新；`implemented-assumed`（P02-10，locally-defined；`GAP-API-CANDLE-QUOTE` 与 `GAP-UI-TICK-LIQUIDITY-MAPPING` unresolved） |
| POOL-13 | 右键/更多操作 | UI+BUNDLE | USER | R1 | 复制、创建任务、屏蔽、聊天室、动向、监控等；`implemented-assumed`（P02-11，任务/监控/聊天仅安全预填 intent） |
| POOL-14 | Token/池屏蔽 | UI+BUNDLE | USER | R1 | 排行、Token 搜索、推荐、分组、对比与展开池统一过滤；管理/恢复；`implemented-assumed`（P02-11，监控/策略仅消费者契约） |
| POOL-15 | 创建历史和创建者归属 | UI+BUNDLE | USER/ADMIN | R0/R1 | 旧数据无记录、池已存在等状态；`implemented-assumed`（P02-12，平台操作溯源，不推断链上创建者） |
| POOL-16 | SSE 数据面 `m.lpbot.cc` | BUNDLE | PUB/USER | R0 | schema、event id、snapshot/diff、心跳和重连契约 |

## 5. 流动性动向与池监控

| ID | 功能 | 证据 | 权限 | 风险 | 复现与验收要点 |
|---|---|---|---|---|---|
| FLOW-01 | 实时加池/撤池/新池流 | UI+BUNDLE | USER | R0 | 交易 hash、NFT、tick、区间、金额、地址、Hook；`implemented-assumed`（P02-04） |
| FLOW-02 | 链、事件、V3/V4、token、金额筛选 | UI+BUNDLE | USER | R0 | 断线后回填且去重；`implemented-assumed`（P02-04） |
| FLOW-03 | 流入/流出/净额统计 | UI+BUNDLE | USER | R0 | 当前过滤范围一致；`implemented-assumed`（P02-05） |
| FLOW-04 | 按地址聚合 | UI+BUNDLE | USER | R0 | 净额/笔数/最近排序、池数、地址操作；`implemented-assumed`（P02-05） |
| FLOW-05 | 地址备注/地址簿 | UI+BUNDLE | USER | R1 | 流动性流、钱包和扫描页复用统一备注；`implemented-assumed`（P02-05） |
| MON-01 | 监控 CRUD 与启停 | UI+API | USER | R1 | 列表、启用数/总数、revision 更新和删除；`implemented-assumed`（P03-02，BSC only） |
| MON-02 | 多条件 AND | UI+API+BUNDLE | USER | R1 | Volume、Fee、Fee/TVL、TVL、交易数、版本；active TVL 与 Fee/aTVL unresolved；`implemented-assumed`（P03-02） |
| MON-03 | 排除中文 token / Hook | UI+BUNDLE | USER | R1 | canonical 三态元数据 fail closed；`implemented-assumed`（P03-02） |
| MON-04 | Telegram 与外部 Webhook | UI+API+BUNDLE | USER | R1 | GET/POST、模板占位符、测试、不保存测试配置；`implemented-assumed`（P03-03，local-sink only；live delivery unresolved） |
| MON-05 | 通知历史 | UI+API | USER | R0 | 池、条件、时间、投递状态 |
| MON-06 | 投递安全 | INFERRED | USER | R2 | SSRF 防护、私网阻断、签名、超时、重试、速率限制 |

## 6. 自动策略

| ID | 功能 | 证据 | 权限 | 风险 | 复现与验收要点 |
|---|---|---|---|---|---|
| STRAT-01 | 策略 CRUD、复制、导入/导出 | UI+BUNDLE | USER | R1 | JSON schema 版本化；导入后手选钱包 |
| STRAT-02 | 激活/停用和运行状态 | UI+BUNDLE | USER | R3/R4 | 停用不隐式撤池；状态可恢复 |
| STRAT-03 | 多钱包轮转 | UI+BUNDLE | USER | R3/R4 | 钱包锁、余额、nonce 队列和公平轮转 |
| STRAT-04 | 固定投入/All-in | UI+BUNDLE | USER | R3/R4 | >200 USD 或 All-in 风险确认 |
| STRAT-05 | 最大并发、冷却、总投入上限 | UI+BUNDLE | USER | R3/R4 | 跨 worker 原子预算和并发计数 |
| STRAT-06 | Tick 倍数与按费率分级 | UI+BUNDLE | USER | R3/R4 | fee tier -> range 映射可预览 |
| STRAT-07 | 开仓条件 DSL | UI+BUNDLE | USER | R3/R4 | 20+ 市场指标；组内 AND、组间 OR、确认次数 |
| STRAT-08 | 标签包含/排除和最小匹配数 | UI+BUNDLE | USER | R3/R4 | 正/负信号语义版本化 |
| STRAT-09 | 币安现货/Alpha 状态 | UI+BUNDLE | USER | R1 | any/spot_or_alpha/spot/alpha/none；数据源失效策略 |
| STRAT-10 | Hook 池默认排除/显式允许 | UI+BUNDLE | USER | R3/R4 | 允许时显示高风险并加强模拟 |
| STRAT-11 | 关仓条件 DSL | UI+BUNDLE | USER | R3/R4 | 市场指标 + PnL/时长/IL/超区间/Fee |
| STRAT-12 | 撤池后稳定币/保持双币 | UI+BUNDLE | USER | R3/R4 | 稳定币侧识别和无可用路径 |
| STRAT-13 | 策略任务历史与 PnL | UI+BUNDLE | USER | R0 | 原因、投入、盈亏、时长、状态 |
| STRAT-14 | 管理员 scope | BUNDLE | ADMIN | R0 | 查看用户策略时不得越权修改 |

## 7. 钱包、安全、Swap 与 LP 仓位

| ID | 功能 | 证据 | 权限 | 风险 | 复现与验收要点 |
|---|---|---|---|---|---|
| WALLET-01 | 导入私钥钱包 | UI+API | USER | R2 | 64 hex 校验；前端不回显；日志永不记录私钥 |
| WALLET-02 | 服务端生成钱包 | UI+BUNDLE | USER | R2 | CSPRNG、地址回显、密文落库、备份策略 |
| WALLET-03 | 命名、删除和强制删除 | UI+API | USER | R2/R3 | 关联策略/任务检查；资产/仓位风险说明 |
| WALLET-04 | 服务器密钥加密模式 | UI+BUNDLE | USER | R2 | envelope encryption、重启自动恢复；密钥不进数据库 |
| WALLET-05 | 用户密码加密模式 | UI+BUNDLE | USER | R2 | Argon2id KDF、仅内存解锁、自动锁、忘记密码销毁流程 |
| WALLET-06 | 设置/修改/重置 keystore 密码 | UI+BUNDLE | USER | R2 | reset preview、确认短语、钱包/任务销毁计数 |
| WALLET-07 | 安全密码 | UI+BUNDLE | USER | R2 | 转到新地址时二次校验；与 keystore 密码分域 |
| WALLET-08 | 余额、USD 估值和 token 导入 | UI+API | USER | R0/R1 | 常用/其他 token、原生币、价格缺失 |
| WALLET-09 | 地址簿、备注和收款二维码 | UI+BUNDLE | USER | R1 | 自钱包、新地址、安全密码分支 |
| WALLET-10 | ERC-20/原生币转账 | UI+API | USER | R3/R4 | 25/50/75/MAX、幂等键、余额/gas/自转校验 |
| SWAP-01 | Swap 报价 | UI+API | USER | R0 | 滑点、minOut、价格影响、gas、报价过期 |
| SWAP-02 | Swap 执行 | UI+API | USER | R3/R4 | approve、route、receipt、失败恢复、幂等 |
| POS-01 | V3/V4 NFT 仓位扫描 | UI+API+BUNDLE | USER | R0 | Uniswap/Pancake、分页、链、未知 NFT |
| POS-02 | 收取仓位手续费 | UI+API | USER | R3/R4 | NFT owner/approval、V3/V4 receipt |
| POS-03 | 部分/全部撤出 LP | UI+API | USER | R3/R4 | 1-100%、slippage、collect、burn 可选 |
| POS-04 | 观察/定价仓位台账 | UI+BUNDLE | USER | R1 | 导入、SSE、成本、withdrawn 标记 |
| HELPER-01 | 一钱包一链 Helper 展示 | UI+BUNDLE+CHAIN | USER | R0 | 地址、版本、部署状态；跨链版本号不可比较 |
| HELPER-02 | 首次使用自动部署 Helper | UI+BUNDLE+CHAIN | USER | R3/R4 | owner EOA 直接部署是当前 BSC 样本事实；部署幂等 |
| HELPER-03 | 自动升级 Helper | UI+BUNDLE | USER | R3/R4 | 版本注册表、旧仓兼容、升级提示；具体升级策略待验证 |
| HELPER-04 | 原子 Swap + Mint/Increase | UI+CHAIN | USER | R3/R4 | owner-only、Permit2/approve、NFT 给 owner、refund |
| HELPER-05 | Helper 残留扫描 | UI+BUNDLE | USER | R0 | 多链/token/native、刷新和空态 |
| HELPER-06 | 逐钱包 sweep/rescue | UI+BUNDLE+CHAIN | USER | R3/R4 | 每钱包发交易、gas 提示、余额归 owner、逐笔结果 |

## 8. 建池、初始流动性、私有池和收费 Hook

| ID | 功能 | 证据 | 权限 | 风险 | 复现与验收要点 |
|---|---|---|---|---|---|
| CREATE-01 | Uniswap/Pancake V3/V4 建池 | UI+API | USER | R3/R4 | token 顺序、fee、tickSpacing、存在性、create/initialize receipt |
| CREATE-02 | 自动市价/手动初始价 | UI+BUNDLE | USER | R3/R4 | 价格方向、decimals、sqrtPriceX96 和极值 |
| CREATE-03 | 建池历史 | UI+BUNDLE | USER | R0 | 钱包、平台、时间、hash、池、已存在标记 |
| CREATE-04 | 一键建池后添加初始流动性 | UI+BUNDLE | USER | R3/R4 | 两段 saga 可恢复；不能重做已成功建池 |
| CREATE-05 | 一次性快速初始流动性 | UI+API | USER | R3/R4 | 不创建任务；amount <=100 USD、range <=200；观察列表 |
| CREATE-06 | BSC Uniswap V4 私有白名单池 | BUNDLE | PRO/ADMIN | R3/R4 | allowlist、Hook、owner、失败提示；实际套餐入口待验证 |
| CREATE-07 | 收费 Hook 池创建 | BUNDLE | PRO/ADMIN | R3/R4 | Swap bps、收款地址、LP 固定/动态费率、owner |
| CREATE-08 | 收费 Hook 参数读取 | UI+BUNDLE | USER/ADMIN | R0 | 普通/管理员只读展示与链上值一致 |
| CREATE-09 | 修改 Swap 费率/收款地址 | BUNDLE | PRO/ADMIN | R3/R4 | 仅 Hook owner 签名；服务端也校验 owner |
| CREATE-10 | 修改 LP 费率/白名单 | BUNDLE | PRO/ADMIN | R3/R4 | 地址增删、动态费率、链上事件和回滚 |
| CREATE-11 | 收费 Hook 列表 | BUNDLE | PRO/ADMIN | R0 | owner、Hook、池、费率、链和版本 |

## 9. 聊天室、红包与社区管理

| ID | 功能 | 证据 | 权限 | 风险 | 复现与验收要点 |
|---|---|---|---|---|---|
| CHAT-01 | 公共房间和 token/项目房间 | UI+BUNDLE | USER | R0 | 最近房间、搜索/进入、房间键规范化 |
| CHAT-02 | 消息历史与 SSE | UI+BUNDLE | USER | R0 | snapshot/message/reaction/delete/online；断线补齐 |
| CHAT-03 | 文本、回复和删除 | UI+BUNDLE | USER/ADMIN | R1 | 长度、权限、已删除占位、审计 |
| CHAT-04 | 图片/媒体 | UI+BUNDLE | USER | R1/R2 | 类型/大小、对象存储、短期 token URL、恶意内容扫描 |
| CHAT-05 | Emoji 反应 | UI+BUNDLE | USER | R1 | 幂等切换和实时计数 |
| CHAT-06 | 已读、未读和在线状态 | UI+BUNDLE | USER | R1 | 多设备游标与房间级未读 |
| CHAT-07 | 举报 | UI+BUNDLE | USER | R1 | 原因、限速、重复举报、状态 |
| CHAT-08 | 禁言/解禁 | BUNDLE | ADMIN | R1 | 房间/全局范围、期限和审计 |
| CHAT-09 | LP/Pro/Admin 徽章与隐藏 | UI+BUNDLE | USER/ADMIN | R1 | tier/持仓派生，用户隐藏偏好 |
| CHAT-10 | 红包发送 | UI+BUNDLE | USER | R3/R4 | BSC、random/equal、金额/份数、合约配置、安全密码 |
| CHAT-11 | 红包领取/退款 | UI+BUNDLE | USER | R3/R4 | 重复领取、过期、余款、旧合约兼容 |
| CHAT-12 | 红包合约部署/迁移 | BUNDLE | ADMIN | R3/R4 | 一键部署、重新部署确认、手填地址、停用 |
| CHAT-13 | 举报/媒体审核队列 | BUNDLE | ADMIN | R1/R2 | dismiss、删除、禁言、证据保留 |

## 10. 日志、通知、反馈和开发者 API

| ID | 功能 | 证据 | 权限 | 风险 | 复现与验收要点 |
|---|---|---|---|---|---|
| LOG-01 | 全局活动日志 | UI+API | USER/ADMIN | R0 | 类型、用户、任务、链、时间、状态、hash |
| LOG-02 | 日志类型过滤 | UI+BUNDLE | USER | R0 | 创建/移仓/复投/补仓/关闭/换池/收 Fee |
| STATS-01 | 系统统计 SSE | API+BUNDLE | USER/ADMIN | R0 | snapshot/update、25s 心跳、Telegram user filter；`implemented-assumed`（P02-13，authoritative local projection） |
| STATS-02 | 推荐池 SSE | API+BUNDLE | USER | R0 | 约 5s、浅 hash 不变不推、链和 limit；`implemented-assumed`（P02-09，locally-defined） |
| NOTIFY-01 | 分类 Telegram 通知偏好 | UI+BUNDLE | USER | R1 | 创建、移仓、失败、关仓等分类；`implemented-assumed`（P03-03，非 monitor 分类仅保存偏好） |
| NOTIFY-02 | 外部 Webhook 偏好 | UI+BUNDLE | USER | R1/R2 | GET/POST、body 模板、测试、密钥化签名；`implemented-assumed`（P03-03，local-sink only；完整 SSRF egress unresolved） |
| FEED-01 | 提交 bug/feature/other | UI+API | USER | R1 | 2000 字、60s/3 条限速 |
| FEED-02 | 我的反馈与管理员回复 | UI+API+BUNDLE | USER | R0/R1 | open/replied/closed，Telegram 回复通知 |
| FEED-03 | 管理反馈队列 | UI+BUNDLE | ADMIN | R1 | 筛选、回复、关闭、重开 |
| DEV-01 | 开发者 Key 创建/查看前缀/删除 | UI+API | USER | R2 | 每用户一个；完整 Key 只显示一次；hash 存储 |
| DEV-02 | 59 端点文档查看/搜索/下载 | UI+API | PUB/USER | R0 | 按类别、展开、复制 curl、JSON/Markdown 同源 |
| DEV-03 | `X-API-Key` 认证和限流 | API | USER | R2 | 120/min 等实际策略需环境验证；审计 lastUsed |

## 11. 设置与管理后台

| ID | 功能 | 证据 | 权限 | 风险 | 复现与验收要点 |
|---|---|---|---|---|---|
| SET-01 | 主题、强调色、任务视图和池侧栏 | UI+BUNDLE | USER | R1 | 本地即时更新并服务端同步 |
| SET-02 | 热门池、扫描入口、导航偏好 | UI+BUNDLE | USER | R1 | 刷新/跨设备一致 |
| SET-03 | 钱包多任务开关 | UI+BUNDLE | USER | R1/R3 | 关闭时创建向导阻止同钱包并发 |
| SET-04 | 自动补仓链开关 | UI+BUNDLE | USER | R1/R3 | BSC/Base 默认；其他链按配置 |
| SET-05 | 自动补仓与重试参数 | UI+BUNDLE | USER | R1/R3 | Mint/Swap/复投尝试、补仓轮数、最低金额 |
| SET-06 | 本机 RPC 选择/自定义/测试 | UI+BUNDLE | USER | R2 | 仅客户端读链；URL secret 不进日志 |
| SET-07 | 用户 OKX API Key | UI+BUNDLE | USER | R2 | 保存/替换/删除/状态；secret 加密且不回显 |
| ADMIN-01 | 用户列表、搜索、状态 tab | UI+BUNDLE | ADMIN | R0 | 待审批/批准/禁用，分页与空态 |
| ADMIN-02 | 审批、拒绝、禁用、解禁、删除 | UI+BUNDLE | ADMIN | R2 | 确认框、审计、运行任务处置 |
| ADMIN-03 | 备注、Pro 升降级 | UI+BUNDLE | ADMIN | R2 | 权限即时失效/生效，已有任务不误停 |
| ADMIN-04 | 免佣和自定义费率 | UI+BUNDLE | ADMIN | R2 | 0-10%，优先级、恢复默认、历史审计 |
| ADMIN-05 | 查看用户钱包和任务 | UI+BUNDLE | ADMIN | R2 | 默认遮蔽敏感数据；只读 scope |
| ADMIN-06 | 地址批量归属查询 | UI+BUNDLE | ADMIN | R0 | 最多 200 地址、跳转筛选 |
| ADMIN-07 | 用户活动热力图 | UI+BUNDLE | ADMIN | R0 | 24h/可选时间、建仓/移仓/关仓动作 |
| ADMIN-08 | 解除用户冷静期 | BUNDLE | ADMIN | R2 | 明确审计，不改变其他风控 |
| ADMIN-09 | 维护模式和公告 | UI+BUNDLE | ADMIN | R2 | enabled/message/until；管理员旁路 |
| ADMIN-10 | 链 `off/pro/all` 管理 | UI+BUNDLE | ADMIN | R2 | 主链约束、只挡新建、权限缓存刷新 |
| ADMIN-11 | 全局抽佣与拥挤度分档 | UI+BUNDLE | ADMIN | R2/R4 | 收款地址、bps、最多 20 档、从 0 起 |
| ADMIN-12 | 服务端 RPC | UI+BUNDLE | ADMIN | R2/R4 | 保存、测试、切换只影响新任务或需重启的提示 |
| ADMIN-13 | mempool WS | UI+BUNDLE | ADMIN | R2/R4 | 按链测试、区块高度、监听规则健康状态 |
| ADMIN-14 | OKX Key 池 | UI+BUNDLE | ADMIN | R2 | 批量导入、轮转、测试、停用失效项、清空 |
| ADMIN-15 | 管理员视图切换 | UI+BUNDLE | ADMIN | R0 | user/admin 数据 scope 严格分离 |
| ADMIN-16 | 池创建者管理 | BUNDLE | ADMIN | R1 | 地址/链查询和批量登记 |

## 12. 链与协议覆盖

生产 Bundle 当前配置如下。它是 2026-08-13 的现网快照，不是永远有效的地址清单。

| 链 | Chain ID | 协议 | 备注 |
|---|---:|---|---|
| BNB Smart Chain | 56 | Uniswap V3/V4、PancakeSwap V3/V4 | 功能最完整；Helper 样本和私有/收费 Hook 位于此链 |
| Base | 8453 | Uniswap V3/V4 | 自动补仓默认开启 |
| Ethereum | 1 | Uniswap V3/V4 | 主网 gas 状态显示 |
| Robinhood Chain | 4663 | Uniswap V3/V4 | 链访问可能受 `off/pro/all` 控制 |
| X Layer | 196 | Uniswap V3/V4 | 有 explorer 代理调用 |

平台 ID：`1=Uniswap V3`、`2=PancakeSwap V3`、`4=Uniswap V4`、`5=PancakeSwap V4`。

测试目标应使用 BSC Testnet 97、Sepolia 11155111、Base Sepolia 84532；没有协议等价部署的场景由本地 fork 或自建 mock 合约覆盖。

## 13. Pro、管理员与“隐藏 Bundle”结论

1. 当前入口可枚举的业务 Chunk 已全部抓取；没有发现一份只有 Pro/admin 才会下载的独立第二入口。
2. Pro/admin 相关代码在公开主 Bundle、设置 Chunk 和建池 Chunk 内，通过 `tier`、`isAdmin`、`allowedChains`、`off/pro/all` 和服务端授权控制。
3. 因此复现工作的重点是**权限矩阵与服务端拒绝行为**，不是仅复制隐藏按钮。
4. `BUNDLE` 只能作为候选规格。收费 Hook、私有池、红包部署和管理端写接口仍需 Pro/admin 会话或本项目自定义产品决策才能闭环。
5. 当前唯一明确的 Pro 差异是访问管理员配置为 `pro` 的链。其他“Pro 是否提升配额/降低费率/开放策略”等仍未证实。

## 14. 仍待闭环的功能缺口

| 缺口 | 当前状态 | 闭环方式 | 阻塞阶段 |
|---|---|---|---|
| Pro 实际页面与配额差异 | 仅 Bundle 候选 | Pro 账号只读对照或产品自行定义 | Pro 验收 |
| 管理员全部写操作行为 | UI/Bundle 可见，服务端未操作 | 管理员只读账号 + staging 写测 | 管理后台发布 |
| 排行聚合/标签/aTVL 精确公式 | 输出可见，算法未公开 | 保存原始事件与生产输出做 golden 校准 | 市场数据最终验收 |
| 私钥加密/KDF/托管实现 | UI 语义可见 | 服务端源码/架构说明或采用审计后的新设计 | 钱包发布 |
| Helper 四入口精确 ABI | 历史编码器强支撑，源码未验证 | 每类 >=10 calldata 字节级回归 | 合约发布 |
| 新版 Helper 多 93 bytes 的含义 | 未完成 | runtime diff + trace | Helper 升级 |
| 移仓/撤池/换池/复投成功和失败交易 | 上层语义清楚，样本不全 | fork/testnet 各一成功一失败 fixture | 自动化发布 |
| 三个收费钱包归因 | 仅确认 EOA | BEP-20 全历史与上游聚类 | 收费对账 |
| 收费 Hook 合约语义 | Bundle 表单候选 | 测试部署、源码/字节码与 owner 操作 | Pro 建池 |
| 红包合约与资格/退款规则 | Bundle 候选 | 测试网合约 fixture | 聊天红包 |
| Webhook 安全与重试 | 服务端未知 | 明确本项目规范并做 SSRF/重试测试 | 通知发布 |
| Robinhood/X Layer 等价测试网 | 未确认 | 官方部署核验；否则 fork/mock | 多链验收 |

## 15. 覆盖率规则

- 每个 ID 最终必须有：产品规格、实现链接、单元/集成/E2E 测试链接、至少一个验收证据。
- `R3/R4` 必须额外有交易 fixture、前后余额、allowance、NFT owner、receipt/log 和失败恢复证据。
- `PRO/ADMIN + BUNDLE` 在没有对应账号证据时可实现，但验收状态只能是 `implemented-assumed`，不能标记 `parity-verified`。
- 新版 lpbot.cc 出现新增/变更时，先更新本矩阵和证据，再改代码。
