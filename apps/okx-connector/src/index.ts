export { clearCredentials, decryptOkxCredentials, encryptOkxCredentials, LocalOkxKmsFixture, okxCredentialAad, parseCredentialIngress } from "./credential-crypto.js";
export { asOkxConnectorError, OkxConnectorError } from "./errors.js";
export type { OkxConnectorErrorCode } from "./errors.js";
export { createOkxConnectorHttpServer } from "./http-server.js";
export { HttpOkxKmsClient } from "./http-kms-client.js";
export { MemoryOkxCredentialRepository } from "./memory-store.js";
export { PostgresOkxCredentialRepository } from "./postgres-store.js";
export type { OkxPostgresFailurePoint } from "./postgres-store.js";
export { OkxCredentialService } from "./service.js";
export { loadOkxConnectorProductionConfig, OkxConnectorConfigurationError } from "./production-config.js";
export type { OkxConnectorProductionConfig } from "./production-config.js";
export { isPublicOkxEgressAddress, OkxHttpsReadOnlyTransport, okxProductionEgress, OkxTransportFixture, parseOkxAccountConfiguration, usableOkxFixtureValidation } from "./transport.js";
export type { OkxDnsResolver, OkxPinnedRequest, OkxPinnedRequester, OkxPinnedResponse } from "./transport.js";
export { clearCredentialBytes, okxCredentialDomain, okxCredentialEnvironment, okxCredentialMaximumAgeMilliseconds } from "./types.js";
export type { OkxConnectorApplication, OkxCredentialAadIdentity, OkxCredentialAuditAction, OkxCredentialAuditEvent, OkxCredentialBytes, OkxCredentialEnvelope, OkxCredentialHead, OkxCredentialMutationContext, OkxCredentialRepository, OkxCredentialVersionRecord, OkxKmsClient, OkxKmsKeyDescriptor, OkxProviderValidation, OkxReadOnlyTransport } from "./types.js";

export const okxConnectorCapabilities = [
  "credential-status",
  "credential-save",
  "credential-replace",
  "credential-test",
  "credential-delete",
  "fixed-read-only-okx-validation",
] as const;
