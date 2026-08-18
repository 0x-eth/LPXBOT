import { OkxConnectorError } from "./errors.js";
import type {
  OkxCredentialAuditEvent,
  OkxCredentialEnvelope,
  OkxCredentialHead,
  OkxCredentialMutationContext,
  OkxCredentialRepository,
  OkxCredentialVersionRecord,
} from "./types.js";

function cloneEnvelope(envelope: OkxCredentialEnvelope): OkxCredentialEnvelope {
  return {
    ...envelope,
    ciphertext: Buffer.from(envelope.ciphertext),
    createdAt: new Date(envelope.createdAt),
    nonce: Buffer.from(envelope.nonce),
    tag: Buffer.from(envelope.tag),
    wrappedDek: Buffer.from(envelope.wrappedDek),
  };
}

function cloneHead(head: OkxCredentialHead): OkxCredentialHead {
  return {
    ...head,
    rotationDueAt: head.rotationDueAt ? new Date(head.rotationDueAt) : null,
    updatedAt: new Date(head.updatedAt),
  };
}

function unconfiguredHead(userId: string, now: Date): OkxCredentialHead {
  return {
    capabilityEpoch: 0,
    configured: false,
    credentialId: "00000000-0000-0000-0000-000000000000",
    rotationDueAt: null,
    status: "unconfigured",
    updatedAt: now,
    userId,
    version: 0,
  };
}

interface MemoryUserState {
  head: OkxCredentialHead;
  versions: Map<number, OkxCredentialVersionRecord>;
}

export class MemoryOkxCredentialRepository implements OkxCredentialRepository {
  readonly #audits: OkxCredentialAuditEvent[] = [];
  readonly #states = new Map<string, MemoryUserState>();

  auditEvents(): OkxCredentialAuditEvent[] {
    return this.#audits.map((event) => ({ ...event, createdAt: new Date(event.createdAt) }));
  }

  versionRecords(userId: string): OkxCredentialVersionRecord[] {
    return [...(this.#states.get(userId)?.versions.values() ?? [])].map((record) => ({
      ...record,
      destroyedAt: record.destroyedAt ? new Date(record.destroyedAt) : null,
      envelope: cloneEnvelope(record.envelope),
    }));
  }

  async getHead(userId: string): Promise<OkxCredentialHead | null> {
    const state = this.#states.get(userId);
    return state ? cloneHead(state.head) : null;
  }

  async getActiveEnvelope(
    userId: string,
    expectedVersion: number,
  ): Promise<OkxCredentialEnvelope | null> {
    const state = this.#states.get(userId);
    const record = state?.versions.get(expectedVersion);
    if (
      !state ||
      !state.head.configured ||
      state.head.version !== expectedVersion ||
      !record?.active ||
      record.destroyedAt
    ) {
      return null;
    }
    return cloneEnvelope(record.envelope);
  }

  async createStaged(input: {
    context: OkxCredentialMutationContext;
    envelope: OkxCredentialEnvelope;
    expectedActiveVersion: number;
  }): Promise<OkxCredentialHead> {
    const existing = this.#states.get(input.context.userId);
    if (!existing) {
      if (input.expectedActiveVersion !== 0 || input.envelope.version !== 1) {
        throw new OkxConnectorError("VERSION_CONFLICT");
      }
      const head: OkxCredentialHead = {
        capabilityEpoch: 1,
        configured: false,
        credentialId: input.envelope.credentialId,
        rotationDueAt: null,
        status: "staged",
        updatedAt: input.context.now,
        userId: input.context.userId,
        version: 1,
      };
      this.#states.set(input.context.userId, {
        head,
        versions: new Map([
          [
            1,
            {
              active: false,
              destroyedAt: null,
              envelope: cloneEnvelope(input.envelope),
              status: "staged",
            },
          ],
        ]),
      });
      return cloneHead(head);
    }
    if (
      !existing.head.configured ||
      existing.head.status === "deleting" ||
      existing.head.version !== input.expectedActiveVersion ||
      input.envelope.credentialId !== existing.head.credentialId ||
      input.envelope.version !== existing.head.version + 1 ||
      existing.versions.has(input.envelope.version)
    ) {
      throw new OkxConnectorError("VERSION_CONFLICT");
    }
    existing.versions.set(input.envelope.version, {
      active: false,
      destroyedAt: null,
      envelope: cloneEnvelope(input.envelope),
      status: "staged",
    });
    return cloneHead(existing.head);
  }

  async destroyStaged(input: {
    context: OkxCredentialMutationContext;
    version: number;
  }): Promise<void> {
    const state = this.#states.get(input.context.userId);
    const record = state?.versions.get(input.version);
    if (record && !record.active) {
      record.envelope.wrappedDek.fill(0);
      record.envelope.wrappedDek = Buffer.alloc(0);
      record.destroyedAt = input.context.now;
      state!.versions.delete(input.version);
    }
    if (state && !state.head.configured && state.head.version === input.version) {
      this.#states.delete(input.context.userId);
    }
  }

  async activateStaged(input: {
    context: OkxCredentialMutationContext;
    expectedActiveVersion: number;
    rotationDueAt: Date;
    version: number;
  }): Promise<OkxCredentialHead> {
    const state = this.#states.get(input.context.userId);
    const staged = state?.versions.get(input.version);
    const currentVersion = state?.head.configured ? state.head.version : 0;
    if (
      !state ||
      !staged ||
      staged.active ||
      staged.destroyedAt ||
      staged.status !== "staged" ||
      currentVersion !== input.expectedActiveVersion ||
      input.version !== input.expectedActiveVersion + 1 ||
      state.head.status === "deleting"
    ) {
      throw new OkxConnectorError("VERSION_CONFLICT");
    }
    const old = state.versions.get(input.expectedActiveVersion);
    if (old?.active) {
      old.active = false;
      old.status = "revoked";
      old.destroyedAt = input.context.now;
      old.envelope.wrappedDek.fill(0);
      old.envelope.wrappedDek = Buffer.alloc(0);
    }
    staged.active = true;
    staged.status = "usable";
    state.head = {
      ...state.head,
      capabilityEpoch: state.head.capabilityEpoch + 1,
      configured: true,
      rotationDueAt: input.rotationDueAt,
      status: "usable",
      updatedAt: input.context.now,
      version: input.version,
    };
    return cloneHead(state.head);
  }

  async setStatus(input: {
    context: OkxCredentialMutationContext;
    expectedCapabilityEpoch?: number;
    expectedVersion: number;
    status: OkxCredentialHead["status"];
  }): Promise<OkxCredentialHead> {
    const state = this.#states.get(input.context.userId);
    if (
      !state?.head.configured ||
      state.head.version !== input.expectedVersion ||
      state.head.status === "deleting" ||
      (input.expectedCapabilityEpoch !== undefined &&
        state.head.capabilityEpoch !== input.expectedCapabilityEpoch)
    ) {
      throw new OkxConnectorError("VERSION_CONFLICT");
    }
    const nextEpoch =
      input.status === "testing"
        ? state.head.capabilityEpoch + 1
        : state.head.capabilityEpoch;
    state.head = {
      ...state.head,
      capabilityEpoch: nextEpoch,
      status: input.status,
      updatedAt: input.context.now,
    };
    const active = state.versions.get(state.head.version);
    if (active) active.status = input.status;
    return cloneHead(state.head);
  }

  async beginDelete(input: {
    context: OkxCredentialMutationContext;
    expectedVersion: number;
  }): Promise<OkxCredentialHead> {
    const state = this.#states.get(input.context.userId);
    if (!state || !state.head.configured) {
      return state ? cloneHead(state.head) : unconfiguredHead(input.context.userId, input.context.now);
    }
    if (state.head.version !== input.expectedVersion) {
      throw new OkxConnectorError("VERSION_CONFLICT");
    }
    state.head = {
      ...state.head,
      capabilityEpoch: state.head.capabilityEpoch + 1,
      status: "deleting",
      updatedAt: input.context.now,
    };
    const active = state.versions.get(state.head.version);
    if (active) active.status = "deleting";
    return cloneHead(state.head);
  }

  async completeDelete(input: {
    context: OkxCredentialMutationContext;
    expectedVersion: number;
  }): Promise<OkxCredentialHead> {
    const state = this.#states.get(input.context.userId);
    if (!state || !state.head.configured) {
      return state ? cloneHead(state.head) : unconfiguredHead(input.context.userId, input.context.now);
    }
    if (state.head.version !== input.expectedVersion || state.head.status !== "deleting") {
      throw new OkxConnectorError("VERSION_CONFLICT");
    }
    const active = state.versions.get(input.expectedVersion);
    if (active) {
      active.active = false;
      active.status = "revoked";
      active.destroyedAt = input.context.now;
      active.envelope.wrappedDek.fill(0);
      active.envelope.wrappedDek = Buffer.alloc(0);
    }
    state.head = {
      ...state.head,
      configured: false,
      rotationDueAt: null,
      status: "unconfigured",
      updatedAt: input.context.now,
    };
    return cloneHead(state.head);
  }

  async appendAudit(event: OkxCredentialAuditEvent): Promise<void> {
    this.#audits.push({ ...event, createdAt: new Date(event.createdAt) });
  }

  async listRecoverable(now: Date, stagedBefore: Date): Promise<OkxCredentialHead[]> {
    return [...this.#states.values()]
      .map(({ head }) => head)
      .filter(
        (head) =>
          head.status === "deleting" ||
          (head.status === "staged" && head.updatedAt.getTime() <= stagedBefore.getTime()) ||
          (head.configured &&
            head.rotationDueAt !== null &&
            head.rotationDueAt.getTime() <= now.getTime()),
      )
      .map(cloneHead);
  }
}
