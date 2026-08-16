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
const EXPECTED_ACCEPTED_COMMIT = "73998c6f22e499f7063207ec1d497766b6714d29";
const EXPECTED_FEATURE_IDS = [
  ...Array.from({ length: 16 }, (_, index) => `POOL-${String(index + 1).padStart(2, "0")}`),
  ...Array.from({ length: 5 }, (_, index) => `FLOW-${String(index + 1).padStart(2, "0")}`),
  ...Array.from({ length: 2 }, (_, index) => `STATS-${String(index + 1).padStart(2, "0")}`),
];
const P02_02_FEATURE_IDS = ["POOL-01", "POOL-02", "POOL-04", "POOL-16"];
const P02_04_FEATURE_IDS = ["POOL-03", "FLOW-01", "FLOW-02"];
const P02_05_FEATURE_IDS = ["FLOW-03", "FLOW-04", "FLOW-05"];
const IMPLEMENTED_FEATURE_IDS = [
  ...P02_02_FEATURE_IDS,
  ...P02_04_FEATURE_IDS,
  ...P02_05_FEATURE_IDS,
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

test("P02 status table keeps exactly ten fixture-verified features implemented", async () => {
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
  assert.equal(planned.length, 13);
  assert.match(markdown, /`implemented-assumed`\s*\|\s*28\s*\|/);
  assert.match(markdown, /(?:其余|remaining)\s*`planned`\s*\|\s*168\s*\|/i);
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
