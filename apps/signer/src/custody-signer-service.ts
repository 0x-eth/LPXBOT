import { randomUUID } from "node:crypto";

import type { CustodyWallet, CustodyWalletPage, WalletEncryptionMode } from "@lpbot/api-contract";

import type { CustodyWalletStore, WalletDirectory, WalletSignerClient } from "./custody-types.js";
import { publicWallet } from "./custody-types.js";
import type { IsolatedWalletSigner, SealedWalletDraft } from "./isolated-wallet-signer.js";
import { SignerError, asSignerError } from "./signer-error.js";

export class CustodySignerService implements WalletDirectory, WalletSignerClient {
  readonly #now: () => Date;
  readonly #signer: IsolatedWalletSigner;
  readonly #store: CustodyWalletStore;
  readonly #uuid: () => string;

  constructor(input: {
    now?: () => Date;
    signer: IsolatedWalletSigner;
    store: CustodyWalletStore;
    uuid?: () => string;
  }) {
    this.#now = input.now ?? (() => new Date());
    this.#signer = input.signer;
    this.#store = input.store;
    this.#uuid = input.uuid ?? randomUUID;
  }

  async importWallet(input: {
    ingress: Uint8Array;
    tenantId: string;
    userId: string;
  }): Promise<CustodyWallet> {
    const walletId = this.#uuid();
    const sealed = await this.#signer.importAndSeal({
      envelopeVersion: 1,
      ingress: input.ingress,
      tenantId: input.tenantId,
      userId: input.userId,
      walletId,
    });
    return this.#commit("wallet.import", input, walletId, sealed);
  }

  async generateWallet(input: {
    mode: WalletEncryptionMode;
    name: string;
    tenantId: string;
    userId: string;
  }): Promise<CustodyWallet> {
    if (input.mode !== "server-kek") throw new SignerError("INVALID_MODE");
    for (let attempt = 0; attempt < 32; attempt += 1) {
      const walletId = this.#uuid();
      const sealed = await this.#signer.generateAndSeal({
        envelopeVersion: 1,
        mode: input.mode,
        name: input.name,
        tenantId: input.tenantId,
        userId: input.userId,
        walletId,
      });
      try {
        return await this.#commit("wallet.generate", input, walletId, sealed);
      } catch (error) {
        const signerError = asSignerError(error);
        if (signerError.code !== "WALLET_ADDRESS_EXISTS") throw signerError;
      }
    }
    throw new SignerError("SIGNER_UNAVAILABLE", true);
  }

  async listWallets(userId: string): Promise<CustodyWalletPage> {
    return this.#store.list(userId);
  }

  async getWallet(userId: string, walletId: string): Promise<CustodyWallet | null> {
    const wallet = await this.#store.get(userId, walletId);
    return wallet ? publicWallet(wallet) : null;
  }

  async recoverWallet(input: {
    tenantId: string;
    userId: string;
    walletId: string;
  }): Promise<CustodyWallet> {
    const wallet = await this.#store.get(input.userId, input.walletId);
    if (!wallet || wallet.tenantId !== input.tenantId) throw new SignerError("WALLET_NOT_FOUND");
    const envelope = await this.#store.getCurrentEnvelope(wallet.walletId, wallet.envelopeVersion);
    if (!envelope) {
      await this.#store.setLockStatus(input.userId, input.walletId, "quarantined", this.#now());
      throw new SignerError("KEYSTORE_CORRUPTED");
    }
    try {
      await this.#signer.openAndVerify({ envelope, wallet });
      if (wallet.lockStatus !== "ready") {
        await this.#store.setLockStatus(input.userId, input.walletId, "ready", this.#now());
      }
      return (await this.getWallet(input.userId, input.walletId))!;
    } catch (error) {
      const signerError = asSignerError(error);
      const lockStatus = signerError.code === "KEYSTORE_CORRUPTED" ? "quarantined" : "locked";
      await this.#store.setLockStatus(input.userId, input.walletId, lockStatus, this.#now());
      throw signerError;
    }
  }

  async #commit(
    auditAction: "wallet.generate" | "wallet.import",
    owner: { tenantId: string; userId: string },
    walletId: string,
    sealed: SealedWalletDraft,
  ): Promise<CustodyWallet> {
    const now = this.#now();
    sealed.envelope.createdAt = now;
    return this.#store.create({
      auditAction,
      envelope: sealed.envelope,
      wallet: {
        address: sealed.address,
        addressLower: sealed.addressLower,
        createdAt: now,
        envelopeVersion: sealed.envelope.envelopeVersion,
        lockStatus: "ready",
        mode: sealed.mode,
        name: sealed.name,
        revision: 1,
        tenantId: owner.tenantId,
        updatedAt: now,
        userId: owner.userId,
        walletId,
      },
    });
  }
}
