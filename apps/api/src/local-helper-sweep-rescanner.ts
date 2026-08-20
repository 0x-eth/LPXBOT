import type { LocalHelperResidualSnapshot } from "@lpbot/domain/local-helper-sweep";

import { LocalHelperSweepError, type LocalHelperSweepApplication } from "./local-helper-sweeps.js";
import type { WalletDirectory } from "./wallets.js";

export interface LocalHelperSweepRescanRequest {
  batchId: string;
  helperAddress: `0x${string}`;
  tenantId: string;
  userId: string;
  walletAddress: `0x${string}`;
  walletId: string;
}

export class LocalHelperSweepApplicationRescanner {
  constructor(
    readonly application: Pick<LocalHelperSweepApplication, "scan">,
    readonly wallets: Pick<WalletDirectory, "getWallet">,
  ) {}

  async rescan(input: LocalHelperSweepRescanRequest): Promise<LocalHelperResidualSnapshot> {
    const wallet = await this.wallets.getWallet(input.userId, input.walletId);
    if (!wallet || wallet.address.toLowerCase() !== input.walletAddress.toLowerCase()) {
      throw new LocalHelperSweepError("WALLET_NOT_FOUND");
    }
    const snapshot = await this.application.scan({
      idempotencyKey: `helper-sweep-rescan:${input.batchId}`,
      tenantId: input.tenantId,
      userId: input.userId,
      wallet,
    });
    if (
      snapshot.wallet.walletId !== input.walletId ||
      snapshot.wallet.address.toLowerCase() !== input.walletAddress.toLowerCase() ||
      snapshot.binding.helperAddress.toLowerCase() !== input.helperAddress.toLowerCase()
    ) {
      throw new LocalHelperSweepError("HELPER_BINDING_MISMATCH");
    }
    return snapshot;
  }
}
