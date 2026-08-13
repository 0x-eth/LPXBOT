# LP Bot API Reference

Base URL: https://api.lpbot.cc
Auth: X-API-Key header


## 任务管理

### GET /api/tasks/stream
任务列表 + 活跃 token 价格 + 链上数据 合并 SSE 推送。tasks 走 snapshot/diff（5s tick + 事件触发）；价格走 prices_snapshot/prices_diff（2s tick，仅活跃 task 涉及的 token）；链上数据走 chain_data_snapshot/chain_data_diff（3s tick，按 taskId 字段级 diff，含池子状态/钱包余额/仓位/手续费）；25s 心跳。

**Query 参数:**
- `user_id` (string): 管理员可选，按用户 telegram_id 过滤

**响应:**
```json
"event: snapshot  data: { count, tasks: Task[], timestamp }\\nevent: diff  data: { set: Task[], remove: number[], count, timestamp }\\nevent: prices_snapshot  data: { prices: { \"56:0x...\": 0.123, ... }, timestamp }\\nevent: prices_diff  data: { set: { \"56:0x...\": 0.124 }, remove: [\"56:0x...\"], timestamp }\\nevent: chain_data_snapshot  data: { data: ChainItem[], timestamp }\\nevent: chain_data_diff  data: { set: ChainItem[], remove: number[], timestamp }\\nevent: error  data: { error }"
```

### GET /api/tasks
获取所有任务列表

> 响应字段使用 camelCase；运行中的任务会返回实时健康状态，未运行任务对应字段为 null/默认值。

**响应:**
```json
{
  "success": true,
  "count": 2,
  "tasks": [
    {
      "id": 1,
      "name": "[W]主钱包-UniswapV3-USDT-WBNB-0.05%",
      "walletAddress": "0x...",
      "poolAddress": "0x...",
      "platform": "Uniswap V3",
      "platformId": 1,
      "chainId": 56,
      "tickRange": 3,
      "tickRangeLower": null,
      "tickRangeUpper": null,
      "slippage": 1.5,
      "nftId": "123456",
      "status": "running",
      "isRunning": true,
      "checkInterval": 1000,
      "maxOutOfRangeCount": 15,
      "withdrawAction": "token0",
      "fixedAmountUsd": null,
      "token0": "0x55d398326f99059ff775485246999027b3197955",
      "token1": "0xbb4cdb9cbd36b01bd1cbaebf2de08d9173bc095c",
      "token0Symbol": "USDT",
      "token1Symbol": "WBNB",
      "token0Price": 1,
      "token1Price": 620.45,
      "token0Logo": "https://...",
      "token1Logo": "https://...",
      "outOfRangeAction": "rebalance",
      "monitorToken": null,
      "basePrice": null,
      "stopLossPercent": null,
      "takeProfitPercent": null,
      "slTpTriggerCount": 10,
      "outOfRange": "0/15",
      "uptime": "2h 30m",
      "lastSuccess": "5秒前",
      "consecutiveFailures": 0,
      "lastError": null,
      "user": {
        "id": 12,
        "telegramId": "123456789",
        "username": "alice",
        "firstName": "Alice",
        "lastName": null,
        "note": "VIP"
      },
      "createdAt": 1708000000000,
      "updatedAt": 1708003600000
    }
  ],
  "timestamp": "2026-02-27T08:00:00.000Z"
}
```

### GET /api/tasks/running
获取所有运行中的任务

> 仅返回运行态任务；结构与 /api/tasks 接近，但包含 positionManager / poolManager / uptimeMs。

**响应:**
```json
{
  "success": true,
  "count": 1,
  "tasks": [
    {
      "id": 1,
      "name": "[W]主钱包-UniswapV3-USDT-WBNB-0.05%",
      "walletAddress": "0x...",
      "poolAddress": "0x...",
      "platform": "Uniswap V3",
      "platformId": 1,
      "chainId": 56,
      "positionManager": "0x...",
      "poolManager": "0x...",
      "tickRange": 3,
      "tickRangeLower": null,
      "tickRangeUpper": null,
      "slippage": 1.5,
      "nftId": "123456",
      "status": "running",
      "monitoringPaused": false,
      "uptime": "2h 30m",
      "uptimeMs": 9000000,
      "lastSuccess": "5秒前",
      "consecutiveFailures": 0,
      "outOfRange": "0/15",
      "lastError": null,
      "checkInterval": 1000,
      "maxOutOfRangeCount": 15,
      "withdrawAction": "token0",
      "fixedAmountUsd": null,
      "token0": "0x55d398326f99059ff775485246999027b3197955",
      "token1": "0xbb4cdb9cbd36b01bd1cbaebf2de08d9173bc095c",
      "token0Symbol": "USDT",
      "token1Symbol": "WBNB",
      "token0Price": 1,
      "token1Price": 620.45,
      "token0Logo": "https://...",
      "token1Logo": "https://...",
      "outOfRangeAction": "rebalance",
      "monitorToken": null,
      "basePrice": null,
      "stopLossPercent": null,
      "takeProfitPercent": null,
      "user": {
        "id": 12,
        "telegramId": "123456789",
        "username": "alice",
        "firstName": "Alice",
        "lastName": null,
        "note": "VIP"
      },
      "createdAt": 1708000000000
    }
  ],
  "timestamp": "2026-02-27T08:00:00.000Z"
}
```

### GET /api/tasks/:taskId
获取单个任务详情

> health 仅在 isRunning=true 时返回对象，否则为 null。

**响应:**
```json
{
  "success": true,
  "task": {
    "id": 1,
    "name": "[W]主钱包-UniswapV3-USDT-WBNB-0.05%",
    "walletAddress": "0x...",
    "poolAddress": "0x...",
    "platform": "Uniswap V3",
    "platformId": 1,
    "chainId": 56,
    "tickRange": 3,
    "tickRangeLower": null,
    "tickRangeUpper": null,
    "slippage": 1.5,
    "checkInterval": 1000,
    "maxOutOfRangeCount": 15,
    "nftId": "123456",
    "withdrawAction": "token0",
    "fixedAmountUsd": null,
    "token0": "0x55d398326f99059ff775485246999027b3197955",
    "token1": "0xbb4cdb9cbd36b01bd1cbaebf2de08d9173bc095c",
    "token0Symbol": "USDT",
    "token1Symbol": "WBNB",
    "outOfRangeAction": "rebalance",
    "monitorToken": null,
    "basePrice": null,
    "stopLossPercent": null,
    "takeProfitPercent": null,
    "slTpTriggerCount": 10,
    "status": "running",
    "isRunning": true,
    "monitoringPaused": false,
    "health": {
      "uptime": "2h 30m",
      "uptimeMs": 9000000,
      "lastSuccess": "5秒前",
      "lastSuccessMs": 5000,
      "consecutiveFailures": 0,
      "outOfRange": "0/15",
      "lastError": "无",
      "hasError": false,
      "checkIntervalMs": 1000,
      "checkIntervalText": "1秒",
      "currentNFTId": "123456"
    },
    "createdAt": 1708000000000,
    "updatedAt": 1708003600000
  },
  "timestamp": "2026-02-27T08:00:00.000Z"
}
```

### POST /api/tasks
创建 LP 任务（创建后需手动启动）

**Body 参数 (JSON):**
- `poolAddress` (string, **必填**): 池子合约地址
- `presetKeyId` (number, **必填**): 钱包 ID（从 GET /api/preset-keys 获取）
- `tickRange` (number): 价格范围 %（默认 3）
- `tickRangeLower` (number): 非对称下限 %
- `tickRangeUpper` (number): 非对称上限 %
- `slippage` (number): 滑点 %（默认 1.5）
- `checkInterval` (number): 检查间隔 ms（默认 1000）
- `maxOutOfRangeCount` (number): 超范围阈值（默认 15）
- `fixedAmountUsd` (number): 固定投入 USD（不传=全部余额）
- `withdrawAction` (string): token0 / token1 / none（none=保持双币，keep 同义；不传则自动识别稳定币侧）
- `outOfRangeAction` (string): rebalance / withdraw
- `chainId` (number): 链 ID（默认 56）

**响应:**
```json
{
  "success": true,
  "taskId": 5,
  "message": "任务创建成功"
}
```

### POST /api/tasks/:taskId/start
启动任务

**响应:**
```json
{
  "success": true,
  "message": "任务已启动"
}
```

### POST /api/tasks/:taskId/stop
停止任务（保留 LP 仓位）

**响应:**
```json
{
  "success": true,
  "message": "任务已停止"
}
```

### POST /api/tasks/:taskId/pause
暂停任务监控

**响应:**
```json
{
  "success": true,
  "message": "任务已暂停"
}
```

### POST /api/tasks/:taskId/resume
恢复已暂停任务

**响应:**
```json
{
  "success": true,
  "message": "任务已恢复运行"
}
```

### POST /api/tasks/:taskId/stop-withdraw
停止并撤出全部流动性

**响应:**
```json
{
  "success": true,
  "message": "任务已停止并撤池",
  "withdraw": {
    "hash": "0x...",
    "nftId": "123456"
  },
  "swap": {
    "success": true,
    "txHash": "0x...",
    "fromSymbol": "WBNB",
    "toSymbol": "USDT"
  }
}
```

### PATCH /api/tasks/:taskId
更新任务配置（运行中会自动暂停再恢复）

**Body 参数 (JSON):**
- `tick_range` (number): 价格范围 %
- `tick_range_lower` (number): 非对称下限 %
- `tick_range_upper` (number): 非对称上限 %
- `slippage` (number): 滑点 %
- `check_interval` (number): 检查间隔 ms
- `max_out_of_range_count` (number): 超范围阈值
- `withdraw_action` (string): token0 / token1 / none（none=保持双币，keep 同义）
- `out_of_range_action` (string): rebalance / withdraw
- `monitor_token` (string): 止损止盈监控: token0 / token1 / null
- `stop_loss_percent` (number): 止损 %（null 关闭）
- `take_profit_percent` (number): 止盈 %（null 关闭）

**响应:**
```json
{
  "success": true,
  "message": "配置已更新",
  "wasRunning": true,
  "resumed": true
}
```

### DELETE /api/tasks/:taskId
删除任务（运行中自动停止）

**响应:**
```json
{
  "success": true,
  "message": "任务已删除"
}
```

### POST /api/tasks/batch-delete
批量删除任务

**Body 参数 (JSON):**
- `taskIds` (number[], **必填**): 任务 ID 数组

**响应:**
```json
{
  "success": true,
  "message": "已删除 3 个任务",
  "deletedCount": 3,
  "stoppedCount": 1
}
```

### POST /api/tasks/:taskId/rebalance
手动触发重新平衡

**响应:**
```json
{
  "success": true,
  "message": "调仓已触发"
}
```

### POST /api/tasks/:taskId/reinvest
复投手续费/余额到仓位

**Body 参数 (JSON):**
- `mode` (string, **必填**): token0 / token1 / both / custom / usd
- `customAmounts` (object): { amount0, amount1 }（custom 模式）
- `usdAmount` (number): USD 金额（usd 模式）

**响应:**
```json
{
  "success": true,
  "message": "复投成功",
  "hash": "0x...",
  "liquidity": "123456789"
}
```

### GET /api/tasks/:taskId/reinvest-info
获取复投信息（余额 + 手续费 + USD）

**响应:**
```json
{
  "success": true,
  "walletAddress": "0x...",
  "token0": {
    "symbol": "USDT",
    "formatted": "100.5",
    "price": 1,
    "usd": 100.5
  },
  "token1": {
    "symbol": "WBNB",
    "formatted": "0.15",
    "price": 620,
    "usd": 93
  }
}
```

### POST /api/tasks/:taskId/migrate
迁移任务到新池子

**Body 参数 (JSON):**
- `newPoolAddress` (string, **必填**): 新池子地址
- `newPlatform` (number): 平台 ID（可选，自动检测）

**响应:**
```json
{
  "success": true,
  "message": "换池成功",
  "oldTaskId": 1,
  "newTaskId": 2,
  "newTaskStarted": true,
  "configCopied": true
}
```


## 钱包管理

### GET /api/preset-keys
获取预设钱包列表

**Query 参数:**
- `token0` (string): Token0 地址（附带余额查询）
- `token1` (string): Token1 地址（附带余额查询）
- `chainId` (number): 链 ID（默认 56）
- `includeNative` (string): "1" 包含原生代币余额

**响应:**
```json
{
  "success": true,
  "keys": [
    {
      "id": 1,
      "name": "主钱包",
      "address": "0x...",
      "helperContract": "0x...",
      "balances": {
        "token0": {
          "symbol": "USDT",
          "formatted": "100.0"
        },
        "token1": {
          "symbol": "WBNB",
          "formatted": "0.5"
        }
      },
      "nativeBalance": {
        "symbol": "BNB",
        "formatted": "0.1"
      }
    }
  ]
}
```

### POST /api/preset-keys
添加预设钱包

**Body 参数 (JSON):**
- `name` (string, **必填**): 钱包名称
- `privateKey` (string, **必填**): 私钥（加密存储）

**响应:**
```json
{
  "success": true,
  "key": {
    "id": 1,
    "name": "我的钱包",
    "address": "0x..."
  }
}
```

### PATCH /api/preset-keys/:keyId
更新钱包名称

**Body 参数 (JSON):**
- `name` (string, **必填**): 新名称

**响应:**
```json
{
  "success": true
}
```

### DELETE /api/preset-keys/:keyId
删除预设钱包

**响应:**
```json
{
  "success": true
}
```

### GET /api/wallets/:address/balances
查询钱包代币余额

**Query 参数:**
- `tokens` (string): 额外代币地址，逗号分隔
- `chainId` (number): 链 ID（默认 56）

**响应:**
```json
{
  "success": true,
  "address": "0x...",
  "balances": [
    {
      "address": "0x...",
      "symbol": "USDT",
      "decimals": 18,
      "formattedBalance": "100.5",
      "priceUsd": 1,
      "valueUsd": 100.5
    }
  ],
  "totalValueUsd": 1234.56
}
```

### GET /api/wallets/:address/positions
查询 LP NFT 仓位

**Query 参数:**
- `limit` (number): 数量（默认 20）
- `chainId` (number): 链 ID（默认 56）

**响应:**
```json
{
  "success": true,
  "positions": [
    {
      "nftId": "123",
      "poolAddress": "0x...",
      "platform": "Uniswap V3",
      "token0": "0x...",
      "token1": "0x...",
      "fee": 3000,
      "liquidity": "999999",
      "amount0": "100.5",
      "amount1": "0.15"
    }
  ],
  "total": 5
}
```

### POST /api/wallets/transfer
转账代币

**Body 参数 (JSON):**
- `presetKeyId` (number, **必填**): 钱包 ID
- `toAddress` (string, **必填**): 目标地址
- `tokenAddress` (string, **必填**): 代币地址（原生币用 0xEeee...EEeE）
- `amount` (string, **必填**): 数量
- `chainId` (number): 链 ID（默认 56）
- `idempotencyKey` (string, **必填**): 客户端生成的唯一请求标识

**响应:**
```json
{
  "success": true,
  "hash": "0x...",
  "from": "0x...",
  "to": "0x...",
  "amount": "10.5",
  "symbol": "USDT"
}
```


## 仓位操作

### POST /api/positions/collect-fees
收取仓位手续费

**Body 参数 (JSON):**
- `presetKeyId` (number, **必填**): 钱包 ID
- `nftId` (string, **必填**): NFT ID
- `protocol` (string, **必填**): uniswap / pancakeswap
- `version` (string): v3 / v4（默认 v3）
- `chainId` (number): 链 ID（默认 56）

**响应:**
```json
{
  "success": true,
  "hash": "0x...",
  "amount0": "1.5",
  "amount1": "0.001"
}
```

### POST /api/positions/remove-liquidity
移除仓位流动性

**Body 参数 (JSON):**
- `presetKeyId` (number, **必填**): 钱包 ID
- `nftId` (string, **必填**): NFT ID
- `protocol` (string, **必填**): uniswap / pancakeswap
- `percent` (number): 移除比例 1-100（默认 100）
- `version` (string): v3 / v4（默认 v3）
- `slippage` (number): 滑点 %
- `chainId` (number): 链 ID（默认 56）

**响应:**
```json
{
  "success": true,
  "hash": "0x...",
  "amount0": "100.5",
  "amount1": "0.15"
}
```


## Swap

### POST /api/swap/quote
获取 Swap 报价

**Body 参数 (JSON):**
- `presetKeyId` (number, **必填**): 钱包 ID
- `fromToken` (string, **必填**): 源代币地址
- `toToken` (string, **必填**): 目标代币地址
- `amount` (number, **必填**): 数量
- `slippage` (number): 滑点 %（默认 1）
- `chainId` (number): 链 ID（默认 56）
- `idempotencyKey` (string, **必填**): 客户端生成的唯一请求标识

**响应:**
```json
{
  "success": true,
  "quote": {
    "fromToken": {
      "symbol": "USDT",
      "amount": "100.5"
    },
    "toToken": {
      "symbol": "WBNB",
      "amount": "0.167"
    },
    "priceImpact": 0.05,
    "estimatedGas": "200000"
  }
}
```

### POST /api/swap/execute
执行 Swap 交易

**Body 参数 (JSON):**
- `presetKeyId` (number, **必填**): 钱包 ID
- `fromToken` (string, **必填**): 源代币地址
- `toToken` (string, **必填**): 目标代币地址
- `amount` (number, **必填**): 数量
- `slippage` (number): 滑点 %（默认 1）
- `chainId` (number): 链 ID（默认 56）

**响应:**
```json
{
  "success": true,
  "txHash": "0x...",
  "fromAmount": "100.5",
  "toAmount": "0.167",
  "fromSymbol": "USDT",
  "toSymbol": "WBNB"
}
```


## 池子与市场

### GET /api/pools/info
获取池子详情

**Query 参数:**
- `address` (string, **必填**): 池子合约地址

**响应:**
```json
{
  "success": true,
  "pool": {
    "address": "0x...",
    "chainId": 56,
    "platformName": "Uniswap V3",
    "token0Symbol": "USDT",
    "token1Symbol": "WBNB",
    "fee": 3000,
    "feePercent": 0.3,
    "currentPrice": 620.5,
    "currentTick": 202000
  }
}
```

### POST /api/pools/create
创建新池子

**Body 参数 (JSON):**
- `platform` (string, **必填**): uniswap / pancakeswap
- `token0` (string, **必填**): Token0 地址
- `token1` (string, **必填**): Token1 地址
- `feePercent` (string, **必填**): "0.01"/"0.05"/"0.25"/"0.3"/"1"
- `presetKeyId` (number, **必填**): 钱包 ID
- `chainId` (number): 链 ID（默认 56）
- `tickSpacing` (number): V4 自定义 tick spacing（正整数，留空=max(1,floor(fee/50)) 自动；V3 忽略）

**响应:**
```json
{
  "success": true,
  "result": {
    "hash": "0x...",
    "poolAddress": "0x...",
    "platformVersion": 3
  },
  "logs": [
    "..."
  ]
}
```

### POST /api/pools/quick-liquidity
快速添加流动性（一次性，不创建任务）

**Body 参数 (JSON):**
- `poolAddress` (string, **必填**): 池子地址
- `presetKeyId` (number, **必填**): 钱包 ID
- `amountUsd` (number, **必填**): USD 金额（最大 100）
- `tickRange` (number, **必填**): 价格范围 %（最大 200）
- `mintPlatform` (number): 平台 ID（1=UniV3 2=PCSV3 4=UniV4 5=PCSV4）
- `chainId` (number): 链 ID（默认 56）

**响应:**
```json
{
  "success": true,
  "hash": "0x...",
  "nftId": "123456",
  "liquidity": "999999"
}
```

### POST /api/okx/price
获取代币 USD 价格

**Body 参数 (JSON):**
- `tokens` (string[], **必填**): 代币地址数组
- `chainIndex` (string): 链索引（默认 "56"）

**响应:**
```json
{
  "success": true,
  "data": {
    "0x55d3...": {
      "price": 1,
      "time": "1716892020000"
    }
  }
}
```

### GET /api/market/candles
获取 K 线数据

**Query 参数:**
- `token` (string, **必填**): 代币地址
- `bar` (string): 周期: 1m/5m/15m/1H/4H/1D（默认 1H）
- `limit` (number): 数量（默认 100，最大 299）
- `chainId` (number): 链 ID（默认 56）

**响应:**
```json
{
  "success": true,
  "data": [
    {
      "o": "620.1",
      "h": "625.0",
      "l": "618.0",
      "c": "622.3",
      "v": "50000",
      "ts": "1700000000000"
    }
  ]
}
```

### GET /api/tokens/:address
获取代币信息

**Query 参数:**
- `chainId` (number): 链 ID（默认 56）

**响应:**
```json
{
  "success": true,
  "token": {
    "address": "0x...",
    "symbol": "USDT",
    "name": "Tether USD",
    "decimals": 18,
    "logoUrl": "https://..."
  }
}
```

### GET /api/pools/top-fees/:minutes
高手续费池子排行

> :minutes 为统计窗口，支持 1/5/15/30/60（分钟）。前端"池子发现"页面使用此接口。

**Query 参数:**
- `chain` (string, **必填**): 链名称：bsc / base
- `dex` (string, **必填**): DEX 过滤，逗号分隔：pcsv3,univ3,pcsv4,univ4

**响应:**
```json
{
  "success": true,
  "data": [
    {
      "pool_address": "0x...",
      "trading_pair": "TOKEN/WBNB",
      "token0_symbol": "TOKEN",
      "token1_symbol": "WBNB",
      "token0_address": "0x...",
      "token1_address": "0xbb4CdB...",
      "factory_name": "PancakeSwap V3",
      "fee_percentage": 0.25,
      "total_fees": 1250.5,
      "total_volume": 500000,
      "transaction_count": 320,
      "current_pool_value": 85000,
      "current_token_price": 0.0523,
      "current_token_fdv_usd": 5200000,
      "current_token0_balance": 1000000,
      "current_token1_balance": 25.5,
      "hook_address": null
    }
  ]
}
```

### GET /api/pools/by-token/:address
按代币地址搜索相关池子

> 返回该代币相关的所有池子及手续费/交易量数据。

**Query 参数:**
- `chain` (string, **必填**): 链名称：bsc / base
- `dex` (string, **必填**): DEX 过滤，逗号分隔：pcsv3,univ3,pcsv4,univ4

**响应:**
```json
{
  "success": true,
  "data": [
    {
      "pool_address": "0x...",
      "token0_symbol": "TOKEN",
      "token1_symbol": "WBNB",
      "token0_address": "0x...",
      "token1_address": "0xbb4CdB...",
      "factory_name": "Uniswap V3",
      "fee_percentage": 0.3,
      "fees_5min": 120,
      "fees_1h": 800,
      "volume_5min": 50000,
      "volume_1h": 350000,
      "tx_count_5min": 45,
      "tx_count_1h": 280,
      "pool_usd_value": 65000,
      "token_usd_price": 0.0523,
      "token_fdv_usd": 5200000
    }
  ]
}
```

### GET /api/pools/liquidity/:poolAddress
池子流动性 Tick 分布

> 返回池子各 tick 区间的流动性分布，用于可视化流动性热力图。V4 池子需传 dex 和 tickSpacing 参数。

**Query 参数:**
- `range` (number): tick 区间数量（默认 15，5-50）
- `chain` (string): 链名称：bsc / base（默认 bsc）
- `dex` (string): V4 池子必传：univ4 / pcsv4
- `tickSpacing` (number): V4 池子必传：tick 间距
- `decimals0` (number): Token0 精度（默认 18）
- `decimals1` (number): Token1 精度（默认 18）

**响应:**
```json
{
  "success": true,
  "ticks": [
    {
      "tickIdx": -200,
      "liquidityNet": "999999",
      "price0": "620.5",
      "price1": "0.00161"
    }
  ],
  "currentTick": -199,
  "tickSpacing": 60
}
```


## 统计与日志

### GET /api/stats
系统统计信息

**响应:**
```json
{
  "success": true,
  "stats": {
    "totalTasks": 15,
    "runningTasks": 5,
    "pausedTasks": 2,
    "stoppedTasks": 8
  }
}
```

### GET /api/stats/stream
系统统计 + 推荐池子 合并 SSE 推送。stats 走 snapshot/update（事件总线触发 + 25s 心跳）；推荐池子走 rec_pools_snapshot（5s tick，浅 hash 不变不推）。客户端建议用 fetch-event-source（支持 Authorization header）。

**Query 参数:**
- `user_id` (string): 管理员可选，按用户 telegram_id 过滤
- `chain` (string): 推荐池子链过滤（bsc / base / eth / robinhood，逗号分隔）。不传则只推 stats，不推荐池子。
- `limit` (number): 推荐池子条数（默认 3，最大 20）

**响应:**
```json
"event: snapshot|update\\ndata: { \"stats\": {...}, \"timestamp\": \"...\" }\\nevent: rec_pools_snapshot\\ndata: { \"pools\": [...], \"ts\": 123 }"
```

### GET /api/activity-logs
活动日志

**Query 参数:**
- `limit` (number): 数量（默认 500）

**响应:**
```json
{
  "success": true,
  "count": 100,
  "logs": [
    "..."
  ]
}
```

### GET /api/activity-logs/task/:taskId
任务活动日志

**Query 参数:**
- `limit` (number): 数量（默认 100）

**响应:**
```json
{
  "success": true,
  "count": 50,
  "logs": [
    "..."
  ]
}
```

### GET /api/cooldown
查询冷静期状态

**响应:**
```json
{
  "success": true,
  "cooldownUntil": 1700003600000
}
```

### POST /api/cooldown
设置冷静期

**Body 参数 (JSON):**
- `durationMs` (number, **必填**): 持续时间 ms（最长 7 天）

**响应:**
```json
{
  "success": true,
  "cooldownUntil": 1700003600000
}
```


## 配置模板

### GET /api/config-templates
获取模板列表

**响应:**
```json
{
  "success": true,
  "templates": [
    {
      "id": 1,
      "name": "保守策略",
      "slippage": 1,
      "checkInterval": 3000,
      "maxOutOfRangeCount": 20,
      "isDefault": true
    }
  ]
}
```

### POST /api/config-templates
创建模板

**Body 参数 (JSON):**
- `name` (string, **必填**): 模板名称
- `slippage` (number): 滑点 %（默认 1.5）
- `checkInterval` (number): 检查间隔 ms（默认 1000）
- `maxOutOfRangeCount` (number): 超范围阈值（默认 15）

**响应:**
```json
{
  "success": true,
  "templateId": 2
}
```

### PUT /api/config-templates/:id
更新模板

**Body 参数 (JSON):**
- `name` (string): 模板名称
- `slippage` (number): 滑点 %
- `checkInterval` (number): 检查间隔 ms
- `maxOutOfRangeCount` (number): 超范围阈值

**响应:**
```json
{
  "success": true
}
```

### DELETE /api/config-templates/:id
删除模板

**响应:**
```json
{
  "success": true
}
```

### PUT /api/config-templates/:id/default
设为默认模板

**响应:**
```json
{
  "success": true
}
```


## 开发者 Key

### GET /api/developer-keys
获取当前 Key（仅前缀）

**响应:**
```json
{
  "success": true,
  "keys": [
    {
      "id": 1,
      "key_prefix": "lp_sk_a3",
      "key_name": "default",
      "last_used_at": "2026-02-25 11:00:00",
      "created_at": "2026-02-20 10:00:00"
    }
  ]
}
```

### POST /api/developer-keys
创建 Key（每用户限 1 个）

**响应:**
```json
{
  "success": true,
  "key": {
    "id": 1,
    "apiKey": "lp_sk_a3b4c5...(完整 Key 仅此一次)",
    "prefix": "lp_sk_a3"
  }
}
```

### DELETE /api/developer-keys/:keyId
删除 Key（立即失效）

**响应:**
```json
{
  "success": true,
  "message": "API Key 已删除"
}
```


## 池子监控

### GET /api/pool-monitors
获取监控列表

**响应:**
```json
{
  "success": true,
  "count": 2,
  "monitors": [
    {
      "id": 1,
      "name": "My Monitor",
      "chain": "bsc",
      "isActive": true,
      "notificationUrl": "https://...",
      "conditions": {}
    }
  ]
}
```

### POST /api/pool-monitors
创建池子监控

**Body 参数 (JSON):**
- `name` (string, **必填**): 监控名称
- `chain` (string): bsc / base / eth / robinhood / all（默认 bsc）
- `notificationUrl` (string): 通知回调 URL
- `notificationMethod` (string): GET / POST（默认 GET）
- `notificationBody` (string): POST 请求体模板
- `conditions` (object): 触发条件

**响应:**
```json
{
  "success": true,
  "monitorId": 1,
  "message": "监控已创建"
}
```

### PATCH /api/pool-monitors/:monitorId
更新监控配置

**响应:**
```json
{
  "success": true,
  "message": "监控已更新"
}
```

### DELETE /api/pool-monitors/:monitorId
删除监控

**响应:**
```json
{
  "success": true,
  "message": "监控已删除"
}
```

### POST /api/pool-monitors/test-notification
发送测试通知

**Body 参数 (JSON):**
- `notificationUrl` (string, **必填**): 通知 URL
- `notificationMethod` (string): GET / POST

**响应:**
```json
{
  "success": true,
  "message": "测试通知已发送"
}
```

### GET /api/notifications
推送消息历史（与 TG 推送同源：任务/策略/监控通知，仅本人）

**Query 参数:**
- `limit` (number): 数量（默认与上限均为 100）

**响应:**
```json
{
  "success": true,
  "notifications": [
    {
      "id": 1,
      "category": "manual_op",
      "title": "🔴 任务已停止",
      "body": "任务: ...",
      "taskId": 7,
      "taskName": "...",
      "time": 1755054000000
    }
  ]
}
```

### DELETE /api/notifications
清空自己的推送消息历史

**响应:**
```json
{
  "success": true
}
```

### GET /api/pool-notifications
通知历史

**Query 参数:**
- `limit` (number): 数量（默认 50）

**响应:**
```json
{
  "success": true,
  "count": 10,
  "notifications": [
    {
      "id": 1,
      "monitorName": "...",
      "poolAddress": "0x...",
      "tradingPair": "USDT/WBNB",
      "volume": 50000,
      "feeRate": 12.5
    }
  ]
}
```


## 用户反馈

### POST /api/feedback
提交反馈（60s 内最多 3 条）

**Body 参数 (JSON):**
- `type` (string): bug / feature / other（默认 other）
- `content` (string, **必填**): 反馈内容（最多 2000 字）

**响应:**
```json
{
  "success": true,
  "feedbackId": 1
}
```

### GET /api/feedback
我的反馈列表（含管理员回复与处理状态）

> status: open 待处理 / replied 已回复 / closed 已关闭

**响应:**
```json
{
  "success": true,
  "count": 1,
  "feedbacks": [
    {
      "id": 1,
      "type": "bug",
      "content": "...",
      "status": "replied",
      "admin_reply": "...",
      "replied_at": "2026-08-09 12:00:00",
      "created_at": "2026-08-09 10:00:00"
    }
  ]
}
```
