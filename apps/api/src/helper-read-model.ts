import type {
  HelperResidualPage,
  HelperVerificationFailure,
  HelperVerificationSnapshot,
  WalletHelperStatus,
} from "@lpbot/api-contract";
import type { PositionReadRpc } from "@lpbot/chain-adapters";
import {
  BSC_HELPER_READ_REGISTRY,
  validateBscHelperReadRegistry,
  type BscHelperReadRegistry,
} from "@lpbot/chain-registry";
import {
  decodeFunctionResult,
  encodeFunctionData,
  keccak256,
  stringToHex,
  type Address,
  type Hex,
} from "viem";

export const HELPER_OWNER_READ_ABI = [
  {
    inputs: [],
    name: "owner",
    outputs: [{ name: "owner", type: "address" }],
    stateMutability: "view",
    type: "function",
  },
] as const;

export type WalletHelperBindingSource = "deployment-result" | "trusted-migration";

export interface WalletHelperBinding {
  bindingId: string;
  boundAt: Date;
  chainId: 56;
  helperAddress: Address;
  helperVersion: string;
  registryVersion: string;
  source: WalletHelperBindingSource;
  userId: string;
  walletId: string;
}

export interface StoredHelperVerification {
  bindingId: string;
  chainId: 56;
  failures: HelperVerificationFailure[];
  helperAddress: Address;
  helperVersion: string;
  userId: string;
  verification: HelperVerificationSnapshot;
  walletId: string;
}

export interface WalletHelperReadStore {
  appendResidualSnapshot(input: {
    idempotencyKey: string;
    page: HelperResidualPage;
    userId: string;
  }): Promise<HelperResidualPage>;
  appendVerification(input: StoredHelperVerification): Promise<void>;
  findBinding(input: {
    chainId: 56;
    userId: string;
    walletId: string;
  }): Promise<WalletHelperBinding | null>;
  findResidualSnapshotByIdempotency(input: {
    chainId: 56;
    idempotencyKey: string;
    userId: string;
    walletId: string;
  }): Promise<HelperResidualPage | null>;
  latestResidualSnapshot(input: {
    chainId: 56;
    helperAddress: Address;
    userId: string;
    walletId: string;
  }): Promise<HelperResidualPage | null>;
}

export interface WalletHelperStatusInput {
  chainId: 56;
  userId: string;
  walletAddress: Address;
  walletId: string;
}

export interface WalletHelperReadApplication {
  resolveTrustedAddress(input: {
    chainId: 56;
    userId: string;
    walletId: string;
  }): Promise<Address | null>;
  status(input: WalletHelperStatusInput): Promise<Readonly<WalletHelperStatus>>;
}

export interface WalletHelperReadServiceOptions {
  now?: () => Date;
  registry?: BscHelperReadRegistry;
  rpc: PositionReadRpc;
  store: WalletHelperReadStore;
}

const addressPattern = /^0x[0-9a-f]{40}$/u;
const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
const helperVersionPattern = /^[a-z0-9](?:[a-z0-9.-]{0,62}[a-z0-9])?$/u;

function bindingKey(input: { chainId: number; userId: string; walletId: string }): string {
  return `${input.userId.toLowerCase()}:${input.walletId.toLowerCase()}:${String(input.chainId)}`;
}

function residualKey(input: {
  chainId: number;
  helperAddress: string;
  userId: string;
  walletId: string;
}): string {
  return `${bindingKey(input)}:${input.helperAddress.toLowerCase()}`;
}

function cloneBinding(binding: WalletHelperBinding): WalletHelperBinding {
  return { ...binding, boundAt: new Date(binding.boundAt) };
}

function freezeVerification(value: HelperVerificationSnapshot): HelperVerificationSnapshot {
  Object.freeze(value.checks);
  Object.freeze(value.observedSelectors);
  return Object.freeze(value);
}

function freezeStatus(value: WalletHelperStatus): Readonly<WalletHelperStatus> {
  Object.freeze(value.failures);
  if (value.verification) freezeVerification(value.verification);
  return Object.freeze(value);
}

function extractPush4Selectors(code: Hex): `0x${string}`[] {
  const body = code.slice(2).toLowerCase();
  const selectors = new Set<`0x${string}`>();
  for (let offset = 0; offset + 10 <= body.length; offset += 2) {
    if (body.slice(offset, offset + 2) === "63") {
      selectors.add(`0x${body.slice(offset + 2, offset + 10)}`);
    }
  }
  return [...selectors].sort((left, right) => left.localeCompare(right));
}

function sameSelectors(left: readonly string[], right: readonly string[]): boolean {
  const a = [...left].sort((x, y) => x.localeCompare(y));
  const b = [...right].sort((x, y) => x.localeCompare(y));
  return a.length === b.length && a.every((selector, index) => selector === b[index]);
}

function helperDigest(input: {
  binding: WalletHelperBinding;
  failures: readonly HelperVerificationFailure[];
  verification: Omit<HelperVerificationSnapshot, "digest">;
}): Hex {
  return keccak256(
    stringToHex(
      JSON.stringify({
        bindingId: input.binding.bindingId,
        chainId: input.binding.chainId,
        failures: input.failures,
        helperAddress: input.binding.helperAddress,
        helperVersion: input.binding.helperVersion,
        registryVersion: input.binding.registryVersion,
        userId: input.binding.userId,
        verification: input.verification,
        walletId: input.binding.walletId,
      }),
    ),
  );
}

export class MemoryWalletHelperReadStore implements WalletHelperReadStore {
  readonly #bindings = new Map<string, WalletHelperBinding>();
  readonly #residualIdempotency = new Map<string, HelperResidualPage>();
  readonly #residuals = new Map<string, HelperResidualPage[]>();
  readonly #verifications: StoredHelperVerification[] = [];

  async recordTrustedBinding(input: WalletHelperBinding): Promise<WalletHelperBinding> {
    if (input.source !== "deployment-result" && input.source !== "trusted-migration") {
      throw new Error("HELPER_BINDING_SOURCE_INVALID");
    }
    if (
      !uuidPattern.test(input.bindingId) ||
      !uuidPattern.test(input.userId) ||
      !uuidPattern.test(input.walletId) ||
      input.chainId !== 56 ||
      !addressPattern.test(input.helperAddress) ||
      input.helperAddress !== input.helperAddress.toLowerCase() ||
      !helperVersionPattern.test(input.helperVersion) ||
      input.registryVersion !== "p05-bsc-execution-v1" ||
      !Number.isFinite(input.boundAt.getTime())
    ) {
      throw new Error("HELPER_BINDING_INVALID");
    }
    const key = bindingKey(input);
    const existing = this.#bindings.get(key);
    if (existing) {
      if (
        existing.bindingId !== input.bindingId ||
        existing.helperAddress !== input.helperAddress ||
        existing.helperVersion !== input.helperVersion ||
        existing.registryVersion !== input.registryVersion ||
        existing.source !== input.source ||
        existing.boundAt.getTime() !== input.boundAt.getTime()
      ) {
        throw new Error("HELPER_BINDING_CONFLICT");
      }
      return cloneBinding(existing);
    }
    const stored = cloneBinding(input);
    this.#bindings.set(key, stored);
    return cloneBinding(stored);
  }

  async appendResidualSnapshot(input: {
    idempotencyKey: string;
    page: HelperResidualPage;
    userId: string;
  }): Promise<HelperResidualPage> {
    const idempotencyKey = `${bindingKey({
      chainId: input.page.chainId,
      userId: input.userId,
      walletId: input.page.walletId,
    })}:${input.idempotencyKey}`;
    const existing = this.#residualIdempotency.get(idempotencyKey);
    if (existing) return existing;
    const key = residualKey({
      chainId: input.page.chainId,
      helperAddress: input.page.helperAddress,
      userId: input.userId,
      walletId: input.page.walletId,
    });
    const snapshots = this.#residuals.get(key) ?? [];
    if (!snapshots.some(({ scanId }) => scanId === input.page.scanId)) snapshots.push(input.page);
    this.#residuals.set(key, snapshots);
    this.#residualIdempotency.set(idempotencyKey, input.page);
    return input.page;
  }

  async appendVerification(input: StoredHelperVerification): Promise<void> {
    this.#verifications.push({
      ...input,
      failures: Object.freeze([...input.failures]) as HelperVerificationFailure[],
      verification: freezeVerification({
        ...input.verification,
        checks: { ...input.verification.checks },
        observedSelectors: [...input.verification.observedSelectors],
      }),
    });
  }

  async findBinding(input: {
    chainId: 56;
    userId: string;
    walletId: string;
  }): Promise<WalletHelperBinding | null> {
    const binding = this.#bindings.get(bindingKey(input));
    return binding ? cloneBinding(binding) : null;
  }

  async findResidualSnapshotByIdempotency(input: {
    chainId: 56;
    idempotencyKey: string;
    userId: string;
    walletId: string;
  }): Promise<HelperResidualPage | null> {
    return (
      this.#residualIdempotency.get(`${bindingKey(input)}:${input.idempotencyKey}`) ?? null
    );
  }

  async latestResidualSnapshot(input: {
    chainId: 56;
    helperAddress: Address;
    userId: string;
    walletId: string;
  }): Promise<HelperResidualPage | null> {
    return this.#residuals.get(residualKey(input))?.at(-1) ?? null;
  }

  verifications(): readonly StoredHelperVerification[] {
    return this.#verifications.map((entry) => ({ ...entry, failures: [...entry.failures] }));
  }
}

export class WalletHelperReadService implements WalletHelperReadApplication {
  readonly #now: () => Date;
  readonly #registry: BscHelperReadRegistry;
  readonly #rpc: PositionReadRpc;
  readonly #store: WalletHelperReadStore;

  constructor(options: WalletHelperReadServiceOptions) {
    this.#registry = options.registry ?? BSC_HELPER_READ_REGISTRY;
    validateBscHelperReadRegistry(this.#registry);
    this.#now = options.now ?? (() => new Date());
    this.#rpc = options.rpc;
    this.#store = options.store;
  }

  async resolveTrustedAddress(input: {
    chainId: 56;
    userId: string;
    walletId: string;
  }): Promise<Address | null> {
    if (
      input.chainId !== 56 ||
      !uuidPattern.test(input.userId) ||
      !uuidPattern.test(input.walletId)
    ) {
      throw new Error("HELPER_STATUS_INPUT_INVALID");
    }
    const binding = await this.#store.findBinding(input);
    if (!binding) return null;
    if (
      !addressPattern.test(binding.helperAddress) ||
      binding.helperAddress !== binding.helperAddress.toLowerCase()
    ) {
      throw new Error("HELPER_BINDING_INVALID");
    }
    return binding.helperAddress;
  }

  async status(input: WalletHelperStatusInput): Promise<Readonly<WalletHelperStatus>> {
    if (
      input.chainId !== 56 ||
      !uuidPattern.test(input.userId) ||
      !uuidPattern.test(input.walletId) ||
      !addressPattern.test(input.walletAddress.toLowerCase())
    ) {
      throw new Error("HELPER_STATUS_INPUT_INVALID");
    }
    const walletAddress = input.walletAddress.toLowerCase() as Address;
    const binding = await this.#store.findBinding(input);
    if (!binding) {
      return freezeStatus({
        address: null,
        chainId: 56,
        failures: [],
        helperVersion: null,
        owner: walletAddress,
        registryVersion: this.#registry.registryVersion,
        state: "undeployed",
        verification: null,
        walletId: input.walletId,
      });
    }
    const version = this.#registry.versions.find(
      (candidate) => candidate.helperVersion === binding.helperVersion,
    );
    const failures = new Set<HelperVerificationFailure>();
    const versionMatches = version !== undefined;
    if (!versionMatches) failures.add("version-unregistered");
    const addressMatches =
      addressPattern.test(binding.helperAddress) &&
      binding.helperAddress === binding.helperAddress.toLowerCase();
    if (!addressMatches) failures.add("address-mismatch");

    const snapshot = await this.#rpc.getBlock("latest");
    let code: Hex | null = null;
    let observedOwner: Address | null = null;
    try {
      code = await this.#rpc.getCode(binding.helperAddress, snapshot.blockNumber);
    } catch {
      failures.add("provider-read-failed");
    }
    try {
      const data = encodeFunctionData({ abi: HELPER_OWNER_READ_ABI, functionName: "owner" });
      const result = await this.#rpc.call({
        blockNumber: snapshot.blockNumber,
        data,
        to: binding.helperAddress,
      });
      const decoded = decodeFunctionResult({
        abi: HELPER_OWNER_READ_ABI,
        data: result,
        functionName: "owner",
      });
      if (typeof decoded !== "string" || !addressPattern.test(decoded.toLowerCase())) {
        throw new Error("HELPER_OWNER_RESPONSE_INVALID");
      }
      observedOwner = decoded.toLowerCase() as Address;
    } catch {
      failures.add("provider-read-failed");
    }

    const observedRuntimeCodeHash = code === null ? null : keccak256(code);
    const observedSelectors = code === null ? [] : extractPush4Selectors(code);
    const ownerMatches = observedOwner !== null && observedOwner === walletAddress;
    if (observedOwner !== null && !ownerMatches) failures.add("owner-mismatch");
    const runtimeCodeHashMatches =
      version !== undefined &&
      observedRuntimeCodeHash !== null &&
      observedRuntimeCodeHash.toLowerCase() === version.runtimeCodeHash.toLowerCase();
    if (version && observedRuntimeCodeHash !== null && !runtimeCodeHashMatches) {
      failures.add("runtime-code-hash-mismatch");
    }
    const selectorSetMatches =
      version !== undefined && sameSelectors(observedSelectors, version.requiredSelectors);
    if (version && code !== null && !selectorSetMatches) failures.add("selector-set-mismatch");
    try {
      const canonical = await this.#rpc.getBlock(snapshot.blockNumber);
      if (canonical.blockHash.toLowerCase() !== snapshot.blockHash.toLowerCase()) {
        failures.add("provider-read-failed");
      }
    } catch {
      failures.add("provider-read-failed");
    }

    const failureList = [...failures].sort((left, right) => left.localeCompare(right));
    const verificationWithoutDigest = {
      blockHash: snapshot.blockHash,
      blockNumber: snapshot.blockNumber,
      blockTimestamp: snapshot.blockTimestamp,
      checks: {
        address: addressMatches,
        owner: ownerMatches,
        runtimeCodeHash: runtimeCodeHashMatches,
        selectorSet: selectorSetMatches,
        version: versionMatches,
      },
      observedOwner,
      observedRuntimeCodeHash,
      observedSelectors,
      verifiedAt: this.#now().toISOString(),
    } satisfies Omit<HelperVerificationSnapshot, "digest">;
    const verification = freezeVerification({
      ...verificationWithoutDigest,
      digest: helperDigest({ binding, failures: failureList, verification: verificationWithoutDigest }),
    });
    await this.#store.appendVerification({
      bindingId: binding.bindingId,
      chainId: 56,
      failures: failureList,
      helperAddress: binding.helperAddress,
      helperVersion: binding.helperVersion,
      userId: input.userId,
      verification,
      walletId: input.walletId,
    });

    let state: WalletHelperStatus["state"] =
      failureList.length > 0
        ? "degraded"
        : binding.helperVersion === this.#registry.currentVersion
          ? "active"
          : "superseded";
    if (state !== "degraded") {
      const residual = await this.#store.latestResidualSnapshot({
        chainId: 56,
        helperAddress: binding.helperAddress,
        userId: input.userId,
        walletId: input.walletId,
      });
      if (residual && residual.items.length > 0) state = "residual";
    }
    return freezeStatus({
      address: binding.helperAddress,
      chainId: 56,
      failures: failureList,
      helperVersion: binding.helperVersion,
      owner: walletAddress,
      registryVersion: this.#registry.registryVersion,
      state,
      verification,
      walletId: input.walletId,
    });
  }
}
