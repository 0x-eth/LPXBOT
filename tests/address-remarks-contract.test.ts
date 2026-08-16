import {
  addressRemarksContracts,
  type AddressRemark,
  type AddressRemarksResponse,
  type DeleteAddressRemarkResponse,
  type PutAddressRemarkRequest,
  type PutAddressRemarkResponse,
  type SharedRemark,
} from "../packages/api-contract/src/index.js";
import { describe, expect, it } from "vitest";

describe("P02-05 address remark contract", () => {
  it("freezes the authenticated CRUD paths and minimal public fields", () => {
    expect(addressRemarksContracts).toEqual({
      delete: { method: "DELETE", path: "/api/address-remarks/{address}" },
      get: { method: "GET", path: "/api/address-remarks" },
      put: { method: "PUT", path: "/api/address-remarks" },
    });

    const remark: AddressRemark = {
      address: "0x1111111111111111111111111111111111111111",
      label: "Whale",
      watched: true,
    };
    const shared: SharedRemark = { address: remark.address, label: "LP", votes: 2 };
    const request: PutAddressRemarkRequest = {
      address: remark.address,
      label: remark.label,
      watched: remark.watched,
    };
    const list: AddressRemarksResponse = { remarks: [remark], shared: [shared] };
    const put: PutAddressRemarkResponse = { remark };
    const deleted: DeleteAddressRemarkResponse = { deleted: true };

    expect({ deleted, list, put, request }).toEqual({
      deleted: { deleted: true },
      list: { remarks: [remark], shared: [shared] },
      put: { remark },
      request: remark,
    });
  });
});
