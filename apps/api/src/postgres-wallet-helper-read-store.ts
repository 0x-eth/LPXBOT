import type {
  HelperResidualAsset,
  HelperResidualPage,
  HelperVerificationFailure,
} from "@lpbot/api-contract";
import type { Pool, PoolClient, QueryResult, QueryResultRow } from "pg";
import type { Address, Hex } from "viem";

import type {
  StoredHelperVerification,
  WalletHelperBinding,
  WalletHelperBindingSource,
  WalletHelperReadStore,
} from "./helper-read-model.js";

interface Queryable {
  query<T extends QueryResultRow>(text: string, values?: unknown[]): Promise<QueryResult<T>>;
}

interface BindingRow extends QueryResultRow {
  binding_id: string;
  bound_at: Date;
  chain_id: number;
  helper_address: Address;
  helper_version: string;
  registry_version: string;
  source: WalletHelperBindingSource;
  user_id: string;
  wallet_id: string;
}

interface ResidualRow extends QueryResultRow {
  allowlist_version: string;
  block_hash: Hex;
  block_number: string;
  block_timestamp: Date;
  chain_id: number;
  coverage: unknown;
  helper_address: Address;
  items: unknown;
  registry_version: string;
  scan_id: string;
  scanned_at: Date;
  snapshot_digest: Hex;
  state: HelperResidualPage["state"];
  wallet_id: string;
}

const addressPattern = /^0x[0-9a-f]{40}$/u;
const decimalPattern = /^(?:0|[1-9][0-9]*)$/u;
const hashPattern = /^0x[0-9a-f]{64}$/u;
const selectorPattern = /^0x[0-9a-f]{8}$/u;
const idempotencyPattern = /^[A-Za-z0-9](?:[A-Za-z0-9._:-]{0,126}[A-Za-z0-9])?$/u;
const versionPattern = /^[a-z0-9](?:[a-z0-9.-]{0,62}[a-z0-9])?$/u;
const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
const verificationFailures = new Set<HelperVerificationFailure>([
  "address-mismatch",
  "owner-mismatch",
  "provider-read-failed",
  "runtime-code-hash-mismatch",
  "selector-set-mismatch",
  "version-unregistered",
]);

const bindingColumns = `
  binding_id::text, user_id::text, wallet_id::text, chain_id::integer,
  helper_address, helper_version, registry_version, source, bound_at`;
const residualColumns = `
  scan_id::text, wallet_id::text, chain_id::integer, helper_address,
  registry_version, allowlist_version, state, coverage, items,
  block_number::text, block_hash, block_timestamp, snapshot_digest, scanned_at`;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function exactKeys(value: Record<string, unknown>, keys: readonly string[]): boolean {
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  return actual.length === expected.length && actual.every((key, index) => key === expected[index]);
}

function validDate(value: Date): boolean {
  return value instanceof Date && Number.isFinite(value.getTime());
}

function canonicalBinding(input: WalletHelperBinding): WalletHelperBinding {
  if (input.source !== "deployment-result" && input.source !== "trusted-migration") {
    throw new Error("HELPER_BINDING_SOURCE_INVALID");
  }
  if (
    !uuidPattern.test(input.bindingId) ||
    !uuidPattern.test(input.userId) ||
    !uuidPattern.test(input.walletId) ||
    input.chainId !== 56 ||
    !addressPattern.test(input.helperAddress) ||
    !versionPattern.test(input.helperVersion) ||
    input.registryVersion !== "p05-bsc-execution-v1" ||
    !validDate(input.boundAt)
  ) {
    throw new Error("HELPER_BINDING_INVALID");
  }
  return { ...input, boundAt: new Date(input.boundAt) };
}

function bindingFromRow(row: BindingRow): WalletHelperBinding {
  return canonicalBinding({
    bindingId: row.binding_id,
    boundAt: row.bound_at,
    chainId: row.chain_id as 56,
    helperAddress: row.helper_address,
    helperVersion: row.helper_version,
    registryVersion: row.registry_version,
    source: row.source,
    userId: row.user_id,
    walletId: row.wallet_id,
  });
}

function sameBinding(left: WalletHelperBinding, right: WalletHelperBinding): boolean {
  return (
    left.bindingId === right.bindingId &&
    left.boundAt.getTime() === right.boundAt.getTime() &&
    left.chainId === right.chainId &&
    left.helperAddress === right.helperAddress &&
    left.helperVersion === right.helperVersion &&
    left.registryVersion === right.registryVersion &&
    left.source === right.source &&
    left.userId === right.userId &&
    left.walletId === right.walletId
  );
}

function coverageFrom(value: unknown): HelperResidualPage["coverage"] {
  if (
    !isRecord(value) ||
    !exactKeys(value, [
      "allowlistComplete",
      "complete",
      "missingSources",
      "positionTokensComplete",
      "walletTokenRegistryComplete",
    ]) ||
    typeof value.allowlistComplete !== "boolean" ||
    typeof value.complete !== "boolean" ||
    typeof value.positionTokensComplete !== "boolean" ||
    typeof value.walletTokenRegistryComplete !== "boolean" ||
    !Array.isArray(value.missingSources) ||
    value.missingSources.length > 2_048 ||
    !value.missingSources.every(
      (source) =>
        typeof source === "string" &&
        source.length >= 1 &&
        source.length <= 256 &&
        !/\p{Cc}/u.test(source),
    ) ||
    new Set(value.missingSources).size !== value.missingSources.length ||
    value.complete !== (value.missingSources.length === 0)
  ) {
    throw new RangeError("Stored Helper residual coverage is invalid");
  }
  return {
    allowlistComplete: value.allowlistComplete,
    complete: value.complete,
    missingSources: [...value.missingSources] as string[],
    positionTokensComplete: value.positionTokensComplete,
    walletTokenRegistryComplete: value.walletTokenRegistryComplete,
  };
}

function amount(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value.length <= 78 &&
    decimalPattern.test(value) &&
    BigInt(value) > 0n
  );
}

function residualAsset(value: unknown): HelperResidualAsset {
  if (!isRecord(value) || !amount(value.amountBaseUnit) || value.chainId !== 56) {
    throw new RangeError("Stored Helper residual asset is invalid");
  }
  if (
    value.kind === "native" &&
    exactKeys(value, ["amountBaseUnit", "assetId", "chainId", "kind", "tokenAddress"]) &&
    value.assetId === "native:56" &&
    value.tokenAddress === null
  ) {
    return {
      amountBaseUnit: value.amountBaseUnit,
      assetId: value.assetId,
      chainId: 56,
      kind: "native",
      tokenAddress: null,
    };
  }
  if (
    value.kind === "token" &&
    exactKeys(value, ["amountBaseUnit", "assetId", "chainId", "kind", "tokenAddress"]) &&
    typeof value.tokenAddress === "string" &&
    addressPattern.test(value.tokenAddress) &&
    value.assetId === `token:${value.tokenAddress}`
  ) {
    return {
      amountBaseUnit: value.amountBaseUnit,
      assetId: value.assetId,
      chainId: 56,
      kind: "token",
      tokenAddress: value.tokenAddress as Address,
    };
  }
  if (
    value.kind === "allowance" &&
    exactKeys(value, [
      "amountBaseUnit",
      "assetId",
      "chainId",
      "kind",
      "spenderAddress",
      "tokenAddress",
    ]) &&
    typeof value.tokenAddress === "string" &&
    addressPattern.test(value.tokenAddress) &&
    typeof value.spenderAddress === "string" &&
    addressPattern.test(value.spenderAddress) &&
    value.assetId === `allowance:${value.tokenAddress}:${value.spenderAddress}`
  ) {
    return {
      amountBaseUnit: value.amountBaseUnit,
      assetId: value.assetId,
      chainId: 56,
      kind: "allowance",
      spenderAddress: value.spenderAddress as Address,
      tokenAddress: value.tokenAddress as Address,
    };
  }
  if (
    value.kind === "nft" &&
    exactKeys(value, [
      "amountBaseUnit",
      "assetId",
      "chainId",
      "kind",
      "managerAddress",
      "tokenAddress",
      "tokenId",
    ]) &&
    value.amountBaseUnit === "1" &&
    typeof value.managerAddress === "string" &&
    addressPattern.test(value.managerAddress) &&
    value.tokenAddress === null &&
    typeof value.tokenId === "string" &&
    value.tokenId.length <= 78 &&
    decimalPattern.test(value.tokenId) &&
    value.assetId === `nft:${value.managerAddress}:${value.tokenId}`
  ) {
    return {
      amountBaseUnit: "1",
      assetId: value.assetId,
      chainId: 56,
      kind: "nft",
      managerAddress: value.managerAddress as Address,
      tokenAddress: null,
      tokenId: value.tokenId,
    };
  }
  throw new RangeError("Stored Helper residual asset is invalid");
}

function itemsFrom(value: unknown): HelperResidualAsset[] {
  if (!Array.isArray(value) || value.length > 10_000) {
    throw new RangeError("Stored Helper residual items are invalid");
  }
  const items = value.map(residualAsset);
  if (new Set(items.map(({ assetId }) => assetId)).size !== items.length) {
    throw new RangeError("Stored Helper residual items are duplicated");
  }
  return items;
}

function freezeResidualPage(page: HelperResidualPage): Readonly<HelperResidualPage> {
  for (const item of page.items) Object.freeze(item);
  Object.freeze(page.coverage.missingSources);
  Object.freeze(page.coverage);
  Object.freeze(page.items);
  Object.freeze(page.snapshot);
  return Object.freeze(page);
}

function residualFromRow(row: ResidualRow): Readonly<HelperResidualPage> {
  const coverage = coverageFrom(row.coverage);
  const items = itemsFrom(row.items);
  if (
    !uuidPattern.test(row.scan_id) ||
    !uuidPattern.test(row.wallet_id) ||
    row.chain_id !== 56 ||
    !addressPattern.test(row.helper_address) ||
    row.registry_version !== "p05-bsc-execution-v1" ||
    !versionPattern.test(row.allowlist_version) ||
    !decimalPattern.test(row.block_number) ||
    row.block_number.length > 78 ||
    !hashPattern.test(row.block_hash) ||
    !hashPattern.test(row.snapshot_digest) ||
    !validDate(row.block_timestamp) ||
    !validDate(row.scanned_at) ||
    !(["empty", "ready", "partial"] as const).includes(row.state) ||
    (coverage.complete && row.state === "partial") ||
    (!coverage.complete && row.state !== "partial") ||
    (coverage.complete && items.length === 0 && row.state !== "empty") ||
    (coverage.complete && items.length > 0 && row.state !== "ready")
  ) {
    throw new RangeError("Stored Helper residual snapshot is invalid");
  }
  return freezeResidualPage({
    allowlistVersion: row.allowlist_version,
    chainId: 56,
    coverage,
    cursor: null,
    helperAddress: row.helper_address,
    items,
    registryVersion: row.registry_version,
    scanId: row.scan_id,
    scannedAt: row.scanned_at.toISOString(),
    snapshot: {
      blockHash: row.block_hash,
      blockNumber: row.block_number,
      blockTimestamp: row.block_timestamp.toISOString(),
      digest: row.snapshot_digest,
    },
    state: row.state,
    walletId: row.wallet_id,
  });
}

function canonicalResidual(input: HelperResidualPage): Readonly<HelperResidualPage> {
  if (input.cursor !== null) throw new RangeError("Helper residual snapshots cannot store cursors");
  return residualFromRow({
    allowlist_version: input.allowlistVersion,
    block_hash: input.snapshot.blockHash,
    block_number: input.snapshot.blockNumber,
    block_timestamp: new Date(input.snapshot.blockTimestamp),
    chain_id: input.chainId,
    coverage: input.coverage,
    helper_address: input.helperAddress,
    items: input.items,
    registry_version: input.registryVersion,
    scan_id: input.scanId,
    scanned_at: new Date(input.scannedAt),
    snapshot_digest: input.snapshot.digest,
    state: input.state,
    wallet_id: input.walletId,
  });
}

function canonicalVerification(input: StoredHelperVerification): StoredHelperVerification {
  const verification = input.verification;
  const failureSet = new Set(input.failures);
  const selectors = [...verification.observedSelectors];
  if (
    !uuidPattern.test(input.bindingId) ||
    !uuidPattern.test(input.userId) ||
    !uuidPattern.test(input.walletId) ||
    input.chainId !== 56 ||
    !addressPattern.test(input.helperAddress) ||
    !versionPattern.test(input.helperVersion) ||
    input.failures.length > verificationFailures.size ||
    failureSet.size !== input.failures.length ||
    !input.failures.every((failure) => verificationFailures.has(failure)) ||
    !decimalPattern.test(verification.blockNumber) ||
    verification.blockNumber.length > 78 ||
    !hashPattern.test(verification.blockHash) ||
    !hashPattern.test(verification.digest) ||
    new Date(verification.blockTimestamp).toISOString() !== verification.blockTimestamp ||
    new Date(verification.verifiedAt).toISOString() !== verification.verifiedAt ||
    (verification.observedOwner !== null && !addressPattern.test(verification.observedOwner)) ||
    (verification.observedRuntimeCodeHash !== null &&
      !hashPattern.test(verification.observedRuntimeCodeHash)) ||
    selectors.length > 256 ||
    new Set(selectors).size !== selectors.length ||
    !selectors.every((selector) => selectorPattern.test(selector))
  ) {
    throw new RangeError("Helper verification snapshot is invalid");
  }
  const checks = verification.checks;
  if (
    !isRecord(checks) ||
    !exactKeys(checks, ["address", "owner", "runtimeCodeHash", "selectorSet", "version"]) ||
    Object.values(checks).some((value) => typeof value !== "boolean")
  ) {
    throw new RangeError("Helper verification checks are invalid");
  }
  return {
    ...input,
    failures: [...input.failures],
    verification: {
      ...verification,
      checks: { ...checks },
      observedSelectors: selectors,
    },
  };
}

async function rollback(client: PoolClient): Promise<void> {
  await client.query("ROLLBACK").catch(() => undefined);
}

export class PostgresWalletHelperReadStore implements WalletHelperReadStore {
  readonly #pool: Pool;

  constructor(pool: Pool) {
    this.#pool = pool;
  }

  async recordTrustedBinding(input: WalletHelperBinding): Promise<WalletHelperBinding> {
    const binding = canonicalBinding(input);
    const inserted = await this.#pool.query<BindingRow>(
      `INSERT INTO wallet_helper_bindings (
         binding_id, user_id, wallet_id, chain_id, helper_address,
         helper_version, registry_version, source, bound_at
       ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
       ON CONFLICT DO NOTHING
       RETURNING ${bindingColumns}`,
      [
        binding.bindingId,
        binding.userId,
        binding.walletId,
        binding.chainId,
        binding.helperAddress,
        binding.helperVersion,
        binding.registryVersion,
        binding.source,
        binding.boundAt,
      ],
    );
    if (inserted.rows[0]) return bindingFromRow(inserted.rows[0]);
    const existing = await this.#pool.query<BindingRow>(
      `SELECT ${bindingColumns}
         FROM wallet_helper_bindings
        WHERE binding_id = $1`,
      [binding.bindingId],
    );
    const current = existing.rows[0] ? bindingFromRow(existing.rows[0]) : null;
    if (!current || !sameBinding(current, binding)) throw new Error("HELPER_BINDING_CONFLICT");
    return current;
  }

  async appendResidualSnapshot(input: {
    idempotencyKey: string;
    page: HelperResidualPage;
    userId: string;
  }): Promise<HelperResidualPage> {
    if (!uuidPattern.test(input.userId) || !idempotencyPattern.test(input.idempotencyKey)) {
      throw new RangeError("Helper residual persistence input is invalid");
    }
    const page = canonicalResidual(input.page);
    const client = await this.#pool.connect();
    try {
      await client.query("BEGIN");
      await client.query("SELECT pg_advisory_xact_lock(hashtextextended($1, 0))", [
        `${input.userId}:${page.walletId}:56:${input.idempotencyKey}`,
      ]);
      const existing = await this.#findResidual(client, {
        chainId: 56,
        idempotencyKey: input.idempotencyKey,
        userId: input.userId,
        walletId: page.walletId,
      });
      if (existing) {
        await client.query("COMMIT");
        return existing;
      }
      const bindings = await client.query<BindingRow>(
        `SELECT ${bindingColumns}
           FROM wallet_helper_bindings
          WHERE user_id = $1 AND wallet_id = $2 AND chain_id = 56
            AND helper_address = $3
          ORDER BY bound_at DESC, binding_id DESC
          LIMIT 1`,
        [input.userId, page.walletId, page.helperAddress],
      );
      const binding = bindings.rows[0] ? bindingFromRow(bindings.rows[0]) : null;
      if (!binding) throw new Error("HELPER_BINDING_NOT_FOUND");
      const inserted = await client.query<ResidualRow>(
        `INSERT INTO wallet_helper_residual_snapshots (
           scan_id, binding_id, user_id, wallet_id, chain_id, helper_address,
           helper_version, idempotency_key, registry_version, allowlist_version,
           state, coverage, items, block_number, block_hash, block_timestamp,
           snapshot_digest, scanned_at
         ) VALUES (
           $1, $2, $3, $4, 56, $5, $6, $7, $8, $9, $10, $11::jsonb,
           $12::jsonb, $13::numeric, $14, $15, $16, $17
         )
         RETURNING ${residualColumns}`,
        [
          page.scanId,
          binding.bindingId,
          input.userId,
          page.walletId,
          page.helperAddress,
          binding.helperVersion,
          input.idempotencyKey,
          page.registryVersion,
          page.allowlistVersion,
          page.state,
          JSON.stringify(page.coverage),
          JSON.stringify(page.items),
          page.snapshot.blockNumber,
          page.snapshot.blockHash,
          page.snapshot.blockTimestamp,
          page.snapshot.digest,
          page.scannedAt,
        ],
      );
      const stored = inserted.rows[0] ? residualFromRow(inserted.rows[0]) : null;
      if (!stored) throw new Error("HELPER_RESIDUAL_INSERT_FAILED");
      await client.query("COMMIT");
      return stored;
    } catch (error) {
      await rollback(client);
      throw error;
    } finally {
      client.release();
    }
  }

  async appendVerification(input: StoredHelperVerification): Promise<void> {
    const stored = canonicalVerification(input);
    const value = stored.verification;
    await this.#pool.query(
      `INSERT INTO wallet_helper_verification_snapshots (
         binding_id, user_id, wallet_id, chain_id, helper_address, helper_version,
         failures, block_number, block_hash, block_timestamp, checks, digest,
         observed_owner, observed_runtime_code_hash, observed_selectors, verified_at
       ) VALUES (
         $1, $2, $3, 56, $4, $5, $6::jsonb, $7::numeric, $8, $9,
         $10::jsonb, $11, $12, $13, $14::jsonb, $15
       )`,
      [
        stored.bindingId,
        stored.userId,
        stored.walletId,
        stored.helperAddress,
        stored.helperVersion,
        JSON.stringify(stored.failures),
        value.blockNumber,
        value.blockHash,
        value.blockTimestamp,
        JSON.stringify(value.checks),
        value.digest,
        value.observedOwner,
        value.observedRuntimeCodeHash,
        JSON.stringify(value.observedSelectors),
        value.verifiedAt,
      ],
    );
  }

  async findBinding(input: {
    chainId: 56;
    userId: string;
    walletId: string;
  }): Promise<WalletHelperBinding | null> {
    if (
      input.chainId !== 56 ||
      !uuidPattern.test(input.userId) ||
      !uuidPattern.test(input.walletId)
    ) {
      throw new RangeError("Helper binding lookup is invalid");
    }
    const result = await this.#pool.query<BindingRow>(
      `SELECT ${bindingColumns}
         FROM wallet_helper_bindings
        WHERE user_id = $1 AND wallet_id = $2 AND chain_id = 56
        ORDER BY bound_at DESC, binding_id DESC
        LIMIT 1`,
      [input.userId, input.walletId],
    );
    return result.rows[0] ? bindingFromRow(result.rows[0]) : null;
  }

  async findResidualSnapshotByIdempotency(input: {
    chainId: 56;
    idempotencyKey: string;
    userId: string;
    walletId: string;
  }): Promise<HelperResidualPage | null> {
    if (
      input.chainId !== 56 ||
      !uuidPattern.test(input.userId) ||
      !uuidPattern.test(input.walletId) ||
      !idempotencyPattern.test(input.idempotencyKey)
    ) {
      throw new RangeError("Helper residual lookup is invalid");
    }
    return this.#findResidual(this.#pool, input);
  }

  async latestResidualSnapshot(input: {
    chainId: 56;
    helperAddress: Address;
    userId: string;
    walletId: string;
  }): Promise<HelperResidualPage | null> {
    if (
      input.chainId !== 56 ||
      !uuidPattern.test(input.userId) ||
      !uuidPattern.test(input.walletId) ||
      !addressPattern.test(input.helperAddress)
    ) {
      throw new RangeError("Helper residual lookup is invalid");
    }
    const result = await this.#pool.query<ResidualRow>(
      `SELECT ${residualColumns}
         FROM wallet_helper_residual_snapshots
        WHERE user_id = $1 AND wallet_id = $2 AND chain_id = 56
          AND helper_address = $3
        ORDER BY scanned_at DESC, scan_id DESC
        LIMIT 1`,
      [input.userId, input.walletId, input.helperAddress],
    );
    return result.rows[0] ? residualFromRow(result.rows[0]) : null;
  }

  async #findResidual(
    queryable: Queryable,
    input: {
      chainId: 56;
      idempotencyKey: string;
      userId: string;
      walletId: string;
    },
  ): Promise<HelperResidualPage | null> {
    const result = await queryable.query<ResidualRow>(
      `SELECT ${residualColumns}
         FROM wallet_helper_residual_snapshots
        WHERE user_id = $1 AND wallet_id = $2 AND chain_id = $3
          AND idempotency_key = $4`,
      [input.userId, input.walletId, input.chainId, input.idempotencyKey],
    );
    return result.rows[0] ? residualFromRow(result.rows[0]) : null;
  }
}
