import type {
  CustodyWallet,
  EvmAddress,
  WalletAssetBalance,
  WalletBalanceSnapshot,
  WalletReceiveContent,
  WalletTokenDefinition,
  WalletTokenPage,
} from "@lpbot/api-contract";
import Decimal from "decimal.js";
import {
  decodeFunctionResult,
  encodeFunctionData,
  formatUnits,
  getAddress,
  type Hex,
} from "viem";

export type WalletAssetErrorCode =
  | "CHAIN_NOT_ALLOWED"
  | "CHAIN_READ_UNAVAILABLE"
  | "DEFAULT_TOKEN_IMMUTABLE"
  | "INVALID_AMOUNT"
  | "INVALID_TOKEN"
  | "TOKEN_ALREADY_EXISTS"
  | "TOKEN_METADATA_CONFLICT"
  | "TOKEN_METADATA_INVALID"
  | "TOKEN_NOT_CONTRACT"
  | "TOKEN_NOT_FOUND";

export class WalletAssetError extends Error {
  readonly code: WalletAssetErrorCode;

  constructor(code: WalletAssetErrorCode, options?: ErrorOptions) {
    super(code, options);
    this.name = "WalletAssetError";
    this.code = code;
  }
}

export interface WalletUsdPrice {
  observedAt: Date;
  priceDecimal: string;
}

export interface ControlledWalletReadProvider {
  readonly chainId: number;
  call(input: { data: Hex; to: EvmAddress }): Promise<Hex>;
  getBalance(address: EvmAddress): Promise<bigint>;
  getBlockNumber(): Promise<bigint>;
  getCode(address: EvmAddress): Promise<Hex>;
  getUsdPrice(tokenAddress: EvmAddress | null): Promise<WalletUsdPrice | null>;
}

export interface ControlledWalletReadProviderRegistry {
  get(chainId: number): ControlledWalletReadProvider | null;
}

export interface StoredWalletToken extends WalletTokenDefinition {
  createdAt: Date;
}

export type WalletTokenInsertResult =
  | { status: "created"; value: StoredWalletToken }
  | { status: "duplicate"; value: StoredWalletToken }
  | { status: "metadata-conflict"; value: StoredWalletToken };

export interface WalletTokenStore {
  delete(input: {
    chainId: number;
    tokenAddress: EvmAddress;
    userId: string;
    walletId: string;
  }): Promise<boolean>;
  insert(input: StoredWalletToken & { userId: string; walletId: string }): Promise<WalletTokenInsertResult>;
  list(input: { chainId: number; userId: string; walletId: string }): Promise<StoredWalletToken[]>;
}

export interface WalletAssetApplication {
  balances(input: {
    chainId: number;
    userId: string;
    wallet: CustodyWallet;
  }): Promise<WalletBalanceSnapshot>;
  deleteToken(input: {
    chainId: number;
    tokenAddress: unknown;
    userId: string;
    walletId: string;
  }): Promise<boolean>;
  importToken(input: {
    chainId: number;
    tokenAddress: unknown;
    userId: string;
    walletId: string;
  }): Promise<WalletTokenDefinition>;
  listTokens(input: {
    chainId: number;
    userId: string;
    walletId: string;
  }): Promise<WalletTokenPage>;
  receive(input: {
    amountDecimal?: unknown;
    chainId: number;
    tokenAddress?: unknown;
    userId: string;
    wallet: CustodyWallet;
  }): Promise<WalletReceiveContent>;
}

const erc20MetadataAbi = [
  {
    inputs: [],
    name: "name",
    outputs: [{ name: "", type: "string" }],
    stateMutability: "view",
    type: "function",
  },
  {
    inputs: [],
    name: "symbol",
    outputs: [{ name: "", type: "string" }],
    stateMutability: "view",
    type: "function",
  },
  {
    inputs: [],
    name: "decimals",
    outputs: [{ name: "", type: "uint8" }],
    stateMutability: "view",
    type: "function",
  },
  {
    inputs: [{ name: "account", type: "address" }],
    name: "balanceOf",
    outputs: [{ name: "", type: "uint256" }],
    stateMutability: "view",
    type: "function",
  },
] as const;

interface NativeAssetDefinition {
  decimals: number;
  name: string;
  symbol: string;
}

const nativeAssets = new Map<number, NativeAssetDefinition>([
  [56, { decimals: 18, name: "BNB", symbol: "BNB" }],
  [8453, { decimals: 18, name: "Ether", symbol: "ETH" }],
  [1, { decimals: 18, name: "Ether", symbol: "ETH" }],
]);

export const defaultWalletTokens: ReadonlyMap<number, readonly WalletTokenDefinition[]> = new Map([
  [
    56,
    [
      {
        chainId: 56,
        decimals: 18,
        default: true,
        name: "Tether USD",
        symbol: "USDT",
        tokenAddress: "0x55d398326f99059ff775485246999027b3197955",
      },
      {
        chainId: 56,
        decimals: 18,
        default: true,
        name: "USD Coin",
        symbol: "USDC",
        tokenAddress: "0x8ac76a51cc950d9822d68b83fe1ad97b32cd580d",
      },
    ],
  ],
  [
    8453,
    [
      {
        chainId: 8453,
        decimals: 6,
        default: true,
        name: "USD Coin",
        symbol: "USDC",
        tokenAddress: "0x833589fcd6edb6e08f4c7c32d4f71b54bda02913",
      },
    ],
  ],
  [
    1,
    [
      {
        chainId: 1,
        decimals: 6,
        default: true,
        name: "USD Coin",
        symbol: "USDC",
        tokenAddress: "0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48",
      },
      {
        chainId: 1,
        decimals: 6,
        default: true,
        name: "Tether USD",
        symbol: "USDT",
        tokenAddress: "0xdac17f958d2ee523a2206206994597c13d831ec7",
      },
    ],
  ],
]);

const canonicalDecimalPattern = /^(?:0|[1-9][0-9]*)(?:\.[0-9]+)?$/u;
const hexDataPattern = /^0x(?:[0-9a-fA-F]{2})*$/u;
const controlCharacterPattern = /\p{Cc}/u;

export function canonicalWalletAddress(value: unknown, code: WalletAssetErrorCode = "INVALID_TOKEN") {
  if (typeof value !== "string" || !/^0x[0-9a-fA-F]{40}$/u.test(value)) {
    throw new WalletAssetError(code);
  }
  try {
    return getAddress(value).toLowerCase() as EvmAddress;
  } catch (error) {
    throw new WalletAssetError(code, { cause: error });
  }
}

function validMetadataText(value: unknown, maximum: number): value is string {
  return (
    typeof value === "string" &&
    value.trim() === value &&
    [...value].length >= 1 &&
    [...value].length <= maximum &&
    !controlCharacterPattern.test(value)
  );
}

function validateRpcData(value: unknown): asserts value is Hex {
  if (typeof value !== "string" || value.length > 131_074 || !hexDataPattern.test(value)) {
    throw new WalletAssetError("TOKEN_METADATA_INVALID");
  }
}

function providerFor(
  providers: ControlledWalletReadProviderRegistry,
  chainId: number,
): ControlledWalletReadProvider {
  const provider = providers.get(chainId);
  if (!provider) throw new WalletAssetError("CHAIN_READ_UNAVAILABLE");
  if (provider.chainId !== chainId) throw new WalletAssetError("CHAIN_NOT_ALLOWED");
  return provider;
}

async function readFunction(
  provider: ControlledWalletReadProvider,
  tokenAddress: EvmAddress,
  functionName: "balanceOf" | "decimals" | "name" | "symbol",
  args?: readonly [EvmAddress],
): Promise<unknown> {
  try {
    const data = encodeFunctionData({
      abi: erc20MetadataAbi,
      args,
      functionName,
    } as never);
    const response = await provider.call({ data, to: tokenAddress });
    validateRpcData(response);
    return decodeFunctionResult({
      abi: erc20MetadataAbi,
      data: response,
      functionName,
    } as never);
  } catch (error) {
    if (error instanceof WalletAssetError) throw error;
    throw new WalletAssetError("TOKEN_METADATA_INVALID", { cause: error });
  }
}

export async function inspectErc20Token(
  provider: ControlledWalletReadProvider,
  chainId: number,
  value: unknown,
): Promise<WalletTokenDefinition> {
  const tokenAddress = canonicalWalletAddress(value);
  let code: Hex;
  try {
    code = await provider.getCode(tokenAddress);
  } catch (error) {
    throw new WalletAssetError("CHAIN_READ_UNAVAILABLE", { cause: error });
  }
  validateRpcData(code);
  if (code === "0x") throw new WalletAssetError("TOKEN_NOT_CONTRACT");

  const [name, symbol, decimals] = await Promise.all([
    readFunction(provider, tokenAddress, "name"),
    readFunction(provider, tokenAddress, "symbol"),
    readFunction(provider, tokenAddress, "decimals"),
  ]);
  if (
    !validMetadataText(name, 128) ||
    !validMetadataText(symbol, 32) ||
    typeof decimals !== "number" ||
    !Number.isInteger(decimals) ||
    decimals < 0 ||
    decimals > 255
  ) {
    throw new WalletAssetError("TOKEN_METADATA_INVALID");
  }
  return { chainId, decimals, default: false, name, symbol, tokenAddress };
}

function metadataEqual(left: WalletTokenDefinition, right: WalletTokenDefinition): boolean {
  return (
    left.chainId === right.chainId &&
    left.decimals === right.decimals &&
    left.name === right.name &&
    left.symbol === right.symbol &&
    left.tokenAddress === right.tokenAddress
  );
}

function parsePrice(value: WalletUsdPrice | null, currentTime: Date, maximumAgeMs: number) {
  if (!value) return { price: null, status: "missing" as const };
  if (
    !canonicalDecimalPattern.test(value.priceDecimal) ||
    value.priceDecimal.length > 160 ||
    !Number.isFinite(value.observedAt.getTime()) ||
    value.observedAt.getTime() > currentTime.getTime() + 1_000
  ) {
    return { price: null, status: "missing" as const };
  }
  if (currentTime.getTime() - value.observedAt.getTime() > maximumAgeMs) {
    return { price: value.priceDecimal, status: "stale" as const };
  }
  return { price: value.priceDecimal, status: "current" as const };
}

function valuedBalance(input: {
  assetType: "native" | "erc20";
  balance: bigint;
  decimals: number;
  default: boolean;
  name: string;
  price: ReturnType<typeof parsePrice>;
  symbol: string;
  tokenAddress: EvmAddress | null;
}): WalletAssetBalance {
  if (input.balance < 0n) throw new WalletAssetError("CHAIN_READ_UNAVAILABLE");
  const balanceDecimal = formatUnits(input.balance, input.decimals);
  const usdValueDecimal =
    input.price.status === "current" && input.price.price !== null
      ? new Decimal(balanceDecimal).mul(input.price.price).toFixed()
      : null;
  return {
    assetType: input.assetType,
    balanceBaseUnit: input.balance.toString(),
    balanceDecimal,
    decimals: input.decimals,
    default: input.default,
    name: input.name,
    priceStatus: input.price.status,
    symbol: input.symbol,
    tokenAddress: input.tokenAddress,
    usdPriceDecimal: input.price.price,
    usdValueDecimal,
  };
}

function decimalToBaseUnits(value: string, decimals: number): bigint {
  if (!canonicalDecimalPattern.test(value) || value.length > 160) {
    throw new WalletAssetError("INVALID_AMOUNT");
  }
  const [whole, fraction = ""] = value.split(".");
  if (fraction.length > decimals) throw new WalletAssetError("INVALID_AMOUNT");
  const digits = `${whole}${fraction.padEnd(decimals, "0")}`.replace(/^0+(?=[0-9])/u, "");
  return BigInt(digits || "0");
}

export class MemoryWalletTokenStore implements WalletTokenStore {
  readonly #tokens = new Map<string, StoredWalletToken>();

  async delete(input: {
    chainId: number;
    tokenAddress: EvmAddress;
    userId: string;
    walletId: string;
  }): Promise<boolean> {
    return this.#tokens.delete(this.#key(input));
  }

  async insert(
    input: StoredWalletToken & { userId: string; walletId: string },
  ): Promise<WalletTokenInsertResult> {
    const key = this.#key(input);
    const current = this.#tokens.get(key);
    if (current) {
      return {
        status: metadataEqual(current, input) ? "duplicate" : "metadata-conflict",
        value: structuredClone(current),
      };
    }
    const value = structuredClone(input);
    this.#tokens.set(key, value);
    return { status: "created", value: structuredClone(value) };
  }

  async list(input: {
    chainId: number;
    userId: string;
    walletId: string;
  }): Promise<StoredWalletToken[]> {
    const prefix = `${input.userId}:${input.walletId}:${input.chainId}:`;
    return [...this.#tokens.entries()]
      .filter(([key]) => key.startsWith(prefix))
      .map(([, value]) => structuredClone(value))
      .sort((left, right) => left.tokenAddress.localeCompare(right.tokenAddress));
  }

  #key(input: { chainId: number; tokenAddress: EvmAddress; userId: string; walletId: string }) {
    return `${input.userId}:${input.walletId}:${input.chainId}:${input.tokenAddress}`;
  }
}

export class WalletAssetService implements WalletAssetApplication {
  readonly #now: () => Date;
  readonly #priceMaximumAgeMs: number;
  readonly #providers: ControlledWalletReadProviderRegistry;
  readonly #tokens: WalletTokenStore;

  constructor(input: {
    now?: () => Date;
    priceMaximumAgeMs?: number;
    providers: ControlledWalletReadProviderRegistry;
    tokens: WalletTokenStore;
  }) {
    this.#now = input.now ?? (() => new Date());
    this.#priceMaximumAgeMs = input.priceMaximumAgeMs ?? 300_000;
    if (!Number.isSafeInteger(this.#priceMaximumAgeMs) || this.#priceMaximumAgeMs < 1) {
      throw new RangeError("priceMaximumAgeMs must be a positive integer");
    }
    this.#providers = input.providers;
    this.#tokens = input.tokens;
  }

  async listTokens(input: {
    chainId: number;
    userId: string;
    walletId: string;
  }): Promise<WalletTokenPage> {
    const custom = await this.#tokens.list(input);
    return {
      chainId: input.chainId,
      items: [...(defaultWalletTokens.get(input.chainId) ?? []), ...custom].map((token) => ({
        chainId: token.chainId,
        decimals: token.decimals,
        default: token.default,
        name: token.name,
        symbol: token.symbol,
        tokenAddress: token.tokenAddress,
      })),
      walletId: input.walletId,
    };
  }

  async importToken(input: {
    chainId: number;
    tokenAddress: unknown;
    userId: string;
    walletId: string;
  }): Promise<WalletTokenDefinition> {
    const tokenAddress = canonicalWalletAddress(input.tokenAddress);
    if (
      (defaultWalletTokens.get(input.chainId) ?? []).some(
        (candidate) => candidate.tokenAddress === tokenAddress,
      )
    ) {
      throw new WalletAssetError("DEFAULT_TOKEN_IMMUTABLE");
    }
    const provider = providerFor(this.#providers, input.chainId);
    const metadata = await inspectErc20Token(provider, input.chainId, tokenAddress);
    const result = await this.#tokens.insert({
      ...metadata,
      createdAt: this.#now(),
      userId: input.userId,
      walletId: input.walletId,
    });
    if (result.status === "duplicate") throw new WalletAssetError("TOKEN_ALREADY_EXISTS");
    if (result.status === "metadata-conflict") {
      throw new WalletAssetError("TOKEN_METADATA_CONFLICT");
    }
    return metadata;
  }

  async deleteToken(input: {
    chainId: number;
    tokenAddress: unknown;
    userId: string;
    walletId: string;
  }): Promise<boolean> {
    const tokenAddress = canonicalWalletAddress(input.tokenAddress);
    if (
      (defaultWalletTokens.get(input.chainId) ?? []).some(
        (candidate) => candidate.tokenAddress === tokenAddress,
      )
    ) {
      throw new WalletAssetError("DEFAULT_TOKEN_IMMUTABLE");
    }
    return this.#tokens.delete({ ...input, tokenAddress });
  }

  async balances(input: {
    chainId: number;
    userId: string;
    wallet: CustodyWallet;
  }): Promise<WalletBalanceSnapshot> {
    const native = nativeAssets.get(input.chainId);
    if (!native) throw new WalletAssetError("CHAIN_NOT_ALLOWED");
    const provider = providerFor(this.#providers, input.chainId);
    const page = await this.listTokens({
      chainId: input.chainId,
      userId: input.userId,
      walletId: input.wallet.walletId,
    });
    const readAt = this.#now();
    try {
      const [blockNumber, nativeBalance, nativePrice, tokenBalances] = await Promise.all([
        provider.getBlockNumber(),
        provider.getBalance(input.wallet.address),
        provider.getUsdPrice(null),
        Promise.all(
          page.items.map(async (token) => {
            const [rawBalance, price] = await Promise.all([
              readFunction(provider, token.tokenAddress, "balanceOf", [input.wallet.address]),
              provider.getUsdPrice(token.tokenAddress),
            ]);
            if (typeof rawBalance !== "bigint") {
              throw new WalletAssetError("CHAIN_READ_UNAVAILABLE");
            }
            return valuedBalance({
              assetType: "erc20",
              balance: rawBalance,
              decimals: token.decimals,
              default: token.default,
              name: token.name,
              price: parsePrice(price, readAt, this.#priceMaximumAgeMs),
              symbol: token.symbol,
              tokenAddress: token.tokenAddress,
            });
          }),
        ),
      ]);
      if (blockNumber < 0n) throw new WalletAssetError("CHAIN_READ_UNAVAILABLE");
      const items = [
        valuedBalance({
          assetType: "native",
          balance: nativeBalance,
          decimals: native.decimals,
          default: true,
          name: native.name,
          price: parsePrice(nativePrice, readAt, this.#priceMaximumAgeMs),
          symbol: native.symbol,
          tokenAddress: null,
        }),
        ...tokenBalances,
      ];
      const totalUsdValueDecimal = items.every(({ usdValueDecimal }) => usdValueDecimal !== null)
        ? items
            .reduce((total, item) => total.add(item.usdValueDecimal!), new Decimal(0))
            .toFixed()
        : null;
      return {
        address: input.wallet.address,
        blockNumberDecimal: blockNumber.toString(),
        chainId: input.chainId,
        items,
        readAt: readAt.toISOString(),
        totalUsdValueDecimal,
        walletId: input.wallet.walletId,
      };
    } catch (error) {
      if (error instanceof WalletAssetError) throw error;
      throw new WalletAssetError("CHAIN_READ_UNAVAILABLE", { cause: error });
    }
  }

  async receive(input: {
    amountDecimal?: unknown;
    chainId: number;
    tokenAddress?: unknown;
    userId: string;
    wallet: CustodyWallet;
  }): Promise<WalletReceiveContent> {
    const native = nativeAssets.get(input.chainId);
    if (!native) throw new WalletAssetError("CHAIN_NOT_ALLOWED");
    const tokenAddress =
      input.tokenAddress === undefined || input.tokenAddress === null || input.tokenAddress === ""
        ? null
        : canonicalWalletAddress(input.tokenAddress);
    const token = tokenAddress
      ? (await this.listTokens({
          chainId: input.chainId,
          userId: input.userId,
          walletId: input.wallet.walletId,
        })).items.find((candidate) => candidate.tokenAddress === tokenAddress)
      : null;
    if (tokenAddress && !token) throw new WalletAssetError("TOKEN_NOT_FOUND");
    const amountDecimal =
      input.amountDecimal === undefined || input.amountDecimal === null || input.amountDecimal === ""
        ? null
        : typeof input.amountDecimal === "string"
          ? input.amountDecimal
          : (() => {
              throw new WalletAssetError("INVALID_AMOUNT");
            })();
    const amountBaseUnit =
      amountDecimal === null
        ? null
        : decimalToBaseUnits(amountDecimal, token?.decimals ?? native.decimals).toString();
    const target = tokenAddress ? getAddress(tokenAddress) : input.wallet.address;
    const recipient = input.wallet.address;
    const eip681 = tokenAddress
      ? `ethereum:${target}@${input.chainId}/transfer?address=${recipient}${
          amountBaseUnit === null ? "" : `&uint256=${amountBaseUnit}`
        }`
      : `ethereum:${recipient}@${input.chainId}${
          amountBaseUnit === null ? "" : `?value=${amountBaseUnit}`
        }`;
    return {
      address: recipient,
      amountBaseUnit,
      amountDecimal,
      chainId: input.chainId,
      eip681,
      tokenAddress,
      walletId: input.wallet.walletId,
    };
  }
}
