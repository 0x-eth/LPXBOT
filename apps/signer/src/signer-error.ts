export type SignerErrorCode =
  | "CONFIRMATION_MISMATCH"
  | "CUSTODY_STORE_UNAVAILABLE"
  | "INVALID_CREDENTIALS"
  | "INVALID_AUTO_LOCK"
  | "INVALID_MODE"
  | "INVALID_PRIVATE_KEY"
  | "INVALID_WALLET"
  | "KEK_VERSION_UNAVAILABLE"
  | "KEYSTORE_CORRUPTED"
  | "LOCKED_OUT"
  | "PASSWORD_ALREADY_CONFIGURED"
  | "PASSWORD_POLICY_FAILED"
  | "PREVIEW_CHANGED"
  | "PREVIEW_EXPIRED"
  | "SECRET_VERSION_CONFLICT"
  | "SIGNER_UNAVAILABLE"
  | "REVISION_CONFLICT"
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
