import type {
  AddressRemark,
  AddressRemarksResponse,
  EvmAddress,
  PutAddressRemarkRequest,
  SharedRemark,
} from "@lpbot/api-contract";

export type AddressRemarksStatus = "error" | "loading" | "ready";

export interface PendingAddressRemarkMutation {
  before: AddressRemark | undefined;
  draft: string;
  operationId: number;
}

export interface AddressRemarksState {
  drafts: Map<string, string>;
  errors: Map<string, string>;
  loadErrorCode: string | null;
  pending: Map<string, PendingAddressRemarkMutation>;
  remarks: Map<string, AddressRemark>;
  shared: Map<string, SharedRemark>;
  status: AddressRemarksStatus;
}

export type AddressRemarksAction =
  | { type: "loading" }
  | { code: string; type: "load-failed" }
  | { response: AddressRemarksResponse; type: "loaded" }
  | { operationId: number; request: PutAddressRemarkRequest; type: "put-optimistic" }
  | { address: EvmAddress; operationId: number; type: "delete-optimistic" }
  | {
      address: EvmAddress;
      operationId: number;
      remark: AddressRemark | null;
      type: "mutation-succeeded";
    }
  | {
      address: EvmAddress;
      code: string;
      operationId: number;
      type: "mutation-failed";
    };

export function initialAddressRemarksState(): AddressRemarksState {
  return {
    drafts: new Map(),
    errors: new Map(),
    loadErrorCode: null,
    pending: new Map(),
    remarks: new Map(),
    shared: new Map(),
    status: "loading",
  };
}

function canonical(value: string): string {
  return value.toLowerCase();
}

export function reduceAddressRemarks(
  state: AddressRemarksState,
  action: AddressRemarksAction,
): AddressRemarksState {
  if (action.type === "loading") return { ...state, loadErrorCode: null, status: "loading" };
  if (action.type === "load-failed") {
    return { ...state, loadErrorCode: action.code, status: "error" };
  }
  if (action.type === "loaded") {
    return {
      ...state,
      loadErrorCode: null,
      remarks: new Map(
        action.response.remarks.map((remark) => [canonical(remark.address), remark]),
      ),
      shared: new Map(action.response.shared.map((remark) => [canonical(remark.address), remark])),
      status: "ready",
    };
  }
  if (action.type === "put-optimistic") {
    const address = canonical(action.request.address);
    const before = state.remarks.get(address);
    const remarks = new Map(state.remarks);
    const request = { ...action.request, address: address as EvmAddress };
    if (!request.label && !request.watched) remarks.delete(address);
    else remarks.set(address, request);
    const pending = new Map(state.pending).set(address, {
      before: before ? { ...before } : undefined,
      draft: request.label,
      operationId: action.operationId,
    });
    const drafts = new Map(state.drafts).set(address, request.label);
    const errors = new Map(state.errors);
    errors.delete(address);
    return { ...state, drafts, errors, pending, remarks };
  }
  if (action.type === "delete-optimistic") {
    const address = canonical(action.address);
    const before = state.remarks.get(address);
    const remarks = new Map(state.remarks);
    remarks.delete(address);
    const pending = new Map(state.pending).set(address, {
      before: before ? { ...before } : undefined,
      draft: before?.label ?? state.drafts.get(address) ?? "",
      operationId: action.operationId,
    });
    const errors = new Map(state.errors);
    errors.delete(address);
    return { ...state, errors, pending, remarks };
  }

  const address = canonical(action.address);
  const current = state.pending.get(address);
  if (!current || current.operationId !== action.operationId) return state;
  const pending = new Map(state.pending);
  pending.delete(address);
  const remarks = new Map(state.remarks);
  const drafts = new Map(state.drafts);
  const errors = new Map(state.errors);
  if (action.type === "mutation-succeeded") {
    if (action.remark) remarks.set(address, action.remark);
    else remarks.delete(address);
    drafts.delete(address);
    errors.delete(address);
  } else {
    if (current.before) remarks.set(address, current.before);
    else remarks.delete(address);
    drafts.set(address, current.draft);
    errors.set(address, action.code);
  }
  return { ...state, drafts, errors, pending, remarks };
}

export function addressRemarkLabel(state: AddressRemarksState, address: string): string {
  const key = canonical(address);
  return state.remarks.get(key)?.label || state.shared.get(key)?.label || "";
}

export function watchedAddressSet(state: AddressRemarksState): Set<string> {
  return new Set(
    [...state.remarks].filter(([, remark]) => remark.watched).map(([address]) => address),
  );
}
