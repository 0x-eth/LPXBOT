import { randomUUID } from "node:crypto";

import type { LocalHelperSweepRegistry } from "@lpbot/chain-registry";
import type { LocalHelperResidualSnapshot } from "@lpbot/domain/local-helper-sweep";

import {
  LocalHelperSweepService,
  MemoryLocalHelperResidualSnapshotStore,
  MemoryLocalHelperSweepBindingStore,
  MemoryLocalHelperSweepOperationStore,
  MemoryLocalHelperSweepPreviewStore,
  type LocalHelperResidualChainReader,
} from "./local-helper-sweeps.js";
import type { LocalHelperUpgradeResidualReader } from "./local-helper-upgrades.js";

export class LocalHelperUpgradeSweepResidualReader implements LocalHelperUpgradeResidualReader {
  readonly #chain: LocalHelperResidualChainReader;
  readonly #idempotencyKey: () => string;
  readonly #now: () => Date;
  readonly #registry: LocalHelperSweepRegistry | undefined;

  constructor(input: {
    chain: LocalHelperResidualChainReader;
    idempotencyKey?: () => string;
    now?: () => Date;
    registry?: LocalHelperSweepRegistry;
  }) {
    this.#chain = input.chain;
    this.#idempotencyKey = input.idempotencyKey ?? (() => `upgrade-${randomUUID()}`);
    this.#now = input.now ?? (() => new Date());
    this.#registry = input.registry;
  }

  async scan(input: Parameters<LocalHelperUpgradeResidualReader["scan"]>[0]) {
    const sweeps = new LocalHelperSweepService({
      bindings: new MemoryLocalHelperSweepBindingStore([
        { ...input.binding, tenantId: input.tenantId, userId: input.userId },
      ]),
      chain: this.#chain,
      now: this.#now,
      operations: new MemoryLocalHelperSweepOperationStore({ now: this.#now }),
      previews: new MemoryLocalHelperSweepPreviewStore(),
      ...(this.#registry ? { registry: this.#registry } : {}),
      snapshots: new MemoryLocalHelperResidualSnapshotStore(),
    });
    const snapshot = await sweeps.scan({
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
