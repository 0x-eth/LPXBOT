import type {
  EvmAddress,
  LiquidityFlowEvent,
  LiquidityFlowEventType,
} from "@lpbot/api-contract";

import type { NormalizedPoolEvent } from "./types.js";

const eventTypeByKind: Partial<Record<NormalizedPoolEvent["kind"], LiquidityFlowEventType>> = {
  "liquidity.add": "add",
  "liquidity.remove": "remove",
  "pool.created": "create",
};

function address(value: string | null | undefined): EvmAddress | null {
  return value === null || value === undefined ? null : (value.toLowerCase() as EvmAddress);
}

function payloadValue(event: NormalizedPoolEvent, key: string): string | null {
  return event.payload[key] ?? null;
}

export function projectLiquidityFlowEvent(
  event: NormalizedPoolEvent,
): LiquidityFlowEvent | null {
  const eventType = eventTypeByKind[event.kind];
  if (!eventType || event.chainId !== 56 || event.removed || event.finality !== "observed") {
    return null;
  }
  const timestamp = Date.parse(event.blockTimestamp);
  if (!Number.isFinite(timestamp)) throw new RangeError("LIQUIDITY_FLOW_TIMESTAMP_INVALID");

  return {
    amount0: event.amount0,
    amount1: event.amount1,
    block_hash: event.blockHash as `0x${string}`,
    block_number: event.blockNumber,
    chain_id: 56,
    cursor: event.cursor.value,
    dex: event.protocol,
    event_type: eventType,
    finality: "observed",
    hooks: address(event.pool.hooks),
    id: event.eventId,
    in_range: null,
    liquidity_delta: event.liquidityDelta,
    log_index: event.logIndex,
    nft_id: null,
    pool_address: address(event.pool.poolAddress),
    pool_id: event.pool.poolId as `0x${string}` | null,
    record_type: "event",
    schema_version: "1.0.0",
    tick_lower: payloadValue(event, "tickLower"),
    tick_upper: payloadValue(event, "tickUpper"),
    token0_address: address(event.pool.token0),
    token0_symbol: null,
    token1_address: address(event.pool.token1),
    token1_symbol: null,
    ts: timestamp,
    tx_hash: event.transactionHash as `0x${string}`,
    tx_index: event.transactionIndex,
    user: address(
      payloadValue(event, "owner") ??
        payloadValue(event, "sender") ??
        payloadValue(event, "recipient"),
    ),
    usd_value: null,
    version: event.protocolGeneration,
  };
}

export function compareLiquidityFlowEvents(
  left: LiquidityFlowEvent,
  right: LiquidityFlowEvent,
): number {
  const blockOrder = BigInt(left.block_number) - BigInt(right.block_number);
  if (blockOrder !== 0n) return blockOrder < 0n ? -1 : 1;
  if (left.tx_index !== right.tx_index) return left.tx_index - right.tx_index;
  if (left.log_index !== right.log_index) return left.log_index - right.log_index;
  const transactionOrder = left.tx_hash.localeCompare(right.tx_hash);
  return transactionOrder === 0 ? left.id.localeCompare(right.id) : transactionOrder;
}

export function stableLiquidityFlowEvents(
  events: readonly LiquidityFlowEvent[],
): LiquidityFlowEvent[] {
  const byId = new Map<string, LiquidityFlowEvent>();
  for (const event of events) {
    if (!byId.has(event.id)) byId.set(event.id, event);
  }
  return [...byId.values()].sort(compareLiquidityFlowEvents);
}
