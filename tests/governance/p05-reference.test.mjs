import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { access, readFile, readdir } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import Ajv from "ajv";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const ACCEPTANCE = path.join(ROOT, "artifacts/acceptance/P05-01");
const BASELINE = "1ae85706d4c17c5dbfeebee447a76d069b14c845";
const FACT_CLASSES = ["OBSERVED", "OFFICIAL", "LOCAL-DECISION", "INFERRED", "UNKNOWN"];
const FEATURE_IDS = [
  "SWAP-01",
  "SWAP-02",
  "POS-01",
  "POS-02",
  "POS-03",
  "POS-04",
  "HELPER-01",
  "HELPER-02",
  "HELPER-03",
  "HELPER-04",
  "HELPER-05",
  "HELPER-06",
];
const OBSERVED_PATHS = {
  "observed-v3-path-a": "0xadc3f25c",
  "observed-v3-path-b": "0xfb691fd9",
  "observed-v4-path-a": "0x71fa74ed",
  "observed-v4-path-b": "0x5dfd8e50",
};
const ZERO_EXECUTION = {
  transactionSignatures: 0,
  transactionBroadcasts: 0,
  chainWrites: 0,
  realFundOperations: 0,
};
const REQUIRED_ARTIFACTS = [
  "adapter-contracts.json",
  "api-contracts.json",
  "artifact-manifest.json",
  "coverage.json",
  "fact-catalog.json",
  "fixture-index.json",
  "gaps.json",
  "helper-contracts.json",
  "operation-contracts.json",
  "prior-acceptance-sha256s.txt",
  "registry-contracts.json",
  "security-boundary-contracts.json",
  "sha256sums.txt",
  "ui-state-contracts.json",
  "checks/artifact-schema.txt",
  "checks/fixture-byte-regression.txt",
  "checks/governance-test.txt",
  "checks/initial-failure.txt",
  "checks/prior-acceptance-integrity.txt",
  "checks/quality-gates.txt",
  "checks/security-audit.txt",
  "fixtures/registry-code-snapshot.json",
];
const REFERENCE_PATHS = [
  "artifacts/acceptance/P04-01/transaction-contracts.json",
  "docs/ARCHITECTURE_AND_WORKFLOWS.md",
  "docs/DEVELOPMENT_ROADMAP.md",
  "docs/FUNCTION_MATRIX.md",
  "docs/TRACEABILITY_MATRIX.md",
  "docs/VIBE_CODING_PLAYBOOK.md",
  "docs/research/onchain-helper.md",
  "docs/research/prior-thread.md",
  "packages/chain-registry/src/index.ts",
];
const COMPONENT_IDS = {
  1: {
    factory: "univ3Factory",
    positionManager: "univ3PositionManager",
  },
  2: {
    factory: "pcsv3Factory",
    positionManager: "pcsv3PositionManager",
  },
  4: {
    poolManager: "univ4PoolManager",
    positionManager: "univ4PositionManager",
    permit2: "univ4Permit2",
  },
  5: {
    poolManager: "pcsv4PoolManager",
    positionManager: "pcsv4PositionManager",
    permit2: "pcsv4Permit2",
  },
};

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
      const match = /^([0-9a-f]{64}) {2}(.+)$/u.exec(line);
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

function clone(value) {
  return structuredClone(value);
}

function registryDecision(registry, request) {
  if (!registry.supportedChainIds.includes(request.chainId)) return "UNSUPPORTED_CHAIN";
  const deployment = registry.deployments.find(
    (candidate) =>
      candidate.chainId === request.chainId && candidate.platformId === request.platformId,
  );
  if (!deployment) return "PLATFORM_NOT_REGISTERED";
  if (request.registryVersion !== registry.registryVersion) return "REGISTRY_VERSION_MISMATCH";
  if (request.abiHash !== deployment.abiHash) return "ABI_HASH_MISMATCH";
  const block = BigInt(request.blockNumber);
  if (
    block < BigInt(deployment.validFromBlock) ||
    (deployment.validToBlock !== null && block > BigInt(deployment.validToBlock))
  ) {
    return "BLOCK_OUTSIDE_VALIDITY";
  }
  for (const componentName of [
    "factory",
    "poolManager",
    "positionManager",
    "permit2",
    "router",
    "spender",
    "wrappedNative",
  ]) {
    const expected = deployment[componentName];
    const actual = request.components[componentName];
    if (expected === null || expected.address === null) {
      if (actual !== null && actual?.address !== null) return "ADDRESS_MISMATCH";
      continue;
    }
    if (actual?.address !== expected.address) return "ADDRESS_MISMATCH";
    if (actual.runtimeCodeHash !== expected.runtimeCodeHash) {
      return "RUNTIME_CODE_HASH_MISMATCH";
    }
  }
  if (!deployment.router.allowedSelectors.includes(request.routerSelector)) {
    return "ROUTER_SELECTOR_NOT_ALLOWLISTED";
  }
  return "ALLOW";
}

function registryRequest(registry, platformId) {
  const deployment = registry.deployments.find((candidate) => candidate.platformId === platformId);
  assert.ok(deployment, `platform ${platformId}`);
  return {
    abiHash: deployment.abiHash,
    blockNumber: deployment.validFromBlock,
    chainId: deployment.chainId,
    components: Object.fromEntries(
      [
        "factory",
        "poolManager",
        "positionManager",
        "permit2",
        "router",
        "spender",
        "wrappedNative",
      ].map((componentName) => [componentName, clone(deployment[componentName])]),
    ),
    platformId,
    registryVersion: deployment.registryVersion,
    routerSelector: "0x00000000",
  };
}

test("P05-01 required reference artifacts exist", async () => {
  for (const relativePath of REQUIRED_ARTIFACTS) {
    await access(path.join(ACCEPTANCE, relativePath));
  }
});

test("P05-01 manifest satisfies its schema and freezes read-only zero-execution scope", async () => {
  const [manifest, schema] = await Promise.all([
    readJson("artifact-manifest.json"),
    readFile(path.join(ROOT, "schemas/p05-reference-artifacts.schema.json"), "utf8").then(
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
    productionRegistry: false,
    productionAdapters: false,
    productionHelper: false,
    productionApiRoutes: false,
    productionUi: false,
    databaseChanges: false,
    signerRuntime: false,
    mainnetReadOnlyEvidenceCapture: true,
    ciNetworkAccess: false,
    ...ZERO_EXECUTION,
  });
});

test("P05 remains 0 implemented-assumed / 12 planned and global counts remain 61 / 135", async () => {
  const coverage = await readJson("coverage.json");
  assert.equal(coverage.workItemId, "P05-01");
  assert.equal(coverage.phase, "P05");
  assert.deepEqual(coverage.workItemFeatureIds, []);
  assert.equal(coverage.implementationOwnership, "none");
  assert.deepEqual(coverage.counts, { "implemented-assumed": 0, planned: 12 });
  assert.deepEqual(coverage.globalCounts, { "implemented-assumed": 61, planned: 135 });
  unique(
    coverage.features.map(({ id }) => id),
    "coverage feature IDs",
  );
  assert.deepEqual(sorted(coverage.features.map(({ id }) => id)), sorted(FEATURE_IDS));
  for (const feature of coverage.features) {
    assert.equal(feature.phase, "P05", `${feature.id} phase`);
    assert.equal(feature.status, "planned", `${feature.id} status`);
    assert.equal(feature.implementationOwner, null, `${feature.id} owner`);
    assert.ok(feature.contractArtifacts.length > 0, `${feature.id} contract artifacts`);
  }
});

test("fact catalog uses exactly five evidence classes and preserves opaque selector names", async () => {
  const catalog = await readJson("fact-catalog.json");
  assert.deepEqual(sorted(Object.keys(catalog.classifications)), sorted(FACT_CLASSES));
  assert.deepEqual(
    sorted(new Set(catalog.facts.map(({ classification }) => classification))),
    sorted(FACT_CLASSES),
  );
  unique(
    catalog.facts.map(({ id }) => id),
    "fact IDs",
  );
  const observedPaths = catalog.facts.find(({ id }) => id === "P05-OBSERVED-HELPER-PATHS");
  assert.ok(observedPaths);
  assert.equal(observedPaths.classification, "OBSERVED");
  assert.deepEqual(
    Object.fromEntries(observedPaths.claim.map(({ name, selector }) => [name, selector])),
    OBSERVED_PATHS,
  );
  for (const pathFact of observedPaths.claim) {
    assert.equal(pathFact.sampleCount, 10, `${pathFact.name} sample count`);
    assert.equal(pathFact.originalFunctionName, null, `${pathFact.name} function name`);
  }
  assert.equal(catalog.promotionPolicy.observedMayNameUnknownFunction, false);
  assert.equal(catalog.promotionPolicy.inferenceMayEnableProductionEncoding, false);
  assert.equal(catalog.promotionPolicy.unknownMayEnableExecution, false);
});

test("BSC execution registry freezes platform identities and matches the code snapshot", async () => {
  const [registry, snapshot] = await Promise.all([
    readJson("registry-contracts.json"),
    readJson("fixtures/registry-code-snapshot.json"),
  ]);
  assert.deepEqual(registry.supportedChainIds, [56]);
  assert.equal(registry.registryVersion, "p05-bsc-execution-v1");
  assert.deepEqual(registry.platformIds, {
    1: "UniV3",
    2: "PCSV3",
    4: "UniV4",
    5: "PCSV4",
  });
  assert.equal(registry.executionEnabled, false);
  assert.equal(registry.effectiveBlock, snapshot.network.blockNumber);
  assert.equal(snapshot.network.chainId, 56);
  assert.equal(snapshot.registryVersion, registry.registryVersion);
  assert.equal(snapshot.components.length, 13);
  const snapshots = by(snapshot.components, "id");
  unique(
    snapshot.components.map(({ id }) => id),
    "registry snapshot IDs",
  );
  for (const deployment of registry.deployments) {
    assert.equal(deployment.chainId, 56);
    assert.equal(deployment.registryVersion, registry.registryVersion);
    assert.match(deployment.abiHash, /^sha256:[0-9a-f]{64}$/u);
    assert.equal(deployment.validFromBlock, registry.effectiveBlock);
    assert.equal(deployment.validToBlock, null);
    assert.deepEqual(deployment.router.allowedSelectors, []);
    const expectedIds = {
      ...COMPONENT_IDS[deployment.platformId],
      router: "router",
      spender: "spender",
      wrappedNative: "wrappedNative",
    };
    for (const [componentName, snapshotId] of Object.entries(expectedIds)) {
      const component = deployment[componentName];
      const observed = snapshots.get(snapshotId);
      assert.ok(component, `${deployment.platformId} ${componentName}`);
      assert.ok(observed, snapshotId);
      assert.equal(component.address, observed.address, `${snapshotId} address`);
      assert.equal(component.runtimeCodeHash, observed.runtimeCodeHash, `${snapshotId} hash`);
      assert.equal(component.runtimeCodeBytes, observed.runtimeCodeBytes, `${snapshotId} bytes`);
    }
  }
  assert.deepEqual(registry.writeBoundary, {
    nonLocalTerminalState: "READY_FOR_APPROVAL",
    ...ZERO_EXECUTION,
  });
});

test("registry address, version, ABI, code hash, effective block, and selectors fail closed", async () => {
  const registry = await readJson("registry-contracts.json");
  assert.deepEqual(registry.failClosedPolicy.requiredExactMatches, [
    "chainId",
    "platformId",
    "registryVersion",
    "abiHash",
    "validBlockRange",
    "componentAddress",
    "runtimeCodeHash",
  ]);
  assert.equal(registry.failClosedPolicy.addressFallbackAllowed, false);
  assert.equal(registry.failClosedPolicy.latestVersionFallbackAllowed, false);
  assert.equal(registry.failClosedPolicy.unknownCodeHashAllowed, false);
  assert.equal(registry.failClosedPolicy.unknownEffectiveBlockAllowed, false);

  const exact = registryRequest(registry, 4);
  assert.equal(registryDecision(registry, exact), "ROUTER_SELECTOR_NOT_ALLOWLISTED");
  const cases = [
    ["UNSUPPORTED_CHAIN", (request) => (request.chainId = 97)],
    ["REGISTRY_VERSION_MISMATCH", (request) => (request.registryVersion = "p05-mutated")],
    ["ABI_HASH_MISMATCH", (request) => (request.abiHash = `sha256:${"0".repeat(64)}`)],
    ["BLOCK_OUTSIDE_VALIDITY", (request) => (request.blockNumber = "116718412")],
    [
      "ADDRESS_MISMATCH",
      (request) => (request.components.positionManager.address = `0x${"0".repeat(40)}`),
    ],
    [
      "RUNTIME_CODE_HASH_MISMATCH",
      (request) => (request.components.router.runtimeCodeHash = `0x${"0".repeat(64)}`),
    ],
  ];
  for (const [expected, mutate] of cases) {
    const request = clone(exact);
    mutate(request);
    assert.equal(registryDecision(registry, request), expected);
  }
});

test("adapter contracts freeze quote and position DTOs without production calldata generation", async () => {
  const contract = await readJson("adapter-contracts.json");
  assert.deepEqual(contract.supportedChainIds, [56]);
  assert.deepEqual(
    contract.adapters.map(({ platformId }) => platformId),
    [1, 2, 4, 5],
  );
  for (const adapter of contract.adapters) assert.equal(adapter.status, "planned", adapter.id);
  for (const field of ["route", "minOutBaseUnit", "priceImpactBps", "gas", "expiry", "digest"]) {
    assert.ok(contract.swapQuote.requiredFields.includes(field), `quote ${field}`);
  }
  assert.equal(contract.swapQuote.fields.amountInBaseUnit, "base10-uint-string");
  assert.equal(contract.swapQuote.fields.amountOutBaseUnit, "base10-uint-string");
  assert.equal(contract.swapQuote.route.clientSuppliedTargetAllowed, false);
  assert.equal(contract.swapQuote.route.clientSuppliedCalldataAllowed, false);
  assert.equal(contract.swapQuote.route.clientSuppliedSelectorAllowed, false);
  assert.equal(contract.swapQuote.route.clientSuppliedSpenderAllowed, false);
  for (const field of [
    "owner",
    "tokenId",
    "pool",
    "ticks",
    "liquidity",
    "fees",
    "approval",
    "snapshot",
  ]) {
    assert.ok(contract.positionDto.requiredFields.includes(field), `position ${field}`);
  }
  assert.equal(contract.observedHelperCodecBoundary.testOnly, true);
  assert.equal(contract.observedHelperCodecBoundary.productionImportAllowed, false);
  assert.deepEqual(contract.observedHelperCodecBoundary.paths, Object.keys(OBSERVED_PATHS));
  assert.equal(contract.outputBoundary.nonLocalWriteState, "READY_FOR_APPROVAL");
  assert.equal(contract.outputBoundary.productionCalldataGenerationEnabled, false);
});

test("Helper contract freezes six states, guarded recovery, and unresolved parity gaps", async () => {
  const [helper, gaps] = await Promise.all([
    readJson("helper-contracts.json"),
    readJson("gaps.json"),
  ]);
  assert.deepEqual(helper.stateMachine.states, [
    "undeployed",
    "deploying",
    "active",
    "degraded",
    "superseded",
    "residual",
  ]);
  assert.equal(helper.deployment.implementationEnabled, false);
  assert.equal(helper.deployment.nonLocalBoundary, "READY_FOR_APPROVAL");
  assert.equal(helper.identity.ownerMustEqualWalletAddress, true);
  assert.equal(helper.identity.runtimeCodeHashMustMatchRegistry, true);
  assert.equal(helper.residualAndSweep.arbitraryTokenInputAllowed, false);
  assert.equal(helper.residualAndSweep.sweepRecipient, "immutable-owner-only");
  assert.equal(helper.factBoundary.functionNamesKnown, false);
  assert.equal(helper.factBoundary.productionCodecEnabled, false);
  for (const subject of ["upgrade", "fee ownership", "atomicity"]) {
    assert.ok(
      helper.unresolvedSubjects.some((value) => value.toLowerCase().includes(subject)),
      subject,
    );
  }
  unique(
    gaps.items.map(({ id }) => id),
    "gap IDs",
  );
  for (const gap of gaps.items) {
    assert.equal(gap.classification, "UNKNOWN", `${gap.id} classification`);
    assert.equal(gap.status, "unresolved", `${gap.id} status`);
    assert.ok(gap.reason.length > 0, `${gap.id} reason`);
    assert.ok(gap.requiredFollowUp.length > 0, `${gap.id} follow-up`);
  }
  for (const id of ["GAP-P05-HELPER-UPGRADE", "GAP-P05-FEE-OWNERSHIP", "GAP-P05-EXIT-ATOMICITY"]) {
    assert.ok(
      gaps.items.some((gap) => gap.id === id),
      id,
    );
  }
});

test("operation state machine freezes seven steps and reuses the P04 execution stack", async () => {
  const contract = await readJson("operation-contracts.json");
  assert.equal(contract.operationIdentity.payloadDigestRequired, true);
  assert.equal(contract.operationIdentity.sameKeyDifferentDigest, "IDEMPOTENCY_CONFLICT");
  assert.equal(contract.p05ReferenceReachability.nonLocalWriteTerminalState, "READY_FOR_APPROVAL");
  assert.equal(contract.p05ReferenceReachability.statesAfterReadyForApprovalImplemented, false);
  assert.deepEqual(
    {
      transactionSignatures: contract.p05ReferenceReachability.signatures,
      transactionBroadcasts: contract.p05ReferenceReachability.broadcasts,
      chainWrites: contract.p05ReferenceReachability.chainWrites,
      realFundOperations: contract.p05ReferenceReachability.realFundOperations,
    },
    ZERO_EXECUTION,
  );
  assert.equal(contract.p04Reuse.newNonceLedgerAllowed, false);
  assert.equal(contract.p04Reuse.newSignerAllowed, false);
  assert.equal(contract.p04Reuse.nonceLedger.serialKey, "chainId+walletId");
  assert.equal(contract.p04Reuse.signer.planDigestMustMatch, true);
  assert.equal(contract.p04Reuse.broadcast.sameSignedTransactionOnly, true);
  assert.equal(contract.p04Reuse.replacement.sameNonce, true);
  assert.equal(contract.p04Reuse.replacement.samePlanDigest, true);
  assert.equal(contract.p04Reuse.reconciliation.receiptBeforeRetry, true);
  assert.deepEqual(
    contract.steps.map(({ kind }) => kind),
    ["approve-or-permit2", "swap", "mint-or-increase", "collect", "decrease", "refund", "sweep"],
  );
  for (const step of contract.steps) {
    assert.ok(step.preconditions.length > 0, `${step.kind} preconditions`);
    assert.ok(step.postconditions.length > 0, `${step.kind} postconditions`);
    assert.ok(step.idempotencyKey.length > 0, `${step.kind} idempotency key`);
    assert.ok(step.recoveryActions.length > 0, `${step.kind} recovery actions`);
  }
  assert.equal(contract.successReconciliation.canonicalReceiptRequired, true);
  assert.equal(contract.successReconciliation.broadcastIsSuccess, false);
  assert.equal(contract.successReconciliation.receiptWithoutStateReconciliationIsSuccess, false);
  for (const subject of ["balances", "allowances", "NFT owner", "events", "fee", "refund"]) {
    assert.ok(
      contract.successReconciliation.requiredChecks.some((value) => value.includes(subject)),
      `reconciliation ${subject}`,
    );
  }
});

test("API and UI contracts expose intent-only approval previews with no production implementation", async () => {
  const [api, ui] = await Promise.all([
    readJson("api-contracts.json"),
    readJson("ui-state-contracts.json"),
  ]);
  assert.equal(api.requestBoundary.accepted, "business-intent-only");
  assert.equal(api.requestBoundary.unknownFields, "reject");
  assert.deepEqual(api.requestBoundary.forbiddenClientFields, [
    "target",
    "router",
    "spender",
    "selector",
    "calldata",
    "feeRecipient",
    "feeBps",
    "positionManager",
    "poolManager",
    "permit2",
    "registryVersionOverride",
  ]);
  assert.equal(api.writeEndpointRules.nonLocalWriteBoundary, "READY_FOR_APPROVAL");
  assert.equal(api.writeEndpointRules.serverMayAutoSign, false);
  assert.equal(api.writeEndpointRules.serverMayAutoBroadcast, false);
  assert.equal(api.productionRoutesCreated, false);
  for (const endpoint of api.endpoints.filter(({ write }) => write)) {
    assert.equal(endpoint.nonLocalResponseState, "READY_FOR_APPROVAL", endpoint.path);
    assert.ok(endpoint.request.includes("idempotencyKey"), `${endpoint.path} idempotency`);
  }
  const surfaces = by(ui.surfaces, "id");
  assert.deepEqual(
    sorted([...surfaces.keys()]),
    sorted([
      "wallet-swap",
      "wallet-positions",
      "position-ledger",
      "helper-status",
      "helper-residuals",
    ]),
  );
  assert.ok(surfaces.get("wallet-swap").states.includes("ready-for-approval"));
  assert.equal(surfaces.get("wallet-swap").broadcastCommandPresent, false);
  assert.deepEqual(surfaces.get("helper-status").states, [
    "undeployed",
    "deploying",
    "active",
    "degraded",
    "superseded",
    "residual",
  ]);
  assert.equal(ui.approvalView.arbitraryTargetEditable, false);
  assert.equal(ui.approvalView.arbitrarySpenderEditable, false);
  assert.equal(ui.approvalView.feePolicyEditable, false);
  assert.equal(ui.approvalView.codeHashMismatchDisablesApproval, true);
  assert.equal(ui.implementationCreated, false);
});

test("security contract denies arbitrary execution and requires full success reconciliation", async () => {
  const contract = await readJson("security-boundary-contracts.json");
  assert.equal(contract.defaultDecision, "deny");
  assert.equal(
    Object.values(contract.arbitraryExecution).every((allowed) => allowed === false),
    true,
  );
  assert.deepEqual(sorted(Object.keys(contract.mandatoryValidation)), [
    "codeHash",
    "deadline",
    "fee",
    "minOut",
    "recipient",
    "token",
  ]);
  assert.deepEqual(
    contract.threatCases.map(({ id }) => id),
    [
      "NON_OWNER",
      "MALICIOUS_TOKEN",
      "MALICIOUS_ROUTER",
      "REENTRANCY",
      "NFT_APPROVAL",
      "DUST",
      "ALLOWANCE",
      "NATIVE_WRAP_UNWRAP",
      "REFUND",
    ],
  );
  assert.equal(contract.simulation.requiredBeforeApproval, true);
  assert.equal(contract.simulation.simulationSuccessAuthorizesBroadcast, false);
  assert.deepEqual(contract.successDefinition, {
    canonicalReceipt: true,
    canonicalBalanceReconciliation: true,
    allowanceReconciliation: true,
    nftOwnerReconciliation: true,
    protocolEventReconciliation: true,
    feeAndRefundReconciliation: true,
    broadcastAlone: false,
    receiptStatusAlone: false,
  });
  assert.deepEqual(contract.executionCounters, ZERO_EXECUTION);
});

test("fixture index covers forty independent observed calldata samples and one registry snapshot", async () => {
  const index = await readJson("fixture-index.json");
  assert.equal(index.networkPolicy, "ci-offline-frozen-observed-only");
  assert.equal(index.capturePolicy.chainId, 56);
  assert.equal(index.capturePolicy.readOnly, true);
  assert.equal(index.capturePolicy.ciRecaptureAllowed, false);
  assert.equal(index.capturePolicy.syntheticSamplesAllowed, false);
  assert.equal(index.capturePolicy.minimumIndependentSamplesPerPath, 10);
  assert.deepEqual(index.requiredPaths, Object.keys(OBSERVED_PATHS));
  assert.deepEqual(index.counts, {
    "observed-v3-path-a": 10,
    "observed-v3-path-b": 10,
    "observed-v4-path-a": 10,
    "observed-v4-path-b": 10,
    total: 40,
    registrySnapshots: 1,
  });
  assert.deepEqual(index.executionCounts, ZERO_EXECUTION);
  assert.equal(index.fixtures.length, 41);
  unique(
    index.fixtures.map(({ id }) => id),
    "fixture IDs",
  );
  unique(
    index.fixtures.map(({ path: value }) => value),
    "fixture paths",
  );

  const transactionHashes = new Set();
  for (const indexed of index.fixtures.filter(
    ({ fixtureType }) => fixtureType === "observed-helper-calldata",
  )) {
    const bytes = await readFile(path.join(ACCEPTANCE, indexed.path));
    const fixture = JSON.parse(bytes.toString("utf8"));
    assert.equal(indexed.bytes, bytes.length, `${indexed.id} bytes`);
    assert.equal(indexed.sha256, digest(bytes), `${indexed.id} sha256`);
    assert.equal(fixture.classification, "OBSERVED", indexed.id);
    assert.equal(fixture.network.chainId, 56, indexed.id);
    assert.equal(fixture.observedPath, indexed.observedPath, indexed.id);
    assert.equal(fixture.selector, OBSERVED_PATHS[fixture.observedPath], indexed.id);
    assert.equal(fixture.rawInput, fixture.transaction.input, indexed.id);
    assert.match(fixture.rawInput, /^0x[0-9a-f]+$/u, `${indexed.id} raw input`);
    assert.equal(fixture.rawInput.slice(0, 10), fixture.selector, indexed.id);
    assert.equal(fixture.receipt.status, "0x1", indexed.id);
    assert.equal(fixture.receipt.transactionHash, fixture.transaction.hash, indexed.id);
    assert.equal(fixture.receipt.blockHash, fixture.network.blockHash, indexed.id);
    assert.deepEqual(fixture.logs, fixture.receipt.logs, indexed.id);
    assert.equal(fixture.block.hash, fixture.network.blockHash, indexed.id);
    assert.ok(fixture.block.transactions.includes(fixture.transaction.hash), indexed.id);
    assert.equal(fixture.transaction.to.toLowerCase(), fixture.helper.address, indexed.id);
    assert.equal(fixture.transaction.from.toLowerCase(), fixture.helper.owner, indexed.id);
    assert.equal(
      fixture.helper.ownerCallResult.slice(-40),
      fixture.helper.owner.slice(2),
      indexed.id,
    );
    assert.match(fixture.helper.runtimeCodeHash, /^0x[0-9a-f]{64}$/u, indexed.id);
    assert.ok(fixture.helper.runtimeCodeBytes > 0, indexed.id);
    assert.deepEqual(
      new Set(fixture.sources.map(({ kind }) => kind)),
      new Set([
        "bscscan-transaction-index",
        "bscscan-transaction",
        "bsc-json-rpc",
        "bsc-archive-json-rpc",
      ]),
      indexed.id,
    );
    assert.deepEqual(fixture.executionCounters, ZERO_EXECUTION, indexed.id);
    assert.equal(transactionHashes.has(fixture.transaction.hash), false, indexed.id);
    transactionHashes.add(fixture.transaction.hash);
    assert.equal(
      path.basename(indexed.path, ".json"),
      fixture.transaction.hash.slice(2),
      indexed.id,
    );
  }
  assert.equal(transactionHashes.size, 40);

  const registryIndex = index.fixtures.find(
    ({ fixtureType }) => fixtureType === "execution-registry-code-snapshot",
  );
  assert.ok(registryIndex);
  const registryBytes = await readFile(path.join(ACCEPTANCE, registryIndex.path));
  assert.equal(registryIndex.bytes, registryBytes.length);
  assert.equal(registryIndex.sha256, digest(registryBytes));
  const registryFixture = JSON.parse(registryBytes.toString("utf8"));
  assert.equal(registryIndex.componentCount, registryFixture.components.length);
  assert.deepEqual(registryFixture.executionCounters, ZERO_EXECUTION);
});

test("manifest references are anchored to the requested baseline", async () => {
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
    assert.equal(reference.commit, BASELINE, `${reference.path} commit`);
    assert.equal(reference.bytes, bytes.length, `${reference.path} bytes`);
    assert.equal(reference.sha256, digest(bytes), `${reference.path} sha256`);
    assert.ok(FACT_CLASSES.includes(reference.classification), reference.path);
  }
});

test("all P00-P04-07 acceptance files remain byte-identical to the baseline inventory", async () => {
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
    .filter((relativePath) => /^artifacts\/acceptance\/P0[0-4]-[^/]+\//u.test(relativePath));
  assert.equal(baselinePaths.length, 582);
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

test("manifest and checksum inventory cover every non-self-referential P05 artifact", async () => {
  const manifest = await readJson("artifact-manifest.json");
  const rows = parseChecksums(
    await readFile(path.join(ACCEPTANCE, "sha256sums.txt"), "utf8"),
    "P05-01 checksums",
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
    assert.equal(manifestMap.get(relativePath).bytes, bytes.length, `${relativePath} bytes`);
  }
});

test("check:p05-reference is offline and CI retains exactly six jobs", async () => {
  const [packageJson, workflow] = await Promise.all([
    readFile(path.join(ROOT, "package.json"), "utf8").then(JSON.parse),
    readFile(path.join(ROOT, ".github/workflows/ci.yml"), "utf8"),
  ]);
  assert.equal(
    packageJson.scripts["check:p05-reference"],
    "node scripts/check-p05-reference-artifacts.mjs",
  );
  assert.ok(packageJson.scripts["check:all"].includes("pnpm check:p05-reference"));
  assert.equal(packageJson.scripts["check:p05-reference"].includes("capture"), false);
  assert.match(workflow, /run: pnpm check:p05-reference/u);
  assert.doesNotMatch(workflow, /capture:p05|capture-p05-01-fixtures/u);
  const jobsSection = workflow.slice(workflow.indexOf("\njobs:\n") + "\njobs:\n".length);
  const jobNames = [...jobsSection.matchAll(/^ {2}([a-z][a-z0-9-]+):$/gmu)].map(
    (match) => match[1],
  );
  assert.deepEqual(jobNames, [
    "quality",
    "governance",
    "browser",
    "contracts",
    "infrastructure",
    "security",
  ]);
});
