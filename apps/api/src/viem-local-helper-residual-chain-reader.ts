import { LocalEvmRpcClient, type LocalEvmRpcClientOptions } from "@lpbot/chain-adapters";
import {
  P05_LOCAL_HELPER_SWEEP_REGISTRY,
  localHelperSweepComponent,
  validateLocalHelperSweepRegistry,
  type LocalHelperSweepRegistry,
} from "@lpbot/chain-registry";
import {
  decodeFunctionResult,
  encodeFunctionData,
  getAddress,
  keccak256,
  parseAbi,
  toHex,
  type Address,
  type Hex,
} from "viem";

import type {
  LocalHelperResidualChainInspection,
  LocalHelperResidualChainReader,
} from "./local-helper-sweeps.js";

const erc20Abi = parseAbi([
  "function allowance(address owner,address spender) view returns (uint256)",
  "function balanceOf(address owner) view returns (uint256)",
]);
const helperAbi = parseAbi([
  "function owner() view returns (address)",
  "function sweepNative(bytes32 planDigest,uint256 amount)",
  "function sweepToken(bytes32 planDigest,address token,uint256 amount)",
]);
const managerAbi = parseAbi(["function ownerOf(uint256 tokenId) view returns (address)"]);
const estimatePlanDigest = `0x${"11".repeat(32)}` as const;

interface RpcBlock {
  baseFeePerGas?: Hex;
  hash: Hex;
  number: Hex;
  timestamp: Hex;
}

export interface LocalHelperResidualInventory {
  complete: boolean;
  knownNfts: readonly { managerAddress: Address; tokenId: string }[];
  tokenAddresses: readonly Address[];
}

export interface LocalHelperResidualInventorySource {
  list(input: {
    chainId: 31_337;
    helperAddress: Address;
    managerAddress: Address;
    walletAddress: Address;
    walletId: string;
  }): Promise<LocalHelperResidualInventory>;
}

export interface ViemLocalHelperResidualChainReaderOptions {
  chainId: 31_337;
  fetch?: typeof fetch;
  inventory: LocalHelperResidualInventorySource;
  providers: ReadonlyArray<Pick<LocalEvmRpcClientOptions, "providerId" | "rpcUrl">>;
  registry?: LocalHelperSweepRegistry;
  timeoutMilliseconds?: number;
}

interface NormalizedInventory {
  nftComplete: boolean;
  nfts: { managerAddress: Address; tokenId: string }[];
  tokenComplete: boolean;
  tokens: Address[];
}

interface ProviderInspection extends LocalHelperResidualChainInspection {
  providerId: string;
}

function quantity(value: unknown, label: string): bigint {
  if (typeof value !== "string" || !/^0x[0-9a-f]+$/iu.test(value)) {
    throw new Error(`LOCAL_HELPER_RESIDUAL_${label}_INVALID`);
  }
  return BigInt(value);
}

function bytes(value: unknown, label: string): Hex {
  if (typeof value !== "string" || !/^0x(?:[0-9a-f]{2})*$/iu.test(value)) {
    throw new Error(`LOCAL_HELPER_RESIDUAL_${label}_INVALID`);
  }
  return value.toLowerCase() as Hex;
}

function address(value: string): Address {
  return getAddress(value).toLowerCase() as Address;
}

function codeHash(value: unknown): Hex | null {
  const code = bytes(value, "CODE");
  return code === "0x" ? null : keccak256(code);
}

function stable(value: unknown): string {
  if (Array.isArray(value)) return JSON.stringify(value.map((entry) => JSON.parse(stable(entry))));
  if (value !== null && typeof value === "object") {
    return JSON.stringify(
      Object.fromEntries(
        Object.entries(value)
          .sort(([left], [right]) => left.localeCompare(right))
          .map(([key, entry]) => [key, JSON.parse(stable(entry))]),
      ),
    );
  }
  return JSON.stringify(value);
}

async function attempt<T>(work: () => Promise<T>): Promise<{ ok: boolean; value: T | null }> {
  try {
    return { ok: true, value: await work() };
  } catch {
    return { ok: false, value: null };
  }
}

function normalizeInventory(
  inventory: LocalHelperResidualInventory,
  registry: LocalHelperSweepRegistry,
): NormalizedInventory {
  let tokenComplete = inventory.complete && inventory.tokenAddresses.length <= 512;
  const tokens = new Set<Address>();
  for (const candidate of inventory.tokenAddresses.slice(0, 512)) {
    try {
      tokens.add(address(candidate));
    } catch {
      tokenComplete = false;
    }
  }

  let nftComplete = inventory.complete && inventory.knownNfts.length <= 1_000;
  const managerAddress = localHelperSweepComponent("manager", registry).address;
  const nfts = new Map<string, { managerAddress: Address; tokenId: string }>();
  for (const candidate of inventory.knownNfts.slice(0, 1_000)) {
    try {
      const manager = address(candidate.managerAddress);
      if (
        manager !== managerAddress ||
        !/^(?:0|[1-9][0-9]*)$/u.test(candidate.tokenId) ||
        candidate.tokenId.length > 78
      ) {
        nftComplete = false;
        continue;
      }
      nfts.set(`${manager}:${candidate.tokenId}`, {
        managerAddress: manager,
        tokenId: candidate.tokenId,
      });
    } catch {
      nftComplete = false;
    }
  }
  return {
    nftComplete,
    nfts: [...nfts.values()].sort((left, right) =>
      `${left.managerAddress}:${left.tokenId}`.localeCompare(
        `${right.managerAddress}:${right.tokenId}`,
      ),
    ),
    tokenComplete,
    tokens: [...tokens].sort((left, right) => left.localeCompare(right)),
  };
}

function sameProviderFacts(left: ProviderInspection, right: ProviderInspection): boolean {
  const facts = (value: ProviderInspection) => ({
    allowances: value.allowances,
    block: value.block,
    componentCode: value.componentCode,
    coverage: value.coverage,
    feeLimits: value.feeLimits,
    headBlockNumber: value.headBlockNumber,
    helper: value.helper,
    nativeBalanceBaseUnit: value.nativeBalanceBaseUnit,
    nftCustody: value.nftCustody,
    referencedBlockHash: value.referencedBlockHash,
    tokenBalances: value.tokenBalances,
    unknownTokens: value.unknownTokens,
  });
  return stable(facts(left)) === stable(facts(right));
}

export class ViemLocalHelperResidualChainReader implements LocalHelperResidualChainReader {
  readonly #inventory: LocalHelperResidualInventorySource;
  readonly #providers: readonly LocalEvmRpcClient[];
  readonly #registry: LocalHelperSweepRegistry;

  constructor(options: ViemLocalHelperResidualChainReaderOptions) {
    if (options.chainId !== 31_337) throw new RangeError("LOCAL_HELPER_RESIDUAL_CHAIN_INVALID");
    if (options.providers.length < 1 || options.providers.length > 4) {
      throw new RangeError("LOCAL_HELPER_RESIDUAL_PROVIDER_COUNT_INVALID");
    }
    const providerIds = new Set(options.providers.map(({ providerId }) => providerId));
    if (providerIds.size !== options.providers.length) {
      throw new RangeError("LOCAL_HELPER_RESIDUAL_PROVIDER_ID_DUPLICATE");
    }
    this.#inventory = options.inventory;
    this.#registry = validateLocalHelperSweepRegistry(
      options.registry ?? P05_LOCAL_HELPER_SWEEP_REGISTRY,
    );
    this.#providers = options.providers.map(
      (provider) =>
        new LocalEvmRpcClient({
          expectedChainId: 31_337,
          ...(options.fetch ? { fetch: options.fetch } : {}),
          ...provider,
          ...(options.timeoutMilliseconds
            ? { timeoutMilliseconds: options.timeoutMilliseconds }
            : {}),
        }),
    );
  }

  async inspect(
    input: Parameters<LocalHelperResidualChainReader["inspect"]>[0],
  ): Promise<LocalHelperResidualChainInspection> {
    if (
      input.binding.walletId.length === 0 ||
      input.binding.ownerAddress !== input.walletAddress ||
      input.binding.helperVersion !== this.#registry.helper.helperVersion ||
      input.binding.deploymentRegistryVersion !== this.#registry.helper.bindingRegistryVersion
    ) {
      throw new Error("LOCAL_HELPER_RESIDUAL_INPUT_INVALID");
    }
    const primary = this.#providers[0]!;
    const latest = await primary.request<RpcBlock>("eth_getBlockByNumber", ["latest", false]);
    const targetNumber = quantity(latest.number, "BLOCK_NUMBER");
    if (!/^0x[0-9a-f]{64}$/iu.test(latest.hash)) {
      throw new Error("LOCAL_HELPER_RESIDUAL_BLOCK_HASH_INVALID");
    }

    let source: LocalHelperResidualInventory;
    try {
      source = await this.#inventory.list({
        chainId: 31_337,
        helperAddress: input.binding.helperAddress,
        managerAddress: localHelperSweepComponent("manager", this.#registry).address,
        walletAddress: input.walletAddress,
        walletId: input.binding.walletId,
      });
    } catch {
      source = { complete: false, knownNfts: [], tokenAddresses: [] };
    }
    const inventory = normalizeInventory(source, this.#registry);
    const observations = await Promise.all(
      this.#providers.map((provider) =>
        this.#inspectProvider(provider, input, targetNumber, inventory),
      ),
    );
    const first = observations[0]!;
    if (observations.some((observation) => !sameProviderFacts(observation, first))) {
      throw new Error("LOCAL_HELPER_RESIDUAL_PROVIDER_DIVERGENCE");
    }
    return {
      allowances: first.allowances,
      block: first.block,
      componentCode: first.componentCode,
      coverage: first.coverage,
      feeLimits: first.feeLimits,
      headBlockNumber: first.headBlockNumber,
      helper: first.helper,
      nativeBalanceBaseUnit: first.nativeBalanceBaseUnit,
      nftCustody: first.nftCustody,
      nonceViews: observations.map(({ nonceViews }) => nonceViews[0]!),
      referencedBlockHash: first.referencedBlockHash,
      tokenBalances: first.tokenBalances,
      unknownTokens: first.unknownTokens,
    };
  }

  async #inspectProvider(
    provider: LocalEvmRpcClient,
    input: Parameters<LocalHelperResidualChainReader["inspect"]>[0],
    targetNumber: bigint,
    inventory: NormalizedInventory,
  ): Promise<ProviderInspection> {
    const targetTag = toHex(targetNumber);
    const referencedTag = input.referencedBlockNumber
      ? toHex(BigInt(input.referencedBlockNumber))
      : null;
    const call = (to: Address, data: Hex) =>
      provider.request<Hex>("eth_call", [{ data, to }, targetTag]);
    const [targetBlock, head, latestNonce, pendingNonce, nativeBalance, referencedBlock] =
      await Promise.all([
        provider.request<RpcBlock | null>("eth_getBlockByNumber", [targetTag, false]),
        provider.request<Hex>("eth_blockNumber", []),
        provider.request<Hex>("eth_getTransactionCount", [input.walletAddress, "latest"]),
        provider.request<Hex>("eth_getTransactionCount", [input.walletAddress, "pending"]),
        provider.request<Hex>("eth_getBalance", [input.binding.helperAddress, targetTag]),
        referencedTag
          ? provider.request<RpcBlock | null>("eth_getBlockByNumber", [referencedTag, false])
          : Promise.resolve(null),
      ]);
    if (
      !targetBlock ||
      quantity(targetBlock.number, "TARGET_BLOCK_NUMBER") !== targetNumber ||
      !/^0x[0-9a-f]{64}$/iu.test(targetBlock.hash) ||
      (referencedBlock && !/^0x[0-9a-f]{64}$/iu.test(referencedBlock.hash))
    ) {
      throw new Error("LOCAL_HELPER_RESIDUAL_CANONICAL_BLOCK_MISSING");
    }

    const helperCode = await attempt(async () =>
      codeHash(
        await provider.request<Hex>("eth_getCode", [input.binding.helperAddress, targetTag]),
      ),
    );
    const helperOwner = await attempt(async () =>
      address(
        decodeFunctionResult({
          abi: helperAbi,
          data: bytes(
            await call(
              input.binding.helperAddress,
              encodeFunctionData({ abi: helperAbi, functionName: "owner" }),
            ),
            "OWNER_RESULT",
          ),
          functionName: "owner",
        }),
      ),
    );

    const componentReads = await Promise.all(
      this.#registry.components.map(async ({ address: componentAddress, role }) => {
        const result = await attempt(async () =>
          codeHash(await provider.request<Hex>("eth_getCode", [componentAddress, targetTag])),
        );
        return { address: componentAddress, ok: result.ok, role, runtimeCodeHash: result.value };
      }),
    );
    const tokenReads = await Promise.all(
      this.#registry.tokens.map(async (token) => {
        const [code, balance] = await Promise.all([
          attempt(async () =>
            codeHash(await provider.request<Hex>("eth_getCode", [token.address, targetTag])),
          ),
          attempt(async () =>
            decodeFunctionResult({
              abi: erc20Abi,
              data: bytes(
                await call(
                  token.address,
                  encodeFunctionData({
                    abi: erc20Abi,
                    args: [input.binding.helperAddress],
                    functionName: "balanceOf",
                  }),
                ),
                "TOKEN_BALANCE_RESULT",
              ),
              functionName: "balanceOf",
            }),
          ),
        ]);
        return { address: token.address, balance, code };
      }),
    );

    const allowanceReads = await Promise.all(
      this.#registry.tokens.flatMap((token) =>
        this.#registry.components.map(async (component) => {
          const amount = await attempt(async () =>
            decodeFunctionResult({
              abi: erc20Abi,
              data: bytes(
                await call(
                  token.address,
                  encodeFunctionData({
                    abi: erc20Abi,
                    args: [input.binding.helperAddress, component.address],
                    functionName: "allowance",
                  }),
                ),
                "ALLOWANCE_RESULT",
              ),
              functionName: "allowance",
            }),
          );
          return { amount, component, token };
        }),
      ),
    );

    const unknownAddresses = inventory.tokens.filter(
      (candidate) => !this.#registry.tokens.some(({ address }) => address === candidate),
    );
    const unknownReads = await Promise.all(
      unknownAddresses.map(async (tokenAddress) => {
        const [code, balance] = await Promise.all([
          attempt(async () =>
            codeHash(await provider.request<Hex>("eth_getCode", [tokenAddress, targetTag])),
          ),
          attempt(async () =>
            decodeFunctionResult({
              abi: erc20Abi,
              data: bytes(
                await call(
                  tokenAddress,
                  encodeFunctionData({
                    abi: erc20Abi,
                    args: [input.binding.helperAddress],
                    functionName: "balanceOf",
                  }),
                ),
                "UNKNOWN_TOKEN_BALANCE_RESULT",
              ),
              functionName: "balanceOf",
            }),
          ),
        ]);
        return { address: tokenAddress, balance, code };
      }),
    );

    const nftReads = await Promise.all(
      inventory.nfts.map(async (nft) => ({
        nft,
        owner: await attempt(async () =>
          address(
            decodeFunctionResult({
              abi: managerAbi,
              data: bytes(
                await call(
                  nft.managerAddress,
                  encodeFunctionData({
                    abi: managerAbi,
                    args: [BigInt(nft.tokenId)],
                    functionName: "ownerOf",
                  }),
                ),
                "NFT_OWNER_RESULT",
              ),
              functionName: "ownerOf",
            }),
          ),
        ),
      })),
    );

    const priorityResult = await attempt(async () =>
      quantity(await provider.request<Hex>("eth_maxPriorityFeePerGas", []), "MAX_PRIORITY_FEE"),
    );
    const baseFee = targetBlock.baseFeePerGas
      ? quantity(targetBlock.baseFeePerGas, "BASE_FEE")
      : 0n;
    const priority = priorityResult.value ?? 0n;
    const maxFee = baseFee * 2n + priority > 0n ? baseFee * 2n + priority : 1n;
    const nativeAmount = quantity(nativeBalance, "NATIVE_BALANCE");
    const feeCandidates = [
      ...(nativeAmount > BigInt(this.#registry.dustPolicy.nativeDustBaseUnit)
        ? [
            {
              amount: nativeAmount,
              assetId: "native:31337",
              data: encodeFunctionData({
                abi: helperAbi,
                args: [estimatePlanDigest, nativeAmount],
                functionName: "sweepNative",
              }),
              maximumGas: 120_000n,
            },
          ]
        : []),
      ...tokenReads.flatMap((read) => {
        const amount = read.balance.value;
        return read.balance.ok && amount !== null && amount > 1n
          ? [
              {
                amount,
                assetId: `token:${read.address}`,
                data: encodeFunctionData({
                  abi: helperAbi,
                  args: [estimatePlanDigest, read.address, amount],
                  functionName: "sweepToken",
                }),
                maximumGas: 250_000n,
              },
            ]
          : [];
      }),
    ];
    const feeLimits: Array<LocalHelperResidualChainInspection["feeLimits"][number]> = [];
    for (const candidate of feeCandidates) {
      const estimate = await attempt(async () =>
        quantity(
          await provider.request<Hex>("eth_estimateGas", [
            {
              data: candidate.data,
              from: input.walletAddress,
              to: input.binding.helperAddress,
              value: "0x0",
            },
            targetTag,
          ]),
          "GAS_ESTIMATE",
        ),
      );
      if (!estimate.ok || estimate.value === null) continue;
      const gasLimit = estimate.value + estimate.value / 5n + 10_000n;
      if (gasLimit > candidate.maximumGas) continue;
      feeLimits.push({
        assetId: candidate.assetId,
        feeLimit: {
          feeCapBaseUnit: (gasLimit * maxFee).toString(),
          gasLimit: gasLimit.toString(),
          maxFeePerGasBaseUnit: maxFee.toString(),
          maxPriorityFeePerGasBaseUnit: priority.toString(),
        },
      });
    }

    const allowancesComplete = allowanceReads.every(({ amount }) => amount.ok);
    const helperIdentityComplete =
      helperCode.ok && helperOwner.ok && componentReads.every(({ ok }) => ok);
    const tokenInventoryComplete =
      inventory.tokenComplete &&
      tokenReads.every(({ balance, code }) => balance.ok && code.ok) &&
      unknownReads.every(({ balance, code }) => balance.ok && code.ok);
    const nftCustodyComplete = inventory.nftComplete && nftReads.every(({ owner }) => owner.ok);
    return {
      allowances: allowanceReads.map(({ amount, component, token }) => ({
        amountBaseUnit: (amount.value ?? 0n).toString(),
        spenderAddress: component.address,
        spenderRole: component.role,
        tokenAddress: token.address,
      })),
      block: {
        hash: targetBlock.hash.toLowerCase() as Hex,
        number: targetNumber.toString(),
        timestamp: new Date(
          Number(quantity(targetBlock.timestamp, "BLOCK_TIMESTAMP")) * 1_000,
        ).toISOString(),
      },
      componentCode: componentReads.map(({ address, role, runtimeCodeHash }) => ({
        address,
        role,
        runtimeCodeHash,
      })),
      coverage: {
        allowancesComplete,
        complete:
          allowancesComplete &&
          helperIdentityComplete &&
          nftCustodyComplete &&
          tokenInventoryComplete,
        helperIdentityComplete,
        nftCustodyComplete,
        tokenInventoryComplete,
      },
      feeLimits: feeLimits.sort((left, right) => left.assetId.localeCompare(right.assetId)),
      headBlockNumber: quantity(head, "HEAD_BLOCK_NUMBER").toString(),
      helper: { owner: helperOwner.value, runtimeCodeHash: helperCode.value },
      nativeBalanceBaseUnit: nativeAmount.toString(),
      nftCustody: nftReads
        .filter(({ owner }) => owner.value === input.binding.helperAddress)
        .map(({ nft }) => nft),
      nonceViews: [
        {
          latest: quantity(latestNonce, "LATEST_NONCE").toString(),
          pending: quantity(pendingNonce, "PENDING_NONCE").toString(),
          providerId: provider.providerId,
        },
      ],
      providerId: provider.providerId,
      referencedBlockHash: referencedBlock ? (referencedBlock.hash.toLowerCase() as Hex) : null,
      tokenBalances: tokenReads.map(({ address, balance, code }) => ({
        address,
        amountBaseUnit: (balance.value ?? 0n).toString(),
        runtimeCodeHash: code.value,
      })),
      unknownTokens: unknownReads.map(({ address, balance, code }) => ({
        address,
        amountBaseUnit: (balance.value ?? 0n).toString(),
        runtimeCodeHash: code.value,
      })),
    };
  }
}
