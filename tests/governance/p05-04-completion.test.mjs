import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { access, readFile, readdir } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(fileURLToPath(new URL("../..", import.meta.url)));
const BASELINE = "63ffc42e3aa371868623f0f22add6b7268df9499";
const ACCEPTANCE = path.join(ROOT, "artifacts/acceptance/P05-04");
const ACCEPTANCE_ROOT = path.join(ROOT, "artifacts/acceptance");
const REFERENCE_COVERAGE = [
  "SWAP-02",
  "POS-02",
  "POS-03",
  "HELPER-02",
  "HELPER-03",
  "HELPER-04",
  "HELPER-06",
];
const CURRENT_IMPLEMENTED = [
  "SWAP-01",
  "POS-01",
  "POS-04",
  "HELPER-01",
  "HELPER-02",
  "HELPER-05",
];
const CURRENT_PLANNED = REFERENCE_COVERAGE.filter((id) => id !== "HELPER-02");
const OBSERVED_SELECTORS = ["0xadc3f25c", "0xfb691fd9", "0x71fa74ed", "0x5dfd8e50"];
const REQUIRED_FILES = [
  "E-CHAIN.md",
  "E-OPS.md",
  "E-REC.md",
  "E-SEC.md",
  "candidate-registry.json",
  "command-output.md",
  "evidence-matrix.json",
  "execution-gate.json",
  "fee-policy.json",
  "helper-abi-code-hashes.json",
  "initial-failure.md",
  "local-anvil-snapshot.json",
  "manifest.json",
  "observed-helper-creation.json",
  "operation-plan-contracts.json",
  "router-policy.json",
  "sha256sums.txt",
  "token-policy.json",
];

function digest(value, prefix = false) {
  const valueDigest = createHash("sha256").update(value).digest("hex");
  return prefix ? `sha256:${valueDigest}` : valueDigest;
}

function sorted(values) {
  return [...values].sort();
}

async function json(name) {
  return JSON.parse(await readFile(path.join(ACCEPTANCE, name), "utf8"));
}

async function filesBelow(directory, prefix = "") {
  const result = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const relative = path.posix.join(prefix, entry.name);
    if (entry.isDirectory())
      result.push(...(await filesBelow(path.join(directory, entry.name), relative)));
    else if (entry.isFile()) result.push(relative);
  }
  return sorted(result);
}

function parseChecksums(source) {
  return source
    .trimEnd()
    .split("\n")
    .map((line) => {
      const match = /^([0-9a-f]{64}) {2}(.+)$/u.exec(line);
      assert.ok(match, line);
      return { path: match[2], sha256: match[1] };
    });
}

function p05Statuses(markdown) {
  const section = markdown
    .split("<!-- P05_STATUS_TABLE_START -->")[1]
    ?.split("<!-- P05_STATUS_TABLE_END -->")[0];
  assert.ok(section);
  const rows = new Map();
  for (const line of section.split("\n")) {
    if (!/^\| (?:SWAP|POS|HELPER)-\d{2} \|/u.test(line)) continue;
    const columns = line
      .split("|")
      .slice(1, -1)
      .map((entry) => entry.trim());
    rows.set(columns[0], columns[1].replaceAll("`", ""));
  }
  return rows;
}

test("P05-04 stays featureless while P05-05 advances current status to 6 / 6 and 67 / 129", async () => {
  const [manifest, functionMatrix, traceability, roadmap] = await Promise.all([
    json("manifest.json"),
    readFile(path.join(ROOT, "docs/FUNCTION_MATRIX.md"), "utf8"),
    readFile(path.join(ROOT, "docs/TRACEABILITY_MATRIX.md"), "utf8"),
    readFile(path.join(ROOT, "docs/DEVELOPMENT_ROADMAP.md"), "utf8"),
  ]);
  assert.equal(manifest.workItemId, "P05-04");
  assert.equal(manifest.phase, "P05");
  assert.equal(manifest.risk, "R2");
  assert.equal(manifest.status, "accepted-with-gaps");
  assert.deepEqual(manifest.featureIds, []);
  assert.ok(manifest.tests.every(({ result }) => result === "passed"));
  assert.deepEqual(sorted(manifest.evidence.map(({ id }) => id)), [
    "E-CHAIN",
    "E-OPS",
    "E-REC",
    "E-SEC",
  ]);
  for (const { path: evidencePath } of manifest.evidence)
    await access(path.join(ROOT, evidencePath));

  const statuses = p05Statuses(traceability);
  assert.deepEqual(
    sorted(
      [...statuses].filter(([, status]) => status === "implemented-assumed").map(([id]) => id),
    ),
    sorted(CURRENT_IMPLEMENTED),
  );
  assert.deepEqual(
    sorted([...statuses].filter(([, status]) => status === "planned").map(([id]) => id)),
    sorted(CURRENT_PLANNED),
  );
  for (const id of CURRENT_PLANNED) {
    assert.match(functionMatrix, new RegExp(`\\| ${id} \\|[^\\n]*planned[^\\n]*P05-04`, "u"));
    assert.match(traceability, new RegExp(`\\| ${id} \\|[^\\n]*planned[^\\n]*P05-04`, "u"));
  }
  for (const document of [traceability, roadmap]) {
    assert.match(document, /P05-04/u);
    assert.match(document, /P05[^\n]*6[^\n]*implemented-assumed[^\n]*6[^\n]*planned/iu);
    assert.match(document, /67[^\n]*implemented-assumed[^\n]*129[^\n]*planned/iu);
    assert.match(
      document,
      /testnet\/production[^\n]*CLOSED|testnet\/production gates[^\n]*`CLOSED`/iu,
    );
  }
});

test("P00 through P05-03 acceptance files remain byte-identical to baseline", async () => {
  const baselineFiles = execFileSync(
    "git",
    ["ls-tree", "-r", "--name-only", BASELINE, "--", "artifacts/acceptance"],
    { cwd: ROOT, encoding: "utf8" },
  )
    .trim()
    .split("\n")
    .filter(Boolean);
  const currentPriorFiles = (await filesBelow(ACCEPTANCE_ROOT))
    .filter((file) => !file.startsWith("P05-04/") && !file.startsWith("P05-05/"))
    .map((file) => `artifacts/acceptance/${file}`);
  assert.deepEqual(currentPriorFiles, sorted(baselineFiles));
  const changedPrior = execFileSync(
    "git",
    ["diff", "--name-only", BASELINE, "--", "artifacts/acceptance"],
    { cwd: ROOT, encoding: "utf8" },
  )
    .trim()
    .split("\n")
    .filter(Boolean)
    .filter(
      (file) =>
        !file.startsWith("artifacts/acceptance/P05-04/") &&
        !file.startsWith("artifacts/acceptance/P05-05/"),
    );
  assert.deepEqual(changedPrior, []);
});

test("all 40 observed fixtures are extracted without promoting candidate ABI semantics", async () => {
  const [matrix, routerPolicy] = await Promise.all([
    json("evidence-matrix.json"),
    json("router-policy.json"),
  ]);
  assert.deepEqual(matrix.referenceCoverage, REFERENCE_COVERAGE);
  assert.deepEqual(matrix.summary, {
    totalFixtures: 40,
    successfulReceipts: 40,
    failedReceipts: 0,
    fixturesWithEmptyInnerPayload: 4,
    candidateSelector: "0xf2c42696",
    candidateSelectorSamples: 36,
    productionAllowedSelectors: 0,
    decision: "DENY",
  });
  assert.equal(new Set(matrix.rows.map(({ id }) => id)).size, 40);
  assert.ok(matrix.rows.every(({ productionDecision }) => productionDecision.allowed === false));
  assert.ok(
    matrix.rows.every(({ innerRouterCandidate }) => innerRouterCandidate.recipient === null),
  );
  for (const row of matrix.rows) {
    const fixtureBytes = await readFile(path.join(ROOT, row.source.fixturePath));
    assert.equal(digest(fixtureBytes), row.source.fixtureSha256, row.id);
    assert.match(row.transferLogDeltaSample.derivation, /not an eth_call balance snapshot/u);
    assert.equal(row.feeCandidate.basis, "UNKNOWN");
    assert.equal(row.feeCandidate.type, "UNKNOWN");
    assert.equal(row.feeCandidate.ownership, "UNKNOWN");
  }
  assert.equal(routerPolicy.production.executionEnabled, false);
  assert.deepEqual(routerPolicy.production.router.allowedSelectors, []);
  assert.deepEqual(routerPolicy.production.router.candidateSelectors[0], {
    selector: "0xf2c42696",
    name: null,
    namingRule: "four-byte collisions do not establish function identity",
    sampleCount: 36,
    successSamples: 36,
    failureSamples: 0,
    recipientSemantics: "UNKNOWN",
    decision: "DENY",
  });
});

test("candidate Registry, Token Policy, and Fee Policy are isolated and self-digesting", async () => {
  const [candidate, tokenPolicy, feePolicy, productionBytes] = await Promise.all([
    json("candidate-registry.json"),
    json("token-policy.json"),
    json("fee-policy.json"),
    readFile(path.join(ROOT, "artifacts/acceptance/P05-01/registry-contracts.json")),
  ]);
  const registry = structuredClone(candidate.registry);
  const expectedRegistryDigest = registry.registryDigest;
  delete registry.registryDigest;
  assert.equal(digest(JSON.stringify(registry), true), expectedRegistryDigest);
  assert.equal(candidate.productionBoundary.sourceSha256, digest(productionBytes, true));
  assert.equal(candidate.productionBoundary.byteModificationByP0504, false);
  assert.equal(candidate.registry.chainId, 31337);
  assert.equal(candidate.registry.environment, "foundry-anvil-only");
  assert.equal(candidate.registry.executionEnabled, true);
  assert.equal(candidate.registry.productionInheritance, false);
  assert.equal(
    candidate.registry.components.every(({ proxyImplementation }) => proxyImplementation === null),
    true,
  );

  const localTokenPolicy = structuredClone(tokenPolicy.local);
  const expectedTokenDigest = localTokenPolicy.policyDigest;
  delete localTokenPolicy.policyDigest;
  assert.equal(digest(JSON.stringify(localTokenPolicy), true), expectedTokenDigest);
  assert.equal(tokenPolicy.symbolOnlyIdentityAllowed, false);
  assert.equal(tokenPolicy.local.tokens.length, 2);
  assert.ok(tokenPolicy.local.tokens.every(({ executionAllowed }) => executionAllowed));
  assert.equal(tokenPolicy.production.unclassifiedTokenMode, "read-only");
  assert.deepEqual(
    sorted(tokenPolicy.behaviorMatrix.map(({ behavior }) => behavior)),
    sorted([
      "standard",
      "wrapped-native",
      "false-return",
      "no-return",
      "usdt-style-approve",
      "fee-on-transfer",
      "rebasing",
      "callback-reentrant",
      "malformed-metadata",
    ]),
  );

  const localFeePolicy = structuredClone(feePolicy.local);
  const expectedFeeDigest = localFeePolicy.policyDigest;
  delete localFeePolicy.policyDigest;
  assert.equal(digest(JSON.stringify(localFeePolicy), true), expectedFeeDigest);
  assert.equal(feePolicy.local.serviceFeeBps, 0);
  assert.equal(feePolicy.nonZeroServiceFeeRequirements.currentlyAllowed, false);
  assert.ok(feePolicy.observedCandidateMatrix.every(({ basis }) => basis === "UNKNOWN"));
  assert.equal(feePolicy.production.fundsExecutionAllowed, false);
});

test("local Helper ABI/code and plan contracts are fully frozen", async () => {
  const [helper, plans, creation] = await Promise.all([
    json("helper-abi-code-hashes.json"),
    json("operation-plan-contracts.json"),
    json("observed-helper-creation.json"),
  ]);
  assert.equal(helper.compiler.version, "0.8.26+commit.8a97fa7a");
  assert.equal(helper.compiler.optimizer.enabled, true);
  assert.equal(helper.abiHash, digest(JSON.stringify(helper.abi), true));
  for (const source of helper.sourceFiles) {
    assert.equal(
      digest(await readFile(path.join(ROOT, source.path)), true),
      source.sha256,
      source.path,
    );
  }
  assert.equal(helper.aggregateSourceHash, digest(JSON.stringify(helper.sourceFiles), true));
  assert.equal(helper.upgradeMode, "deploy-new-helper-no-proxy");
  assert.ok(
    Object.values(helper.businessSelectorAllowlist).every(
      (value) => !OBSERVED_SELECTORS.includes(value),
    ),
  );
  assert.equal(helper.observedSelectorsReusedAsBusinessNames, false);
  assert.equal(creation.creationBuild.creationInputBytes, 19377);
  assert.equal(
    creation.creationBuild.creationInputHash,
    "0xd3c67af8640b66e72ac6c0a0ad62add939676cbd2d5509ed6ba8f5a879dbba08",
  );
  assert.equal(creation.runtimeComparison.sameSelectorSet, true);
  assert.equal(creation.runtimeComparison.runtimeHashesEqual, false);

  assert.deepEqual(plans.planTypes, [
    "HelperDeploymentPlan",
    "SwapPlan",
    "PositionPlan",
    "SweepPlan",
  ]);
  for (const binding of [
    "wallet",
    "chainId",
    "nonce",
    "registry",
    "target",
    "selector",
    "deadline",
    "fee policy",
    "quote digest",
    "snapshot digest",
    "code hash",
  ]) {
    assert.match(plans.commonDigestBindings.join("\n"), new RegExp(binding, "iu"), binding);
  }
  assert.equal(plans.publicExecutionIntegration, false);
});

test("local success/revert/recovery evidence opens only the local gate", async () => {
  const [snapshot, gate] = await Promise.all([
    json("local-anvil-snapshot.json"),
    json("execution-gate.json"),
  ]);
  assert.equal(snapshot.network.chainId, 31337);
  assert.equal(snapshot.network.forked, false);
  assert.equal(snapshot.operationEvidence.swap.success.receiptStatus, "success");
  assert.equal(snapshot.operationEvidence.swap.success.valueBaseUnit, "0");
  assert.equal(snapshot.operationEvidence.swap.failure.receiptStatus, "reverted");
  assert.equal(snapshot.operationEvidence.swap.failure.executedPlanRecorded, false);
  assert.deepEqual(
    snapshot.operationEvidence.swap.failure.balanceAndAllowanceStateAfter,
    snapshot.operationEvidence.swap.failure.balanceAndAllowanceStateBefore,
  );
  assert.equal(
    snapshot.operationEvidence.swap.failure.recovery.state.allowances.ownerToHelper,
    "0",
  );
  assert.equal(snapshot.operationEvidence.duplicatePlanRejected, true);
  assert.equal(snapshot.operationEvidence.duplicateRawTransaction.secondSubmissionRejected, true);
  assert.equal(snapshot.operationEvidence.nonceReplacement.firstReceiptState, "replaced");
  assert.equal(snapshot.operationEvidence.restartRecovery.executedPlanRecovered, true);
  assert.deepEqual(snapshot.executionCounters, {
    localChainWrites: 15,
    localRevertedTransactions: 1,
    localTransactionBroadcastsAccepted: 17,
    mainnetBroadcasts: 0,
    mainnetSignatures: 0,
    realFundOperations: 0,
    testnetBroadcasts: 0,
    testnetSignatures: 0,
  });
  assert.equal(gate.featureImplementationClaimed, false);
  assert.equal(gate.gates.local.status, "OPEN");
  assert.equal(gate.gates.testnet.status, "CLOSED");
  assert.equal(gate.gates.production.status, "CLOSED");
});

test("P05-04 acceptance inventory and checksums are complete", async () => {
  const files = await filesBelow(ACCEPTANCE);
  assert.deepEqual(files, REQUIRED_FILES);
  const checksums = parseChecksums(await readFile(path.join(ACCEPTANCE, "sha256sums.txt"), "utf8"));
  assert.deepEqual(
    checksums.map(({ path: file }) => file),
    files.filter((file) => file !== "sha256sums.txt"),
  );
  for (const row of checksums) {
    assert.equal(digest(await readFile(path.join(ACCEPTANCE, row.path))), row.sha256, row.path);
  }
});
