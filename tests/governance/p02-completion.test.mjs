import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { access, readFile, readdir } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const FUNCTION_MATRIX_PATH = path.join(ROOT, "docs/FUNCTION_MATRIX.md");
const TRACEABILITY_PATH = path.join(ROOT, "docs/TRACEABILITY_MATRIX.md");
const MANIFEST_PATH = path.join(ROOT, "artifacts/acceptance/P02-02/manifest.json");
const P02_04_MANIFEST_PATH = path.join(ROOT, "artifacts/acceptance/P02-04/manifest.json");
const P02_05_ROOT = path.join(ROOT, "artifacts/acceptance/P02-05");
const P02_05_MANIFEST_PATH = path.join(P02_05_ROOT, "manifest.json");
const P02_05_GAPS_PATH = path.join(P02_05_ROOT, "gap-resolution.json");
const P02_06_ROOT = path.join(ROOT, "artifacts/acceptance/P02-06");
const P02_06_MANIFEST_PATH = path.join(P02_06_ROOT, "manifest.json");
const P02_07_ROOT = path.join(ROOT, "artifacts/acceptance/P02-07");
const P02_07_MANIFEST_PATH = path.join(P02_07_ROOT, "manifest.json");
const P02_08_ROOT = path.join(ROOT, "artifacts/acceptance/P02-08");
const P02_08_MANIFEST_PATH = path.join(P02_08_ROOT, "manifest.json");
const P02_08_CONTRACT_PATH = path.join(P02_08_ROOT, "label-rule-contract.json");
const P02_08_PRIOR_CHECKSUMS_PATH = path.join(P02_08_ROOT, "prior-acceptance-sha256s.txt");
const P02_09_ROOT = path.join(ROOT, "artifacts/acceptance/P02-09");
const P02_09_MANIFEST_PATH = path.join(P02_09_ROOT, "manifest.json");
const P02_09_CONTRACT_PATH = path.join(P02_09_ROOT, "recommendation-contract.json");
const P02_09_PRIOR_CHECKSUMS_PATH = path.join(P02_09_ROOT, "prior-acceptance-sha256s.txt");
const P02_10_ROOT = path.join(ROOT, "artifacts/acceptance/P02-10");
const P02_10_MANIFEST_PATH = path.join(P02_10_ROOT, "manifest.json");
const P02_10_CONTRACT_PATH = path.join(P02_10_ROOT, "candle-tick-contract.json");
const P02_10_PRIOR_CHECKSUMS_PATH = path.join(P02_10_ROOT, "prior-acceptance-sha256s.txt");
const P02_11_ROOT = path.join(ROOT, "artifacts/acceptance/P02-11");
const P02_11_MANIFEST_PATH = path.join(P02_11_ROOT, "manifest.json");
const P02_11_CONTRACT_PATH = path.join(P02_11_ROOT, "blocklist-action-contract.json");
const P02_11_PRIOR_CHECKSUMS_PATH = path.join(P02_11_ROOT, "prior-acceptance-sha256s.txt");
const P02_12_ROOT = path.join(ROOT, "artifacts/acceptance/P02-12");
const P02_12_MANIFEST_PATH = path.join(P02_12_ROOT, "manifest.json");
const P02_12_CONTRACT_PATH = path.join(P02_12_ROOT, "provenance-contract.json");
const P02_12_PRIOR_CHECKSUMS_PATH = path.join(P02_12_ROOT, "prior-acceptance-sha256s.txt");
const P02_13_ROOT = path.join(ROOT, "artifacts/acceptance/P02-13");
const P02_13_MANIFEST_PATH = path.join(P02_13_ROOT, "manifest.json");
const P02_13_CONTRACT_PATH = path.join(P02_13_ROOT, "system-stats-contract.json");
const P02_13_PRIOR_CHECKSUMS_PATH = path.join(P02_13_ROOT, "prior-acceptance-sha256s.txt");
const RUNTIME_LABEL_CONTRACT_PATH = path.join(
  ROOT,
  "packages/market-metrics/src/label-rule-contract.json",
);
const P02_01_GAPS_PATH = path.join(ROOT, "artifacts/acceptance/P02-01/gaps.json");
const EXPECTED_ACCEPTED_COMMIT = "73998c6f22e499f7063207ec1d497766b6714d29";
const EXPECTED_FEATURE_IDS = [
  ...Array.from({ length: 16 }, (_, index) => `POOL-${String(index + 1).padStart(2, "0")}`),
  ...Array.from({ length: 5 }, (_, index) => `FLOW-${String(index + 1).padStart(2, "0")}`),
  ...Array.from({ length: 2 }, (_, index) => `STATS-${String(index + 1).padStart(2, "0")}`),
];
const P02_02_FEATURE_IDS = ["POOL-01", "POOL-02", "POOL-04", "POOL-16"];
const P02_04_FEATURE_IDS = ["POOL-03", "FLOW-01", "FLOW-02"];
const P02_05_FEATURE_IDS = ["FLOW-03", "FLOW-04", "FLOW-05"];
const P02_06_FEATURE_IDS = ["POOL-08", "POOL-09", "POOL-10"];
const P02_07_FEATURE_IDS = ["POOL-05", "POOL-06", "POOL-11"];
const P02_08_FEATURE_IDS = ["POOL-07"];
const P02_09_FEATURE_IDS = ["STATS-02"];
const P02_10_FEATURE_IDS = ["POOL-12"];
const P02_11_FEATURE_IDS = ["POOL-13", "POOL-14"];
const P02_12_FEATURE_IDS = ["POOL-15"];
const P02_13_FEATURE_IDS = ["STATS-01"];
const IMPLEMENTED_FEATURE_IDS = [
  ...P02_02_FEATURE_IDS,
  ...P02_04_FEATURE_IDS,
  ...P02_05_FEATURE_IDS,
  ...P02_06_FEATURE_IDS,
  ...P02_07_FEATURE_IDS,
  ...P02_08_FEATURE_IDS,
  ...P02_09_FEATURE_IDS,
  ...P02_10_FEATURE_IDS,
  ...P02_11_FEATURE_IDS,
  ...P02_12_FEATURE_IDS,
  ...P02_13_FEATURE_IDS,
];
const REQUIRED_EVIDENCE_IDS = [
  "E-DATA",
  "E-REC",
  "E-API",
  "E-SSE",
  "E-UI",
  "E-VIS",
  "E-MIG",
  "E-SEC",
  "E-OPS",
];

function sorted(values) {
  return [...values].sort((left, right) => left.localeCompare(right));
}

function p02StatusRows(markdown) {
  const section = markdown.match(
    /<!-- P02_STATUS_TABLE_START -->([\s\S]*?)<!-- P02_STATUS_TABLE_END -->/,
  );
  assert.ok(section, "TRACEABILITY_MATRIX is missing the machine-checkable P02 status table");

  const rows = new Map();
  for (const line of section[1].split("\n")) {
    const columns = line
      .split("|")
      .slice(1, -1)
      .map((value) => value.trim());
    if (!EXPECTED_FEATURE_IDS.includes(columns[0])) continue;
    assert.equal(rows.has(columns[0]), false, `duplicate P02 status row for ${columns[0]}`);
    rows.set(columns[0], {
      status: columns[1].replaceAll("`", ""),
      implementation: columns[2],
      tests: columns[3],
      evidence: columns[4],
    });
  }
  return rows;
}

function commaSeparated(value) {
  return value
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean);
}

function traceabilityRows(markdown) {
  const rows = new Map();
  const rowPattern =
    /^\|\s*([A-Z][A-Z0-9]*-\d{2})\s*\|\s*(P\d{2})\s*\|\s*([^|]+?)\s*\|\s*([^|]+?)\s*\|\s*$/gm;
  for (const match of markdown.matchAll(rowPattern)) {
    rows.set(match[1], {
      evidence: commaSeparated(match[4]),
      tests: commaSeparated(match[3]),
    });
  }
  return rows;
}

function assertRepositoryPath(value, label) {
  assert.equal(path.isAbsolute(value), false, `${label} must be repository-relative`);
  const resolved = path.resolve(ROOT, value);
  assert.ok(
    resolved.startsWith(`${ROOT}${path.sep}`),
    `${label} must not resolve outside the repository`,
  );
  return resolved;
}

async function acceptanceFiles(directory, prefix = "") {
  const files = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const relative = path.posix.join(prefix, entry.name);
    if (entry.isDirectory())
      files.push(...(await acceptanceFiles(path.join(directory, entry.name), relative)));
    else if (entry.isFile()) files.push(relative);
  }
  return files.sort();
}

test("P02 status table closes with exactly twenty-three fixture-verified features implemented", async () => {
  const markdown = await readFile(TRACEABILITY_PATH, "utf8");
  const rows = p02StatusRows(markdown);
  assert.deepEqual(sorted(rows.keys()), sorted(EXPECTED_FEATURE_IDS));

  const implemented = [];
  const planned = [];
  for (const [featureId, row] of rows) {
    if (row.status === "implemented-assumed") implemented.push(featureId);
    if (row.status === "planned") planned.push(featureId);
    assert.match(row.status, /^(implemented-assumed|planned)$/, `${featureId} status`);

    if (row.status === "implemented-assumed") {
      assert.match(row.evidence, /local-fixture-verified/, `${featureId} evidence level`);
      assert.doesNotMatch(
        row.evidence,
        /live-observed|frozen-bundle-candidate|parity-verified|released/,
        `${featureId} must not claim stronger evidence`,
      );
    } else {
      assert.match(row.evidence, /P02-01 reference-only; no implementation evidence/);
    }
  }

  assert.deepEqual(sorted(implemented), sorted(IMPLEMENTED_FEATURE_IDS));
  assert.deepEqual(planned, []);
  assert.match(markdown, /P02[^\n]*23[^\n]*implemented-assumed[^\n]*0[^\n]*planned/i);
  assert.match(markdown, /当前产品实现\s*\|\s*41\s*\|/);
  assert.match(markdown, /`implemented-assumed`\s*\|\s*41\s*\|/);
  assert.match(markdown, /(?:其余|remaining)\s*`planned`\s*\|\s*155\s*\|/i);
});

test("P02-13 owns only STATS-01 and freezes authoritative projection semantics", async () => {
  const [manifest, functionMatrix, traceabilityMarkdown, contract, gaps] = await Promise.all([
    readFile(P02_13_MANIFEST_PATH, "utf8").then(JSON.parse),
    readFile(FUNCTION_MATRIX_PATH, "utf8"),
    readFile(TRACEABILITY_PATH, "utf8"),
    readFile(P02_13_CONTRACT_PATH, "utf8").then(JSON.parse),
    readFile(P02_01_GAPS_PATH, "utf8").then(JSON.parse),
  ]);

  assert.equal(manifest.workItemId, "P02-13");
  assert.equal(manifest.phase, "P02");
  assert.equal(manifest.risk, "R1");
  assert.equal(manifest.status, "accepted-with-gaps");
  assert.deepEqual(manifest.featureIds, P02_13_FEATURE_IDS);
  assert.match(manifest.completedAt, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/u);
  assert.match(manifest.commit, /^[0-9a-f]{40}$/u);

  const markedFunctionIds = functionMatrix
    .split("\n")
    .filter((line) => line.includes("`implemented-assumed`（P02-13"))
    .map((line) => line.split("|")[1]?.trim())
    .filter((id) => EXPECTED_FEATURE_IDS.includes(id));
  assert.deepEqual(markedFunctionIds, P02_13_FEATURE_IDS);

  const minimums = traceabilityRows(traceabilityMarkdown).get("STATS-01");
  assert.ok(minimums, "STATS-01 is missing from TRACEABILITY_MATRIX");
  const manifestTests = new Set(manifest.tests.map(({ id }) => id));
  const manifestEvidence = new Set(manifest.evidence.map(({ id }) => id));
  for (const testId of minimums.tests) assert.ok(manifestTests.has(testId), `missing ${testId}`);
  for (const evidenceId of minimums.evidence)
    assert.ok(manifestEvidence.has(evidenceId), `missing ${evidenceId}`);
  assert.deepEqual(
    sorted(manifest.evidence.map(({ id }) => id)),
    sorted(["E-API", "E-DATA", "E-SSE", "E-REC", "E-UI", "E-VIS", "E-RBAC", "E-SEC"]),
  );
  for (const evidence of manifest.evidence) {
    await access(assertRepositoryPath(evidence.path, evidence.id));
  }

  assert.equal(contract.contractVersion, "system-stats/local-v1");
  assert.equal(contract.evidenceLevel, "locally-defined");
  assert.equal(contract.parityStatus, "not-parity-verified");
  assert.equal(contract.publisher.visibility, "internal-port-only");
  assert.equal(contract.publisher.inputMode, "authoritative-absolute-snapshot");
  assert.equal(contract.publisher.incrementalWrites, false);
  assert.equal(contract.publisher.httpWriteEndpoint, false);
  assert.deepEqual(contract.publisher.acceptedFields, [
    "userId",
    "running",
    "paused",
    "stopped",
    "sourceRevision",
    "observedAt",
  ]);
  assert.equal(contract.counts.total.stored, false);
  assert.deepEqual(contract.counts.total.sumOf, ["running", "paused", "stopped"]);
  assert.equal(contract.readiness.beforeBackfill.status, 503);
  assert.equal(contract.readiness.beforeBackfill.code, "STATS_UNAVAILABLE");
  assert.equal(contract.readiness.readyMissingUserMeansZero, true);
  assert.equal(contract.revisions.sameRevisionSamePayload, "idempotent");
  assert.equal(contract.revisions.sameRevisionDifferentPayload, "record-conflict");
  assert.equal(contract.revisions.olderRevision, "ignore");
  assert.equal(contract.scopes.user, "signed-in-user-only");
  assert.equal(contract.scopes.adminWithoutFilter, "global");
  assert.equal(contract.scopes.adminFilter.semantic, "decimal-telegram-user-id");
  assert.equal(contract.scopes.adminFilter.resolveThrough, "telegram_identities");
  assert.equal(contract.sse.firstStatsEvent, "snapshot");
  assert.equal(contract.sse.heartbeatMilliseconds, 25_000);
  assert.equal(contract.sse.heartbeatSequence, null);
  assert.equal(contract.sse.updatePayload, "latest-complete-taskCounts");
  assert.deepEqual(contract.nullableMeasurements, [
    "fps",
    "pingMs",
    "gas.baseGwei",
    "gas.ethereumGwei",
    "online",
  ]);
  assert.equal(contract.boundaries.taskBusinessDomainConnected, false);
  assert.equal(contract.boundaries.externalRpc, false);
  assert.equal(contract.boundaries.signingBroadcastOrFunds, false);

  const unresolved = new Map(gaps.items.map((gap) => [gap.id, gap.status]));
  for (const gapId of contract.unresolvedGapRefs) assert.equal(unresolved.get(gapId), "unresolved");
  const assumptions = manifest.assumptions.join("\n");
  assert.match(assumptions, /local-fixture-verified only/);
  assert.match(assumptions, /task business domain is not connected/i);
  assert.match(assumptions, /unready.*503/i);
  assert.match(assumptions, /P02-01 through P02-12 acceptance directories remain byte-identical/);
  assert.match(assumptions, /P02 remains accepted-with-gaps/);
  assert.doesNotMatch(assumptions, /parity-verified|released/);
});

test("P02-13 scope and sequence Golden covers readiness, isolation and revision outcomes", async () => {
  const golden = await readFile(path.join(P02_13_ROOT, "golden/scope-sequence.json"), "utf8").then(
    JSON.parse,
  );
  assert.equal(golden.schemaVersion, 1);
  assert.deepEqual(
    golden.cases.map(({ id }) => id),
    [
      "unready",
      "ready-missing-user",
      "personal-isolation",
      "admin-global",
      "admin-telegram-filter",
      "idempotent-revision",
      "stale-revision",
      "conflicting-revision",
      "skipped-updates",
      "user-deletion",
      "restart-reconnect",
    ],
  );
  assert.equal(golden.cases[0].expected.code, "STATS_UNAVAILABLE");
  assert.deepEqual(golden.cases[1].expected.taskCounts, { paused: 0, running: 0, stopped: 0 });
  assert.equal(golden.cases.find(({ id }) => id === "conflicting-revision").expected.conflicts, 1);
  assert.equal(
    golden.cases.find(({ id }) => id === "skipped-updates").expected.patch.complete,
    true,
  );
  assert.equal(golden.cases.find(({ id }) => id === "restart-reconnect").expected.regresses, false);
});

test("P02-01 through P02-12 remain byte-identical to the pre-P02-13 inventory", async () => {
  const inventory = new Map(
    (await readFile(P02_13_PRIOR_CHECKSUMS_PATH, "utf8"))
      .trim()
      .split("\n")
      .map((line) => {
        const match = line.match(/^([0-9a-f]{64}) {2}(.+)$/u);
        assert.ok(match, `invalid prior acceptance checksum row: ${line}`);
        return [match[2], match[1]];
      }),
  );
  const priorFiles = (
    await Promise.all(
      Array.from({ length: 12 }, async (_, index) => {
        const directory = `artifacts/acceptance/P02-${String(index + 1).padStart(2, "0")}`;
        return (await acceptanceFiles(path.join(ROOT, directory))).map((file) =>
          path.posix.join(directory, file),
        );
      }),
    )
  ).flat();
  assert.equal(priorFiles.length, 231);
  assert.deepEqual(sorted(inventory.keys()), sorted(priorFiles));
  for (const file of priorFiles) {
    const bytes = await readFile(path.join(ROOT, file));
    assert.equal(
      inventory.get(file),
      createHash("sha256").update(bytes).digest("hex"),
      `${file} changed after P02-12 baseline`,
    );
  }
});

test("P02-13 sha256 inventory covers every acceptance file except itself", async () => {
  const checksumText = await readFile(path.join(P02_13_ROOT, "sha256sums.txt"), "utf8");
  const checksums = new Map(
    checksumText
      .trim()
      .split("\n")
      .map((line) => {
        const match = line.match(/^([0-9a-f]{64}) {2}(.+)$/u);
        assert.ok(match, `invalid P02-13 checksum row: ${line}`);
        return [match[2], match[1]];
      }),
  );
  const files = (await acceptanceFiles(P02_13_ROOT)).filter((file) => file !== "sha256sums.txt");
  assert.deepEqual([...checksums.keys()].sort(), files);
  for (const file of files) {
    const bytes = await readFile(path.join(P02_13_ROOT, file));
    assert.equal(
      checksums.get(file),
      createHash("sha256").update(bytes).digest("hex"),
      `${file} checksum`,
    );
  }
});

test("P02-12 owns only POOL-15 and freezes platform-recorded provenance semantics", async () => {
  const [manifest, functionMatrix, traceabilityMarkdown, contract] = await Promise.all([
    readFile(P02_12_MANIFEST_PATH, "utf8").then(JSON.parse),
    readFile(FUNCTION_MATRIX_PATH, "utf8"),
    readFile(TRACEABILITY_PATH, "utf8"),
    readFile(P02_12_CONTRACT_PATH, "utf8").then(JSON.parse),
  ]);

  assert.equal(manifest.workItemId, "P02-12");
  assert.equal(manifest.phase, "P02");
  assert.equal(manifest.risk, "R1");
  assert.equal(manifest.status, "accepted-with-gaps");
  assert.deepEqual(manifest.featureIds, P02_12_FEATURE_IDS);
  assert.match(manifest.completedAt, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/u);
  assert.match(manifest.commit, /^[0-9a-f]{40}$/u);

  const markedFunctionIds = functionMatrix
    .split("\n")
    .filter((line) => line.includes("`implemented-assumed`（P02-12"))
    .map((line) => line.split("|")[1]?.trim())
    .filter((id) => EXPECTED_FEATURE_IDS.includes(id));
  assert.deepEqual(markedFunctionIds, P02_12_FEATURE_IDS);

  const traceability = traceabilityRows(traceabilityMarkdown);
  const minimums = traceability.get("POOL-15");
  const manifestTests = new Set(manifest.tests.map(({ id }) => id));
  const manifestEvidence = new Set(manifest.evidence.map(({ id }) => id));
  assert.ok(minimums);
  for (const testId of minimums.tests) assert.ok(manifestTests.has(testId), `missing ${testId}`);
  for (const evidenceId of minimums.evidence)
    assert.ok(manifestEvidence.has(evidenceId), `missing ${evidenceId}`);
  assert.deepEqual(
    sorted(manifest.evidence.map(({ id }) => id)),
    sorted(["E-API", "E-DATA", "E-REC", "E-UI", "E-VIS", "E-RBAC", "E-SEC"]),
  );
  for (const evidence of manifest.evidence) {
    await access(assertRepositoryPath(evidence.path, evidence.id));
  }

  assert.equal(contract.contractVersion, "pool-creation-provenance/local-v1");
  assert.equal(contract.evidenceLevel, "locally-defined");
  assert.equal(contract.parityStatus, "not-parity-verified");
  assert.equal(contract.chainId, 56);
  assert.equal(contract.creatorMeaning, "user-who-completed-a-platform-recorded-create-operation");
  assert.deepEqual(contract.creatorNeverInferredFrom, [
    "transaction.from",
    "PoolCreated",
    "Initialize",
    "first-Mint",
    "market-pool-catalog",
    "token-owner",
  ]);
  assert.deepEqual(contract.record.requiredFields, [
    "operationId",
    "userId",
    "chainId",
    "poolKey",
    "protocol",
    "creatorAddress",
    "feePips",
    "txHash",
    "outcome",
    "completedAt",
    "schemaVersion",
  ]);
  assert.deepEqual(contract.record.outcomes, ["created", "already_exists"]);
  assert.equal(contract.record.alreadyExistsProvesPlatformFirst, false);
  assert.equal(contract.record.schemaVersion, 1);
  assert.equal(contract.noRecord.meaning, "not-platform-created-or-predates-feature");
  assert.deepEqual(contract.noRecord.successValues, [null, []]);
  assert.equal(contract.recorder.visibility, "internal-port-only");
  assert.equal(contract.recorder.httpWriteEndpoint, false);
  assert.equal(contract.attribution.firstChoice, "earliest-created");
  assert.equal(contract.attribution.fallback, "earliest-already_exists-with-warning");
  assert.equal(contract.catalog.attributionSource, false);
  assert.equal(contract.api.history.path, "/api/pools/create-history");
  assert.equal(contract.api.single.path, "/api/admin/pool-creators");
  assert.equal(contract.api.batch.path, "/api/admin/pool-creators");
  assert.equal(contract.api.batch.maximumIdentities, 100);
  assert.equal(contract.boundaries.externalRpc, false);
  assert.equal(contract.boundaries.transactionSenderLookup, false);
  assert.equal(contract.boundaries.metadataFetch, false);
  assert.equal(contract.boundaries.signingBroadcastOrFunds, false);

  const assumptions = manifest.assumptions.join("\n");
  assert.match(assumptions, /local-fixture-verified only/);
  assert.match(assumptions, /STATS-01 remains planned/);
  assert.match(assumptions, /internal recorder/);
  assert.match(assumptions, /no public pool creation command or funds operation/i);
  assert.match(assumptions, /All P02-01 unresolved gaps remain unresolved/);
  assert.match(assumptions, /P02-01 through P02-11 acceptance directories remain byte-identical/);
  assert.doesNotMatch(assumptions, /parity-verified|released/);
});

test("P02-12 attribution Golden covers created, fallback, absent and deleted-user cases", async () => {
  const golden = await readFile(path.join(P02_12_ROOT, "golden/attribution.json"), "utf8").then(
    JSON.parse,
  );
  assert.equal(golden.schemaVersion, 1);
  assert.deepEqual(
    golden.cases.map(({ id }) => id),
    ["earliest-created", "already-exists-fallback", "no-record", "deleted-user"],
  );
  const created = golden.cases.find(({ id }) => id === "earliest-created");
  assert.equal(created.expected.record.operationId, created.attempts[1].operationId);
  assert.equal(created.expected.warning, null);
  const fallback = golden.cases.find(({ id }) => id === "already-exists-fallback");
  assert.equal(fallback.expected.record.operationId, fallback.attempts[0].operationId);
  assert.equal(fallback.expected.warning, "ALREADY_EXISTS_NOT_PLATFORM_FIRST");
  assert.equal(golden.cases.find(({ id }) => id === "no-record").expected, null);
  assert.equal(golden.cases.find(({ id }) => id === "deleted-user").expected.creatorProfile, null);
});

test("P02-01 through P02-11 remain byte-identical to the pre-P02-12 inventory", async () => {
  const inventory = new Map(
    (await readFile(P02_12_PRIOR_CHECKSUMS_PATH, "utf8"))
      .trim()
      .split("\n")
      .map((line) => {
        const match = line.match(/^([0-9a-f]{64}) {2}(.+)$/u);
        assert.ok(match, `invalid prior acceptance checksum row: ${line}`);
        return [match[2], match[1]];
      }),
  );
  const priorFiles = (
    await Promise.all(
      Array.from({ length: 11 }, async (_, index) => {
        const directory = `artifacts/acceptance/P02-${String(index + 1).padStart(2, "0")}`;
        return (await acceptanceFiles(path.join(ROOT, directory))).map((file) =>
          path.posix.join(directory, file),
        );
      }),
    )
  ).flat();
  assert.equal(priorFiles.length, 215);
  assert.deepEqual(sorted(inventory.keys()), sorted(priorFiles));
  for (const file of priorFiles) {
    const bytes = await readFile(path.join(ROOT, file));
    assert.equal(
      inventory.get(file),
      createHash("sha256").update(bytes).digest("hex"),
      `${file} changed after P02-11 baseline`,
    );
  }
});

test("P02-12 sha256 inventory covers every acceptance file except itself", async () => {
  const checksumText = await readFile(path.join(P02_12_ROOT, "sha256sums.txt"), "utf8");
  const checksums = new Map(
    checksumText
      .trim()
      .split("\n")
      .map((line) => {
        const match = line.match(/^([0-9a-f]{64}) {2}(.+)$/u);
        assert.ok(match, `invalid P02-12 checksum row: ${line}`);
        return [match[2], match[1]];
      }),
  );
  const files = (await acceptanceFiles(P02_12_ROOT)).filter((file) => file !== "sha256sums.txt");
  assert.deepEqual([...checksums.keys()].sort(), files);
  for (const file of files) {
    const bytes = await readFile(path.join(P02_12_ROOT, file));
    assert.equal(
      checksums.get(file),
      createHash("sha256").update(bytes).digest("hex"),
      `${file} checksum`,
    );
  }
});

test("P02-11 owns only POOL-13/14 and freezes blocklist plus action intent semantics", async () => {
  const [manifest, functionMatrix, traceabilityMarkdown, contract] = await Promise.all([
    readFile(P02_11_MANIFEST_PATH, "utf8").then(JSON.parse),
    readFile(FUNCTION_MATRIX_PATH, "utf8"),
    readFile(TRACEABILITY_PATH, "utf8"),
    readFile(P02_11_CONTRACT_PATH, "utf8").then(JSON.parse),
  ]);

  assert.equal(manifest.workItemId, "P02-11");
  assert.equal(manifest.phase, "P02");
  assert.equal(manifest.risk, "R1");
  assert.equal(manifest.status, "accepted-with-gaps");
  assert.deepEqual(manifest.featureIds, P02_11_FEATURE_IDS);
  assert.match(manifest.completedAt, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/u);
  assert.match(manifest.commit, /^[0-9a-f]{40}$/u);

  const markedFunctionIds = functionMatrix
    .split("\n")
    .filter((line) => line.includes("`implemented-assumed`（P02-11"))
    .map((line) => line.split("|")[1]?.trim())
    .filter((id) => EXPECTED_FEATURE_IDS.includes(id));
  assert.deepEqual(markedFunctionIds, P02_11_FEATURE_IDS);

  const traceability = traceabilityRows(traceabilityMarkdown);
  const manifestTests = new Set(manifest.tests.map(({ id }) => id));
  const manifestEvidence = new Set(manifest.evidence.map(({ id }) => id));
  for (const featureId of P02_11_FEATURE_IDS) {
    const minimums = traceability.get(featureId);
    assert.ok(minimums, `${featureId} is missing from TRACEABILITY_MATRIX`);
    for (const testId of minimums.tests) assert.ok(manifestTests.has(testId), `missing ${testId}`);
    for (const evidenceId of minimums.evidence)
      assert.ok(manifestEvidence.has(evidenceId), `missing ${evidenceId}`);
  }
  assert.deepEqual(
    sorted(manifest.evidence.map(({ id }) => id)),
    sorted(["E-API", "E-DATA", "E-SSE", "E-REC", "E-UI", "E-VIS", "E-RBAC", "E-SEC"]),
  );
  for (const evidence of manifest.evidence) {
    await access(assertRepositoryPath(evidence.path, evidence.id));
  }

  assert.equal(contract.contractVersion, "pool-blocklist-actions/local-v1");
  assert.equal(contract.evidenceLevel, "locally-defined");
  assert.equal(contract.parityStatus, "not-parity-verified");
  assert.equal(contract.chainId, 56);
  assert.equal(contract.blocklist.schemaVersion, 1);
  assert.deepEqual(contract.blocklist.entry.scopes, ["pool", "token"]);
  assert.equal(contract.blocklist.entry.label.authority, "non-authoritative");
  assert.equal(contract.blocklist.identity.pool.source, "stable-poolKey");
  assert.equal(contract.blocklist.identity.pool.v3Bytes, 20);
  assert.equal(contract.blocklist.identity.pool.v4Bytes, 32);
  assert.equal(contract.blocklist.identity.token.bytes, 20);
  assert.equal(contract.blocklist.identity.token.symbolAccepted, false);
  assert.deepEqual(contract.blocklist.sorting, [
    "chainId:numeric-asc",
    "scope:byte-asc",
    "identity:byte-asc",
  ]);
  assert.equal(contract.blocklist.hash.algorithm, "sha256");
  assert.equal(contract.blocklist.hash.labelIncluded, false);
  assert.deepEqual(contract.api.patch.requiredBody, ["expectedRevision", "operation"]);
  assert.equal(contract.api.patch.operationsPerRequest, 1);
  assert.equal(contract.api.patch.conflict.status, 409);
  assert.equal(contract.api.patch.conflict.code, "REVISION_CONFLICT");
  assert.equal(contract.api.patch.idempotentNoOpIncrementsRevision, false);
  assert.deepEqual(contract.actionIntent.actions, ["create-task", "create-monitor", "share-chat"]);
  assert.equal(contract.actionIntent.schemaVersion, 1);
  assert.equal(contract.actionIntent.businessWrites, false);
  assert.deepEqual(contract.commandRegistry.surfaces, ["row-context-menu", "row-more-button"]);
  assert.equal(contract.eligibility.symbolMatching, false);
  assert.equal(contract.eligibility.filterBeforeSortAndLimit, true);
  assert.deepEqual(contract.eligibility.consumers, [
    "top-fees",
    "by-token",
    "recommended-pools",
    "groups",
    "comparison",
    "expanded-pool",
  ]);
  assert.equal(contract.streams.cursorBoundToBlocklistHash, true);
  assert.equal(contract.streams.hashChangeRequiresSnapshot, true);

  const assumptions = manifest.assumptions.join("\n");
  assert.match(assumptions, /local-fixture-verified only/);
  assert.match(assumptions, /POOL-15 and STATS-01 remain planned/);
  assert.match(assumptions, /monitoring and strategy expose consumer contracts only/);
  assert.match(assumptions, /P02-01 through P02-10 acceptance directories remain byte-identical/);
  assert.doesNotMatch(assumptions, /parity-verified|released/);
});

test("P02-11 eligibility Golden freezes blocked identities, limitations and backfill order", async () => {
  const golden = await readFile(path.join(P02_11_ROOT, "golden/eligibility.json"), "utf8").then(
    JSON.parse,
  );
  assert.equal(golden.schemaVersion, 1);
  assert.equal(golden.blocklist.schemaVersion, 1);
  assert.match(golden.blocklist.blocklistHash, /^sha256:[0-9a-f]{64}$/u);
  assert.deepEqual(
    golden.expected.eligiblePoolKeys,
    golden.candidates
      .filter(({ id }) => ["eligible-v4", "missing-address", "non-canonical-address"].includes(id))
      .map(({ poolKey }) => poolKey),
  );
  assert.deepEqual(
    golden.expected.decisions.filter(({ eligible }) => !eligible).map(({ id }) => id),
    ["blocked-pool", "blocked-token0", "blocked-token1"],
  );
  assert.deepEqual(
    golden.expected.decisions
      .flatMap(({ limitations }) => limitations.map(({ code }) => code))
      .sort(),
    ["TOKEN_ADDRESS_MISSING", "TOKEN_ADDRESS_NON_CANONICAL"],
  );
  assert.deepEqual(
    golden.expected.limitedResultPoolKeys,
    golden.expected.eligiblePoolKeys.slice(0, 2),
  );
});

test("P02-01 through P02-10 remain byte-identical to the pre-P02-11 inventory", async () => {
  const inventory = new Map(
    (await readFile(P02_11_PRIOR_CHECKSUMS_PATH, "utf8"))
      .trim()
      .split("\n")
      .map((line) => {
        const match = line.match(/^([0-9a-f]{64}) {2}(.+)$/u);
        assert.ok(match, `invalid prior acceptance checksum row: ${line}`);
        return [match[2], match[1]];
      }),
  );
  const priorFiles = (
    await Promise.all(
      Array.from({ length: 10 }, async (_, index) => {
        const directory = `artifacts/acceptance/P02-${String(index + 1).padStart(2, "0")}`;
        return (await acceptanceFiles(path.join(ROOT, directory))).map((file) =>
          path.posix.join(directory, file),
        );
      }),
    )
  ).flat();
  assert.equal(priorFiles.length, 198);
  assert.deepEqual(sorted(inventory.keys()), sorted(priorFiles));
  for (const file of priorFiles) {
    const bytes = await readFile(path.join(ROOT, file));
    assert.equal(
      inventory.get(file),
      createHash("sha256").update(bytes).digest("hex"),
      `${file} changed after P02-11 baseline`,
    );
  }
});

test("P02-11 sha256 inventory covers every acceptance file except itself", async () => {
  const checksumText = await readFile(path.join(P02_11_ROOT, "sha256sums.txt"), "utf8");
  const checksums = new Map(
    checksumText
      .trim()
      .split("\n")
      .map((line) => {
        const match = line.match(/^([0-9a-f]{64}) {2}(.+)$/u);
        assert.ok(match, `invalid P02-11 checksum row: ${line}`);
        return [match[2], match[1]];
      }),
  );
  const files = (await acceptanceFiles(P02_11_ROOT)).filter((file) => file !== "sha256sums.txt");
  assert.deepEqual([...checksums.keys()].sort(), files);
  for (const file of files) {
    const bytes = await readFile(path.join(P02_11_ROOT, file));
    assert.equal(
      checksums.get(file),
      createHash("sha256").update(bytes).digest("hex"),
      `${file} checksum`,
    );
  }
});

test("P02-10 owns only POOL-12 and freezes non-parity Candle/Tick semantics", async () => {
  const [manifest, functionMatrix, traceabilityMarkdown, contract, gaps] = await Promise.all([
    readFile(P02_10_MANIFEST_PATH, "utf8").then(JSON.parse),
    readFile(FUNCTION_MATRIX_PATH, "utf8"),
    readFile(TRACEABILITY_PATH, "utf8"),
    readFile(P02_10_CONTRACT_PATH, "utf8").then(JSON.parse),
    readFile(P02_01_GAPS_PATH, "utf8").then(JSON.parse),
  ]);

  assert.equal(manifest.workItemId, "P02-10");
  assert.equal(manifest.phase, "P02");
  assert.equal(manifest.risk, "R1");
  assert.equal(manifest.status, "accepted-with-gaps");
  assert.deepEqual(manifest.featureIds, P02_10_FEATURE_IDS);
  assert.match(manifest.completedAt, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/u);
  assert.match(manifest.commit, /^[0-9a-f]{40}$/u);

  const markedFunctionIds = functionMatrix
    .split("\n")
    .filter((line) => line.includes("`implemented-assumed`（P02-10"))
    .map((line) => line.split("|")[1]?.trim())
    .filter((id) => EXPECTED_FEATURE_IDS.includes(id));
  assert.deepEqual(markedFunctionIds, P02_10_FEATURE_IDS);

  const minimums = traceabilityRows(traceabilityMarkdown).get("POOL-12");
  assert.ok(minimums, "POOL-12 is missing from TRACEABILITY_MATRIX");
  const manifestTests = new Set(manifest.tests.map(({ id }) => id));
  const manifestEvidence = new Set(manifest.evidence.map(({ id }) => id));
  for (const testId of minimums.tests) assert.ok(manifestTests.has(testId), `missing ${testId}`);
  for (const evidenceId of minimums.evidence)
    assert.ok(manifestEvidence.has(evidenceId), `missing ${evidenceId}`);
  assert.deepEqual(
    sorted(manifest.evidence.map(({ id }) => id)),
    sorted(["E-API", "E-DATA", "E-SSE", "E-REC", "E-UI", "E-VIS", "E-RBAC", "E-SEC"]),
  );
  for (const evidence of manifest.evidence) {
    await access(assertRepositoryPath(evidence.path, evidence.id));
  }

  assert.equal(contract.contractVersion, "candle-tick/local-v1");
  assert.equal(contract.parityStatus, "not-parity-verified");
  assert.equal(contract.chainId, 56);
  assert.equal(contract.candles.baseBar, "1m");
  assert.deepEqual(contract.candles.aggregateBars, ["5m", "15m", "1H", "4H", "1D"]);
  assert.equal(contract.candles.price.token0, "token1-raw/token0-raw");
  assert.equal(contract.candles.price.token1, "token0-raw/token1-raw");
  assert.equal(contract.candles.price.usd, false);
  assert.equal(contract.candles.volume.unit, "selected-base-token-raw-integer-absolute");
  assert.equal(contract.candles.bucket.emptyPolicy, "omit");
  assert.equal(contract.candles.bucket.interpolate, false);
  assert.equal(contract.candles.bucket.forwardFill, false);
  assert.equal(contract.candles.rounding.mode, "ROUND_HALF_EVEN");
  assert.equal(contract.poolResolution.uiRequiresPoolKey, true);
  assert.equal(contract.poolResolution.tokenOnly, "unique-pool-only");
  assert.equal(contract.poolResolution.ambiguousError, "AMBIGUOUS_POOL");
  assert.equal(contract.nullPolicy.currentTickMissing, "currentTick=null;ticks=[]");
  assert.equal(contract.nullPolicy.unknownDecimals, "price0=null;price1=null");
  assert.deepEqual(contract.unresolvedGapRefs, [
    "GAP-API-CANDLE-QUOTE",
    "GAP-UI-TICK-LIQUIDITY-MAPPING",
  ]);

  const unresolved = new Map(gaps.items.map((gap) => [gap.id, gap.status]));
  for (const gap of contract.unresolvedGapRefs) assert.equal(unresolved.get(gap), "unresolved");
  const assumptions = manifest.assumptions.join("\n");
  assert.match(assumptions, /GAP-API-CANDLE-QUOTE.*unresolved/);
  assert.match(assumptions, /GAP-UI-TICK-LIQUIDITY-MAPPING.*unresolved/);
  assert.doesNotMatch(assumptions, /parity-verified|released/);
});

test("P02-10 Golden freezes V3 and V4 identity, Candle direction and Tick boundaries", async () => {
  const [v3, v4] = await Promise.all([
    readFile(path.join(P02_10_ROOT, "golden/v3.json"), "utf8").then(JSON.parse),
    readFile(path.join(P02_10_ROOT, "golden/v4.json"), "utf8").then(JSON.parse),
  ]);
  assert.equal(v3.protocol, "univ3");
  assert.match(v3.pool.poolAddress, /^0x[0-9a-f]{40}$/u);
  assert.equal(v3.pool.poolId, null);
  assert.equal(v3.pool.tickSpacing, 60);
  assert.equal(v3.expected.token0Candles[0].high, "4");
  assert.equal(v3.expected.token1Candles[0].low, "0.25");
  assert.deepEqual(
    v3.expected.ticks.map(({ tickIdx }) => tickIdx),
    [-120, 120],
  );
  assert.ok(v3.expected.ticks.every(({ liquidityNet }) => typeof liquidityNet === "string"));

  assert.equal(v4.protocol, "pcsv4");
  assert.equal(v4.pool.poolAddress, null);
  assert.match(v4.pool.poolId, /^0x[0-9a-f]{64}$/u);
  assert.equal(v4.pool.tickSpacing, 10);
  assert.equal(v4.expected.currentTick, -1);
  assert.deepEqual(
    v4.expected.ticks.map(({ tickIdx }) => tickIdx),
    [-20, 30],
  );
  assert.equal(v4.expected.decimalsUnknown[0].price0, null);
  assert.equal(v4.expected.decimalsUnknown[0].price1, null);
});

test("P02-01 through P02-09 remain byte-identical to the pre-P02-10 inventory", async () => {
  const inventory = new Map(
    (await readFile(P02_10_PRIOR_CHECKSUMS_PATH, "utf8"))
      .trim()
      .split("\n")
      .map((line) => {
        const match = line.match(/^([0-9a-f]{64}) {2}(.+)$/u);
        assert.ok(match, `invalid prior acceptance checksum row: ${line}`);
        return [match[2], match[1]];
      }),
  );
  const priorFiles = (
    await Promise.all(
      Array.from({ length: 9 }, async (_, index) => {
        const directory = `artifacts/acceptance/P02-${String(index + 1).padStart(2, "0")}`;
        return (await acceptanceFiles(path.join(ROOT, directory))).map((file) =>
          path.posix.join(directory, file),
        );
      }),
    )
  ).flat();
  assert.deepEqual(sorted(inventory.keys()), sorted(priorFiles));
  for (const file of priorFiles) {
    const bytes = await readFile(path.join(ROOT, file));
    assert.equal(
      inventory.get(file),
      createHash("sha256").update(bytes).digest("hex"),
      `${file} changed after P02-10 baseline`,
    );
  }
});

test("P02-10 sha256 inventory covers every acceptance file except itself", async () => {
  const checksumText = await readFile(path.join(P02_10_ROOT, "sha256sums.txt"), "utf8");
  const checksums = new Map(
    checksumText
      .trim()
      .split("\n")
      .map((line) => {
        const match = line.match(/^([0-9a-f]{64}) {2}(.+)$/u);
        assert.ok(match, `invalid P02-10 checksum row: ${line}`);
        return [match[2], match[1]];
      }),
  );
  const files = (await acceptanceFiles(P02_10_ROOT)).filter((file) => file !== "sha256sums.txt");
  assert.deepEqual([...checksums.keys()].sort(), files);
  for (const file of files) {
    const bytes = await readFile(path.join(P02_10_ROOT, file));
    assert.equal(
      checksums.get(file),
      createHash("sha256").update(bytes).digest("hex"),
      `${file} checksum`,
    );
  }
});

test("P02-09 owns only STATS-02 and freezes a locally-defined recommendation contract", async () => {
  const [manifest, functionMatrix, traceabilityMarkdown, contract] = await Promise.all([
    readFile(P02_09_MANIFEST_PATH, "utf8").then(JSON.parse),
    readFile(FUNCTION_MATRIX_PATH, "utf8"),
    readFile(TRACEABILITY_PATH, "utf8"),
    readFile(P02_09_CONTRACT_PATH, "utf8").then(JSON.parse),
  ]);

  assert.equal(manifest.workItemId, "P02-09");
  assert.equal(manifest.phase, "P02");
  assert.equal(manifest.risk, "R1");
  assert.equal(manifest.status, "accepted-with-gaps");
  assert.deepEqual(manifest.featureIds, P02_09_FEATURE_IDS);
  assert.match(manifest.completedAt, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/u);
  assert.match(manifest.commit, /^[0-9a-f]{40}$/u);

  const markedFunctionIds = functionMatrix
    .split("\n")
    .filter((line) => line.includes("`implemented-assumed`（P02-09"))
    .map((line) => line.split("|")[1]?.trim())
    .filter((id) => EXPECTED_FEATURE_IDS.includes(id));
  assert.deepEqual(markedFunctionIds, P02_09_FEATURE_IDS);

  const minimums = traceabilityRows(traceabilityMarkdown).get("STATS-02");
  assert.ok(minimums, "STATS-02 is missing from TRACEABILITY_MATRIX");
  const manifestTests = new Set(manifest.tests.map(({ id }) => id));
  const manifestEvidence = new Set(manifest.evidence.map(({ id }) => id));
  for (const testId of minimums.tests) assert.ok(manifestTests.has(testId), `missing ${testId}`);
  for (const evidenceId of minimums.evidence)
    assert.ok(manifestEvidence.has(evidenceId), `missing ${evidenceId}`);
  assert.deepEqual(
    sorted(manifest.evidence.map(({ id }) => id)),
    sorted(["E-API", "E-DATA", "E-SSE", "E-REC", "E-UI", "E-VIS", "E-RBAC", "E-SEC"]),
  );
  for (const evidence of manifest.evidence) {
    await access(assertRepositoryPath(evidence.path, evidence.id));
  }

  assert.equal(contract.contractVersion, "recommended-pools/local-v1");
  assert.equal(contract.evidenceLevel, "locally-defined");
  assert.equal(contract.parityStatus, "not-parity-verified");
  assert.equal(contract.source.streamKey, "top-fees:56:5");
  assert.equal(contract.source.windowMinutes, 5);
  assert.equal(contract.query.chain.omitted, "stats-only");
  assert.deepEqual(contract.query.limit, { default: 3, maximum: 20, minimum: 1 });
  assert.deepEqual(contract.selection.order, ["feesUsd:decimal-desc", "poolKey:byte-asc"]);
  assert.equal(contract.selection.deduplicateBy, "poolKey-before-limit");
  assert.equal(contract.event.sourceWindow, 5);
  assert.equal(contract.deduplication.hashInput, "ordered-wire-rows-only");
  assert.equal(contract.scope.stats01Implemented, false);

  const assumptions = manifest.assumptions.join("\n");
  assert.match(assumptions, /locally-defined/);
  assert.match(assumptions, /STATS-01 remains planned/);
  assert.match(assumptions, /P02-01 through P02-08 acceptance directories remain byte-identical/);
  assert.doesNotMatch(assumptions, /parity-verified|released/);
});

test("P02-09 Golden freezes ordered wire rows, hash, and cursor", async () => {
  const [input, output] = await Promise.all([
    readFile(path.join(P02_09_ROOT, "golden/input.json"), "utf8").then(JSON.parse),
    readFile(path.join(P02_09_ROOT, "golden/output.json"), "utf8").then(JSON.parse),
  ]);
  assert.equal(input.chain, "bsc");
  assert.equal(input.limit, 3);
  assert.equal(input.snapshot.chainId, 56);
  assert.equal(input.snapshot.minutes, 5);
  assert.deepEqual(
    output.pools.map(({ poolKey }) => poolKey),
    [
      "56:0x1111111111111111111111111111111111111111",
      "56:0x2222222222222222222222222222222222222222",
      `56:0x${"3".repeat(64)}`,
    ],
  );
  assert.ok(output.pools.every(({ feesUsd }) => typeof feesUsd === "string"));
  assert.equal(output.pools[1].token0Symbol, null);
  assert.equal(output.pools[2].token1Symbol, null);
  assert.match(output.selectionHash, /^sha256:[0-9a-f]{64}$/u);
  assert.match(output.cursor, /^rec-pools:v1:bsc:3:/u);
  assert.equal(output.sourceVersion, input.snapshot.version);
  assert.equal(output.sourceWindowEnd, input.snapshot.windowEnd);
});

test("P02-01 through P02-08 remain byte-identical to the pre-P02-09 inventory", async () => {
  const inventory = new Map(
    (await readFile(P02_09_PRIOR_CHECKSUMS_PATH, "utf8"))
      .trim()
      .split("\n")
      .map((line) => {
        const match = line.match(/^([0-9a-f]{64}) {2}(.+)$/u);
        assert.ok(match, `invalid prior acceptance checksum row: ${line}`);
        return [match[2], match[1]];
      }),
  );
  const priorFiles = (
    await Promise.all(
      Array.from({ length: 8 }, async (_, index) => {
        const directory = `artifacts/acceptance/P02-0${index + 1}`;
        return (await acceptanceFiles(path.join(ROOT, directory))).map((file) =>
          path.posix.join(directory, file),
        );
      }),
    )
  ).flat();
  assert.deepEqual(sorted(inventory.keys()), sorted(priorFiles));
  for (const file of priorFiles) {
    const bytes = await readFile(path.join(ROOT, file));
    assert.equal(
      inventory.get(file),
      createHash("sha256").update(bytes).digest("hex"),
      `${file} changed after P02-09 baseline`,
    );
  }
});

test("P02-09 sha256 inventory covers every acceptance file except itself", async () => {
  const checksumText = await readFile(path.join(P02_09_ROOT, "sha256sums.txt"), "utf8");
  const checksums = new Map(
    checksumText
      .trim()
      .split("\n")
      .map((line) => {
        const match = line.match(/^([0-9a-f]{64}) {2}(.+)$/u);
        assert.ok(match, `invalid P02-09 checksum row: ${line}`);
        return [match[2], match[1]];
      }),
  );
  const files = (await acceptanceFiles(P02_09_ROOT)).filter((file) => file !== "sha256sums.txt");
  assert.deepEqual([...checksums.keys()].sort(), files);
  for (const file of files) {
    const bytes = await readFile(path.join(P02_09_ROOT, file));
    assert.equal(
      checksums.get(file),
      createHash("sha256").update(bytes).digest("hex"),
      `${file} checksum`,
    );
  }
});

test("P02-08 owns only POOL-07 and keeps its local label contract explicitly non-parity", async () => {
  const [manifest, functionMatrix, traceabilityMarkdown, contract, runtimeContract, gaps] =
    await Promise.all([
      readFile(P02_08_MANIFEST_PATH, "utf8").then(JSON.parse),
      readFile(FUNCTION_MATRIX_PATH, "utf8"),
      readFile(TRACEABILITY_PATH, "utf8"),
      readFile(P02_08_CONTRACT_PATH, "utf8").then(JSON.parse),
      readFile(RUNTIME_LABEL_CONTRACT_PATH, "utf8").then(JSON.parse),
      readFile(P02_01_GAPS_PATH, "utf8").then(JSON.parse),
    ]);

  assert.equal(manifest.workItemId, "P02-08");
  assert.equal(manifest.phase, "P02");
  assert.equal(manifest.risk, "R1");
  assert.equal(manifest.status, "accepted-with-gaps");
  assert.deepEqual(manifest.featureIds, P02_08_FEATURE_IDS);
  assert.match(manifest.completedAt, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/u);
  assert.match(manifest.commit, /^[0-9a-f]{40}$/u);

  const markedFunctionIds = functionMatrix
    .split("\n")
    .filter((line) => line.includes("`implemented-assumed`（P02-08"))
    .map((line) => line.split("|")[1]?.trim())
    .filter((id) => EXPECTED_FEATURE_IDS.includes(id));
  assert.deepEqual(markedFunctionIds, P02_08_FEATURE_IDS);

  const traceability = traceabilityRows(traceabilityMarkdown);
  const minimums = traceability.get("POOL-07");
  assert.ok(minimums, "POOL-07 is missing from TRACEABILITY_MATRIX");
  const manifestTests = new Set(manifest.tests.map(({ id }) => id));
  const manifestEvidence = new Set(manifest.evidence.map(({ id }) => id));
  for (const testId of minimums.tests) assert.ok(manifestTests.has(testId), `missing ${testId}`);
  for (const evidenceId of minimums.evidence)
    assert.ok(manifestEvidence.has(evidenceId), `missing ${evidenceId}`);
  assert.deepEqual(
    sorted(manifest.evidence.map(({ id }) => id)),
    sorted(["E-API", "E-DATA", "E-SSE", "E-REC", "E-UI", "E-VIS", "E-SEC"]),
  );
  for (const evidence of manifest.evidence) {
    await access(assertRepositoryPath(evidence.path, evidence.id));
  }

  assert.deepEqual(contract, runtimeContract);
  assert.equal(contract.ruleVersion, "pool-labels/local-v1");
  assert.equal(contract.evidenceLevel, "locally-defined");
  assert.equal(contract.parityStatus, "not-parity-verified");
  assert.equal(contract.unresolvedGap, "GAP-LABEL-ALGORITHM");
  assert.equal(contract.nullPolicy, "omit-label");
  assert.equal(contract.inputWindow.priceSource, "canonical-sqrtPriceX96-sequence-only");
  assert.equal(contract.inputWindow.usdPriceConstruction, "forbidden");
  assert.equal(new Set(contract.rules.map(({ id }) => id)).size, 9);
  assert.deepEqual(
    contract.rules.map(({ priority }) => priority),
    [...contract.rules.map(({ priority }) => priority)].sort((left, right) => left - right),
  );
  assert.equal(gaps.items.find(({ id }) => id === "GAP-LABEL-ALGORITHM")?.status, "unresolved");

  const assumptions = manifest.assumptions.join("\n");
  assert.match(assumptions, /locally-defined/);
  assert.match(assumptions, /not parity-verified/);
  assert.match(assumptions, /GAP-LABEL-ALGORITHM remains unresolved/);
  assert.match(assumptions, /canonical sqrtPriceX96/);
  assert.match(assumptions, /P02-01 through P02-07 acceptance directories remain byte-identical/);
});

test("P02-08 Golden output freezes complete, ordered label records", async () => {
  const [input, output] = await Promise.all([
    readFile(path.join(P02_08_ROOT, "golden/input.json"), "utf8").then(JSON.parse),
    readFile(path.join(P02_08_ROOT, "golden/output.json"), "utf8").then(JSON.parse),
  ]);
  assert.equal(output.canonicalRevision, input.canonicalRevision);
  assert.equal(output.metricVersion, input.metricVersion);
  assert.equal(output.windowEnd, input.windowEnd);
  assert.equal(output.labelRuleVersion, "pool-labels/local-v1");
  assert.deepEqual(
    output.labels.map(({ id }) => id),
    ["high-fee-rate", "crowded", "lp-inflow"],
  );
  for (const label of output.labels) {
    assert.deepEqual(
      sorted(Object.keys(label)),
      sorted(["id", "label", "score", "reasons", "ruleVersion", "computedAt"]),
    );
    assert.ok(label.score >= 0 && label.score <= 100);
    assert.ok(label.reasons.length > 0);
    for (const reason of label.reasons) {
      assert.deepEqual(
        sorted(Object.keys(reason)),
        sorted(["code", "window", "observed", "threshold", "operator"]),
      );
    }
  }
});

test("P02-01 through P02-07 remain byte-identical to the pre-P02-08 inventory", async () => {
  const inventory = new Map(
    (await readFile(P02_08_PRIOR_CHECKSUMS_PATH, "utf8"))
      .trim()
      .split("\n")
      .map((line) => {
        const match = line.match(/^([0-9a-f]{64}) {2}(.+)$/u);
        assert.ok(match, `invalid prior acceptance checksum row: ${line}`);
        return [match[2], match[1]];
      }),
  );
  const priorFiles = (
    await Promise.all(
      Array.from({ length: 7 }, async (_, index) => {
        const directory = `artifacts/acceptance/P02-0${index + 1}`;
        return (await acceptanceFiles(path.join(ROOT, directory))).map((file) =>
          path.posix.join(directory, file),
        );
      }),
    )
  ).flat();
  assert.deepEqual(sorted(inventory.keys()), sorted(priorFiles));
  for (const file of priorFiles) {
    const bytes = await readFile(path.join(ROOT, file));
    assert.equal(
      inventory.get(file),
      createHash("sha256").update(bytes).digest("hex"),
      `${file} changed after P02-08 baseline`,
    );
  }
});

test("P02-08 sha256 inventory covers every acceptance file except itself", async () => {
  const checksumText = await readFile(path.join(P02_08_ROOT, "sha256sums.txt"), "utf8");
  const checksums = new Map(
    checksumText
      .trim()
      .split("\n")
      .map((line) => {
        const match = line.match(/^([0-9a-f]{64}) {2}(.+)$/u);
        assert.ok(match, `invalid P02-08 checksum row: ${line}`);
        return [match[2], match[1]];
      }),
  );
  const files = (await acceptanceFiles(P02_08_ROOT)).filter((file) => file !== "sha256sums.txt");
  assert.deepEqual([...checksums.keys()].sort(), files);
  for (const file of files) {
    const bytes = await readFile(path.join(P02_08_ROOT, file));
    assert.equal(
      checksums.get(file),
      createHash("sha256").update(bytes).digest("hex"),
      `${file} checksum`,
    );
  }
});

test("P02-07 owns only POOL-05/06/11 with the required local evidence", async () => {
  const [manifest, functionMatrix, traceabilityMarkdown] = await Promise.all([
    readFile(P02_07_MANIFEST_PATH, "utf8").then(JSON.parse),
    readFile(FUNCTION_MATRIX_PATH, "utf8"),
    readFile(TRACEABILITY_PATH, "utf8"),
  ]);
  assert.equal(manifest.workItemId, "P02-07");
  assert.equal(manifest.phase, "P02");
  assert.equal(manifest.risk, "R1");
  assert.equal(manifest.status, "accepted-with-gaps");
  assert.deepEqual(sorted(manifest.featureIds), sorted(P02_07_FEATURE_IDS));

  const markedFunctionIds = functionMatrix
    .split("\n")
    .filter((line) => line.includes("`implemented-assumed`（P02-07"))
    .map((line) => line.split("|")[1]?.trim())
    .filter((id) => EXPECTED_FEATURE_IDS.includes(id));
  assert.deepEqual(sorted(markedFunctionIds), sorted(P02_07_FEATURE_IDS));

  const traceability = traceabilityRows(traceabilityMarkdown);
  const manifestTests = new Set(manifest.tests.map(({ id }) => id));
  const manifestEvidence = new Set(manifest.evidence.map(({ id }) => id));
  for (const featureId of P02_07_FEATURE_IDS) {
    const minimums = traceability.get(featureId);
    assert.ok(minimums, `${featureId} is missing from TRACEABILITY_MATRIX`);
    for (const testId of minimums.tests) {
      assert.ok(manifestTests.has(testId), `${featureId} is missing ${testId}`);
    }
    for (const evidenceId of minimums.evidence) {
      assert.ok(manifestEvidence.has(evidenceId), `${featureId} is missing ${evidenceId}`);
    }
  }

  assert.deepEqual(
    sorted(manifest.evidence.map(({ id }) => id)),
    sorted(["E-API", "E-DATA", "E-SSE", "E-UI", "E-VIS", "E-RBAC", "E-SEC"]),
  );
  for (const evidence of manifest.evidence) {
    await access(assertRepositoryPath(evidence.path, evidence.id));
  }

  const assumptions = manifest.assumptions.join("\n");
  assert.match(assumptions, /local-fixture-verified only/);
  assert.match(assumptions, /Fee\/TVL is unannualized Fees divided by TVL/);
  assert.match(assumptions, /aTVL and Fee\/aTVL remain unresolved/);
  assert.match(assumptions, /comparison selection remains session-only/);
  assert.match(assumptions, /BSC chainId 56 is the only implemented chain/);
  assert.match(assumptions, /P02-01 through P02-06 acceptance directories remain byte-identical/);
  assert.doesNotMatch(assumptions, /parity-verified|released/);
});

test("P02-07 sha256 inventory covers every acceptance file except itself", async () => {
  const checksumText = await readFile(path.join(P02_07_ROOT, "sha256sums.txt"), "utf8");
  const checksums = new Map(
    checksumText
      .trim()
      .split("\n")
      .map((line) => {
        const match = line.match(/^([0-9a-f]{64}) {2}(.+)$/u);
        assert.ok(match, `invalid P02-07 checksum row: ${line}`);
        return [match[2], match[1]];
      }),
  );
  const files = (await acceptanceFiles(P02_07_ROOT)).filter((file) => file !== "sha256sums.txt");
  assert.deepEqual([...checksums.keys()].sort(), files);
  for (const file of files) {
    const bytes = await readFile(path.join(P02_07_ROOT, file));
    assert.equal(
      checksums.get(file),
      createHash("sha256").update(bytes).digest("hex"),
      `${file} checksum`,
    );
  }
});

test("P02-06 owns only POOL-08/09/10 with the required local evidence", async () => {
  const [manifest, functionMatrix, traceabilityMarkdown] = await Promise.all([
    readFile(P02_06_MANIFEST_PATH, "utf8").then(JSON.parse),
    readFile(FUNCTION_MATRIX_PATH, "utf8"),
    readFile(TRACEABILITY_PATH, "utf8"),
  ]);
  assert.equal(manifest.workItemId, "P02-06");
  assert.equal(manifest.phase, "P02");
  assert.equal(manifest.risk, "R1");
  assert.equal(manifest.status, "accepted-with-gaps");
  assert.deepEqual(sorted(manifest.featureIds), sorted(P02_06_FEATURE_IDS));

  const markedFunctionIds = functionMatrix
    .split("\n")
    .filter((line) => line.includes("`implemented-assumed`（P02-06"))
    .map((line) => line.split("|")[1]?.trim())
    .filter((id) => EXPECTED_FEATURE_IDS.includes(id));
  assert.deepEqual(sorted(markedFunctionIds), sorted(P02_06_FEATURE_IDS));

  const traceability = traceabilityRows(traceabilityMarkdown);
  const manifestTests = new Set(manifest.tests.map(({ id }) => id));
  const manifestEvidence = new Set(manifest.evidence.map(({ id }) => id));
  for (const featureId of P02_06_FEATURE_IDS) {
    const minimums = traceability.get(featureId);
    assert.ok(minimums, `${featureId} is missing from TRACEABILITY_MATRIX`);
    for (const testId of minimums.tests) {
      assert.ok(manifestTests.has(testId), `${featureId} is missing ${testId}`);
    }
    for (const evidenceId of minimums.evidence) {
      assert.ok(manifestEvidence.has(evidenceId), `${featureId} is missing ${evidenceId}`);
    }
  }

  assert.deepEqual(
    sorted(manifest.evidence.map(({ id }) => id)),
    sorted(["E-API", "E-DATA", "E-SSE", "E-REC", "E-UI", "E-VIS", "E-RBAC", "E-SEC"]),
  );
  for (const evidence of manifest.evidence) {
    await access(assertRepositoryPath(evidence.path, evidence.id));
  }

  const assumptions = manifest.assumptions.join("\n");
  assert.match(assumptions, /local-fixture-verified only/);
  assert.match(assumptions, /BSC chainId 56 is the only implemented chain/);
  assert.match(assumptions, /POOL-15 creator attribution remains planned/);
  assert.match(assumptions, /GAP-FINALITY-DEPTH remains unresolved/);
  assert.match(assumptions, /existing USD and formula gaps remain unresolved/);
  assert.match(assumptions, /P02-01 through P02-05 acceptance directories remain byte-identical/);
  assert.doesNotMatch(assumptions, /parity-verified|released/);
});

test("P02-06 sha256 inventory covers every acceptance file except itself", async () => {
  const checksumText = await readFile(path.join(P02_06_ROOT, "sha256sums.txt"), "utf8");
  const checksums = new Map(
    checksumText
      .trim()
      .split("\n")
      .map((line) => {
        const match = line.match(/^([0-9a-f]{64}) {2}(.+)$/u);
        assert.ok(match, `invalid P02-06 checksum row: ${line}`);
        return [match[2], match[1]];
      }),
  );
  const files = (await acceptanceFiles(P02_06_ROOT)).filter((file) => file !== "sha256sums.txt");
  assert.deepEqual([...checksums.keys()].sort(), files);
  for (const file of files) {
    const bytes = await readFile(path.join(P02_06_ROOT, file));
    assert.equal(
      checksums.get(file),
      createHash("sha256").update(bytes).digest("hex"),
      `${file} checksum`,
    );
  }
});

test("P02-05 owns only FLOW-03/04/05 with the required local evidence", async () => {
  const [manifest, gaps, functionMatrix, traceabilityMarkdown] = await Promise.all([
    readFile(P02_05_MANIFEST_PATH, "utf8").then(JSON.parse),
    readFile(P02_05_GAPS_PATH, "utf8").then(JSON.parse),
    readFile(FUNCTION_MATRIX_PATH, "utf8"),
    readFile(TRACEABILITY_PATH, "utf8"),
  ]);
  assert.equal(manifest.workItemId, "P02-05");
  assert.equal(manifest.phase, "P02");
  assert.equal(manifest.risk, "R1");
  assert.equal(manifest.status, "accepted-with-gaps");
  assert.deepEqual(sorted(manifest.featureIds), sorted(P02_05_FEATURE_IDS));

  const markedFunctionIds = functionMatrix
    .split("\n")
    .filter((line) => line.includes("`implemented-assumed`（P02-05）"))
    .map((line) => line.split("|")[1]?.trim())
    .filter((id) => EXPECTED_FEATURE_IDS.includes(id));
  assert.deepEqual(sorted(markedFunctionIds), sorted(P02_05_FEATURE_IDS));

  const traceability = traceabilityRows(traceabilityMarkdown);
  const manifestTests = new Set(manifest.tests.map(({ id }) => id));
  const manifestEvidence = new Set(manifest.evidence.map(({ id }) => id));
  for (const featureId of P02_05_FEATURE_IDS) {
    const minimums = traceability.get(featureId);
    assert.ok(minimums, `${featureId} is missing from TRACEABILITY_MATRIX`);
    for (const testId of minimums.tests) {
      assert.ok(manifestTests.has(testId), `${featureId} is missing ${testId}`);
    }
    for (const evidenceId of minimums.evidence) {
      assert.ok(manifestEvidence.has(evidenceId), `${featureId} is missing ${evidenceId}`);
    }
  }

  assert.deepEqual(
    sorted(manifest.evidence.map(({ id }) => id)),
    sorted(["E-DATA", "E-SSE", "E-API", "E-UI", "E-VIS", "E-RBAC", "E-SEC"]),
  );
  for (const evidence of manifest.evidence) {
    await access(assertRepositoryPath(evidence.path, evidence.id));
  }

  const gapById = new Map(gaps.items.map((item) => [item.id, item]));
  assert.equal(gapById.get("GAP-FLOW-USD-VALUATION")?.status, "unresolved");
  assert.equal(gapById.get("GAP-FINALITY-DEPTH")?.status, "unresolved");

  const assumptions = manifest.assumptions.join("\n");
  assert.match(assumptions, /other 13 P02 feature IDs remain planned/);
  assert.match(assumptions, /GAP-FLOW-USD-VALUATION remains unresolved/);
  assert.match(assumptions, /GAP-FINALITY-DEPTH remains unresolved/);
  assert.match(assumptions, /No event is marked finalized/);
  assert.match(assumptions, /local-fixture-verified only/);
  assert.doesNotMatch(assumptions, /parity-verified|released/);
});

test("P02-05 sha256 inventory covers every acceptance file except itself", async () => {
  const checksumText = await readFile(path.join(P02_05_ROOT, "sha256sums.txt"), "utf8");
  const checksums = new Map(
    checksumText
      .trim()
      .split("\n")
      .map((line) => {
        const match = line.match(/^([0-9a-f]{64}) {2}(.+)$/u);
        assert.ok(match, `invalid P02-05 checksum row: ${line}`);
        return [match[2], match[1]];
      }),
  );
  const files = (await acceptanceFiles(P02_05_ROOT)).filter((file) => file !== "sha256sums.txt");
  assert.deepEqual([...checksums.keys()].sort(), files);
  for (const file of files) {
    const bytes = await readFile(path.join(P02_05_ROOT, file));
    assert.equal(
      checksums.get(file),
      createHash("sha256").update(bytes).digest("hex"),
      `${file} checksum`,
    );
  }
});

test("P02-04 owns only POOL-03 and FLOW-01/02 with local fixture evidence", async () => {
  const [manifest, functionMatrix, traceabilityMarkdown] = await Promise.all([
    readFile(P02_04_MANIFEST_PATH, "utf8").then(JSON.parse),
    readFile(FUNCTION_MATRIX_PATH, "utf8"),
    readFile(TRACEABILITY_PATH, "utf8"),
  ]);
  assert.equal(manifest.workItemId, "P02-04");
  assert.equal(manifest.phase, "P02");
  assert.equal(manifest.risk, "R1");
  assert.equal(manifest.status, "accepted-with-gaps");
  assert.deepEqual(sorted(manifest.featureIds), sorted(P02_04_FEATURE_IDS));

  const markedFunctionIds = functionMatrix
    .split("\n")
    .filter((line) => line.includes("`implemented-assumed`（P02-04）"))
    .map((line) => line.split("|")[1]?.trim())
    .filter((id) => EXPECTED_FEATURE_IDS.includes(id));
  assert.deepEqual(sorted(markedFunctionIds), sorted(P02_04_FEATURE_IDS));

  const traceability = traceabilityRows(traceabilityMarkdown);
  const manifestTests = new Set(manifest.tests.map(({ id }) => id));
  const manifestEvidence = new Set(manifest.evidence.map(({ id }) => id));
  for (const featureId of P02_04_FEATURE_IDS) {
    const minimums = traceability.get(featureId);
    assert.ok(minimums, `${featureId} is missing from TRACEABILITY_MATRIX`);
    for (const testId of minimums.tests) {
      assert.ok(manifestTests.has(testId), `${featureId} is missing ${testId}`);
    }
    for (const evidenceId of minimums.evidence) {
      assert.ok(manifestEvidence.has(evidenceId), `${featureId} is missing ${evidenceId}`);
    }
  }

  assert.deepEqual(
    sorted(manifest.evidence.map(({ id }) => id)),
    sorted(["E-API", "E-SSE", "E-DATA", "E-REC", "E-UI", "E-VIS", "E-SEC"]),
  );
  for (const evidence of manifest.evidence) {
    await access(assertRepositoryPath(evidence.path, evidence.id));
  }

  const assumptions = manifest.assumptions.join("\n");
  assert.match(assumptions, /other 16 P02 feature IDs remain planned/);
  assert.match(assumptions, /FLOW-03, FLOW-04 and FLOW-05 remain planned/);
  assert.match(assumptions, /GAP-FINALITY-DEPTH remains unresolved/);
  assert.match(assumptions, /No event is marked finalized/);
  assert.match(assumptions, /No external RPC/);
});

test("P02-02 manifest owns only the tracer slice and local fixture evidence", async () => {
  const [manifest, markdown] = await Promise.all([
    readFile(MANIFEST_PATH, "utf8").then(JSON.parse),
    readFile(TRACEABILITY_PATH, "utf8"),
  ]);
  assert.equal(manifest.workItemId, "P02-02");
  assert.equal(manifest.phase, "P02");
  assert.equal(manifest.risk, "R1");
  assert.equal(manifest.status, "accepted-with-gaps");
  assert.match(manifest.completedAt, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
  assert.equal(Number.isNaN(Date.parse(manifest.completedAt)), false);
  assert.equal(manifest.commit, EXPECTED_ACCEPTED_COMMIT);
  assert.deepEqual(sorted(manifest.featureIds), sorted(P02_02_FEATURE_IDS));
  assert.deepEqual(sorted(manifest.evidence.map(({ id }) => id)), sorted(REQUIRED_EVIDENCE_IDS));

  const traceability = traceabilityRows(markdown);
  const manifestTests = new Set(manifest.tests.map(({ id }) => id));
  const manifestEvidence = new Set(manifest.evidence.map(({ id }) => id));
  for (const featureId of P02_02_FEATURE_IDS) {
    const minimums = traceability.get(featureId);
    assert.ok(minimums, `${featureId} is missing from TRACEABILITY_MATRIX`);
    for (const testId of minimums.tests) {
      assert.ok(manifestTests.has(testId), `${featureId} is missing ${testId}`);
    }
    for (const evidenceId of minimums.evidence) {
      assert.ok(manifestEvidence.has(evidenceId), `${featureId} is missing ${evidenceId}`);
    }
  }

  for (const evidence of manifest.evidence) {
    await access(assertRepositoryPath(evidence.path, evidence.id));
  }

  const assumptions = manifest.assumptions.join("\n");
  assert.match(assumptions, /local-fixture-verified only/);
  assert.match(assumptions, /other 19 P02 feature IDs remain planned/);
  assert.match(assumptions, /GAP-EVENT-/);
  assert.match(assumptions, /GAP-FINALITY-DEPTH/);
  assert.match(assumptions, /No external RPC/);
});
