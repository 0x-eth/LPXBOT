export type SignerErrorCode =
  | "CONFIRMATION_MISMATCH"
  | "CUSTODY_STORE_UNAVAILABLE"
  | "DELETE_BLOCKED"
  | "INVALID_CREDENTIALS"
  | "INVALID_AUTO_LOCK"
  | "INVALID_MODE"
  | "INVALID_PRIVATE_KEY"
  | "INVALID_WALLET"
  | "HELPER_DELIVERY_UNAVAILABLE"
  | "HELPER_PLAN_EXPIRED"
  | "HELPER_PLAN_REJECTED"
  | "KEK_VERSION_UNAVAILABLE"
  | "KEYSTORE_CORRUPTED"
  | "LOCAL_SWAP_DELIVERY_UNAVAILABLE"
  | "LOCAL_SWAP_PLAN_EXPIRED"
  | "LOCAL_SWAP_PLAN_REJECTED"
  | "LOCKED_OUT"
  | "PASSWORD_ALREADY_CONFIGURED"
  | "PASSWORD_POLICY_FAILED"
  | "PERMIT2_AUTHORIZATION_REJECTED"
  | "PREVIEW_CHANGED"
  | "PREVIEW_EXPIRED"
  | "SECRET_VERSION_CONFLICT"
  | "SIGNER_UNAVAILABLE"
  | "TRANSFER_DELIVERY_UNAVAILABLE"
  | "TRANSFER_PLAN_EXPIRED"
  | "TRANSFER_PLAN_REJECTED"
  | "REVISION_CONFLICT"
  | "REQUEST_TOO_LARGE"
  | "SECURITY_PASSWORD_VERSION_CONFLICT"
  | "WALLET_ADDRESS_EXISTS"
  | "WALLET_NOT_FOUND";

export class SignerError extends Error {
  readonly code: SignerErrorCode;
  readonly retryable: boolean;

  constructor(code: SignerErrorCode, retryable = false) {
    super(code);
    this.name = "SignerError";
    this.code = code;
    this.retryable = retryable;
  }
}

export function asSignerError(error: unknown): SignerError {
  return error instanceof SignerError ? error : new SignerError("CUSTODY_STORE_UNAVAILABLE", true);
}
