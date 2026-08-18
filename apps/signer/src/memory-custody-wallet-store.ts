import type { CustodyWallet, CustodyWalletPage, WalletLockStatus } from "@lpbot/api-contract";

import type {
  CustodyEnvelope,
  CustodyWalletCreate,
  CustodyWalletStore,
  StoredCustodyWallet,
} from "./custody-types.js";
import { publicWallet } from "./custody-types.js";
import { SignerError } from "./signer-error.js";

function cloneEnvelope(envelope: CustodyEnvelope): CustodyEnvelope {
  return {
    ...envelope,
    ciphertext: Buffer.from(envelope.ciphertext),
    createdAt: new Date(envelope.createdAt),
    nonce: Buffer.from(envelope.nonce),
    tag: Buffer.from(envelope.tag),
    wrappedDek: Buffer.from(envelope.wrappedDek),
  };
}

function cloneWallet(wallet: StoredCustodyWallet): StoredCustodyWallet {
  return {
    ...wallet,
    createdAt: new Date(wallet.createdAt),
    updatedAt: new Date(wallet.updatedAt),
  };
}

export class InMemoryCustodyWalletStore implements CustodyWalletStore {
  readonly #audits: Array<{ action: string; walletId: string }> = [];
  readonly #envelopes = new Map<string, Map<number, CustodyEnvelope>>();
  readonly #failBeforeCommit: boolean;
  readonly #wallets = new Map<string, StoredCustodyWallet>();
  readonly openAttempts: number[] = [];

  constructor(options: { failBeforeCommit?: boolean } = {}) {
    this.#failBeforeCommit = options.failBeforeCommit ?? false;
  }

  get auditCount(): number {
    return this.#audits.length;
  }

  get envelopeCount(): number {
    return [...this.#envelopes.values()].reduce((count, versions) => count + versions.size, 0);
  }

  async create(input: CustodyWalletCreate): Promise<CustodyWallet> {
    const duplicate = [...this.#wallets.values()].some(
      (wallet) =>
        wallet.userId === input.wallet.userId && wallet.addressLower === input.wallet.addressLower,
    );
    if (duplicate) throw new SignerError("WALLET_ADDRESS_EXISTS");
    if (this.#failBeforeCommit) throw new SignerError("CUSTODY_STORE_UNAVAILABLE", true);

    const wallet = cloneWallet(input.wallet);
    const envelope = cloneEnvelope(input.envelope);
    this.#wallets.set(wallet.walletId, wallet);
    this.#envelopes.set(wallet.walletId, new Map([[envelope.envelopeVersion, envelope]]));
    this.#audits.push({ action: input.auditAction, walletId: wallet.walletId });
    return publicWallet(wallet);
  }

  async get(userId: string, walletId: string): Promise<StoredCustodyWallet | null> {
    const wallet = this.#wallets.get(walletId);
    return wallet?.userId === userId ? cloneWallet(wallet) : null;
  }

  async getCurrentEnvelope(walletId: string, envelopeVersion: number): Promise<CustodyEnvelope | null> {
    this.openAttempts.push(envelopeVersion);
    const envelope = this.#envelopes.get(walletId)?.get(envelopeVersion);
    return envelope ? cloneEnvelope(envelope) : null;
  }

  async list(userId: string): Promise<CustodyWalletPage> {
    return {
      items: [...this.#wallets.values()]
        .filter((wallet) => wallet.userId === userId)
        .sort(
          (left, right) =>
            right.createdAt.getTime() - left.createdAt.getTime() ||
            left.walletId.localeCompare(right.walletId),
        )
        .map(publicWallet),
    };
  }

  async setLockStatus(
    userId: string,
    walletId: string,
    status: WalletLockStatus,
    updatedAt: Date,
  ): Promise<void> {
    const wallet = this.#wallets.get(walletId);
    if (!wallet || wallet.userId !== userId) throw new SignerError("WALLET_NOT_FOUND");
    wallet.lockStatus = status;
    wallet.updatedAt = new Date(updatedAt);
    wallet.revision += 1;
  }

  async mutateEnvelopeForTest(
    walletId: string,
    mutate: (envelope: CustodyEnvelope) => CustodyEnvelope,
  ): Promise<void> {
    const wallet = this.#wallets.get(walletId);
    if (!wallet) throw new Error("wallet fixture missing");
    const versions = this.#envelopes.get(walletId)!;
    const envelope = versions.get(wallet.envelopeVersion)!;
    versions.set(wallet.envelopeVersion, cloneEnvelope(mutate(cloneEnvelope(envelope))));
  }
}
