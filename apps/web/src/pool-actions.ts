import {
  poolActionIntentSchemaVersion,
  type EvmAddress,
  type MarketPoolRow,
  type PoolActionIntent,
  type PoolActionIntentAction,
  type PoolBlocklistEntry,
} from "@lpbot/api-contract";

const addressPattern = /^0x[0-9a-f]{40}$/u;
const poolIdPattern = /^0x[0-9a-f]{64}$/u;
const poolKeyPattern = /^56:0x(?:[0-9a-f]{40}|[0-9a-f]{64})$/u;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export const poolActionCommandIds = [
  "expand-market",
  "copy-pool-address",
  "copy-token0-address",
  "copy-token1-address",
  "search-token0-pools",
  "search-token1-pools",
  "view-pool-flow",
  "view-token0-flow",
  "view-token1-flow",
  "block-pool",
  "block-token0",
  "block-token1",
  "create-task",
  "create-monitor",
  "share-chat",
] as const;

export type PoolActionCommandId = (typeof poolActionCommandIds)[number];
export type PoolActionCommandSection = "inspect" | "discover" | "block" | "prefill";

export interface PoolActionCommandDefinition {
  id: PoolActionCommandId;
  label: string;
  section: PoolActionCommandSection;
}

export const poolActionCommandRegistry: readonly PoolActionCommandDefinition[] = [
  { id: "expand-market", label: "展开 K 线 / Tick", section: "inspect" },
  { id: "copy-pool-address", label: "复制池地址", section: "inspect" },
  { id: "copy-token0-address", label: "复制 token0 地址", section: "inspect" },
  { id: "copy-token1-address", label: "复制 token1 地址", section: "inspect" },
  { id: "search-token0-pools", label: "搜索 token0 同 Token 池", section: "discover" },
  { id: "search-token1-pools", label: "搜索 token1 同 Token 池", section: "discover" },
  { id: "view-pool-flow", label: "查看池流动性动向", section: "discover" },
  { id: "view-token0-flow", label: "查看 token0 流动性动向", section: "discover" },
  { id: "view-token1-flow", label: "查看 token1 流动性动向", section: "discover" },
  { id: "block-pool", label: "屏蔽池", section: "block" },
  { id: "block-token0", label: "屏蔽 token0", section: "block" },
  { id: "block-token1", label: "屏蔽 token1", section: "block" },
  { id: "create-task", label: "创建任务", section: "prefill" },
  { id: "create-monitor", label: "创建监控", section: "prefill" },
  { id: "share-chat", label: "分享到聊天室", section: "prefill" },
];

export interface PoolActionCapabilities {
  chatPrefill: boolean;
  clipboard: boolean;
  liquidityFlow: boolean;
  monitorPrefill: boolean;
  taskPrefill: boolean;
}

const defaultCapabilities: PoolActionCapabilities = {
  chatPrefill: true,
  clipboard: true,
  liquidityFlow: true,
  monitorPrefill: false,
  taskPrefill: true,
};

export type PoolActionResult =
  | { kind: "toggle-detail" }
  | { kind: "copy"; value: EvmAddress }
  | { address: EvmAddress; kind: "search-token" }
  | { field: "pool" | "token"; identity: string; kind: "filter-flow" }
  | { entry: PoolBlocklistEntry; kind: "block" }
  | { intent: PoolActionIntent; kind: "navigate"; to: string }
  | { intent: PoolActionIntent; kind: "chat-intent" };

export type ResolvedPoolAction =
  { enabled: true; result: PoolActionResult } | { enabled: false; reason: string };

function canonicalAddress(value: string | null): EvmAddress | null | undefined {
  if (value === null) return null;
  return addressPattern.test(value) ? (value as EvmAddress) : undefined;
}

function canonicalPool(row: MarketPoolRow): {
  poolAddress: EvmAddress | null;
  poolId: `0x${string}` | null;
  poolKey: `56:0x${string}`;
} | null {
  if (row.chainId !== 56 || !poolKeyPattern.test(row.poolKey)) return null;
  const isV3 = row.protocol === "pcsv3" || row.protocol === "univ3";
  if (isV3) {
    if (!row.poolAddress || !addressPattern.test(row.poolAddress) || row.poolId !== null)
      return null;
    if (row.poolKey !== `56:${row.poolAddress}`) return null;
    return {
      poolAddress: row.poolAddress,
      poolId: null,
      poolKey: row.poolKey as `56:0x${string}`,
    };
  }
  if (!row.poolId || !poolIdPattern.test(row.poolId) || row.poolAddress !== null) return null;
  if (row.poolKey !== `56:${row.poolId}`) return null;
  return { poolAddress: null, poolId: row.poolId, poolKey: row.poolKey as `56:0x${string}` };
}

export function createPoolActionIntent(
  row: MarketPoolRow,
  action: PoolActionIntentAction,
): PoolActionIntent | null {
  const pool = canonicalPool(row);
  const token0Address = canonicalAddress(row.token0Address);
  const token1Address = canonicalAddress(row.token1Address);
  if (!pool || token0Address === undefined || token1Address === undefined) return null;
  return {
    action,
    chainId: 56,
    poolAddress: pool.poolAddress,
    poolId: pool.poolId,
    poolKey: pool.poolKey,
    schemaVersion: poolActionIntentSchemaVersion,
    token0Address,
    token1Address,
  };
}

export function parsePoolActionIntent(value: unknown): PoolActionIntent | null {
  if (!isRecord(value)) return null;
  const expected = [
    "action",
    "chainId",
    "poolAddress",
    "poolId",
    "poolKey",
    "schemaVersion",
    "token0Address",
    "token1Address",
  ];
  const keys = Object.keys(value).sort();
  if (
    keys.length !== expected.length ||
    !expected.sort().every((key, index) => keys[index] === key) ||
    value.schemaVersion !== poolActionIntentSchemaVersion ||
    value.chainId !== 56 ||
    (value.action !== "create-task" &&
      value.action !== "create-monitor" &&
      value.action !== "share-chat") ||
    typeof value.poolKey !== "string" ||
    !poolKeyPattern.test(value.poolKey)
  ) {
    return null;
  }
  const poolAddress = canonicalAddress(
    typeof value.poolAddress === "string" || value.poolAddress === null
      ? value.poolAddress
      : "invalid",
  );
  const token0Address = canonicalAddress(
    typeof value.token0Address === "string" || value.token0Address === null
      ? value.token0Address
      : "invalid",
  );
  const token1Address = canonicalAddress(
    typeof value.token1Address === "string" || value.token1Address === null
      ? value.token1Address
      : "invalid",
  );
  const poolId =
    value.poolId === null
      ? null
      : typeof value.poolId === "string" && poolIdPattern.test(value.poolId)
        ? value.poolId
        : undefined;
  if (
    poolAddress === undefined ||
    token0Address === undefined ||
    token1Address === undefined ||
    poolId === undefined ||
    (poolAddress === null) === (poolId === null) ||
    value.poolKey !== `56:${poolAddress ?? poolId}`
  ) {
    return null;
  }
  return value as unknown as PoolActionIntent;
}

function unavailableToken(side: 0 | 1): ResolvedPoolAction {
  return { enabled: false, reason: `token${side} 地址不可用` };
}

function tokenAddress(row: MarketPoolRow, side: 0 | 1): EvmAddress | null {
  const value = side === 0 ? row.token0Address : row.token1Address;
  return value !== null && addressPattern.test(value) ? value : null;
}

export function resolvePoolAction(
  row: MarketPoolRow,
  commandId: PoolActionCommandId,
  capabilities: Partial<PoolActionCapabilities> = {},
): ResolvedPoolAction {
  const available = { ...defaultCapabilities, ...capabilities };
  const pool = canonicalPool(row);
  if (commandId === "expand-market") {
    return pool
      ? { enabled: true, result: { kind: "toggle-detail" } }
      : { enabled: false, reason: "池身份不可用" };
  }
  if (commandId === "copy-pool-address") {
    if (!available.clipboard) return { enabled: false, reason: "剪贴板不可用" };
    if (!pool) return { enabled: false, reason: "池身份不可用" };
    return pool.poolAddress
      ? { enabled: true, result: { kind: "copy", value: pool.poolAddress } }
      : { enabled: false, reason: "V4 池没有可复制的池地址" };
  }
  if (commandId === "copy-token0-address" || commandId === "copy-token1-address") {
    if (!available.clipboard) return { enabled: false, reason: "剪贴板不可用" };
    const side = commandId === "copy-token0-address" ? 0 : 1;
    const address = tokenAddress(row, side);
    return address
      ? { enabled: true, result: { kind: "copy", value: address } }
      : unavailableToken(side);
  }
  if (commandId === "search-token0-pools" || commandId === "search-token1-pools") {
    const side = commandId === "search-token0-pools" ? 0 : 1;
    const address = tokenAddress(row, side);
    return address
      ? { enabled: true, result: { address, kind: "search-token" } }
      : unavailableToken(side);
  }
  if (commandId === "view-pool-flow") {
    if (!available.liquidityFlow) return { enabled: false, reason: "流动性动向模块暂不可用" };
    if (!pool) return { enabled: false, reason: "池身份不可用" };
    return {
      enabled: true,
      result: { field: "pool", identity: pool.poolAddress ?? pool.poolId!, kind: "filter-flow" },
    };
  }
  if (commandId === "view-token0-flow" || commandId === "view-token1-flow") {
    if (!available.liquidityFlow) return { enabled: false, reason: "流动性动向模块暂不可用" };
    const side = commandId === "view-token0-flow" ? 0 : 1;
    const address = tokenAddress(row, side);
    return address
      ? { enabled: true, result: { field: "token", identity: address, kind: "filter-flow" } }
      : unavailableToken(side);
  }
  if (commandId === "block-pool") {
    return pool
      ? {
          enabled: true,
          result: {
            entry: { chainId: 56, identity: pool.poolKey, scope: "pool" },
            kind: "block",
          },
        }
      : { enabled: false, reason: "池身份不可用" };
  }
  if (commandId === "block-token0" || commandId === "block-token1") {
    const side = commandId === "block-token0" ? 0 : 1;
    const address = tokenAddress(row, side);
    return address
      ? {
          enabled: true,
          result: { entry: { chainId: 56, identity: address, scope: "token" }, kind: "block" },
        }
      : unavailableToken(side);
  }

  const action: PoolActionIntentAction = commandId;
  if (action === "create-monitor" && !available.monitorPrefill) {
    return { enabled: false, reason: "监控模块暂不可用" };
  }
  if (action === "create-task" && !available.taskPrefill) {
    return { enabled: false, reason: "任务模块暂不可用" };
  }
  if (action === "share-chat" && !available.chatPrefill) {
    return { enabled: false, reason: "聊天室预填暂不可用" };
  }
  const intent = createPoolActionIntent(row, action);
  if (!intent) return { enabled: false, reason: "池或 Token 身份不可用" };
  if (action === "share-chat") return { enabled: true, result: { intent, kind: "chat-intent" } };
  return {
    enabled: true,
    result: {
      intent,
      kind: "navigate",
      to: action === "create-task" ? "/tasks/running" : "/monitors",
    },
  };
}
