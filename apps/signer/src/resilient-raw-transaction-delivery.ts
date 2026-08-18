import { transferHashPattern } from "@lpbot/domain/wallet-transfer";

import type { RawTransactionDelivery, RawTransactionDeliveryResult } from "./custody-types.js";
import { SignerError } from "./signer-error.js";

export interface RawTransactionBroadcastPort {
  broadcast(input: { chainId: number; rawTransaction: Uint8Array }): Promise<{
    status: "accepted" | "already-known";
    transactionHash: `0x${string}`;
  }>;
  transactionKnown(input: { chainId: number; transactionHash: `0x${string}` }): Promise<boolean>;
}

export class ResilientRawTransactionDelivery implements RawTransactionDelivery {
  readonly #adapterId: string;
  readonly #broadcast: RawTransactionBroadcastPort;

  constructor(input: { adapterId: string; broadcast: RawTransactionBroadcastPort }) {
    if (!/^[a-z0-9](?:[a-z0-9._:-]{0,62}[a-z0-9])?$/u.test(input.adapterId)) {
      throw new RangeError("broadcast adapter id is invalid");
    }
    this.#adapterId = input.adapterId;
    this.#broadcast = input.broadcast;
  }

  async deliver(input: {
    chainId: number;
    operationId: string;
    rawTransaction: Uint8Array;
    transactionHash: `0x${string}`;
  }): Promise<RawTransactionDeliveryResult> {
    if (
      !Number.isSafeInteger(input.chainId) ||
      input.chainId < 1 ||
      !/^[a-z0-9](?:[a-z0-9._:-]{0,126}[a-z0-9])?$/u.test(input.operationId) ||
      input.rawTransaction.byteLength < 1 ||
      !transferHashPattern.test(input.transactionHash)
    ) {
      throw new SignerError("TRANSFER_DELIVERY_UNAVAILABLE", true);
    }
    const deliveryId = `${this.#adapterId}:${input.transactionHash.slice(2, 18)}`;
    try {
      const result = await this.#broadcast.broadcast({
        chainId: input.chainId,
        rawTransaction: input.rawTransaction,
      });
      if (
        result.transactionHash !== input.transactionHash ||
        (result.status !== "accepted" && result.status !== "already-known")
      ) {
        throw new SignerError("TRANSFER_DELIVERY_UNAVAILABLE", true);
      }
      return { deliveryId, status: result.status };
    } catch (error) {
      try {
        if (
          await this.#broadcast.transactionKnown({
            chainId: input.chainId,
            transactionHash: input.transactionHash,
          })
        ) {
          return { deliveryId, status: "already-known" };
        }
      } catch {
        throw new SignerError("TRANSFER_DELIVERY_UNAVAILABLE", true);
      }
      if (error instanceof SignerError && !error.retryable) throw error;
      throw new SignerError("TRANSFER_DELIVERY_UNAVAILABLE", true);
    }
  }
}
