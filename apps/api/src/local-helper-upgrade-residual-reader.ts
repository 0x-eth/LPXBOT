import { randomUUID } from "node:crypto";

import type { LocalHelperResidualSnapshot } from "@lpbot/domain/local-helper-sweep";

import type { LocalHelperSweepApplication } from "./local-helper-sweeps.js";
import type { LocalHelperUpgradeResidualReader } from "./local-helper-upgrades.js";

export class LocalHelperUpgradeSweepResidualReader implements LocalHelperUpgradeResidualReader {
  readonly #idempotencyKey: () => string;
  readonly #sweeps: LocalHelperSweepApplication;

  constructor(input: {
    idempotencyKey?: () => string;
    sweeps: LocalHelperSweepApplication;
  }) {
    this.#idempotencyKey = input.idempotencyKey ?? (() => `upgrade-${randomUUID()}`);
    this.#sweeps = input.sweeps;
  }

  async scan(input: Parameters<LocalHelperUpgradeResidualReader["scan"]>[0]) {
    const snapshot = await this.#sweeps.scan({
      idempotencyKey: this.#idempotencyKey(),
      tenantId: input.tenantId,
      userId: input.userId,
      wallet: input.wallet,
    });
    if (
      snapshot.binding.bindingId !== input.binding.bindingId ||
      snapshot.binding.helperAddress !== input.binding.helperAddress
    ) {
      throw new RangeError("LOCAL_HELPER_UPGRADE_RESIDUAL_BINDING_MISMATCH");
    }
    return structuredClone(snapshot) as LocalHelperResidualSnapshot;
  }
}
