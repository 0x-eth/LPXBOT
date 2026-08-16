import type { AddressRemark, PutAddressRemarkRequest } from "../packages/api-contract/src/index.js";
import {
  AddressRemarksClient,
  AddressRemarksRequestError,
} from "../apps/web/src/address-remarks-client.js";
import {
  addressRemarkLabel,
  initialAddressRemarksState,
  reduceAddressRemarks,
  watchedAddressSet,
} from "../apps/web/src/address-remarks-state.js";
import { afterEach, describe, expect, it, vi } from "vitest";

const address = "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa" as const;
const otherAddress = "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb" as const;

afterEach(() => {
  vi.restoreAllMocks();
});

function success(data: unknown): Response {
  return Response.json({ data, requestId: "request-remark", success: true });
}

describe("P02-05 address remarks web client", () => {
  it("uses credentialed CRUD requests and parses only frozen personal/shared fields", async () => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        success({
          remarks: [{ address, label: "Mine", watched: true }],
          shared: [{ address: otherAddress, label: "Shared", votes: 3 }],
        }),
      )
      .mockResolvedValueOnce(success({ remark: { address, label: "Updated", watched: false } }))
      .mockResolvedValueOnce(success({ deleted: false }));
    const client = new AddressRemarksClient(fetcher);

    await expect(client.get()).resolves.toEqual({
      remarks: [{ address, label: "Mine", watched: true }],
      shared: [{ address: otherAddress, label: "Shared", votes: 3 }],
    });
    await expect(client.put({ address, label: "Updated", watched: false })).resolves.toEqual({
      address,
      label: "Updated",
      watched: false,
    });
    await expect(client.delete(address)).resolves.toBe(false);

    expect(fetcher.mock.calls).toEqual([
      [
        "/api/address-remarks",
        expect.objectContaining({ cache: "no-store", credentials: "include", method: "GET" }),
      ],
      [
        "/api/address-remarks",
        expect.objectContaining({
          body: JSON.stringify({ address, label: "Updated", watched: false }),
          credentials: "include",
          method: "PUT",
        }),
      ],
      [
        `/api/address-remarks/${address}`,
        expect.objectContaining({ credentials: "include", method: "DELETE" }),
      ],
    ]);
  });

  it("rejects malformed responses and any shared identity field", async () => {
    const responses = [
      { remarks: [], shared: [{ address, label: "Shared", userId: "leak", votes: 1 }] },
      { remarks: [], shared: [{ address, label: "Shared", votes: 0 }] },
      { remarks: [{ address: address.toUpperCase(), label: "Mine", watched: true }], shared: [] },
    ];
    for (const data of responses) {
      const client = new AddressRemarksClient(
        vi.fn<typeof fetch>().mockResolvedValue(success(data)),
      );
      await expect(client.get()).rejects.toMatchObject({
        code: "INVALID_RESPONSE",
        name: "AddressRemarksRequestError",
      });
    }
  });

  it("surfaces stable API and network errors without raw response content", async () => {
    const api = new AddressRemarksClient(
      vi.fn<typeof fetch>().mockResolvedValue(
        Response.json(
          {
            error: {
              code: "RATE_LIMITED",
              message: "internal provider details",
              retryable: true,
            },
            success: false,
          },
          { status: 429 },
        ),
      ),
    );
    const network = new AddressRemarksClient(
      vi.fn<typeof fetch>().mockRejectedValue(new Error("secret upstream host")),
    );

    await expect(api.put({ address, label: "Mine", watched: false })).rejects.toEqual(
      expect.objectContaining({ code: "RATE_LIMITED", retryable: true, status: 429 }),
    );
    await expect(network.get()).rejects.toEqual(
      expect.objectContaining({ code: "NETWORK_ERROR", retryable: true, status: 0 }),
    );
    await expect(network.get()).rejects.not.toThrow(/secret upstream host/u);
    expect(new AddressRemarksRequestError("CODE", false, 400).message).not.toContain("CODE");
  });
});

describe("P02-05 optimistic address remark state", () => {
  const original: AddressRemark = { address, label: "Original", watched: false };

  function ready() {
    return reduceAddressRemarks(initialAddressRemarksState(), {
      response: {
        remarks: [original],
        shared: [
          { address, label: "Shared fallback", votes: 4 },
          { address: otherAddress, label: "Other shared", votes: 2 },
        ],
      },
      type: "loaded",
    });
  }

  it("prioritizes personal labels and derives watched state from personal rows only", () => {
    const state = ready();
    expect(addressRemarkLabel(state, address)).toBe("Original");
    expect(addressRemarkLabel(state, otherAddress)).toBe("Other shared");
    expect(watchedAddressSet(state)).toEqual(new Set());
  });

  it("rolls back the exact failed PUT and preserves the user's trimmed draft", () => {
    const request: PutAddressRemarkRequest = { address, label: "New draft", watched: true };
    const optimistic = reduceAddressRemarks(ready(), {
      operationId: 1,
      request,
      type: "put-optimistic",
    });
    expect(optimistic.remarks.get(address)).toEqual(request);
    expect(watchedAddressSet(optimistic)).toEqual(new Set([address]));

    const failed = reduceAddressRemarks(optimistic, {
      address,
      code: "NETWORK_ERROR",
      operationId: 1,
      type: "mutation-failed",
    });
    expect(failed.remarks.get(address)).toEqual(original);
    expect(failed.drafts.get(address)).toBe("New draft");
    expect(failed.errors.get(address)).toBe("NETWORK_ERROR");
  });

  it("does not let a stale failure roll back a newer watch/label operation", () => {
    const first = reduceAddressRemarks(ready(), {
      operationId: 1,
      request: { address, label: "First", watched: true },
      type: "put-optimistic",
    });
    const second = reduceAddressRemarks(first, {
      operationId: 2,
      request: { address, label: "Second", watched: false },
      type: "put-optimistic",
    });
    const staleFailure = reduceAddressRemarks(second, {
      address,
      code: "NETWORK_ERROR",
      operationId: 1,
      type: "mutation-failed",
    });
    expect(staleFailure.remarks.get(address)).toEqual({
      address,
      label: "Second",
      watched: false,
    });
    expect(staleFailure.pending.get(address)?.operationId).toBe(2);
  });

  it("restores an idempotently deleted row on failure and removes it on success", () => {
    const optimistic = reduceAddressRemarks(ready(), {
      address,
      operationId: 3,
      type: "delete-optimistic",
    });
    expect(optimistic.remarks.has(address)).toBe(false);
    const failed = reduceAddressRemarks(optimistic, {
      address,
      code: "RATE_LIMITED",
      operationId: 3,
      type: "mutation-failed",
    });
    expect(failed.remarks.get(address)).toEqual(original);

    const retried = reduceAddressRemarks(failed, {
      address,
      operationId: 4,
      type: "delete-optimistic",
    });
    const succeeded = reduceAddressRemarks(retried, {
      address,
      operationId: 4,
      remark: null,
      type: "mutation-succeeded",
    });
    expect(succeeded.remarks.has(address)).toBe(false);
    expect(succeeded.pending.has(address)).toBe(false);
  });
});
