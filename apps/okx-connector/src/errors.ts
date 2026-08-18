export type OkxConnectorErrorCode =
  | "CAPABILITY_EXPIRED"
  | "CONNECTOR_UNAVAILABLE"
  | "CREDENTIAL_ALREADY_CONFIGURED"
  | "CREDENTIAL_INTEGRITY_FAILED"
  | "CREDENTIAL_INVALID"
  | "CREDENTIAL_NOT_CONFIGURED"
  | "CREDENTIAL_REVOKED"
  | "EGRESS_DENIED"
  | "INSUFFICIENT_PERMISSION"
  | "INVALID_CREDENTIAL_INGRESS"
  | "KMS_UNAVAILABLE"
  | "PROVIDER_UNKNOWN"
  | "VERSION_CONFLICT";

export class OkxConnectorError extends Error {
  readonly code: OkxConnectorErrorCode;
  readonly retryable: boolean;

  constructor(code: OkxConnectorErrorCode, retryable = false) {
    super(code);
    this.name = "OkxConnectorError";
    this.code = code;
    this.retryable = retryable;
  }
}

export function asOkxConnectorError(error: unknown): OkxConnectorError {
  return error instanceof OkxConnectorError
    ? error
    : new OkxConnectorError("CONNECTOR_UNAVAILABLE", true);
}
