import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createCipheriv, createHash } from "node:crypto";
import { access, readFile, readdir } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { argon2id } from "@noble/hashes/argon2";
import Ajv from "ajv";
import { privateKeyToAddress } from "viem/accounts";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const ACCEPTANCE = path.join(ROOT, "artifacts/acceptance/P04-01");
const BASELINE = "37cb850c149168bbfff5a98768067a1a63bff2f9";
const FEATURE_IDS = [
  ...Array.from({ length: 10 }, (_, index) => `WALLET-${String(index + 1).padStart(2, "0")}`),
  "SET-06",
  "SET-07",
];
const ZERO_DANGEROUS_OPERATIONS = {
  privateKeyDecryptions: 0,
  transactionSignatures: 0,
  transactionBroadcasts: 0,
  externalRpcCalls: 0,
};
const REQUIRED_ARTIFACTS = [
  "api-contracts.json",
  "artifact-manifest.json",
  "coverage.json",
  "fact-catalog.json",
  "fixture-index.json",
  "gaps.json",
  "key-lifecycle-contracts.json",
  "security-boundary-contracts.json",
  "settings-contracts.json",
  "transaction-contracts.json",
  "ui-state-contracts.json",
  "prior-acceptance-sha256s.txt",
  "sha256sums.txt",
  "checks/artifact-schema.txt",
  "checks/governance-test.txt",
  "checks/initial-failure.txt",
  "checks/prior-acceptance-integrity.txt",
  "checks/quality-gates.txt",
  "checks/security-audit.txt",
  "fixtures/aad-tamper.json",
  "fixtures/argon2id-known-answer.json",
  "fixtures/crypto-known-answer.json",
  "fixtures/lifecycle-recovery.json",
  "fixtures/nonce-concurrency.json",
  "fixtures/replacement-lineage.json",
];
const REFERENCE_PATHS = [
  "artifacts/acceptance/P01-04/E-RBAC.md",
  "artifacts/lpbot/2026-08-13/api-calls.json",
  "docs/ARCHITECTURE_AND_WORKFLOWS.md",
  "docs/DEVELOPMENT_ROADMAP.md",
  "docs/FUNCTION_MATRIX.md",
  "docs/TRACEABILITY_MATRIX.md",
  "docs/VIBE_CODING_PLAYBOOK.md",
  "infra/migrations/20260814000300_create_login_wallet_auth.sql",
];

async function readJson(relativePath) {
  return JSON.parse(await readFile(path.join(ACCEPTANCE, relativePath), "utf8"));
}

function sorted(values) {
  return [...values].sort((left, right) => left.localeCompare(right));
}

function unique(values, label) {
  assert.equal(new Set(values).size, values.length, `${label} must not contain duplicates`);
}

function by(items, key) {
  return new Map(items.map((item) => [item[key], item]));
}

function digest(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

function parseChecksums(source, label) {
  const rows = source
    .trimEnd()
    .split("\n")
    .map((line, index) => {
      const match = /^([0-9a-f]{64}) {2}(.+)$/.exec(line);
      assert.ok(match, `${label} line ${index + 1} is invalid`);
      return { sha256: match[1], path: match[2] };
    });
  unique(
    rows.map((row) => row.path),
    `${label} paths`,
  );
  return rows;
}

function git(args, options = {}) {
  const result = spawnSync("git", args, {
    cwd: ROOT,
    encoding: Object.hasOwn(options, "encoding") ? options.encoding : "utf8",
    maxBuffer: 64 * 1024 * 1024,
  });
  assert.equal(
    result.status,
    0,
    `git ${args.join(" ")} failed: ${result.stderr?.toString("utf8") ?? ""}`,
  );
  return result.stdout;
}

function baselineBytes(relativePath) {
  assert.equal(path.isAbsolute(relativePath), false, `${relativePath} must be relative`);
  assert.equal(relativePath.includes(".."), false, `${relativePath} must stay in the repository`);
  return git(["show", `${BASELINE}:${relativePath}`], { encoding: null });
}

async function filesBelow(directory, prefix = "") {
  const files = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const relativePath = path.posix.join(prefix, entry.name);
    if (entry.isDirectory()) {
      files.push(...(await filesBelow(path.join(directory, entry.name), relativePath)));
    } else if (entry.isFile()) {
      files.push(relativePath);
    } else {
      assert.fail(`unsupported artifact entry: ${relativePath}`);
    }
  }
  return sorted(files);
}

function encryptAesGcm({ keyHex, nonceHex, plaintextHex, aadUtf8 }) {
  const cipher = createCipheriv(
    "aes-256-gcm",
    Buffer.from(keyHex, "hex"),
    Buffer.from(nonceHex, "hex"),
    { authTagLength: 16 },
  );
  cipher.setAAD(Buffer.from(aadUtf8, "utf8"));
  const ciphertext = Buffer.concat([
    cipher.update(Buffer.from(plaintextHex, "hex")),
    cipher.final(),
  ]);
  return {
    ciphertextHex: ciphertext.toString("hex"),
    tagHex: cipher.getAuthTag().toString("hex"),
  };
}

test("P04-01 required reference artifacts exist", async () => {
  for (const relativePath of REQUIRED_ARTIFACTS) {
    await access(path.join(ACCEPTANCE, relativePath));
  }
});

test("P04-01 manifest satisfies its JSON Schema and freezes a zero-execution scope", async () => {
  const [manifest, schema] = await Promise.all([
    readJson("artifact-manifest.json"),
    readFile(path.join(ROOT, "schemas/p04-reference-artifacts.schema.json"), "utf8").then(
      JSON.parse,
    ),
  ]);
  const validate = new Ajv({ allErrors: true, strict: false }).compile(schema);
  assert.equal(
    validate(manifest),
    true,
    (validate.errors ?? [])
      .map((error) => `${error.instancePath || "/"} ${error.message}`)
      .join("\n"),
  );
  assert.equal(manifest.referenceBaseline, BASELINE);
  assert.deepEqual(manifest.featureIds, []);
  assert.deepEqual(manifest.scope, {
    mode: "reference-only",
    implementationOwnership: "none",
    databaseChanges: false,
    businessTables: false,
    productionRoutes: false,
    workers: false,
    signerRuntime: false,
    kmsAccess: false,
    productionSecrets: false,
    ...ZERO_DANGEROUS_OPERATIONS,
  });
});

test("WALLET-01..10 and SET-06..07 remain 0 implemented-assumed / 12 planned", async () => {
  const coverage = await readJson("coverage.json");
  assert.equal(coverage.workItemId, "P04-01");
  assert.equal(coverage.phase, "P04");
  assert.deepEqual(coverage.workItemFeatureIds, []);
  assert.equal(coverage.implementationOwnership, "none");
  assert.equal(coverage.counts["implemented-assumed"], 0);
  assert.equal(coverage.counts.planned, 12);
  unique(
    coverage.features.map(({ id }) => id),
    "coverage feature IDs",
  );
  assert.deepEqual(sorted(coverage.features.map(({ id }) => id)), sorted(FEATURE_IDS));
  for (const feature of coverage.features) {
    assert.equal(feature.phase, "P04", `${feature.id} phase`);
    assert.equal(feature.status, "planned", `${feature.id} status`);
    assert.equal(feature.implementationOwner, null, `${feature.id} implementation owner`);
  }
});

test("fact catalog separates evidence classes and keeps login wallets authentication-only", async () => {
  const catalog = await readJson("fact-catalog.json");
  const classes = ["PUBLIC", "BUNDLE-CANDIDATE", "INFERRED", "LOCAL-DECISION"];
  assert.deepEqual(sorted(Object.keys(catalog.classifications)), sorted(classes));
  assert.deepEqual(sorted(new Set(catalog.facts.map(({ classification }) => classification))), sorted(classes));
  unique(
    catalog.facts.map(({ id }) => id),
    "fact IDs",
  );
  for (const fact of catalog.facts) {
    assert.ok(classes.includes(fact.classification), `${fact.id} classification`);
    assert.equal(fact.implementationStatus, "planned", `${fact.id} implementation status`);
    assert.ok(fact.sources.length > 0, `${fact.id} sources`);
  }
  const facts = by(catalog.facts, "id");
  assert.equal(facts.get("AUTH-LOGIN-WALLET-BOUNDARY").classification, "LOCAL-DECISION");
  assert.equal(facts.get("AUTH-LOGIN-WALLET-BOUNDARY").claim.usage, "login-only");
  assert.equal(facts.get("AUTH-LOGIN-WALLET-BOUNDARY").claim.custodyAuthority, false);
  assert.equal(facts.get("AUTH-LOGIN-WALLET-BOUNDARY").claim.signingAuthority, false);
  assert.equal(facts.get("AUTH-LOGIN-WALLET-BOUNDARY").claim.autoPromotion, false);
  assert.equal(catalog.promotionPolicy.bundleCandidateMayClaimParity, false);
  assert.equal(catalog.promotionPolicy.inferenceMayClaimTargetBehavior, false);
  assert.equal(catalog.promotionPolicy.localDecisionMayClaimPublicFact, false);
});

test("trust boundary freezes Browser -> API -> worker -> signer -> KMS/ciphertext-store flows", async () => {
  const contract = await readJson("security-boundary-contracts.json");
  assert.deepEqual(contract.flow.order, [
    "browser",
    "api",
    "worker",
    "signer",
    "kms",
    "ciphertext-store",
  ]);
  const components = by(contract.components, "id");
  for (const id of ["api", "web", "worker", "queue", "ordinary-database-connection"]) {
    const component = components.get(id);
    assert.ok(component, `${id} component`);
    assert.equal(component.privateKeyDecrypt, false, `${id} private-key decrypt`);
    assert.equal(component.kekUse, false, `${id} KEK use`);
  }
  assert.equal(components.get("signer").privateKeyDecrypt, true);
  assert.equal(components.get("signer").plaintextPrivateKeyEgress, false);
  assert.equal(components.get("kms").rawKekExport, false);
  assert.equal(contract.secretIngress.apiMode, "opaque-no-log-no-queue-stream-to-signer");
  assert.equal(contract.secretIngress.workerReceivesSecret, false);
  assert.equal(contract.secretIngress.signerOnlyMemoryUnlock, true);
  assert.deepEqual(contract.forbiddenDestinations, [
    "api-response",
    "audit-payload",
    "error-report",
    "log",
    "queue",
    "telemetry",
  ]);
  for (const field of ["secret", "privateKey", "password", "dek", "kek", "licenseBlob"]) {
    assert.ok(contract.forbiddenFieldNames.includes(field), `${field} forbidden field`);
  }
  assert.deepEqual(contract.executionCounts, ZERO_DANGEROUS_OPERATIONS);
});

test("key lifecycle freezes secp256k1, envelope, Argon2id, rotation, lock, deletion, and recovery", async () => {
  const contract = await readJson("key-lifecycle-contracts.json");
  assert.equal(contract.privateKey.curve, "secp256k1");
  assert.equal(contract.privateKey.import.acceptedEncoding, "optional-0x-plus-exactly-64-hex");
  assert.equal(contract.privateKey.import.scalarRange, "1 <= key < secp256k1.n");
  assert.equal(contract.privateKey.generation.source, "operating-system-CSPRNG-through-signer");
  assert.equal(contract.privateKey.generation.moduloReduction, false);
  assert.equal(contract.addressDerivation.hash, "Keccak-256");
  assert.equal(contract.addressDerivation.identity, "lowercase-20-byte-address");
  assert.equal(contract.duplicateAddress.withinUser.status, 409);
  assert.equal(contract.duplicateAddress.withinUser.code, "WALLET_ADDRESS_EXISTS");
  assert.equal(contract.duplicateAddress.crossUser.discloseExistingOwner, false);

  assert.equal(contract.envelope.currentVersion, 1);
  assert.equal(contract.envelope.aead.algorithm, "AES-256-GCM");
  assert.equal(contract.envelope.aead.nonceBytes, 12);
  assert.equal(contract.envelope.aead.tagBytes, 16);
  assert.equal(contract.envelope.dek.bytes, 32);
  assert.equal(contract.envelope.dek.scope, "one-random-DEK-per-wallet-version");
  assert.equal(contract.envelope.kek.storage, "KMS-or-Vault-only-never-database");
  assert.equal(contract.envelope.aad.encoding, "UTF-8-exact-order-newline-delimited-v1");
  assert.deepEqual(contract.envelope.aad.fields, [
    "domain",
    "tenantId",
    "userId",
    "walletId",
    "address",
    "mode",
    "envelopeVersion",
    "kekVersion",
  ]);
  assert.equal(contract.envelope.tamperPolicy, "authentication-failure-lock-and-quarantine-no-fallback");
  assert.equal(contract.envelope.rotation.kek, "rewrap-DEK-in-signer-without-private-key-plaintext");
  assert.equal(contract.envelope.rotation.dek, "new-DEK-and-envelope-version-atomic-signer-only");

  assert.equal(contract.passwordMode.kdf.algorithm, "Argon2id");
  assert.deepEqual(contract.passwordMode.kdf.version1, {
    argonVersion: 19,
    memoryKiB: 65536,
    iterations: 3,
    parallelism: 1,
    saltBytes: 16,
    outputBytes: 32,
  });
  assert.equal(contract.passwordMode.unlock.location, "signer-memory-only");
  assert.equal(contract.passwordMode.restart, "locked");
  assert.equal(contract.serverMode.restart, "recover-wrapped-DEK-through-signer-KMS-grant");
  assert.equal(contract.wrongPassword.externalError, "INVALID_CREDENTIALS");
  assert.equal(contract.wrongPassword.timing, "uniform-envelope-open-path");
  assert.equal(contract.memory.lockedMemoryRequired, true);
  assert.equal(contract.memory.zeroizeOn.everyExitPath, true);
  assert.equal(contract.memory.crashPolicy, "process-exit-discards-unlock-state");

  const lifecycle = by(contract.lifecycle.operations, "id");
  for (const id of [
    "create",
    "import",
    "unlock",
    "auto-lock",
    "restart",
    "change-password",
    "switch-mode",
    "delete",
    "recover",
  ]) {
    assert.ok(lifecycle.has(id), `${id} lifecycle operation`);
  }
  assert.equal(lifecycle.get("change-password").atomic, true);
  assert.equal(lifecycle.get("switch-mode").atomic, true);
  assert.equal(lifecycle.get("delete").previewRequired, true);
  assert.equal(lifecycle.get("recover").plaintextBackupAllowed, false);
});

test("synthetic crypto, Argon2id, and AAD tamper fixtures are executable known answers without decryption", async () => {
  const [crypto, argon, tamper] = await Promise.all([
    readJson("fixtures/crypto-known-answer.json"),
    readJson("fixtures/argon2id-known-answer.json"),
    readJson("fixtures/aad-tamper.json"),
  ]);
  for (const fixture of [crypto, argon, tamper]) {
    assert.equal(fixture.fixtureOnly, true);
    assert.equal(fixture.syntheticSecrets, true);
    assert.equal(fixture.networkAccess, false);
    assert.deepEqual(fixture.executionCounts, ZERO_DANGEROUS_OPERATIONS);
  }

  assert.equal(
    privateKeyToAddress(`0x${crypto.input.syntheticPrivateKeyHex}`),
    crypto.expected.checksumAddress,
    "secp256k1 address derivation known answer",
  );
  assert.equal(crypto.expected.lowercaseAddress, crypto.expected.checksumAddress.toLowerCase());
  assert.deepEqual(encryptAesGcm(crypto.input.aes256Gcm), crypto.expected.aes256Gcm);

  const derived = argon2id(
    Buffer.from(argon.input.passwordUtf8, "utf8"),
    Buffer.from(argon.input.saltHex, "hex"),
    {
      t: argon.input.parameters.iterations,
      m: argon.input.parameters.memoryKiB,
      p: argon.input.parameters.parallelism,
      version: argon.input.parameters.argonVersion,
      dkLen: argon.input.parameters.outputBytes,
    },
  );
  assert.equal(Buffer.from(derived).toString("hex"), argon.expected.derivedKeyHex);
  assert.equal(argon.input.parameters.fixtureCostOnly, true);
  assert.equal(argon.input.parameters.productionAcceptable, false);

  const original = encryptAesGcm(tamper.input.original);
  const changedAad = encryptAesGcm({
    ...tamper.input.original,
    aadUtf8: tamper.input.tamperedAadUtf8,
  });
  assert.deepEqual(original, tamper.expected.original);
  assert.equal(changedAad.ciphertextHex, original.ciphertextHex);
  assert.equal(changedAad.tagHex, tamper.expected.tamperedAadTagHex);
  assert.notEqual(changedAad.tagHex, original.tagHex);
  const tamperedCiphertext = Buffer.from(original.ciphertextHex, "hex");
  tamperedCiphertext[tamper.input.ciphertextMutation.byteOffset] ^=
    tamper.input.ciphertextMutation.xorByte;
  assert.equal(tamperedCiphertext.toString("hex"), tamper.expected.tamperedCiphertextHex);
  assert.deepEqual(tamper.expected.openResults, {
    original: "not-executed",
    changedAad: "AUTHENTICATION_FAILED",
    changedCiphertext: "AUTHENTICATION_FAILED",
  });
});

test("wallet API contract freezes CRUD, balances, tokens, address book, QR, passwords, and transfers", async () => {
  const contract = await readJson("api-contracts.json");
  assert.equal(contract.implementationStatus, "planned");
  assert.equal(contract.authentication, "session-required");
  assert.equal(contract.ownership.crossUserAccess, "deny-not-found");
  assert.equal(contract.wireRules.unknownFields, "reject");
  assert.equal(contract.wireRules.amounts, "unsigned-canonical-base-10-base-unit-strings-only");
  assert.equal(contract.wireRules.floatingPointAmounts, "forbidden");
  assert.equal(contract.wireRules.cacheControl, "no-store");

  const endpoints = new Map(
    contract.endpoints.map((endpoint) => [`${endpoint.method} ${endpoint.path}`, endpoint]),
  );
  const required = [
    "GET /api/wallets",
    "POST /api/wallets/import",
    "POST /api/wallets/generate",
    "GET /api/wallets/:walletId",
    "PATCH /api/wallets/:walletId",
    "DELETE /api/wallets/:walletId",
    "POST /api/wallets/:walletId/encryption-mode",
    "GET /api/wallets/:walletId/balances",
    "GET /api/wallets/:walletId/tokens",
    "POST /api/wallets/:walletId/tokens",
    "DELETE /api/wallets/:walletId/tokens/:tokenAddress",
    "GET /api/wallets/:walletId/receive",
    "GET /api/address-book",
    "POST /api/address-book",
    "PATCH /api/address-book/:entryId",
    "DELETE /api/address-book/:entryId",
    "GET /api/security-password/status",
    "PUT /api/security-password",
    "GET /api/keystore/status",
    "POST /api/keystore/unlock",
    "POST /api/keystore/lock",
    "PATCH /api/keystore/auto-lock",
    "POST /api/keystore/password",
    "PUT /api/keystore/password",
    "GET /api/keystore/reset-preview",
    "POST /api/keystore/reset",
    "POST /api/wallets/transfers/preview",
    "POST /api/wallets/transfers",
    "GET /api/wallets/transfers/:operationId",
  ];
  for (const key of required) {
    const endpoint = endpoints.get(key);
    assert.ok(endpoint, key);
    assert.equal(endpoint.authentication, "session-required", `${key} authentication`);
    assert.equal(endpoint.ownerScope, "current-user", `${key} ownership`);
    assert.equal(endpoint.implementationStatus, "planned", `${key} implementation status`);
    assert.equal(endpoint.productionRoute, false, `${key} must not claim implementation`);
    assert.ok(endpoint.success, `${key} success`);
    assert.ok(endpoint.errors.length > 0, `${key} errors`);
  }

  const dtos = by(contract.dtos, "id");
  for (const id of [
    "Wallet",
    "WalletImportWrite",
    "WalletBalance",
    "WalletToken",
    "AddressBookEntry",
    "WalletReceiveQr",
    "SecurityPasswordWrite",
    "KeystoreSecretStatus",
    "NativeTransferPreview",
    "Erc20TransferPreview",
    "TransferCreate",
    "ResetPreview",
  ]) {
    assert.ok(dtos.has(id), `${id} DTO`);
  }
  for (const dto of contract.dtos) {
    for (const field of dto.fields) {
      if (field.secret === true) {
        assert.equal(field.direction, "write-only", `${dto.id}.${field.name} secret direction`);
      }
      if (field.monetary === true) {
        assert.equal(field.type, "decimal-base-unit-string", `${dto.id}.${field.name} amount type`);
      }
    }
  }
  assert.deepEqual(dtos.get("KeystoreSecretStatus").fields, [
    { name: "configured", type: "boolean", direction: "read-only" },
    { name: "version", type: "positive-integer", direction: "read-only" },
    { name: "status", type: "secret-status", direction: "read-only" },
  ]);
  assert.equal(contract.secretReadPolicy.returnedFields, "configured-version-status-only");
  assert.equal(contract.secretReadPolicy.maskedSecretFragments, false);
});

test("UI contracts freeze every /wallets and /settings loading, locked, conflict, and error state", async () => {
  const contract = await readJson("ui-state-contracts.json");
  assert.equal(contract.implementationStatus, "planned");
  assert.equal(contract.implementedComponents, 0);
  const routes = by(contract.routes, "path");
  assert.deepEqual(sorted(routes.keys()), ["/settings", "/wallets"]);
  for (const route of routes.values()) {
    assert.equal(route.implementationStatus, "planned", route.path);
    for (const state of ["loading", "locked", "conflict", "error"]) {
      assert.ok(route.states.some(({ id }) => id === state), `${route.path} ${state}`);
    }
    unique(
      route.states.map(({ id }) => id),
      `${route.path} states`,
    );
  }
  for (const state of [
    "empty",
    "ready",
    "balance-stale",
    "delete-blocked",
    "destructive-preview",
    "transfer-preview",
    "transfer-submitting",
    "transfer-pending",
    "transfer-confirmed",
    "transfer-failed",
  ]) {
    assert.ok(routes.get("/wallets").states.some(({ id }) => id === state), `/wallets ${state}`);
  }
  for (const state of [
    "ready",
    "rpc-testing",
    "rpc-timeout",
    "rpc-invalid-response",
    "okx-unconfigured",
    "okx-testing",
    "okx-configured",
    "okx-invalid",
  ]) {
    assert.ok(routes.get("/settings").states.some(({ id }) => id === state), `/settings ${state}`);
  }
  assert.equal(contract.secretInputs.repopulateAfterFailure, false);
  assert.equal(contract.secretInputs.revealControl, false);
  assert.equal(contract.amountInputs.internalRepresentation, "base-unit-decimal-string");
  assert.equal(contract.amountInputs.javascriptNumberAllowed, false);
});

test("transaction contract freezes idempotency, request hashes, nonce serialization, states, and reconciliation", async () => {
  const contract = await readJson("transaction-contracts.json");
  assert.equal(contract.implementationStatus, "planned");
  assert.equal(contract.idempotency.requiredHeader, "Idempotency-Key");
  assert.equal(contract.idempotency.scope, "userId+commandType+walletId+idempotencyKey");
  assert.equal(contract.idempotency.requestHash.algorithm, "SHA-256");
  assert.equal(contract.idempotency.requestHash.secretFieldsIncluded, false);
  assert.equal(contract.idempotency.sameKeySameHash, "return-original-operation-and-status");
  assert.deepEqual(contract.idempotency.sameKeyDifferentHash, {
    status: 409,
    code: "IDEMPOTENCY_CONFLICT",
    createSecondOperation: false,
  });
  assert.equal(contract.nonceLedger.serialKey, "chainId+walletId");
  assert.equal(contract.nonceLedger.sourceOfTruth, "transactional-database-ledger");
  assert.equal(contract.nonceLedger.queueIsSourceOfTruth, false);
  assert.equal(contract.nonceLedger.concurrentAllocation, "serializable-single-writer-with-fencing-token");
  assert.deepEqual(contract.states, [
    "signed",
    "broadcast",
    "pending",
    "confirmed",
    "failed",
    "dropped",
    "replaced",
  ]);
  assert.equal(contract.replacement.sameNonceRequired, true);
  assert.equal(contract.replacement.planMutationAllowed, false);
  assert.equal(contract.replacement.lineageRequired, true);
  assert.equal(contract.replacement.gasPolicy, "fee-bump-only-with-configured-cap");
  assert.deepEqual(contract.confirmation.requiredReconciliation, [
    "receipt-status-success-and-canonical",
    "nonce-consumed-by-lineage-transaction",
    "native-balance-deltas",
    "erc20-balance-deltas-when-applicable",
    "token-transfer-logs-when-applicable",
  ]);
  assert.equal(contract.confirmation.successBeforeAllReconciled, false);
  assert.equal(contract.broadcast.method, "eth_sendRawTransaction");
  assert.equal(contract.broadcast.allowedInP0401, false);
  assert.deepEqual(contract.executionCounts, ZERO_DANGEROUS_OPERATIONS);
});

test("nonce fixture serializes concurrent requests by chainId + walletId without gaps or reuse", async () => {
  const fixture = await readJson("fixtures/nonce-concurrency.json");
  assert.equal(fixture.fixtureOnly, true);
  assert.equal(fixture.networkAccess, false);
  assert.deepEqual(fixture.executionCounts, ZERO_DANGEROUS_OPERATIONS);
  const groups = new Map();
  for (const request of fixture.input.requests) {
    const key = `${request.chainId}:${request.walletId}`;
    const values = groups.get(key) ?? [];
    values.push(request);
    groups.set(key, values);
  }
  const allocations = [];
  for (const [key, requests] of groups) {
    const nextNonce = fixture.input.startingNonceByLedger[key];
    assert.ok(Number.isSafeInteger(nextNonce), `${key} starting nonce`);
    requests.sort(
      (left, right) =>
        left.arrivalOrdinal - right.arrivalOrdinal || left.requestId.localeCompare(right.requestId),
    );
    requests.forEach((request, index) => {
      allocations.push({ requestId: request.requestId, ledgerKey: key, nonce: nextNonce + index });
    });
  }
  allocations.sort((left, right) => left.requestId.localeCompare(right.requestId));
  assert.deepEqual(allocations, fixture.expected.allocations);
  for (const key of groups.keys()) {
    const nonces = allocations.filter((row) => row.ledgerKey === key).map(({ nonce }) => nonce);
    unique(nonces, `${key} allocated nonces`);
    assert.deepEqual(
      nonces,
      Array.from({ length: nonces.length }, (_, index) => Math.min(...nonces) + index),
      `${key} contiguous nonces`,
    );
  }
  assert.equal(fixture.expected.duplicateNonceCount, 0);
  assert.equal(fixture.expected.gapCount, 0);
});

test("replacement fixture preserves same-nonce bidirectional lineage and one active head", async () => {
  const fixture = await readJson("fixtures/replacement-lineage.json");
  assert.equal(fixture.fixtureOnly, true);
  assert.equal(fixture.networkAccess, false);
  assert.deepEqual(fixture.executionCounts, ZERO_DANGEROUS_OPERATIONS);
  const transactions = by(fixture.input.transactions, "txId");
  unique(
    fixture.input.transactions.map(({ txId }) => txId),
    "replacement tx IDs",
  );
  for (const transaction of fixture.input.transactions) {
    assert.equal(transaction.chainId, fixture.input.chainId, `${transaction.txId} chain`);
    assert.equal(transaction.walletId, fixture.input.walletId, `${transaction.txId} wallet`);
    assert.equal(transaction.nonce, fixture.input.nonce, `${transaction.txId} nonce`);
    assert.equal(transaction.planHash, fixture.input.planHash, `${transaction.txId} plan`);
    if (transaction.replacesTxId !== null) {
      const parent = transactions.get(transaction.replacesTxId);
      assert.ok(parent, `${transaction.txId} parent`);
      assert.equal(parent.replacedByTxId, transaction.txId, `${transaction.txId} reverse parent link`);
      assert.ok(
        BigInt(transaction.maxFeePerGasBaseUnits) > BigInt(parent.maxFeePerGasBaseUnits),
        `${transaction.txId} fee bump`,
      );
    }
  }
  assert.deepEqual(
    fixture.input.transactions.map(({ txId }) => txId),
    fixture.expected.lineage,
  );
  assert.equal(fixture.expected.activeHeadTxId, fixture.input.transactions.at(-1).txId);
  assert.equal(fixture.expected.uniqueNonceCount, 1);
  assert.equal(fixture.expected.planMutationCount, 0);
});

test("SET-06 and SET-07 freeze browser-only RPC and write-only OKX credentials", async () => {
  const contract = await readJson("settings-contracts.json");
  assert.equal(contract.implementationStatus, "planned");
  assert.equal(contract.customRpc.featureId, "SET-06");
  assert.equal(contract.customRpc.executionLocation, "browser-only");
  assert.equal(contract.customRpc.readOnly, true);
  assert.equal(contract.customRpc.serverTasksMayUse, false);
  assert.equal(contract.customRpc.serverReceivesUrl, false);
  assert.equal(contract.customRpc.telemetryReceivesUrl, false);
  assert.equal(contract.customRpc.serviceWorkerCachesResponses, false);
  assert.ok(contract.customRpc.methodAllowlist.includes("eth_call"));
  assert.ok(contract.customRpc.methodAllowlist.includes("eth_getBalance"));
  for (const method of [
    "eth_sendRawTransaction",
    "eth_sendTransaction",
    "eth_sign",
    "personal_sign",
    "wallet_addEthereumChain",
    "debug_traceTransaction",
  ]) {
    assert.ok(contract.customRpc.methodDenylist.includes(method), `${method} denied`);
    assert.equal(contract.customRpc.methodAllowlist.includes(method), false, `${method} not allowed`);
  }
  assert.equal(contract.customRpc.url.redaction, "scheme+host+explicit-port+redacted-path-no-query-no-userinfo");
  assert.equal(contract.customRpc.timeoutMs, 8000);
  assert.deepEqual(contract.customRpc.states, [
    "unconfigured",
    "ready",
    "testing",
    "timeout",
    "network-error",
    "chain-mismatch",
    "invalid-response",
    "rate-limited",
  ]);

  assert.equal(contract.okxKey.featureId, "SET-07");
  assert.deepEqual(contract.okxKey.operations, ["save", "replace", "delete", "test", "status"]);
  assert.deepEqual(contract.okxKey.writeOnlyFields, ["apiKey", "secretKey", "passphrase"]);
  assert.deepEqual(contract.okxKey.statusResponseFields, ["configured", "version", "status"]);
  assert.equal(contract.okxKey.secretEcho, false);
  assert.deepEqual(contract.okxKey.minimumPermissions, {
    read: true,
    trade: false,
    withdraw: false,
  });
  assert.equal(contract.okxKey.egress.defaultDeny, true);
  assert.deepEqual(contract.okxKey.egress.allowedHosts, ["www.okx.com"]);
  assert.equal(contract.okxKey.rotation.atomicVersionSwap, true);
  assert.equal(contract.okxKey.audit.secretValues, "forbidden");
  assert.equal(contract.okxKey.audit.changedFlagsOnly, true);
  assert.equal(contract.okxKey.failurePolicy, "closed-no-shared-key-fallback-no-stale-version-use");
  assert.deepEqual(contract.executionCounts, ZERO_DANGEROUS_OPERATIONS);
});

test("lifecycle recovery fixture covers restarts, wrong passwords, tamper, rotation, deletion, and DR", async () => {
  const fixture = await readJson("fixtures/lifecycle-recovery.json");
  assert.equal(fixture.fixtureOnly, true);
  assert.equal(fixture.networkAccess, false);
  assert.deepEqual(fixture.executionCounts, ZERO_DANGEROUS_OPERATIONS);
  const scenarios = by(fixture.input.scenarios, "id");
  for (const id of [
    "server-mode-restart",
    "password-mode-restart",
    "wrong-password",
    "ciphertext-tamper",
    "kek-rewrap",
    "password-change-crash-before-commit",
    "mode-switch-crash-before-commit",
    "delete-with-dependencies",
    "disaster-restore-missing-kek",
    "disaster-restore-complete",
  ]) {
    assert.ok(scenarios.has(id), id);
  }
  assert.equal(scenarios.get("password-mode-restart").expected.state, "locked");
  assert.equal(scenarios.get("wrong-password").expected.error, "INVALID_CREDENTIALS");
  assert.equal(scenarios.get("ciphertext-tamper").expected.state, "quarantined");
  assert.equal(scenarios.get("kek-rewrap").expected.privateKeyPlaintextRequired, false);
  assert.equal(scenarios.get("password-change-crash-before-commit").expected.oldEnvelopeUsable, true);
  assert.equal(scenarios.get("mode-switch-crash-before-commit").expected.partialModeVisible, false);
  assert.equal(scenarios.get("delete-with-dependencies").expected.previewRequired, true);
  assert.equal(scenarios.get("disaster-restore-missing-kek").expected.failClosed, true);
  assert.equal(scenarios.get("disaster-restore-complete").expected.plaintextBackupUsed, false);
});

test("fixture index hashes every synthetic offline fixture and unresolved subjects have gaps", async () => {
  const [index, gaps] = await Promise.all([readJson("fixture-index.json"), readJson("gaps.json")]);
  assert.equal(index.networkPolicy, "offline-synthetic-only");
  assert.deepEqual(index.executionCounts, ZERO_DANGEROUS_OPERATIONS);
  assert.deepEqual(sorted(index.fixtures.map(({ scenario }) => scenario)), [
    "aad-tamper",
    "argon2id-known-answer",
    "crypto-known-answer",
    "lifecycle-recovery",
    "nonce-concurrency",
    "replacement-lineage",
  ]);
  unique(
    index.fixtures.map(({ id }) => id),
    "fixture IDs",
  );
  for (const fixture of index.fixtures) {
    assert.match(fixture.path, /^fixtures\/[a-z0-9-]+\.json$/u);
    assert.match(fixture.schemaId, /^p04-fixture:\/\/[a-z0-9-]+\/v1$/u);
    const bytes = await readFile(path.join(ACCEPTANCE, fixture.path));
    assert.equal(fixture.bytes, bytes.length, `${fixture.id} bytes`);
    assert.equal(fixture.sha256, digest(bytes), `${fixture.id} sha256`);
    const contents = JSON.parse(bytes.toString("utf8"));
    assert.equal(contents.schemaVersion, 1, `${fixture.id} schemaVersion`);
    assert.equal(contents.schemaId, fixture.schemaId, `${fixture.id} schemaId`);
    assert.equal(contents.scenario, fixture.scenario, `${fixture.id} scenario`);
    assert.equal(contents.fixtureOnly, true, `${fixture.id} fixtureOnly`);
    assert.equal(contents.syntheticSecrets, true, `${fixture.id} synthetic secrets`);
    assert.equal(contents.networkAccess, false, `${fixture.id} network access`);
    assert.deepEqual(contents.executionCounts, ZERO_DANGEROUS_OPERATIONS, `${fixture.id} counts`);
    assert.ok(contents.input, `${fixture.id} input`);
    assert.ok(contents.expected, `${fixture.id} expected`);
  }
  unique(
    gaps.items.map(({ id }) => id),
    "gap IDs",
  );
  for (const gap of gaps.items) {
    assert.equal(gap.status, "unresolved", gap.id);
    assert.equal(gap.blocksParity, true, gap.id);
    assert.ok(gap.reason.length > 0, `${gap.id} reason`);
    assert.ok(gap.requiredFollowUp.length > 0, `${gap.id} follow-up`);
  }
});

test("manifest reference hashes are anchored to the requested baseline", async () => {
  const manifest = await readJson("artifact-manifest.json");
  assert.deepEqual(
    sorted(manifest.references.map(({ path: value }) => value)),
    sorted(REFERENCE_PATHS),
  );
  unique(
    manifest.references.map(({ path: value }) => value),
    "reference paths",
  );
  for (const reference of manifest.references) {
    const bytes = baselineBytes(reference.path);
    assert.equal(reference.bytes, bytes.length, `${reference.path} bytes`);
    assert.equal(reference.sha256, digest(bytes), `${reference.path} sha256`);
    assert.equal(reference.commit, BASELINE, `${reference.path} commit`);
    assert.ok(reference.source.length > 0, `${reference.path} source`);
    assert.match(
      reference.classification,
      /^(PUBLIC|BUNDLE-CANDIDATE|INFERRED|LOCAL-DECISION)$/u,
      `${reference.path} classification`,
    );
  }
});

test("P00-P03-04 acceptance files remain byte-identical to the baseline inventory", async () => {
  const rows = parseChecksums(
    await readFile(path.join(ACCEPTANCE, "prior-acceptance-sha256s.txt"), "utf8"),
    "prior acceptance checksums",
  );
  const baselinePaths = git([
    "ls-tree",
    "-r",
    "--name-only",
    BASELINE,
    "--",
    "artifacts/acceptance",
  ])
    .trimEnd()
    .split("\n")
    .filter((relativePath) => /^artifacts\/acceptance\/P0[0-3]-[^/]+\//u.test(relativePath));
  assert.equal(baselinePaths.length, 462);
  assert.deepEqual(
    sorted(rows.map(({ path: value }) => value)),
    sorted(baselinePaths),
    "prior acceptance inventory must be exhaustive",
  );
  for (const row of rows) {
    const current = await readFile(path.join(ROOT, row.path));
    assert.equal(digest(current), row.sha256, `${row.path} current sha256`);
    assert.equal(digest(baselineBytes(row.path)), row.sha256, `${row.path} baseline sha256`);
  }
});

test("manifest inventory and sha256sums cover every non-self-referential P04-01 artifact", async () => {
  const manifest = await readJson("artifact-manifest.json");
  const rows = parseChecksums(
    await readFile(path.join(ACCEPTANCE, "sha256sums.txt"), "utf8"),
    "P04-01 checksums",
  );
  const actualPaths = (await filesBelow(ACCEPTANCE)).filter(
    (relativePath) => !["artifact-manifest.json", "sha256sums.txt"].includes(relativePath),
  );
  assert.deepEqual(sorted(rows.map(({ path: value }) => value)), actualPaths);
  assert.deepEqual(sorted(manifest.files.map(({ path: value }) => value)), actualPaths);
  const checksumMap = by(rows, "path");
  const manifestMap = by(manifest.files, "path");
  for (const relativePath of actualPaths) {
    const bytes = await readFile(path.join(ACCEPTANCE, relativePath));
    const sha256 = digest(bytes);
    assert.equal(checksumMap.get(relativePath).sha256, sha256, `${relativePath} checksum`);
    assert.equal(manifestMap.get(relativePath).sha256, sha256, `${relativePath} manifest hash`);
    assert.equal(manifestMap.get(relativePath).bytes, bytes.length, `${relativePath} manifest bytes`);
  }
});
