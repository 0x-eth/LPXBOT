import { randomUUID } from "node:crypto";

import type { OkxKeyStatus, OkxKeyStatusName } from "@lpbot/api-contract";

import {
  clearCredentials,
  decryptOkxCredentials,
  encryptOkxCredentials,
  parseCredentialIngress,
} from "./credential-crypto.js";
import { OkxConnectorError } from "./errors.js";
import {
  okxCredentialEnvironment,
  okxCredentialMaximumAgeMilliseconds,
  type OkxConnectorApplication,
  type OkxCredentialAuditAction,
  type OkxCredentialBytes,
  type OkxCredentialHead,
  type OkxCredentialMutationContext,
  type OkxCredentialRepository,
  type OkxKmsClient,
  type OkxProviderValidation,
  type OkxReadOnlyTransport,
} from "./types.js";

function publicStatus(head: OkxCredentialHead | null): OkxKeyStatus {
  return head
    ? { configured: head.configured, status: head.status, version: head.version }
    : { configured: false, status: "unconfigured", version: 0 };
}

function validationStatus(result: OkxProviderValidation): OkxKeyStatusName {
  if (result.authentication === "invalid") return "invalid";
  if (result.authentication === "unknown") return "unknown";
  const { read, trade, withdraw } = result.permissions;
  if (trade === true || withdraw === true || read === false || result.ipAllowlisted === false) {
    return "insufficient-permission";
  }
  if (read === null || trade === null || withdraw === null || result.ipAllowlisted === null) {
    return "unknown";
  }
  return read && !trade && !withdraw && result.ipAllowlisted ? "usable" : "insufficient-permission";
}

function validationError(status: OkxKeyStatusName): OkxConnectorError {
  switch (status) {
    case "invalid":
      return new OkxConnectorError("CREDENTIAL_INVALID");
    case "insufficient-permission":
      return new OkxConnectorError("INSUFFICIENT_PERMISSION");
    default:
      return new OkxConnectorError("PROVIDER_UNKNOWN", true);
  }
}

export class OkxCredentialService implements OkxConnectorApplication {
  readonly #environment: string;
  readonly #kms: OkxKmsClient;
  readonly #now: () => Date;
  readonly #repository: OkxCredentialRepository;
  readonly #transport: OkxReadOnlyTransport;

  constructor(input: {
    environment?: string;
    kms: OkxKmsClient;
    now?: () => Date;
    repository: OkxCredentialRepository;
    transport: OkxReadOnlyTransport;
  }) {
    this.#environment = input.environment ?? okxCredentialEnvironment;
    this.#kms = input.kms;
    this.#now = input.now ?? (() => new Date());
    this.#repository = input.repository;
    this.#transport = input.transport;
  }

  async status(userId: string): Promise<OkxKeyStatus> {
    const head = await this.#repository.getHead(userId);
    if (
      head?.configured &&
      head.rotationDueAt &&
      head.rotationDueAt.getTime() <= this.#now().getTime() &&
      head.status !== "revoked" &&
      head.status !== "deleting"
    ) {
      const now = this.#now();
      const context = { actor: "connector-recovery", now, requestId: "rotation-expiry", userId };
      const revoked = await this.#repository.setStatus({
        context,
        expectedVersion: head.version,
        status: "revoked",
      });
      await this.#audit("status-change", context, revoked, true);
      return publicStatus(revoked);
    }
    return publicStatus(head);
  }

  async save(input: OkxCredentialMutationContext & { ingress: Buffer }): Promise<OkxKeyStatus> {
    return this.#stageAndActivate({ ...input, expectedVersion: 0, operation: "save" });
  }

  async replace(
    input: OkxCredentialMutationContext & { expectedVersion: number; ingress: Buffer },
  ): Promise<OkxKeyStatus> {
    if (input.expectedVersion < 1) throw new OkxConnectorError("VERSION_CONFLICT");
    return this.#stageAndActivate({ ...input, operation: "replace" });
  }

  async test(
    input: OkxCredentialMutationContext & { expectedVersion: number },
  ): Promise<OkxKeyStatus> {
    const current = await this.#repository.getHead(input.userId);
    if (!current?.configured) throw new OkxConnectorError("CREDENTIAL_NOT_CONFIGURED");
    if (current.version !== input.expectedVersion) throw new OkxConnectorError("VERSION_CONFLICT");
    if (
      current.status === "revoked" ||
      (current.rotationDueAt && current.rotationDueAt.getTime() <= input.now.getTime())
    ) {
      throw new OkxConnectorError("CREDENTIAL_REVOKED");
    }
    const started = await this.#repository.setStatus({
      context: input,
      expectedVersion: input.expectedVersion,
      status: "testing",
    });
    await this.#audit("test", input, started, true);
    const envelope = await this.#repository.getActiveEnvelope(input.userId, input.expectedVersion);
    if (!envelope) throw new OkxConnectorError("CAPABILITY_EXPIRED");
    let credentials: OkxCredentialBytes | null = null;
    let nextStatus: OkxKeyStatusName = "unknown";
    try {
      credentials = await decryptOkxCredentials(envelope, this.#kms);
      nextStatus = validationStatus(
        await this.#validate(credentials, input, input.expectedVersion),
      );
    } catch (error) {
      if (error instanceof OkxConnectorError && error.code === "CREDENTIAL_INTEGRITY_FAILED") {
        nextStatus = "revoked";
      } else if (error instanceof OkxConnectorError && error.code === "KMS_UNAVAILABLE") {
        nextStatus = "unknown";
      } else {
        nextStatus = "unknown";
      }
    } finally {
      if (credentials) clearCredentials(credentials);
    }
    let completed: OkxCredentialHead;
    try {
      completed = await this.#repository.setStatus({
        context: { ...input, now: this.#now() },
        expectedCapabilityEpoch: started.capabilityEpoch,
        expectedVersion: input.expectedVersion,
        status: nextStatus,
      });
    } catch (error) {
      if (error instanceof OkxConnectorError && error.code === "VERSION_CONFLICT") {
        throw new OkxConnectorError("CAPABILITY_EXPIRED");
      }
      throw error;
    }
    await this.#audit("status-change", input, completed, completed.status !== started.status);
    return publicStatus(completed);
  }

  async delete(
    input: OkxCredentialMutationContext & { expectedVersion: number },
  ): Promise<OkxKeyStatus> {
    const before = await this.#repository.getHead(input.userId);
    if (!before?.configured) {
      await this.#audit("delete", input, before, false);
      return publicStatus(before);
    }
    const deleting = await this.#repository.beginDelete({
      context: input,
      expectedVersion: input.expectedVersion,
    });
    await this.#audit("status-change", input, deleting, true);
    const deleted = await this.#repository.completeDelete({
      context: { ...input, now: this.#now() },
      expectedVersion: input.expectedVersion,
    });
    await this.#audit("delete", input, deleted, true);
    return publicStatus(deleted);
  }

  async revoke(input: OkxCredentialMutationContext & { expectedVersion: number }): Promise<void> {
    const revoked = await this.#repository.setStatus({
      context: input,
      expectedVersion: input.expectedVersion,
      status: "revoked",
    });
    await this.#audit("status-change", input, revoked, true);
  }

  async recover(input?: { now?: Date; stagedTtlMilliseconds?: number }): Promise<number> {
    const now = input?.now ?? this.#now();
    const stagedBefore = new Date(now.getTime() - (input?.stagedTtlMilliseconds ?? 5 * 60_000));
    const records = await this.#repository.listRecoverable(now, stagedBefore);
    let changed = 0;
    for (const head of records) {
      const context = {
        actor: "connector-recovery",
        now,
        requestId: `recover:${head.version}`,
        userId: head.userId,
      };
      if (head.status === "staged") {
        await this.#repository.destroyStaged({ context, version: head.version });
        await this.#audit("status-change", context, head, true, "unconfigured");
        changed += 1;
      } else if (head.status === "deleting") {
        const deleted = await this.#repository.completeDelete({
          context,
          expectedVersion: head.version,
        });
        await this.#audit("delete", context, deleted, true);
        changed += 1;
      } else if (head.status === "testing") {
        const unknown = await this.#repository.setStatus({
          context,
          expectedVersion: head.version,
          status: "unknown",
        });
        await this.#audit("status-change", context, unknown, true);
        changed += 1;
      } else if (
        head.rotationDueAt &&
        head.rotationDueAt.getTime() <= now.getTime() &&
        head.status !== "revoked"
      ) {
        const revoked = await this.#repository.setStatus({
          context,
          expectedVersion: head.version,
          status: "revoked",
        });
        await this.#audit("status-change", context, revoked, true);
        changed += 1;
      }
    }
    return changed;
  }

  async #stageAndActivate(
    input: OkxCredentialMutationContext & {
      expectedVersion: number;
      ingress: Buffer;
      operation: "replace" | "save";
    },
  ): Promise<OkxKeyStatus> {
    let credentials: OkxCredentialBytes | null = null;
    let stagedVersion = input.expectedVersion + 1;
    let staged = false;
    try {
      const current = await this.#repository.getHead(input.userId);
      if (input.operation === "save" && current?.configured) {
        throw new OkxConnectorError("CREDENTIAL_ALREADY_CONFIGURED");
      }
      if (
        input.operation === "replace" &&
        (!current?.configured || current.version !== input.expectedVersion)
      ) {
        throw new OkxConnectorError("VERSION_CONFLICT");
      }
      credentials = parseCredentialIngress(input.ingress);
      const credentialId = current?.configured ? current.credentialId : randomUUID();
      stagedVersion = input.expectedVersion + 1;
      const envelope = await encryptOkxCredentials({
        credentials,
        identity: {
          credentialId,
          environment: this.#environment,
          userId: input.userId,
          version: stagedVersion,
        },
        kms: this.#kms,
        now: input.now,
      });
      await this.#repository.createStaged({
        context: input,
        envelope,
        expectedActiveVersion: input.expectedVersion,
      });
      staged = true;
      const status = validationStatus(await this.#validate(credentials, input, stagedVersion));
      if (status !== "usable") {
        await this.#repository.destroyStaged({
          context: { ...input, now: this.#now() },
          version: stagedVersion,
        });
        staged = false;
        await this.#repository.appendAudit({
          action: input.operation,
          actor: input.actor,
          changed: false,
          createdAt: this.#now(),
          requestId: input.requestId,
          status,
          userId: input.userId,
          version: stagedVersion,
        });
        throw validationError(status);
      }
      const activated = await this.#repository.activateStaged({
        context: { ...input, now: this.#now() },
        expectedActiveVersion: input.expectedVersion,
        rotationDueAt: new Date(this.#now().getTime() + okxCredentialMaximumAgeMilliseconds),
        version: stagedVersion,
      });
      staged = false;
      await this.#audit(input.operation, input, activated, true);
      await this.#audit("status-change", input, activated, true);
      return publicStatus(activated);
    } catch (error) {
      if (staged) {
        await this.#repository.destroyStaged({
          context: { ...input, now: this.#now() },
          version: stagedVersion,
        });
      }
      throw error;
    } finally {
      if (credentials) clearCredentials(credentials);
      input.ingress.fill(0);
    }
  }

  async #validate(
    credentials: OkxCredentialBytes,
    context: OkxCredentialMutationContext,
    version: number,
  ): Promise<OkxProviderValidation> {
    try {
      return await this.#transport.validate(credentials);
    } catch (error) {
      if (error instanceof OkxConnectorError && error.code === "EGRESS_DENIED") {
        await this.#repository.appendAudit({
          action: "egress-denied",
          actor: context.actor,
          changed: false,
          createdAt: this.#now(),
          requestId: context.requestId,
          status: "unknown",
          userId: context.userId,
          version,
        });
      }
      return {
        authentication: "unknown",
        ipAllowlisted: null,
        permissions: { read: null, trade: null, withdraw: null },
      };
    }
  }

  async #audit(
    action: OkxCredentialAuditAction,
    context: OkxCredentialMutationContext,
    head: OkxCredentialHead | null,
    changed: boolean,
    status?: OkxKeyStatusName,
  ): Promise<void> {
    await this.#repository.appendAudit({
      action,
      actor: context.actor,
      changed,
      createdAt: context.now,
      requestId: context.requestId,
      status: status ?? head?.status ?? "unconfigured",
      userId: context.userId,
      version: head?.version ?? 0,
    });
  }
}
