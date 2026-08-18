import { pathToFileURL } from "node:url";

import type { Server } from "node:http";
import { Pool, type QueryResultRow } from "pg";

import { CustodySignerService } from "./custody-signer-service.js";
import { HttpKmsClient } from "./http-kms-client.js";
import { createSignerHttpServer } from "./http-server.js";
import { IsolatedWalletSigner } from "./isolated-wallet-signer.js";
import type { KmsClient } from "./kms.js";
import { PostgresCustodyWalletStore } from "./postgres-custody-wallet-store.js";
import {
  loadSignerProductionConfig,
  SignerConfigurationError,
  type SignerProductionConfig,
} from "./production-config.js";
import { SignerError } from "./signer-error.js";

interface CustodyTablesRow extends QueryResultRow {
  auditEvents: string | null;
  envelopes: string | null;
  wallets: string | null;
}

export interface SignerRuntime {
  close(): Promise<void>;
  url: string;
}

export interface SignerRuntimeDependencies {
  kms?: KmsClient;
  pool?: Pool;
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
         to_regclass('public.custody_wallet_envelopes')::text AS envelopes,
         to_regclass('public.custody_wallets')::text AS wallets`,
    );
    row = result.rows[0];
  } catch {
    throw new SignerError("CUSTODY_STORE_UNAVAILABLE", true);
  }
  if (!row?.auditEvents || !row.envelopes || !row.wallets) {
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
    const service = new CustodySignerService({ signer, store });
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
        await closeServer(server!);
        await pool.end();
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
