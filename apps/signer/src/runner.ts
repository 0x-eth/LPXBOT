import { pathToFileURL } from "node:url";

import type { Server } from "node:http";
import { Pool, type QueryResultRow } from "pg";

import { CustodySignerService } from "./custody-signer-service.js";
import type {
  HelperDeploymentPlanAuthorizer,
  LocalHelperSweepPlanAuthorizer,
  LocalHelperUpgradePlanAuthorizer,
  RawTransactionDelivery,
  WalletDependencyInventory,
  WalletTaskCoordinator,
  WalletTransferPlanAuthorizer,
} from "./custody-types.js";
import { HttpKmsClient } from "./http-kms-client.js";
import { createSignerHttpServer } from "./http-server.js";
import { IsolatedWalletSigner } from "./isolated-wallet-signer.js";
import type { KmsClient } from "./kms.js";
import { PostgresCustodyWalletStore } from "./postgres-custody-wallet-store.js";
import { PostgresWalletTransferPlanAuthorizer } from "./postgres-transfer-plan-authorizer.js";
import {
  loadSignerProductionConfig,
  SignerConfigurationError,
  type SignerProductionConfig,
} from "./production-config.js";
import { SignerError } from "./signer-error.js";

interface CustodyTablesRow extends QueryResultRow {
  auditEvents: string | null;
  deletePreviews: string | null;
  envelopes: string | null;
  failures: string | null;
  keystoreVersions: string | null;
  keystores: string | null;
  resetPreviews: string | null;
  securityPasswordAudits: string | null;
  securityPasswordVersions: string | null;
  securityPasswords: string | null;
  tombstones: string | null;
  transferNonceLedgers: string | null;
  transferOperations: string | null;
  transferReplacementAuthorizations: string | null;
  wallets: string | null;
}

export interface SignerRuntime {
  close(): Promise<void>;
  url: string;
}

export interface SignerRuntimeDependencies {
  helperDeploymentPlanAuthorizer?: HelperDeploymentPlanAuthorizer;
  localHelperSweepPlanAuthorizer?: LocalHelperSweepPlanAuthorizer;
  localHelperUpgradePlanAuthorizer?: LocalHelperUpgradePlanAuthorizer;
  kms?: KmsClient;
  pool?: Pool;
  rawTransactionDelivery?: RawTransactionDelivery;
  taskCoordinator?: WalletTaskCoordinator;
  transferPlanAuthorizer?: WalletTransferPlanAuthorizer;
  walletDependencyInventory?: WalletDependencyInventory;
}

function listen(server: Server, config: SignerProductionConfig): Promise<void> {
  return new Promise((resolve, reject) => {
    const onError = (error: Error) => reject(error);
    server.once("error", onError);
    server.listen(config.port, config.host, () => {
      server.off("error", onError);
      resolve();
    });
  });
}

async function closeServer(server: Server): Promise<void> {
  server.closeAllConnections();
  await new Promise<void>((resolve) => server.close(() => resolve()));
}

async function assertStoreReady(pool: Pool): Promise<void> {
  let row: CustodyTablesRow | undefined;
  try {
    const result = await pool.query<CustodyTablesRow>(
      `SELECT
         to_regclass('public.custody_wallet_audit_events')::text AS "auditEvents",
         to_regclass('public.custody_wallet_delete_previews')::text AS "deletePreviews",
         to_regclass('public.custody_wallet_envelopes')::text AS envelopes,
         to_regclass('public.user_keystore_failures')::text AS failures,
         to_regclass('public.user_keystore_versions')::text AS "keystoreVersions",
         to_regclass('public.user_keystores')::text AS keystores,
         to_regclass('public.user_keystore_reset_previews')::text AS "resetPreviews",
         to_regclass('public.security_password_audit_events')::text AS "securityPasswordAudits",
         to_regclass('public.user_security_password_versions')::text AS "securityPasswordVersions",
         to_regclass('public.user_security_passwords')::text AS "securityPasswords",
         to_regclass('public.custody_wallet_tombstones')::text AS tombstones,
         to_regclass('public.custody_wallets')::text AS wallets,
         to_regclass('public.wallet_nonce_ledgers')::text AS "transferNonceLedgers",
         to_regclass('public.wallet_transfer_operations')::text AS "transferOperations",
         to_regclass('public.wallet_transfer_replacement_authorizations')::text
           AS "transferReplacementAuthorizations"`,
    );
    row = result.rows[0];
  } catch {
    throw new SignerError("CUSTODY_STORE_UNAVAILABLE", true);
  }
  if (
    !row?.auditEvents ||
    !row.deletePreviews ||
    !row.envelopes ||
    !row.failures ||
    !row.keystoreVersions ||
    !row.keystores ||
    !row.resetPreviews ||
    !row.securityPasswordAudits ||
    !row.securityPasswordVersions ||
    !row.securityPasswords ||
    !row.tombstones ||
    !row.wallets ||
    !row.transferNonceLedgers ||
    !row.transferOperations ||
    !row.transferReplacementAuthorizations
  ) {
    throw new SignerError("CUSTODY_STORE_UNAVAILABLE", true);
  }
}

export async function startSignerRuntime(
  config: SignerProductionConfig,
  dependencies: SignerRuntimeDependencies = {},
): Promise<SignerRuntime> {
  const pool =
    dependencies.pool ??
    new Pool({
      application_name: config.identity,
      connectionString: config.ciphertextDatabaseUrl,
      max: 4,
    });
  const kms =
    dependencies.kms ??
    new HttpKmsClient({
      identity: config.identity,
      identityToken: config.kms.identityToken,
      keyId: config.kms.keyId,
      keyVersion: config.kms.keyVersion,
      url: config.kms.url,
    });
  let server: Server | null = null;
  try {
    const activeKey = await kms.activeKey();
    if (activeKey.kekId !== config.kms.keyId || activeKey.kekVersion !== config.kms.keyVersion) {
      throw new SignerError("KEK_VERSION_UNAVAILABLE");
    }
    await assertStoreReady(pool);

    const store = new PostgresCustodyWalletStore(pool);
    const signer = new IsolatedWalletSigner({ kms });
    const transferPlanAuthorizer =
      dependencies.transferPlanAuthorizer ??
      new PostgresWalletTransferPlanAuthorizer({ localChainIds: [31_337], pool });
    const service = new CustodySignerService({
      ...(dependencies.helperDeploymentPlanAuthorizer
        ? { helperDeploymentPlanAuthorizer: dependencies.helperDeploymentPlanAuthorizer }
        : {}),
      ...(dependencies.localHelperSweepPlanAuthorizer
        ? { localHelperSweepPlanAuthorizer: dependencies.localHelperSweepPlanAuthorizer }
        : {}),
      ...(dependencies.localHelperUpgradePlanAuthorizer
        ? { localHelperUpgradePlanAuthorizer: dependencies.localHelperUpgradePlanAuthorizer }
        : {}),
      ...(dependencies.rawTransactionDelivery
        ? { rawTransactionDelivery: dependencies.rawTransactionDelivery }
        : {}),
      signer,
      store,
      ...(dependencies.taskCoordinator ? { taskCoordinator: dependencies.taskCoordinator } : {}),
      ...(dependencies.walletDependencyInventory
        ? { walletDependencyInventory: dependencies.walletDependencyInventory }
        : {}),
      transferPlanAuthorizer,
    });
    server = createSignerHttpServer({ apiToken: config.apiToken, service });
    await listen(server, config);
    const address = server.address();
    if (!address || typeof address === "string") throw new SignerError("SIGNER_UNAVAILABLE", true);
    const host = address.family === "IPv6" ? `[${address.address}]` : address.address;
    let closed = false;
    return {
      async close() {
        if (closed) return;
        closed = true;
        try {
          await service.shutdown();
        } finally {
          try {
            await closeServer(server!);
          } finally {
            await pool.end();
          }
        }
      },
      url: `http://${host}:${address.port}`,
    };
  } catch (error) {
    if (server?.listening) await closeServer(server);
    await pool.end();
    throw error;
  }
}

function startupFailureCode(error: unknown): string {
  return error instanceof SignerError || error instanceof SignerConfigurationError
    ? error.code
    : "SIGNER_STARTUP_FAILED";
}

async function main(): Promise<void> {
  const config = loadSignerProductionConfig(process.env);
  const runtime = await startSignerRuntime(config);
  process.stdout.write(`${JSON.stringify({ event: "signer.ready", identity: config.identity })}\n`);
  let stopping = false;
  const stop = () => {
    if (stopping) return;
    stopping = true;
    void runtime.close().then(() => {
      process.stdout.write(`${JSON.stringify({ event: "signer.stopped" })}\n`);
    });
  };
  process.once("SIGINT", stop);
  process.once("SIGTERM", stop);
}

const entrypoint = process.argv[1] ? pathToFileURL(process.argv[1]).href : null;
if (entrypoint === import.meta.url) {
  void main().catch((error: unknown) => {
    process.stderr.write(
      `${JSON.stringify({ code: startupFailureCode(error), event: "signer.failed" })}\n`,
    );
    process.exitCode = 1;
  });
}
