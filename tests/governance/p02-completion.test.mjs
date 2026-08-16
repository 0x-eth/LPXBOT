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
const IMPLEMENTED_FEATURE_IDS = [
  ...P02_02_FEATURE_IDS,
  ...P02_04_FEATURE_IDS,
  ...P02_05_FEATURE_IDS,
  ...P02_06_FEATURE_IDS,
  ...P02_07_FEATURE_IDS,
  ...P02_08_FEATURE_IDS,
  ...P02_09_FEATURE_IDS,
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

test("P02 status table keeps exactly eighteen fixture-verified features implemented", async () => {
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
  assert.equal(planned.length, 5);
  assert.match(markdown, /`implemented-assumed`\s*\|\s*36\s*\|/);
  assert.match(markdown, /(?:其余|remaining)\s*`planned`\s*\|\s*160\s*\|/i);
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
