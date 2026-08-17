# LPBot 功能追踪矩阵

> 基线日期：2026-08-13  
> 范围源：[功能矩阵](./FUNCTION_MATRIX.md)  
> 阶段源：[开发路线图](./DEVELOPMENT_ROADMAP.md)  
> 当前状态：P01 的 18 项功能及 P02 的 21 项功能已完成阶段实现，因目标对照和 live 证据缺口均保持 `implemented-assumed`；其余 157 项保持 `planned`。表中测试和证据是达到完成定义的最低要求。

## 1. 使用规则

- Test ID 和 Evidence ID 的定义见 [路线图第 5、6 节](./DEVELOPMENT_ROADMAP.md#5-统一测试套件)。
- 开发时在每个 ID 后补充实现链接、测试报告、证据目录和 `implemented-assumed/parity-verified/released` 状态；不得删除最低测试或证据。
- `E-CHAIN` 必须包含 raw tx、receipt/log、前后余额、allowance 和 NFT 状态；`E-REC` 必须证明部分完成后不会重复资金动作。
- `PRO/ADMIN + BUNDLE` 即使实现和自测完成，缺少对应角色证据时仍为 `implemented-assumed`。
- P12 的全量验收在下表最低要求之上统一增加 `T-SEC,T-PERF,T-MIG` 和 `E-OPS` 的受影响范围测试。

## 2. 逐功能覆盖

### 身份、权限与应用壳

| ID | 阶段 | 最低测试 | 最低验收证据 |
|---|---|---|---|
| AUTH-01 | P01 | T-UNIT,T-API,T-UI,T-SEC | E-API,E-UI,E-RBAC,E-SEC |
| AUTH-02 | P01 | T-UNIT,T-API,T-UI,T-SEC | E-API,E-UI,E-RBAC,E-SEC |
| AUTH-03 | P01 | T-UNIT,T-API,T-UI,T-SEC | E-API,E-UI,E-RBAC,E-SEC |
| AUTH-04 | P01 | T-API,T-UI,T-SEC | E-API,E-UI,E-RBAC,E-SEC |
| AUTH-05 | P01 | T-API,T-UI,T-SEC | E-API,E-UI,E-RBAC,E-SEC |
| AUTH-06 | P01 | T-API,T-UI,T-SEC | E-API,E-UI,E-RBAC |
| AUTH-07 | P01 | T-API,T-UI,T-REC | E-API,E-UI,E-RBAC,E-REC |
| AUTH-08 | P01 | T-API,T-UI,T-SEC | E-API,E-UI,E-RBAC |
| AUTH-09 | P01 | T-API,T-UI,T-SEC | E-API,E-UI,E-RBAC,E-SEC |
| AUTH-10 | P01 | T-API,T-UI,T-SEC | E-API,E-UI,E-RBAC,E-OPS |
| SHELL-01 | P01 | T-UI,T-VIS | E-UI,E-VIS |
| SHELL-02 | P01 | T-SSE,T-UI,T-VIS | E-SSE,E-UI,E-VIS |
| SHELL-03 | P01 | T-UI,T-VIS | E-UI,E-VIS |
| SHELL-04 | P01 | T-API,T-UI,T-VIS | E-API,E-UI,E-VIS,E-RBAC |
| SHELL-05 | P01 | T-UI,T-VIS | E-UI,E-VIS |
| SHELL-06 | P01 | T-UI,T-VIS,T-MIG | E-UI,E-VIS,E-OPS |

### LP 任务页面与分析

| ID | 阶段 | 最低测试 | 最低验收证据 |
|---|---|---|---|
| TASK-01 | P06 | T-API,T-SSE,T-UI,T-VIS | E-API,E-SSE,E-UI,E-VIS |
| TASK-02 | P06 | T-API,T-UI,T-VIS | E-API,E-UI,E-VIS |
| TASK-03 | P06 | T-UNIT,T-SSE,T-UI,T-VIS | E-SSE,E-UI,E-VIS |
| TASK-04 | P06 | T-API,T-UI,T-REC | E-API,E-UI,E-REC |
| TASK-05 | P06 | T-API,T-SSE,T-UI,T-VIS | E-API,E-SSE,E-UI,E-VIS |
| TASK-06 | P06 | T-UNIT,T-API,T-SSE,T-UI | E-API,E-SSE,E-DATA,E-UI |
| TASK-07 | P06 | T-UNIT,T-API,T-UI,T-VIS | E-API,E-DATA,E-UI,E-VIS |
| TASK-08 | P06 | T-UNIT,T-API,T-UI | E-API,E-DATA,E-UI |
| TASK-09 | P06 | T-API,T-SSE,T-UI | E-API,E-SSE,E-UI,E-OPS |
| TASK-10 | P06 | T-UI,T-VIS | E-UI,E-VIS |
| TASK-11 | P06 | T-API,T-UI,T-VIS,T-SEC | E-API,E-UI,E-VIS,E-RBAC |
| TASK-12 | P06 | T-API,T-SSE,T-UI | E-API,E-SSE,E-DATA,E-UI |
| TASK-13 | P06 | T-API,T-CHAIN,T-UI | E-API,E-CHAIN,E-UI |

### 任务配置与模板

| ID | 阶段 | 最低测试 | 最低验收证据 |
|---|---|---|---|
| TCFG-01 | P06 | T-UNIT,T-API,T-UI | E-API,E-DATA,E-UI |
| TCFG-02 | P06 | T-API,T-UI,T-SEC | E-API,E-UI,E-RBAC |
| TCFG-03 | P06 | T-UNIT,T-API,T-UI | E-API,E-DATA,E-UI |
| TCFG-04 | P06 | T-UNIT,T-UI,T-VIS | E-DATA,E-UI,E-VIS |
| TCFG-05 | P06 | T-UNIT,T-API,T-CHAIN,T-UI | E-API,E-CHAIN,E-UI |
| TCFG-06 | P06 | T-UNIT,T-CHAIN,T-UI,T-SEC | E-DATA,E-CHAIN,E-UI,E-SEC |
| TCFG-07 | P06 | T-UNIT,T-API,T-UI | E-API,E-UI |
| TCFG-08 | P06 | T-UNIT,T-API,T-REC,T-UI | E-API,E-REC,E-UI |
| TCFG-09 | P06 | T-UNIT,T-API,T-UI | E-API,E-DATA,E-UI |
| TCFG-10 | P06 | T-UNIT,T-API,T-CHAIN,T-UI | E-API,E-CHAIN,E-UI |
| TCFG-11 | P06 | T-UNIT,T-API,T-REC,T-UI | E-API,E-REC,E-UI |
| TCFG-12 | P06 | T-UNIT,T-API,T-REC,T-UI | E-API,E-REC,E-UI |
| TCFG-13 | P06 | T-API,T-CHAIN,T-REC,T-UI | E-API,E-CHAIN,E-REC,E-UI |
| TCFG-14 | P06 | T-API,T-UI,T-MIG | E-API,E-UI,E-OPS |
| TCFG-15 | P06 | T-API,T-CHAIN,T-REC,T-UI | E-API,E-CHAIN,E-REC,E-UI |
| TCFG-16 | P06 | T-UNIT,T-API,T-UI,T-SEC | E-API,E-DATA,E-UI,E-RBAC |
| TCFG-17 | P06 | T-UNIT,T-API,T-UI,T-SEC | E-API,E-DATA,E-UI,E-RBAC |

### 任务资金动作

| ID | 阶段 | 最低测试 | 最低验收证据 |
|---|---|---|---|
| TOP-01 | P07 | T-API,T-CHAIN,T-REC,T-UI,T-SEC | E-API,E-CHAIN,E-REC,E-UI,E-SEC |
| TOP-02 | P07 | T-API,T-REC,T-UI | E-API,E-REC,E-UI |
| TOP-03 | P07 | T-API,T-REC,T-UI | E-API,E-REC,E-UI |
| TOP-04 | P07 | T-API,T-CHAIN,T-REC,T-UI | E-API,E-CHAIN,E-REC,E-UI |
| TOP-05 | P07 | T-API,T-CHAIN,T-REC,T-UI,T-SEC | E-API,E-CHAIN,E-REC,E-UI,E-SEC |
| TOP-06 | P07 | T-API,T-CHAIN,T-REC,T-UI | E-API,E-CHAIN,E-REC,E-UI |
| TOP-07 | P07 | T-API,T-CHAIN,T-REC,T-UI | E-API,E-CHAIN,E-REC,E-UI |
| TOP-08 | P07 | T-API,T-CHAIN,T-REC,T-UI,T-SEC | E-API,E-CHAIN,E-REC,E-UI,E-SEC |
| TOP-09 | P08 | T-UNIT,T-CHAIN,T-REC,T-UI,T-SEC | E-DATA,E-CHAIN,E-REC,E-UI,E-SEC |
| TOP-10 | P07 | T-API,T-CHAIN,T-REC,T-UI,T-SEC | E-API,E-CHAIN,E-REC,E-UI,E-SEC |
| TOP-11 | P07 | T-API,T-CHAIN,T-REC,T-UI,T-SEC | E-API,E-CHAIN,E-REC,E-UI,E-SEC |
| TOP-12 | P07 | T-API,T-UI | E-API,E-UI |
| TOP-13 | P07 | T-API,T-CHAIN,T-REC,T-UI | E-API,E-CHAIN,E-REC,E-UI |

### 风控与关仓

| ID | 阶段 | 最低测试 | 最低验收证据 |
|---|---|---|---|
| RISK-01 | P08 | T-UNIT,T-CHAIN,T-REC,T-UI | E-DATA,E-CHAIN,E-REC,E-UI |
| RISK-02 | P08 | T-UNIT,T-CHAIN,T-REC,T-UI | E-CHAIN,E-REC,E-UI |
| RISK-03 | P08 | T-UNIT,T-CHAIN,T-REC,T-UI | E-DATA,E-CHAIN,E-REC,E-UI |
| RISK-04 | P08 | T-UNIT,T-REC,T-UI | E-DATA,E-REC,E-UI |
| RISK-05 | P08 | T-UNIT,T-REC,T-UI | E-DATA,E-REC,E-UI |
| RISK-06 | P08 | T-UNIT,T-REC,T-UI | E-DATA,E-REC,E-UI |
| RISK-07 | P08 | T-UNIT,T-CHAIN,T-REC,T-UI | E-DATA,E-CHAIN,E-REC,E-UI |
| RISK-08 | P08 | T-UNIT,T-REC,T-UI | E-DATA,E-REC,E-UI |
| RISK-09 | P08 | T-UNIT,T-CHAIN,T-REC,T-UI | E-DATA,E-CHAIN,E-REC,E-UI |
| RISK-10 | P08 | T-UNIT,T-API,T-UI | E-API,E-DATA,E-UI |
| RISK-11 | P08 | T-UNIT,T-API,T-REC,T-UI | E-API,E-REC,E-UI |
| RISK-12 | P08 | T-CHAIN,T-REC,T-SEC,T-UI | E-CHAIN,E-REC,E-SEC,E-UI |
| RISK-13 | P08 | T-CHAIN,T-REC,T-UI | E-CHAIN,E-REC,E-UI |
| RISK-14 | P08 | T-API,T-UI,T-SEC | E-API,E-UI,E-RBAC,E-OPS |
| RISK-15 | P08 | T-UNIT,T-CHAIN,T-SEC,T-UI | E-CHAIN,E-SEC,E-UI |

### 池发现、排行和实时数据

| ID | 阶段 | 最低测试 | 最低验收证据 |
|---|---|---|---|
| POOL-01 | P02 | T-UNIT,T-API,T-SSE,T-UI,T-VIS | E-API,E-SSE,E-DATA,E-UI,E-VIS |
| POOL-02 | P02 | T-UNIT,T-API,T-SSE,T-UI | E-API,E-SSE,E-DATA,E-UI |
| POOL-03 | P02 | T-UNIT,T-API,T-SSE,T-UI | E-API,E-SSE,E-DATA,E-UI |
| POOL-04 | P02 | T-UNIT,T-API,T-SSE,T-UI,T-VIS | E-API,E-SSE,E-DATA,E-UI,E-VIS |
| POOL-05 | P02 | T-UNIT,T-API,T-SSE,T-UI | E-API,E-SSE,E-DATA,E-UI |
| POOL-06 | P02 | T-UNIT,T-SSE,T-UI,T-VIS | E-SSE,E-DATA,E-UI,E-VIS |
| POOL-07 | P02 | T-UNIT,T-SSE,T-UI,T-VIS | E-SSE,E-DATA,E-UI,E-VIS |
| POOL-08 | P02 | T-API,T-SSE,T-UI | E-API,E-SSE,E-DATA,E-UI |
| POOL-09 | P02 | T-UNIT,T-SSE,T-UI,T-VIS | E-SSE,E-UI,E-VIS |
| POOL-10 | P02 | T-API,T-UI,T-VIS | E-API,E-UI,E-VIS |
| POOL-11 | P02 | T-UNIT,T-SSE,T-UI,T-VIS | E-SSE,E-DATA,E-UI,E-VIS |
| POOL-12 | P02 | T-UNIT,T-API,T-SSE,T-UI,T-VIS | E-API,E-SSE,E-DATA,E-UI,E-VIS |
| POOL-13 | P02 | T-API,T-UI,T-SEC | E-API,E-UI,E-RBAC |
| POOL-14 | P02 | T-API,T-UI,T-REC | E-API,E-UI,E-REC |
| POOL-15 | P02 | T-API,T-UI,T-SEC | E-API,E-UI,E-RBAC |
| POOL-16 | P02 | T-API,T-SSE,T-REC,T-PERF | E-API,E-SSE,E-REC,E-OPS |

### 流动性动向与监控

| ID | 阶段 | 最低测试 | 最低验收证据 |
|---|---|---|---|
| FLOW-01 | P02 | T-UNIT,T-SSE,T-UI,T-VIS | E-SSE,E-DATA,E-UI,E-VIS |
| FLOW-02 | P02 | T-UNIT,T-SSE,T-REC,T-UI | E-SSE,E-DATA,E-REC,E-UI |
| FLOW-03 | P02 | T-UNIT,T-SSE,T-UI | E-SSE,E-DATA,E-UI |
| FLOW-04 | P02 | T-UNIT,T-SSE,T-UI,T-VIS | E-SSE,E-DATA,E-UI,E-VIS |
| FLOW-05 | P02 | T-API,T-UI,T-SEC | E-API,E-UI,E-RBAC |
| MON-01 | P03 | T-API,T-UI | E-API,E-UI |
| MON-02 | P03 | T-UNIT,T-API,T-UI | E-API,E-DATA,E-UI |
| MON-03 | P03 | T-UNIT,T-API,T-UI | E-API,E-DATA,E-UI |
| MON-04 | P03 | T-API,T-REC,T-SEC,T-UI | E-API,E-REC,E-SEC,E-UI |
| MON-05 | P03 | T-API,T-UI | E-API,E-UI |
| MON-06 | P03 | T-UNIT,T-REC,T-SEC | E-REC,E-SEC,E-OPS |

### 自动策略

| ID | 阶段 | 最低测试 | 最低验收证据 |
|---|---|---|---|
| STRAT-01 | P08 | T-UNIT,T-API,T-UI,T-MIG | E-API,E-DATA,E-UI,E-OPS |
| STRAT-02 | P08 | T-API,T-CHAIN,T-REC,T-UI | E-API,E-CHAIN,E-REC,E-UI |
| STRAT-03 | P08 | T-UNIT,T-CHAIN,T-REC,T-SEC | E-CHAIN,E-REC,E-SEC |
| STRAT-04 | P08 | T-UNIT,T-CHAIN,T-REC,T-UI | E-DATA,E-CHAIN,E-REC,E-UI |
| STRAT-05 | P08 | T-UNIT,T-CHAIN,T-REC,T-PERF | E-DATA,E-CHAIN,E-REC,E-OPS |
| STRAT-06 | P08 | T-UNIT,T-UI | E-DATA,E-UI |
| STRAT-07 | P08 | T-UNIT,T-API,T-REC,T-UI | E-API,E-DATA,E-REC,E-UI |
| STRAT-08 | P08 | T-UNIT,T-API,T-UI | E-API,E-DATA,E-UI |
| STRAT-09 | P08 | T-UNIT,T-REC,T-UI | E-DATA,E-REC,E-UI |
| STRAT-10 | P08 | T-UNIT,T-CHAIN,T-SEC,T-UI | E-DATA,E-CHAIN,E-SEC,E-UI |
| STRAT-11 | P08 | T-UNIT,T-CHAIN,T-REC,T-UI | E-DATA,E-CHAIN,E-REC,E-UI |
| STRAT-12 | P08 | T-UNIT,T-CHAIN,T-REC,T-UI | E-CHAIN,E-REC,E-UI |
| STRAT-13 | P08 | T-API,T-UI,T-VIS | E-API,E-DATA,E-UI,E-VIS |
| STRAT-14 | P08 | T-API,T-UI,T-SEC | E-API,E-UI,E-RBAC |

### 钱包、安全、Swap 与 LP 仓位

| ID | 阶段 | 最低测试 | 最低验收证据 |
|---|---|---|---|
| WALLET-01 | P04 | T-API,T-UI,T-SEC | E-API,E-UI,E-SEC |
| WALLET-02 | P04 | T-API,T-UI,T-SEC | E-API,E-UI,E-SEC |
| WALLET-03 | P04 | T-API,T-REC,T-UI,T-SEC | E-API,E-REC,E-UI,E-SEC |
| WALLET-04 | P04 | T-UNIT,T-REC,T-SEC | E-REC,E-SEC,E-OPS |
| WALLET-05 | P04 | T-UNIT,T-API,T-REC,T-SEC,T-UI | E-API,E-REC,E-SEC,E-UI |
| WALLET-06 | P04 | T-UNIT,T-API,T-REC,T-SEC,T-UI | E-API,E-REC,E-SEC,E-UI |
| WALLET-07 | P04 | T-UNIT,T-API,T-SEC,T-UI | E-API,E-SEC,E-UI |
| WALLET-08 | P04 | T-UNIT,T-API,T-CHAIN,T-UI | E-API,E-DATA,E-CHAIN,E-UI |
| WALLET-09 | P04 | T-API,T-UI,T-SEC | E-API,E-UI,E-SEC |
| WALLET-10 | P04 | T-API,T-CHAIN,T-REC,T-UI,T-SEC | E-API,E-CHAIN,E-REC,E-UI,E-SEC |
| SWAP-01 | P05 | T-UNIT,T-API,T-CHAIN,T-UI,T-SEC | E-API,E-CHAIN,E-UI,E-SEC |
| SWAP-02 | P05 | T-API,T-CHAIN,T-REC,T-UI,T-SEC | E-API,E-CHAIN,E-REC,E-UI,E-SEC |
| POS-01 | P05 | T-API,T-CHAIN,T-UI | E-API,E-CHAIN,E-UI |
| POS-02 | P05 | T-API,T-CHAIN,T-REC,T-UI | E-API,E-CHAIN,E-REC,E-UI |
| POS-03 | P05 | T-API,T-CHAIN,T-REC,T-UI,T-SEC | E-API,E-CHAIN,E-REC,E-UI,E-SEC |
| POS-04 | P05 | T-API,T-SSE,T-CHAIN,T-UI | E-API,E-SSE,E-CHAIN,E-UI |
| HELPER-01 | P05 | T-API,T-CHAIN,T-UI | E-API,E-CHAIN,E-UI |
| HELPER-02 | P05 | T-CHAIN,T-REC,T-SEC,T-UI | E-CHAIN,E-REC,E-SEC,E-UI |
| HELPER-03 | P05 | T-CHAIN,T-REC,T-MIG,T-UI | E-CHAIN,E-REC,E-OPS,E-UI |
| HELPER-04 | P05 | T-UNIT,T-CHAIN,T-REC,T-SEC | E-CHAIN,E-REC,E-SEC |
| HELPER-05 | P05 | T-API,T-CHAIN,T-UI | E-API,E-CHAIN,E-UI |
| HELPER-06 | P05 | T-API,T-CHAIN,T-REC,T-SEC,T-UI | E-API,E-CHAIN,E-REC,E-SEC,E-UI |

### 建池、初始流动性和收费 Hook

| ID | 阶段 | 最低测试 | 最低验收证据 |
|---|---|---|---|
| CREATE-01 | P09 | T-UNIT,T-API,T-CHAIN,T-REC,T-UI | E-API,E-CHAIN,E-REC,E-UI |
| CREATE-02 | P09 | T-UNIT,T-CHAIN,T-UI,T-SEC | E-DATA,E-CHAIN,E-UI,E-SEC |
| CREATE-03 | P09 | T-API,T-CHAIN,T-UI | E-API,E-CHAIN,E-UI |
| CREATE-04 | P09 | T-API,T-CHAIN,T-REC,T-UI,T-SEC | E-API,E-CHAIN,E-REC,E-UI,E-SEC |
| CREATE-05 | P09 | T-API,T-CHAIN,T-REC,T-UI,T-SEC | E-API,E-CHAIN,E-REC,E-UI,E-SEC |
| CREATE-06 | P09 | T-UNIT,T-CHAIN,T-REC,T-SEC,T-UI | E-CHAIN,E-REC,E-SEC,E-UI,E-RBAC |
| CREATE-07 | P09 | T-UNIT,T-CHAIN,T-REC,T-SEC,T-UI | E-CHAIN,E-REC,E-SEC,E-UI,E-RBAC |
| CREATE-08 | P09 | T-API,T-CHAIN,T-UI | E-API,E-CHAIN,E-UI,E-RBAC |
| CREATE-09 | P09 | T-API,T-CHAIN,T-REC,T-SEC,T-UI | E-API,E-CHAIN,E-REC,E-SEC,E-UI,E-RBAC |
| CREATE-10 | P09 | T-API,T-CHAIN,T-REC,T-SEC,T-UI | E-API,E-CHAIN,E-REC,E-SEC,E-UI,E-RBAC |
| CREATE-11 | P09 | T-API,T-CHAIN,T-UI,T-SEC | E-API,E-CHAIN,E-UI,E-RBAC |

### 聊天室、红包与社区管理

| ID | 阶段 | 最低测试 | 最低验收证据 |
|---|---|---|---|
| CHAT-01 | P10 | T-API,T-UI,T-VIS | E-API,E-UI,E-VIS |
| CHAT-02 | P10 | T-API,T-SSE,T-REC,T-UI | E-API,E-SSE,E-REC,E-UI |
| CHAT-03 | P10 | T-API,T-SSE,T-SEC,T-UI | E-API,E-SSE,E-UI,E-RBAC |
| CHAT-04 | P10 | T-API,T-SEC,T-UI | E-API,E-SEC,E-UI |
| CHAT-05 | P10 | T-API,T-SSE,T-REC,T-UI | E-API,E-SSE,E-REC,E-UI |
| CHAT-06 | P10 | T-API,T-SSE,T-REC,T-UI | E-API,E-SSE,E-REC,E-UI |
| CHAT-07 | P10 | T-API,T-SEC,T-UI | E-API,E-SEC,E-UI |
| CHAT-08 | P10 | T-API,T-SEC,T-UI | E-API,E-UI,E-RBAC,E-SEC |
| CHAT-09 | P10 | T-API,T-UI,T-SEC | E-API,E-UI,E-RBAC |
| CHAT-10 | P10 | T-UNIT,T-API,T-CHAIN,T-REC,T-SEC,T-UI | E-API,E-CHAIN,E-REC,E-SEC,E-UI |
| CHAT-11 | P10 | T-UNIT,T-API,T-CHAIN,T-REC,T-SEC,T-UI | E-API,E-CHAIN,E-REC,E-SEC,E-UI |
| CHAT-12 | P10 | T-CHAIN,T-REC,T-SEC,T-UI | E-CHAIN,E-REC,E-SEC,E-UI,E-RBAC |
| CHAT-13 | P10 | T-API,T-SEC,T-UI | E-API,E-UI,E-RBAC,E-SEC |

### 日志、统计、通知、反馈与开发者 API

| ID | 阶段 | 最低测试 | 最低验收证据 |
|---|---|---|---|
| LOG-01 | P11 | T-API,T-UI,T-SEC | E-API,E-UI,E-RBAC,E-OPS |
| LOG-02 | P11 | T-API,T-UI,T-VIS | E-API,E-UI,E-VIS |
| STATS-01 | P02 | T-API,T-SSE,T-REC,T-UI | E-API,E-SSE,E-REC,E-UI |
| STATS-02 | P02 | T-UNIT,T-API,T-SSE,T-REC,T-UI | E-API,E-SSE,E-DATA,E-REC,E-UI |
| NOTIFY-01 | P03 | T-API,T-REC,T-UI | E-API,E-REC,E-UI |
| NOTIFY-02 | P03 | T-API,T-REC,T-SEC,T-UI | E-API,E-REC,E-SEC,E-UI |
| FEED-01 | P11 | T-API,T-SEC,T-UI | E-API,E-SEC,E-UI |
| FEED-02 | P11 | T-API,T-REC,T-UI | E-API,E-REC,E-UI |
| FEED-03 | P11 | T-API,T-SEC,T-UI | E-API,E-UI,E-RBAC,E-SEC |
| DEV-01 | P11 | T-API,T-REC,T-SEC,T-UI | E-API,E-REC,E-SEC,E-UI |
| DEV-02 | P11 | T-API,T-UI,T-VIS,T-MIG | E-API,E-UI,E-VIS,E-OPS |
| DEV-03 | P11 | T-API,T-PERF,T-SEC | E-API,E-SEC,E-OPS |

### 设置

| ID | 阶段 | 最低测试 | 最低验收证据 |
|---|---|---|---|
| SET-01 | P01 | T-API,T-UI,T-VIS | E-API,E-UI,E-VIS |
| SET-02 | P01 | T-API,T-UI,T-VIS | E-API,E-UI,E-VIS |
| SET-03 | P06 | T-API,T-REC,T-UI | E-API,E-REC,E-UI |
| SET-04 | P08 | T-API,T-REC,T-UI,T-SEC | E-API,E-REC,E-UI,E-RBAC |
| SET-05 | P08 | T-UNIT,T-API,T-REC,T-UI | E-API,E-REC,E-UI |
| SET-06 | P04 | T-API,T-SEC,T-UI | E-API,E-SEC,E-UI |
| SET-07 | P04 | T-API,T-REC,T-SEC,T-UI | E-API,E-REC,E-SEC,E-UI |

#### P01 当前实现与证据状态

`accepted` work item 只表示对应工作项通过当时门禁，不自动提升功能状态。以下项目均只有本地 fixture、冻结 Bundle 候选或有限 live-observed 证据；完整目标对照未完成，因此没有项目达到 `parity-verified` 或 `released`。完整逐文件记录见 [P01-08 feature coverage](../artifacts/acceptance/P01-08/feature-coverage.json)。

<!-- P01_STATUS_TABLE_START -->
| ID | 当前状态 | 实现 | 测试 | 验收与证据等级 |
|---|---|---|---|---|
| AUTH-01 | `implemented-assumed` | [Telegram initData](../packages/security/src/telegram-init-data.ts), [Mini App login](../packages/security/src/telegram-mini-app-login.ts), [API](../apps/api/src/app.ts), [Web adapter](../apps/web/src/telegram-mini-app.ts) | [T-UNIT](../tests/telegram-init-data.test.ts), [T-API/T-SEC](../tests/telegram-mini-app-login.test.ts), [T-UI](../tests/e2e/telegram-login.spec.ts) | [P01-03](../artifacts/acceptance/P01-03/manifest.json); frozen-bundle-candidate, local-fixture-verified |
| AUTH-02 | `implemented-assumed` | [Bot login](../packages/security/src/telegram-bot-login.ts), [API](../apps/api/src/app.ts), [Web auth](../apps/web/src/auth-client.ts) | [T-UNIT/T-API/T-SEC](../tests/telegram-bot-login.test.ts), [T-UI](../tests/e2e/telegram-login.spec.ts) | [P01-03](../artifacts/acceptance/P01-03/manifest.json); frozen-bundle-candidate, local-fixture-verified |
| AUTH-03 | `implemented-assumed` | [Wallet auth](../packages/security/src/login-wallet-auth.ts), [API](../apps/api/src/app.ts), [EIP-1193 adapter](../apps/web/src/eip1193-wallet.ts), [Web auth](../apps/web/src/auth-client.ts) | [T-UNIT/T-SEC](../tests/wallet-auth.test.ts), [T-API](../tests/wallet-auth-api.test.ts), [T-UI](../tests/e2e/wallet-auth.spec.ts) | [P01-04](../artifacts/acceptance/P01-04/manifest.json); frozen-bundle-candidate, local-fixture-verified; EOA only, no EIP-1271 claim |
| AUTH-04 | `implemented-assumed` | [Wallet auth](../packages/security/src/login-wallet-auth.ts), [API](../apps/api/src/app.ts), [Web shell](../apps/web/src/App.tsx), [Web auth](../apps/web/src/auth-client.ts) | [T-API](../tests/wallet-auth-api.test.ts), [T-UI](../tests/e2e/wallet-auth.spec.ts), [T-SEC](../tests/wallet-domain-boundary.test.ts) | [P01-04](../artifacts/acceptance/P01-04/manifest.json); frozen-bundle-candidate, local-fixture-verified |
| AUTH-05 | `implemented-assumed` | [API](../apps/api/src/app.ts), [PostgreSQL session store](../apps/api/src/postgres-session-store.ts), [Cookie policy](../apps/api/src/browser-session-cookie.ts), [Web auth](../apps/web/src/auth-client.ts) | [T-API/T-SEC](../tests/api-auth.test.ts), [T-UI](../tests/e2e/auth-states.spec.ts) | [P01-02](../artifacts/acceptance/P01-02/manifest.json); frozen-bundle-candidate, local-fixture-verified; historical commit remains null |
| AUTH-06 | `implemented-assumed` | [Domain policy](../packages/domain/src/index.ts), [API](../apps/api/src/app.ts), [Web shell](../apps/web/src/App.tsx) | [T-API](../tests/api-auth.test.ts), [T-UI](../tests/e2e/auth-states.spec.ts), [T-SEC](../tests/auth-policy.test.ts) | [P01-02](../artifacts/acceptance/P01-02/manifest.json); frozen-bundle-candidate, local-fixture-verified |
| AUTH-07 | `implemented-assumed` | [Domain policy](../packages/domain/src/index.ts), [API](../apps/api/src/app.ts), [Web shell](../apps/web/src/App.tsx) | [T-API](../tests/api-auth.test.ts), [T-UI](../tests/e2e/auth-states.spec.ts), [T-REC](../tests/integration/postgres-session.integration.ts) | [P01-02](../artifacts/acceptance/P01-02/manifest.json); frozen-bundle-candidate, local-fixture-verified |
| AUTH-08 | `implemented-assumed` | [Domain policy](../packages/domain/src/index.ts), [API](../apps/api/src/app.ts), [Web shell](../apps/web/src/App.tsx) | [T-API](../tests/api-auth.test.ts), [T-UI](../tests/e2e/auth-states.spec.ts), [T-SEC](../tests/auth-policy.test.ts) | [P01-02](../artifacts/acceptance/P01-02/manifest.json); frozen-bundle-candidate, local-fixture-verified |
| AUTH-09 | `implemented-assumed` | [Domain policy](../packages/domain/src/index.ts), [API](../apps/api/src/app.ts), [Web shell](../apps/web/src/App.tsx) | [T-API](../tests/api-auth.test.ts), [T-UI](../tests/e2e/auth-states.spec.ts), [T-SEC](../tests/auth-policy.test.ts) | [P01-02](../artifacts/acceptance/P01-02/manifest.json); frozen-bundle-candidate, local-fixture-verified |
| AUTH-10 | `implemented-assumed` | [Domain policy](../packages/domain/src/index.ts), [API](../apps/api/src/app.ts), [Policy store](../apps/api/src/postgres-chain-access-policy-store.ts), [Chain management](../apps/web/src/chain-management.tsx), [Migration](../infra/migrations/20260815000100_create_chain_access_policies.sql) | [T-API](../tests/chain-access-api.test.ts), [T-UI](../tests/e2e/chain-management.spec.ts), [T-SEC](../tests/chain-access-policy.test.ts) | [P01-07](../artifacts/acceptance/P01-07/manifest.json); frozen-bundle-candidate, local-fixture-verified; R2 review |
| SHELL-01 | `implemented-assumed` | [Web shell](../apps/web/src/App.tsx), [Styles](../apps/web/src/styles.css) | [T-UI/T-VIS](../tests/e2e/shell.spec.ts) | [P01-05](../artifacts/acceptance/P01-05/manifest.json); live-observed, local-fixture-verified |
| SHELL-02 | `implemented-assumed` | [API stats](../apps/api/src/shell-stats.ts), [API](../apps/api/src/app.ts), [Web stats](../apps/web/src/shell-stats.ts), [React adapter](../apps/web/src/shell-stats-react.tsx) | [T-SSE](../tests/stats-sse-api.test.ts), [T-UI/T-VIS](../tests/e2e/preferences-shell.spec.ts) | [P01-06](../artifacts/acceptance/P01-06/manifest.json); live-observed, frozen-bundle-candidate, local-fixture-verified |
| SHELL-03 | `implemented-assumed` | [Theme](../apps/web/src/theme.ts), [Preferences](../apps/web/src/preferences.tsx), [Styles](../apps/web/src/styles.css) | [T-UI/T-VIS](../tests/e2e/preferences-shell.spec.ts) | [P01-06](../artifacts/acceptance/P01-06/manifest.json); live-observed, local-fixture-verified |
| SHELL-04 | `implemented-assumed` | [Preferences API](../apps/api/src/user-preferences.ts), [Preferences UI](../apps/web/src/preferences.tsx), [Settings UI](../apps/web/src/settings-interface.tsx), [Web shell](../apps/web/src/App.tsx) | [T-API](../tests/user-preferences-api.test.ts), [T-UI/T-VIS](../tests/e2e/preferences-shell.spec.ts) | [P01-06](../artifacts/acceptance/P01-06/manifest.json); frozen-bundle-candidate, local-fixture-verified |
| SHELL-05 | `implemented-assumed` | [Feedback controller](../apps/web/src/feedback-controller.ts), [Feedback UI](../apps/web/src/feedback.tsx), [Web shell](../apps/web/src/App.tsx) | [T-UI/T-VIS](../tests/e2e/shell.spec.ts) | [P01-05](../artifacts/acceptance/P01-05/manifest.json); local-fixture-verified |
| SHELL-06 | `implemented-assumed` | [Service Worker](../apps/web/src/sw.ts), [PWA policy](../apps/web/src/pwa-policy.ts), [Update controller](../apps/web/src/pwa-update-controller.ts), [Mini App adapter](../apps/web/src/telegram-mini-app.ts) | [T-UI/T-VIS](../tests/e2e/shell.spec.ts), [T-MIG](../tests/e2e-pwa/pwa-preview.spec.ts) | [P01-05](../artifacts/acceptance/P01-05/manifest.json); frozen-bundle-candidate, local-fixture-verified |
| SET-01 | `implemented-assumed` | [Preferences API](../apps/api/src/user-preferences.ts), [Preferences store](../apps/api/src/postgres-user-preferences-store.ts), [Preferences UI](../apps/web/src/preferences.tsx), [Settings UI](../apps/web/src/settings-interface.tsx) | [T-API](../tests/user-preferences-api.test.ts), [T-UI/T-VIS](../tests/e2e/preferences-shell.spec.ts) | [P01-06](../artifacts/acceptance/P01-06/manifest.json); live-observed, frozen-bundle-candidate, local-fixture-verified |
| SET-02 | `implemented-assumed` | [Preferences API](../apps/api/src/user-preferences.ts), [Preferences store](../apps/api/src/postgres-user-preferences-store.ts), [Preferences UI](../apps/web/src/preferences.tsx), [Settings UI](../apps/web/src/settings-interface.tsx) | [T-API](../tests/user-preferences-api.test.ts), [T-UI/T-VIS](../tests/e2e/preferences-shell.spec.ts) | [P01-06](../artifacts/acceptance/P01-06/manifest.json); live-observed, frozen-bundle-candidate, local-fixture-verified |
<!-- P01_STATUS_TABLE_END -->

#### P02 当前实现与证据状态

P02-02、P02-04、P02-05、P02-06、P02-07、P02-08、P02-09、P02-10 与 P02-11 只验证 BSC chainId 56 的本地 fixture 纵向路径。以下 21 项只有 `local-fixture-verified` 证据，因此均为 `implemented-assumed`；没有项目达到 `parity-verified` 或 `released`。其余 POOL-15 与 STATS-01 明确保留 `planned`，P02-01 继续是无实现所有权的冻结参考契约，aTVL、Fee/aTVL、`GAP-LABEL-ALGORITHM`、`GAP-FLOW-USD-VALUATION`、`GAP-API-CANDLE-QUOTE`、`GAP-UI-TICK-LIQUIDITY-MAPPING`、既有 USD/公式缺口与 `GAP-FINALITY-DEPTH` 继续 unresolved。

<!-- P02_STATUS_TABLE_START -->
| ID | 当前状态 | 实现 | 测试 | 验收与证据等级 |
|---|---|---|---|---|
| POOL-01 | `implemented-assumed` | [Indexer](../apps/indexer/src/index.ts), [PostgreSQL store](../apps/indexer/src/postgres-canonical-event-store.ts), [Metrics](../packages/market-metrics/src/index.ts), [API](../apps/api/src/market-pools.ts), [Web](../apps/web/src/pools-page.tsx) | [T-UNIT](../tests/market-metrics.test.ts), [T-API/T-SSE](../tests/market-pools-api.test.ts), [T-REC/T-PERF](../tests/integration/postgres-market-indexer.integration.ts), [T-UI/T-VIS](../tests/e2e/pools.spec.ts) | [P02-02](../artifacts/acceptance/P02-02/manifest.json); local-fixture-verified; BSC chainId 56 only |
| POOL-02 | `implemented-assumed` | [Window contracts](../packages/api-contract/src/index.ts), [Metrics](../packages/market-metrics/src/index.ts), [API](../apps/api/src/app.ts), [Web control](../apps/web/src/pools-page.tsx) | [T-UNIT](../tests/market-metrics.test.ts), [T-API](../tests/market-pools-api.test.ts), [T-UI](../tests/e2e/pools.spec.ts) | [P02-02](../artifacts/acceptance/P02-02/manifest.json); local-fixture-verified |
| POOL-03 | `implemented-assumed` | [DEX contract](../packages/api-contract/src/index.ts), [Snapshot/SSE provider](../apps/api/src/market-pools.ts), [HTTP validation](../apps/api/src/app.ts), [Web client](../apps/web/src/pools-client.ts), [Web controls](../apps/web/src/pools-page.tsx) | [T-UNIT](../tests/liquidity-flow-contract.test.ts), [T-API/T-SSE](../tests/market-pools-api.test.ts), [T-UI](../tests/pools-stream-client.test.ts), [T-UI/T-VIS](../tests/e2e/liquidity-flow.spec.ts) | [P02-04](../artifacts/acceptance/P02-04/manifest.json); local-fixture-verified; BSC chainId 56 only |
| POOL-04 | `implemented-assumed` | [Decimal metrics](../packages/market-metrics/src/index.ts), [API contract](../packages/api-contract/src/index.ts), [Pool table](../apps/web/src/pools-page.tsx) | [T-UNIT](../tests/market-metrics.test.ts), [T-API](../tests/market-pools-api.test.ts), [T-UI/T-VIS](../tests/e2e/pools.spec.ts) | [P02-02](../artifacts/acceptance/P02-02/manifest.json); local-fixture-verified; aTVL fields remain null |
| POOL-05 | `implemented-assumed` | [Decimal metrics](../packages/market-metrics/src/index.ts), [API contract](../packages/api-contract/src/index.ts), [Column state](../apps/web/src/pool-table-state.ts), [Web](../apps/web/src/pools-page.tsx) | [T-UNIT](../tests/pool-yield.test.ts), [T-API](../tests/market-pools-api.test.ts), [T-SSE](../tests/pool-comparison.test.ts), [T-UI](../tests/e2e/p02-07-pool-analysis.spec.ts) | [P02-07](../artifacts/acceptance/P02-07/manifest.json); local-fixture-verified; Fee/TVL is current-window and unannualized; aTVL and Fee/aTVL remain unresolved |
| POOL-06 | `implemented-assumed` | [Filter state](../apps/web/src/pool-filter-state.ts), [Grouping and columns](../apps/web/src/pool-table-state.ts), [Web controls](../apps/web/src/pools-page.tsx) | [T-UNIT](../tests/pool-advanced-filters.test.ts), [T-SSE](../tests/pool-comparison.test.ts), [T-UI/T-VIS](../tests/e2e/p02-07-pool-analysis.spec.ts) | [P02-07](../artifacts/acceptance/P02-07/manifest.json); local-fixture-verified; URL-restorable Decimal ranges and known-symbol Han exclusion |
| POOL-07 | `implemented-assumed` | [Rule contract and Decimal engine](../packages/market-metrics/src/pool-labels.ts), [Transactional projection](../apps/indexer/src/postgres-canonical-event-store.ts), [API contract](../packages/api-contract/src/index.ts), [SSE client](../apps/web/src/pools-client.ts), [Pool UI](../apps/web/src/pools-page.tsx), [Preferences UI](../apps/web/src/settings-interface.tsx) | [T-UNIT](../tests/pool-labels.test.ts), [T-API/T-SSE](../tests/market-pools-api.test.ts), [T-SSE/T-UI](../tests/pool-label-stream.test.ts), [T-REC](../tests/integration/postgres-market-indexer.integration.ts), [T-API/T-REC](../tests/integration/postgres-user-preferences.integration.ts), [T-UI/T-VIS](../tests/e2e/p02-08-pool-labels.spec.ts) | [P02-08](../artifacts/acceptance/P02-08/manifest.json); local-fixture-verified; locally-defined rules; `GAP-LABEL-ALGORITHM` unresolved |
| POOL-08 | `implemented-assumed` | [Catalog store](../apps/indexer/src/postgres-canonical-event-store.ts), [Catalog migration](../infra/migrations/20260816000400_create_market_pool_catalog.sql), [Token API](../apps/api/src/market-pools.ts), [HTTP route](../apps/api/src/app.ts), [Search state](../apps/web/src/pool-search-state.ts), [Web](../apps/web/src/pools-page.tsx) | [T-UNIT](../tests/pool-search-state.test.ts), [T-API](../tests/pools-by-token-api.test.ts), [T-REC](../tests/integration/postgres-market-indexer.integration.ts), [T-UI](../tests/e2e/p02-06-pool-discovery.spec.ts) | [P02-06](../artifacts/acceptance/P02-06/manifest.json); local-fixture-verified; BSC chainId 56 only; no external RPC |
| POOL-09 | `implemented-assumed` | [Canonical grouping](../apps/web/src/pool-table-state.ts), [SSE integration](../apps/web/src/pools-page.tsx) | [T-UNIT/T-SSE](../tests/pool-grouping.test.ts), [T-UI/T-VIS](../tests/e2e/p02-06-pool-discovery.spec.ts) | [P02-06](../artifacts/acceptance/P02-06/manifest.json); local-fixture-verified; frozen BSC quote-token registry |
| POOL-10 | `implemented-assumed` | [Preferences contract](../packages/api-contract/src/index.ts), [Preferences validation](../apps/api/src/user-preferences.ts), [PostgreSQL store](../apps/api/src/postgres-user-preferences-store.ts), [Column state](../apps/web/src/pool-table-state.ts), [Web](../apps/web/src/pools-page.tsx) | [T-UNIT](../tests/pool-columns.test.ts), [T-API](../tests/user-preferences-api.test.ts), [T-REC](../tests/integration/postgres-user-preferences.integration.ts), [T-UI/T-VIS](../tests/e2e/p02-06-pool-discovery.spec.ts) | [P02-06](../artifacts/acceptance/P02-06/manifest.json); local-fixture-verified; schema v3 revision conflicts and cross-device restore |
| POOL-11 | `implemented-assumed` | [Comparison state](../apps/web/src/pool-comparison-state.ts), [Snapshot/SSE reducer](../apps/web/src/pools-stream-state.ts), [Web panel](../apps/web/src/pools-page.tsx) | [T-UNIT/T-SSE](../tests/pool-comparison.test.ts), [T-UI/T-VIS](../tests/e2e/p02-07-pool-analysis.spec.ts) | [P02-07](../artifacts/acceptance/P02-07/manifest.json); local-fixture-verified; session-only selection of 2 to 3 stable pool keys bound to one snapshot |
| POOL-12 | `implemented-assumed` | [Candle/Tick metrics](../packages/market-metrics/src/candle-tick.ts), [Transactional read model](../apps/indexer/src/candle-tick-read-model.ts), [PostgreSQL store](../apps/indexer/src/postgres-canonical-event-store.ts), [Migration](../infra/migrations/20260817000100_create_candle_tick_read_models.sql), [Read-only API](../apps/api/src/market-charts.ts), [Strict client](../apps/web/src/market-chart-client.ts), [Pool detail UI](../apps/web/src/pool-market-detail.tsx) | [T-UNIT](../tests/candle-tick-projection.test.ts), [T-API](../tests/candle-tick-api.test.ts), [T-SSE/T-UI](../tests/market-chart-client.test.ts), [T-REC/T-MIG](../tests/integration/postgres-candle-tick-read-model.integration.ts), [T-UI/T-VIS](../tests/e2e/p02-10-candle-tick.spec.ts) | [P02-10](../artifacts/acceptance/P02-10/manifest.json); local-fixture-verified; BSC only; locally-defined raw-unit price/volume semantics; `GAP-API-CANDLE-QUOTE` and `GAP-UI-TICK-LIQUIDITY-MAPPING` unresolved |
| POOL-13 | `implemented-assumed` | [Intent contract](../packages/api-contract/src/index.ts), [Shared command registry](../apps/web/src/pool-actions.ts), [Accessible menu](../apps/web/src/pool-action-menu.tsx), [Pool UI](../apps/web/src/pools-page.tsx) | [T-UNIT/T-SEC](../tests/pool-action-registry.test.ts), [T-UI/T-VIS](../tests/e2e/p02-11-pool-actions-blocklist.spec.ts) | [P02-11](../artifacts/acceptance/P02-11/manifest.json); local-fixture-verified; task/monitor/chat actions are canonical prefill intents only and perform no business write |
| POOL-14 | `implemented-assumed` | [Blocklist contract](../packages/api-contract/src/index.ts), [PostgreSQL store](../apps/api/src/postgres-pool-blocklist-store.ts), [API](../apps/api/src/app.ts), [Migration](../infra/migrations/20260817000200_create_user_pool_blocklist.sql), [Eligibility policy](../packages/domain/src/index.ts), [Market consumers](../apps/api/src/market-pools.ts), [Recommendation consumer](../apps/api/src/recommended-pools.ts), [Client state](../apps/web/src/pool-blocklist-state.ts), [Management UI](../apps/web/src/pool-blocklist-manager.tsx) | [T-UNIT](../tests/pool-blocklist-contract.test.ts), [T-API/T-SSE](../tests/pool-blocklist-api.test.ts), [T-REC/T-MIG](../tests/integration/postgres-pool-blocklist.integration.ts), [T-UI/T-VIS](../tests/e2e/p02-11-pool-actions-blocklist.spec.ts) | [P02-11](../artifacts/acceptance/P02-11/manifest.json); local-fixture-verified; BSC only; monitoring and strategy expose consumer contracts only |
| POOL-15 | `planned` | 未实现 | 未实现 | P02-01 reference-only; no implementation evidence |
| POOL-16 | `implemented-assumed` | [SSE contract](../packages/api-contract/src/index.ts), [Replay provider](../apps/api/src/market-pools.ts), [HTTP stream](../apps/api/src/app.ts), [Durable outbox](../infra/migrations/20260816000100_create_market_indexer.sql) | [T-API/T-SSE](../tests/market-pools-api.test.ts), [T-REC/T-PERF](../tests/integration/postgres-market-indexer.integration.ts), [T-UI](../tests/pools-stream-client.test.ts) | [P02-02](../artifacts/acceptance/P02-02/manifest.json); local-fixture-verified |
| FLOW-01 | `implemented-assumed` | [Versioned contract](../packages/api-contract/src/index.ts), [Golden projection](../apps/indexer/src/liquidity-flow.ts), [Transactional store](../apps/indexer/src/postgres-canonical-event-store.ts), [Read-only SSE](../apps/api/src/liquidity-flow.ts), [Web panel](../apps/web/src/pools-page.tsx) | [T-UNIT](../tests/liquidity-flow-projection.test.ts), [T-SSE](../tests/liquidity-flow-api.test.ts), [T-REC](../tests/integration/postgres-liquidity-flow.integration.ts), [T-UI](../tests/liquidity-flow-client.test.ts), [T-UI/T-VIS](../tests/e2e/liquidity-flow.spec.ts) | [P02-04](../artifacts/acceptance/P02-04/manifest.json); local-fixture-verified; observed/reverted only; nullable values are not inferred |
| FLOW-02 | `implemented-assumed` | [Filter contract](../packages/api-contract/src/index.ts), [Backfill provider](../apps/api/src/liquidity-flow.ts), [HTTP validation](../apps/api/src/app.ts), [Client reconnect/state](../apps/web/src/liquidity-flow-client.ts), [UI filtering](../apps/web/src/liquidity-flow-state.ts) | [T-UNIT/T-UI](../tests/liquidity-flow-client.test.ts), [T-SSE](../tests/liquidity-flow-api.test.ts), [T-REC](../tests/integration/postgres-liquidity-flow.integration.ts), [T-UI/T-VIS](../tests/e2e/liquidity-flow.spec.ts) | [P02-04](../artifacts/acceptance/P02-04/manifest.json); local-fixture-verified; retained-cursor replay and reorg tombstones |
| FLOW-03 | `implemented-assumed` | [Decimal projection](../apps/web/src/liquidity-flow-state.ts), [Statistics strip](../apps/web/src/pools-page.tsx) | [T-UNIT/T-SSE](../tests/liquidity-flow-client.test.ts), [T-UI](../tests/e2e/p02-05-liquidity-insights.spec.ts) | [P02-05](../artifacts/acceptance/P02-05/manifest.json); local-fixture-verified; unknown USD remains partial |
| FLOW-04 | `implemented-assumed` | [Address projection](../apps/web/src/liquidity-flow-state.ts), [Address table](../apps/web/src/pools-page.tsx), [Remark state](../apps/web/src/address-remarks-state.ts) | [T-UNIT/T-SSE](../tests/liquidity-flow-client.test.ts), [T-UI/T-VIS](../tests/e2e/p02-05-liquidity-insights.spec.ts) | [P02-05](../artifacts/acceptance/P02-05/manifest.json); local-fixture-verified; partial values stay segregated |
| FLOW-05 | `implemented-assumed` | [Contract](../packages/api-contract/src/index.ts), [API](../apps/api/src/app.ts), [PostgreSQL store](../apps/api/src/postgres-address-remark-store.ts), [Migration](../infra/migrations/20260816000300_create_address_remarks.sql), [Web client/state](../apps/web/src/address-remarks-client.ts) | [T-API/T-SEC](../tests/address-remarks-api.test.ts), [T-REC](../tests/integration/postgres-address-remarks.integration.ts), [T-UI](../tests/address-remarks-client.test.ts), [T-UI/T-VIS](../tests/e2e/p02-05-liquidity-insights.spec.ts) | [P02-05](../artifacts/acceptance/P02-05/manifest.json); local-fixture-verified; session-owned personal rows and anonymous shared votes |
| STATS-01 | `planned` | P02 实现所有权未认领 | 未实现 | P02-01 reference-only; no implementation evidence |
| STATS-02 | `implemented-assumed` | [API contract](../packages/api-contract/src/index.ts), [Recommendation selector and poller](../apps/api/src/recommended-pools.ts), [HTTP stream](../apps/api/src/app.ts), [Canonical provider](../apps/api/src/market-pools.ts), [Strict client](../apps/web/src/shell-stats.ts), [Status bar](../apps/web/src/shell-stats-react.tsx) | [T-UNIT](../tests/recommended-pools.test.ts), [T-API/T-SSE](../tests/recommended-pools-api.test.ts), [T-SSE](../tests/recommended-pools-stream.test.ts), [T-REC](../tests/integration/postgres-market-indexer.integration.ts), [T-UI](../tests/recommended-pools-client.test.ts), [T-UI/T-VIS](../tests/e2e/p02-09-recommended-pools.spec.ts) | [P02-09](../artifacts/acceptance/P02-09/manifest.json); local-fixture-verified; locally-defined selection; BSC canonical 5-minute source only |
<!-- P02_STATUS_TABLE_END -->

### 管理后台

| ID | 阶段 | 最低测试 | 最低验收证据 |
|---|---|---|---|
| ADMIN-01 | P11 | T-API,T-UI,T-VIS,T-SEC | E-API,E-UI,E-VIS,E-RBAC |
| ADMIN-02 | P11 | T-API,T-REC,T-SEC,T-UI | E-API,E-REC,E-UI,E-RBAC,E-OPS |
| ADMIN-03 | P11 | T-API,T-REC,T-SEC,T-UI | E-API,E-REC,E-UI,E-RBAC,E-OPS |
| ADMIN-04 | P11 | T-UNIT,T-API,T-REC,T-SEC,T-UI | E-API,E-REC,E-UI,E-RBAC,E-OPS |
| ADMIN-05 | P11 | T-API,T-SEC,T-UI | E-API,E-UI,E-RBAC,E-SEC |
| ADMIN-06 | P11 | T-API,T-SEC,T-UI | E-API,E-UI,E-RBAC |
| ADMIN-07 | P11 | T-API,T-UI,T-VIS,T-SEC | E-API,E-DATA,E-UI,E-VIS,E-RBAC |
| ADMIN-08 | P11 | T-API,T-REC,T-SEC,T-UI | E-API,E-REC,E-UI,E-RBAC,E-OPS |
| ADMIN-09 | P11 | T-API,T-REC,T-SEC,T-UI | E-API,E-REC,E-UI,E-RBAC,E-OPS |
| ADMIN-10 | P11 | T-API,T-REC,T-SEC,T-UI | E-API,E-REC,E-UI,E-RBAC,E-OPS |
| ADMIN-11 | P11 | T-UNIT,T-API,T-CHAIN,T-REC,T-SEC,T-UI | E-API,E-CHAIN,E-REC,E-UI,E-RBAC,E-OPS |
| ADMIN-12 | P11 | T-API,T-REC,T-SEC,T-UI | E-API,E-REC,E-UI,E-RBAC,E-OPS |
| ADMIN-13 | P11 | T-API,T-REC,T-SEC,T-UI | E-API,E-REC,E-UI,E-RBAC,E-OPS |
| ADMIN-14 | P11 | T-API,T-REC,T-SEC,T-UI | E-API,E-REC,E-SEC,E-UI,E-RBAC,E-OPS |
| ADMIN-15 | P11 | T-API,T-UI,T-SEC | E-API,E-UI,E-RBAC |
| ADMIN-16 | P11 | T-API,T-REC,T-SEC,T-UI | E-API,E-REC,E-UI,E-RBAC,E-OPS |

## 3. 当前覆盖统计

| 项目 | 数量 | 当前结果 |
|---|---:|---|
| 功能矩阵稳定 ID | 196 | 已全部映射 |
| 追踪表稳定 ID | 196 | 必须由自动检查保持相等 |
| 当前产品实现 | 39 | P01 的 18 项和 P02 的 21 项完成阶段实现 |
| `implemented-assumed` | 39 | 目标对照或 live 证据仍不完整 |
| `parity-verified` | 0 | 不由 accepted work item 自动提升 |
| `released` | 0 | 尚无 staging、监控和回滚完整证明 |
| 其余 `planned` | 157 | P02 仍有 2 项 planned；P03-P13 状态未改变 |

建议 CI 检查逻辑：从 `FUNCTION_MATRIX.md` 与本文件抽取 `^[A-Z]+-[0-9]{2}$`，比较去重集合；再检查每行非空的阶段、测试和证据列。任何新增功能 ID 必须先进入范围源和本表。
