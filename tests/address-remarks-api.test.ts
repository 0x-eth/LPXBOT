import type {
  AddressRemark,
  AddressRemarksResponse,
  EvmAddress,
} from "../packages/api-contract/src/index.js";
import { buildApiApp } from "../apps/api/src/index.js";
import type {
  AddressRemarkAuditInput,
  AddressRemarkDeleteInput,
  AddressRemarkPutInput,
  AddressRemarkStore,
} from "../apps/api/src/address-remarks.js";
import { afterEach, describe, expect, it } from "vitest";

import { issueFixtureSession, SessionFixtureStore } from "./helpers/session-fixture.js";

const userA = "27000000-0000-4000-8000-000000000001";
const userB = "27000000-0000-4000-8000-000000000002";
const userC = "27000000-0000-4000-8000-000000000003";
const address = "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa" as const;
const now = new Date("2026-08-16T07:00:00.000Z");

class MemoryAddressRemarkStore implements AddressRemarkStore {
  readonly audits: AddressRemarkAuditInput[] = [];
  readonly records = new Map<string, AddressRemark>();

  async list(input: { chainId: 56; userId: string }): Promise<AddressRemarksResponse> {
    const remarks = [...this.records]
      .filter(([key]) => key.startsWith(`${input.userId}:`))
      .map(([, remark]) => structuredClone(remark))
      .sort((left, right) => left.address.localeCompare(right.address));
    const votes = new Map<string, Map<string, number>>();
    for (const remark of this.records.values()) {
      if (!remark.label) continue;
      const labels = votes.get(remark.address) ?? new Map<string, number>();
      labels.set(remark.label, (labels.get(remark.label) ?? 0) + 1);
      votes.set(remark.address, labels);
    }
    const shared = [...votes].map(([sharedAddress, labels]) => {
      const [label, count] = [...labels].sort(
        ([leftLabel, leftVotes], [rightLabel, rightVotes]) =>
          rightVotes - leftVotes || leftLabel.localeCompare(rightLabel),
      )[0]!;
      return { address: sharedAddress as EvmAddress, label, votes: count };
    });
    return { remarks, shared };
  }

  async put(input: AddressRemarkPutInput): Promise<AddressRemark | null> {
    const key = `${input.userId}:${input.address}`;
    if (!input.label && !input.watched) {
      this.records.delete(key);
      this.audits.push({ ...input.audit, outcome: "allowed", resultCode: "DELETED" });
      return null;
    }
    const remark = { address: input.address, label: input.label, watched: input.watched };
    this.records.set(key, remark);
    this.audits.push({ ...input.audit, outcome: "allowed", resultCode: "UPDATED" });
    return structuredClone(remark);
  }

  async delete(input: AddressRemarkDeleteInput): Promise<boolean> {
    const deleted = this.records.delete(`${input.userId}:${input.address}`);
    this.audits.push({
      ...input.audit,
      outcome: "allowed",
      resultCode: deleted ? "DELETED" : "ALREADY_ABSENT",
    });
    return deleted;
  }

  async recordDenied(input: AddressRemarkAuditInput): Promise<void> {
    this.audits.push(input);
  }
}

const apps: Array<{ close(): Promise<void> }> = [];

afterEach(async () => {
  await Promise.all(apps.splice(0).map((app) => app.close()));
});

async function fixture(max = 30) {
  const sessionStore = new SessionFixtureStore();
  const addressRemarkStore = new MemoryAddressRemarkStore();
  const [tokenA, tokenB, tokenC] = await Promise.all(
    [userA, userB, userC].map((userId) => issueFixtureSession(sessionStore, userId, now)),
  );
  const app = buildApiApp({
    addressRemarkRateLimit: { max, timeWindowMs: 60_000 },
    addressRemarkStore,
    maintenance: { enabled: false, message: null, until: null },
    now: () => now,
    regionPolicy: () => ({ blocked: false, code: null, message: null }),
    sessionStore,
  });
  apps.push(app);
  return { addressRemarkStore, app, tokenA, tokenB, tokenC };
}

function session(token: string) {
  return { cookie: `lpbot_session=${token}` };
}

describe("P02-05 address remarks API", () => {
  it("requires a session and derives personal ownership only from that session", async () => {
    const { addressRemarkStore, app, tokenA, tokenB } = await fixture();
    const anonymous = await app.inject({ method: "GET", url: "/api/address-remarks" });
    expect(anonymous.statusCode).toBe(401);
    expect(addressRemarkStore.records.size).toBe(0);

    const saved = await app.inject({
      headers: session(tokenA),
      method: "PUT",
      payload: { address: address.toUpperCase().replace("0X", "0x"), label: "  Whale  ", watched: true },
      url: "/api/address-remarks",
    });
    expect(saved.statusCode).toBe(200);
    expect(saved.headers["cache-control"]).toBe("no-store");
    expect(saved.json().data).toEqual({
      remark: { address, label: "Whale", watched: true },
    });

    const [mine, other] = await Promise.all([
      app.inject({ headers: session(tokenA), method: "GET", url: "/api/address-remarks" }),
      app.inject({ headers: session(tokenB), method: "GET", url: "/api/address-remarks" }),
    ]);
    expect(mine.json().data.remarks).toEqual([{ address, label: "Whale", watched: true }]);
    expect(other.json().data.remarks).toEqual([]);
    expect(other.json().data.shared).toEqual([{ address, label: "Whale", votes: 1 }]);
    expect(other.body).not.toContain(userA);

    const idor = await app.inject({
      headers: session(tokenB),
      method: "PUT",
      payload: { address, label: "Other", userId: userA, watched: false },
      url: "/api/address-remarks",
    });
    expect(idor.statusCode).toBe(400);
    expect(idor.body).not.toContain(userA);
  });

  it("selects the shared label by votes then stable label while personal labels stay first", async () => {
    const { app, tokenA, tokenB, tokenC } = await fixture();
    for (const [token, label] of [
      [tokenA, "Zebra"],
      [tokenB, "Alpha"],
    ] as const) {
      const response = await app.inject({
        headers: session(token),
        method: "PUT",
        payload: { address, label, watched: false },
        url: "/api/address-remarks",
      });
      expect(response.statusCode).toBe(200);
    }
    const tied = await app.inject({
      headers: session(tokenC),
      method: "GET",
      url: "/api/address-remarks",
    });
    expect(tied.json().data.shared).toEqual([{ address, label: "Alpha", votes: 1 }]);

    await app.inject({
      headers: session(tokenC),
      method: "PUT",
      payload: { address, label: "Zebra", watched: true },
      url: "/api/address-remarks",
    });
    const voted = await app.inject({
      headers: session(tokenA),
      method: "GET",
      url: "/api/address-remarks",
    });
    expect(voted.json().data).toEqual({
      remarks: [{ address, label: "Zebra", watched: false }],
      shared: [{ address, label: "Zebra", votes: 2 }],
    });
    expect(Object.keys(voted.json().data.shared[0]).sort()).toEqual(["address", "label", "votes"]);
  });

  it("validates exact fields, addresses, control-free trimmed labels and 32 Unicode characters", async () => {
    const { addressRemarkStore, app, tokenA } = await fixture();
    const invalidBodies = [
      { address: "bad", label: "Whale", watched: false },
      { address, label: "x".repeat(33), watched: false },
      { address, label: "ok\nlabel", watched: false },
      { address, label: "ok\u007flabel", watched: false },
      { address, label: "Whale", watched: "yes" },
      { address, label: "Whale", watched: false, securityPassword: "out-of-scope" },
    ];
    for (const payload of invalidBodies) {
      const response = await app.inject({
        headers: session(tokenA),
        method: "PUT",
        payload,
        url: "/api/address-remarks",
      });
      expect(response.statusCode, JSON.stringify(payload)).toBe(400);
      expect(response.json().error.code).toBe("ADDRESS_REMARK_INVALID");
    }
    const unicode = await app.inject({
      headers: session(tokenA),
      method: "PUT",
      payload: { address, label: "鲸".repeat(32), watched: false },
      url: "/api/address-remarks",
    });
    expect(unicode.statusCode).toBe(200);
    expect(addressRemarkStore.audits.filter(({ outcome }) => outcome === "denied")).toHaveLength(
      invalidBodies.length,
    );
  });

  it("supports watch-only records, idempotent delete, per-session rate limits and write audits", async () => {
    const { addressRemarkStore, app, tokenA, tokenB } = await fixture(2);
    const watched = await app.inject({
      headers: session(tokenA),
      method: "PUT",
      payload: { address, label: "", watched: true },
      url: "/api/address-remarks",
    });
    expect(watched.json().data.remark).toEqual({ address, label: "", watched: true });
    const deleted = await app.inject({
      headers: session(tokenA),
      method: "DELETE",
      url: `/api/address-remarks/${address}`,
    });
    expect(deleted.json().data).toEqual({ deleted: true });
    const limited = await app.inject({
      headers: session(tokenA),
      method: "DELETE",
      url: `/api/address-remarks/${address}`,
    });
    expect(limited.statusCode).toBe(429);
    expect(limited.json().error.code).toBe("RATE_LIMITED");

    const absent = await app.inject({
      headers: session(tokenB),
      method: "DELETE",
      url: `/api/address-remarks/${address}`,
    });
    expect(absent.statusCode).toBe(200);
    expect(absent.json().data).toEqual({ deleted: false });
    expect(addressRemarkStore.audits.map(({ resultCode }) => resultCode)).toEqual([
      "UPDATED",
      "DELETED",
      "RATE_LIMITED",
      "ALREADY_ABSENT",
    ]);
  });
});
