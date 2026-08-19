import type {
  EvmAddress,
  PositionPlatformId,
  SwapQuoteRequest,
  SwapQuoteView,
} from "@lpbot/api-contract";
import type { BscSwapQuoteAdapter } from "@lpbot/chain-adapters";
import { BSC_SWAP_QUOTE_REGISTRY } from "@lpbot/chain-registry";

const addressPattern = /^0x[0-9a-fA-F]{40}$/u;
const positiveDecimalPattern = /^[1-9][0-9]*$/u;
const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
const requestKeys = [
  "amountInBaseUnit",
  "chainId",
  "platformId",
  "slippageBps",
  "tokenIn",
  "tokenOut",
  "walletId",
] as const;

export interface ParsedSwapQuoteRequest extends Omit<SwapQuoteRequest, "chainId"> {
  chainId: number;
}

export class SwapQuoteValidationError extends Error {
  readonly code: "SWAP_QUOTE_INVALID" | "WALLET_NOT_FOUND";

  constructor(code: "SWAP_QUOTE_INVALID" | "WALLET_NOT_FOUND") {
    super(code);
    this.name = "SwapQuoteValidationError";
    this.code = code;
  }
}

export interface SwapQuoteApplicationInput extends SwapQuoteRequest {
  userId: string;
  walletAddress: EvmAddress;
}

export interface SwapQuoteApplication {
  quote(input: SwapQuoteApplicationInput): Promise<Readonly<SwapQuoteView>>;
}

export interface SwapQuoteSnapshotStore {
  append(input: {
    quote: Readonly<SwapQuoteView>;
    tenantId: string;
    userId: string;
  }): Promise<void>;
}

export class ControlledSwapQuoteService implements SwapQuoteApplication {
  readonly #adapter: Pick<BscSwapQuoteAdapter, "quote">;
  readonly #snapshotStore: SwapQuoteSnapshotStore;
  readonly #tenantId: string;

  constructor(options: {
    adapter: Pick<BscSwapQuoteAdapter, "quote">;
    snapshotStore: SwapQuoteSnapshotStore;
    tenantId: string;
  }) {
    if (options.tenantId.length < 1 || options.tenantId.length > 128) {
      throw new RangeError("SWAP_QUOTE_TENANT_INVALID");
    }
    this.#adapter = options.adapter;
    this.#snapshotStore = options.snapshotStore;
    this.#tenantId = options.tenantId;
  }

  async quote(input: SwapQuoteApplicationInput): Promise<Readonly<SwapQuoteView>> {
    const quote = (await this.#adapter.quote({
      amountInBaseUnit: input.amountInBaseUnit,
      chainId: input.chainId,
      platformId: input.platformId,
      slippageBps: input.slippageBps,
      tokenIn: input.tokenIn,
      tokenOut: input.tokenOut,
      walletAddress: input.walletAddress,
      walletId: input.walletId,
    })) as Readonly<SwapQuoteView>;
    await this.#snapshotStore.append({ quote, tenantId: this.#tenantId, userId: input.userId });
    return quote;
  }
}

function record(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function canonicalToken(value: unknown): EvmAddress | null {
  if (typeof value !== "string" || !addressPattern.test(value)) return null;
  return value.toLowerCase() as EvmAddress;
}

export function parseSwapQuoteRequest(value: unknown): ParsedSwapQuoteRequest {
  const input = record(value);
  if (!input || Object.keys(input).sort().join(",") !== [...requestKeys].sort().join(",")) {
    throw new SwapQuoteValidationError("SWAP_QUOTE_INVALID");
  }
  if (typeof input.walletId !== "string" || !uuidPattern.test(input.walletId)) {
    throw new SwapQuoteValidationError("WALLET_NOT_FOUND");
  }
  const tokenIn = canonicalToken(input.tokenIn);
  const tokenOut = canonicalToken(input.tokenOut);
  if (
    !Number.isSafeInteger(input.chainId) ||
    Number(input.chainId) < 1 ||
    !([1, 2, 4, 5] as const).includes(input.platformId as PositionPlatformId) ||
    typeof input.amountInBaseUnit !== "string" ||
    !positiveDecimalPattern.test(input.amountInBaseUnit) ||
    !Number.isSafeInteger(input.slippageBps) ||
    Number(input.slippageBps) < 0 ||
    Number(input.slippageBps) > 500 ||
    !tokenIn ||
    !tokenOut ||
    tokenIn === tokenOut
  ) {
    throw new SwapQuoteValidationError("SWAP_QUOTE_INVALID");
  }
  if (
    Number(input.chainId) === 56 &&
    (!BSC_SWAP_QUOTE_REGISTRY.tokens.some(({ address }) => address === tokenIn) ||
      !BSC_SWAP_QUOTE_REGISTRY.tokens.some(({ address }) => address === tokenOut))
  ) {
    throw new SwapQuoteValidationError("SWAP_QUOTE_INVALID");
  }
  return {
    amountInBaseUnit: input.amountInBaseUnit,
    chainId: Number(input.chainId),
    platformId: input.platformId as PositionPlatformId,
    slippageBps: Number(input.slippageBps),
    tokenIn,
    tokenOut,
    walletId: input.walletId.toLowerCase(),
  };
}
