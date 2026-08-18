import type { CustodyWallet, CustodyWalletPage, WalletLockStatus } from "@lpbot/api-contract";
import type { Pool, QueryResultRow } from "pg";

import { publicWalletDto, type WalletDirectory } from "./wallets.js";

interface WalletMetadataRow extends QueryResultRow {
  address: `0x${string}`;
  created_at: Date;
  current_envelope_version: number;
  lock_status: WalletLockStatus;
  mode: "server-kek";
  name: string;
  revision: string;
  updated_at: Date;
  wallet_id: string;
}

const publicColumns = `
  wallet_id::text, name, address, mode, lock_status, current_envelope_version,
  revision::text, created_at, updated_at`;

function walletDto(row: WalletMetadataRow): CustodyWallet {
  return publicWalletDto({
    address: row.address,
    createdAt: row.created_at.toISOString(),
    envelopeVersion: Number(row.current_envelope_version),
    lockStatus: row.lock_status,
    mode: row.mode,
    name: row.name,
    revision: Number(row.revision),
    updatedAt: row.updated_at.toISOString(),
    walletId: row.wallet_id,
  });
}

export class PostgresWalletDirectory implements WalletDirectory {
  readonly #pool: Pool;

  constructor(pool: Pool) {
    this.#pool = pool;
  }

  async getWallet(userId: string, walletId: string): Promise<CustodyWallet | null> {
    const result = await this.#pool.query<WalletMetadataRow>(
      `SELECT ${publicColumns}
         FROM custody_wallets
        WHERE user_id = $1 AND wallet_id = $2
          AND lifecycle_status IN ('active', 'recoverable')`,
      [userId, walletId],
    );
    return result.rows[0] ? walletDto(result.rows[0]) : null;
  }

  async listWallets(userId: string): Promise<CustodyWalletPage> {
    const result = await this.#pool.query<WalletMetadataRow>(
      `SELECT ${publicColumns}
         FROM custody_wallets
        WHERE user_id = $1 AND lifecycle_status IN ('active', 'recoverable')
        ORDER BY created_at DESC, wallet_id DESC`,
      [userId],
    );
    return { items: result.rows.map(walletDto) };
  }
}
