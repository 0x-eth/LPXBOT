import {
  encryptOkxCredentials,
  LocalOkxKmsFixture,
  MemoryOkxCredentialRepository,
  OkxCredentialService,
  OkxTransportFixture,
  parseCredentialIngress,
  usableOkxFixtureValidation,
  type OkxCredentialBytes,
  type OkxProviderValidation,
  type OkxReadOnlyTransport,
} from "../apps/okx-connector/src/index.js";
import { describe, expect, it } from "vitest";

const userId = "71000000-0000-4000-8000-000000000001";
const now = new Date("2026-08-19T02:00:00.000Z");

function body(label: string) {
  return Buffer.from(
    JSON.stringify({
      apiKey: `synthetic-api-${label}`,
      passphrase: `synthetic-pass-${label}`,
      secretKey: `synthetic-secret-${label}`,
    }),
  );
}

function context(requestId: string) {
  return { actor: "fixture-user", now, requestId, userId };
}

describe("P04-07 OKX credential lifecycle", () => {
  it("saves, preserves the old version on failed replacement, switches atomically and crypto-erases", async () => {
    const repository = new MemoryOkxCredentialRepository();
    const transport = new OkxTransportFixture(
      usableOkxFixtureValidation,
      {
        authentication: "valid",
        ipAllowlisted: true,
        permissions: { read: true, trade: true, withdraw: false },
      },
      usableOkxFixtureValidation,
      usableOkxFixtureValidation,
    );
    const service = new OkxCredentialService({
      kms: new LocalOkxKmsFixture({ key: Buffer.alloc(32, 0x51) }),
      now: () => now,
      repository,
      transport,
    });

    await expect(service.status(userId)).resolves.toEqual({
      configured: false,
      status: "unconfigured",
      version: 0,
    });
    await expect(service.save({ ...context("save-1"), ingress: body("one") })).resolves.toEqual({
      configured: true,
      status: "usable",
      version: 1,
    });
    await expect(
      service.replace({ ...context("replace-denied"), expectedVersion: 1, ingress: body("bad") }),
    ).rejects.toMatchObject({ code: "INSUFFICIENT_PERMISSION" });
    await expect(service.status(userId)).resolves.toEqual({
      configured: true,
      status: "usable",
      version: 1,
    });
    expect(repository.versionRecords(userId)).toHaveLength(1);

    await expect(
      service.replace({ ...context("replace-2"), expectedVersion: 1, ingress: body("two") }),
    ).resolves.toMatchObject({ configured: true, status: "usable", version: 2 });
    const versions = repository.versionRecords(userId);
    expect(versions).toHaveLength(2);
    expect(versions.filter(({ active }) => active)).toHaveLength(1);
    expect(
      versions.find(({ envelope }) => envelope.version === 1)?.envelope.wrappedDek,
    ).toHaveLength(0);

    await expect(
      service.test({ ...context("test-stale"), expectedVersion: 1 }),
    ).rejects.toMatchObject({ code: "VERSION_CONFLICT" });
    await expect(service.test({ ...context("test-2"), expectedVersion: 2 })).resolves.toMatchObject(
      {
        status: "usable",
        version: 2,
      },
    );
    await expect(
      service.delete({ ...context("delete-stale"), expectedVersion: 1 }),
    ).rejects.toMatchObject({ code: "VERSION_CONFLICT" });
    await expect(service.delete({ ...context("delete-2"), expectedVersion: 2 })).resolves.toEqual({
      configured: false,
      status: "unconfigured",
      version: 2,
    });
    await expect(
      service.delete({ ...context("delete-again"), expectedVersion: 2 }),
    ).resolves.toEqual({
      configured: false,
      status: "unconfigured",
      version: 2,
    });
    expect(repository.versionRecords(userId)[1]?.envelope.wrappedDek).toHaveLength(0);
    expect(repository.auditEvents().map(({ action }) => action)).toEqual(
      expect.arrayContaining(["save", "replace", "test", "delete", "status-change"]),
    );
    expect(JSON.stringify(repository.auditEvents())).not.toMatch(
      /synthetic-api|synthetic-secret|synthetic-pass/iu,
    );
  });

  it("invalidates an in-flight test capability after replacement and keeps one active version", async () => {
    let releaseTest!: () => void;
    let testEntered!: () => void;
    const entered = new Promise<void>((resolve) => (testEntered = resolve));
    const released = new Promise<void>((resolve) => (releaseTest = resolve));
    let calls = 0;
    const transport: OkxReadOnlyTransport = {
      async validate(_credentials: OkxCredentialBytes): Promise<OkxProviderValidation> {
        calls += 1;
        if (calls === 2) {
          testEntered();
          await released;
        }
        return usableOkxFixtureValidation;
      },
    };
    const repository = new MemoryOkxCredentialRepository();
    const service = new OkxCredentialService({
      kms: new LocalOkxKmsFixture({ key: Buffer.alloc(32, 0x52) }),
      now: () => now,
      repository,
      transport,
    });
    await service.save({ ...context("save-concurrent"), ingress: body("one") });
    const testing = service.test({ ...context("test-concurrent"), expectedVersion: 1 });
    await entered;
    await service.replace({
      ...context("replace-concurrent"),
      expectedVersion: 1,
      ingress: body("two"),
    });
    releaseTest();
    await expect(testing).rejects.toMatchObject({ code: "CAPABILITY_EXPIRED" });
    expect(repository.versionRecords(userId).filter(({ active }) => active)).toHaveLength(1);
    await expect(service.status(userId)).resolves.toMatchObject({ status: "usable", version: 2 });
  });

  it("recovers abandoned staged/deleting work and revokes credentials after 90 days", async () => {
    const repository = new MemoryOkxCredentialRepository();
    const kms = new LocalOkxKmsFixture({ key: Buffer.alloc(32, 0x53) });
    const transport = new OkxTransportFixture(usableOkxFixtureValidation);
    const service = new OkxCredentialService({ kms, now: () => now, repository, transport });
    const credentials = parseCredentialIngress(body("staged"));
    const envelope = await encryptOkxCredentials({
      credentials,
      identity: {
        credentialId: "71000000-0000-4000-8000-000000000099",
        environment: "production",
        userId,
        version: 1,
      },
      kms,
      now: new Date(now.getTime() - 600_000),
    });
    await repository.createStaged({
      context: context("stage-crash"),
      envelope,
      expectedActiveVersion: 0,
    });
    await expect(service.recover({ now, stagedTtlMilliseconds: 300_000 })).resolves.toBe(1);
    await expect(service.status(userId)).resolves.toMatchObject({ status: "unconfigured" });

    const laterTransport = new OkxTransportFixture(usableOkxFixtureValidation);
    const later = new Date(now.getTime() + 91 * 24 * 60 * 60 * 1_000);
    const restarted = new OkxCredentialService({
      kms,
      now: () => later,
      repository,
      transport: laterTransport,
    });
    await service.save({ ...context("save-before-restart"), ingress: body("active") });
    await expect(restarted.status(userId)).resolves.toMatchObject({
      status: "revoked",
      version: 1,
    });
    await expect(
      restarted.test({ ...context("expired-test"), now: later, expectedVersion: 1 }),
    ).rejects.toMatchObject({ code: "CREDENTIAL_REVOKED" });
    credentials.apiKey.fill(0);
    credentials.secretKey.fill(0);
    credentials.passphrase.fill(0);
  });
});
