import assert from "node:assert/strict";
import { access, readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const TRACEABILITY_PATH = path.join(ROOT, "docs/TRACEABILITY_MATRIX.md");
const MANIFEST_PATH = path.join(ROOT, "artifacts/acceptance/P02-02/manifest.json");
const EXPECTED_FEATURE_IDS = [
  ...Array.from({ length: 16 }, (_, index) => `POOL-${String(index + 1).padStart(2, "0")}`),
  ...Array.from({ length: 5 }, (_, index) => `FLOW-${String(index + 1).padStart(2, "0")}`),
  ...Array.from({ length: 2 }, (_, index) => `STATS-${String(index + 1).padStart(2, "0")}`),
];
const IMPLEMENTED_FEATURE_IDS = ["POOL-01", "POOL-02", "POOL-04", "POOL-16"];
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

test("P02 status table keeps exactly four fixture-verified features implemented", async () => {
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
  assert.equal(planned.length, 19);
  assert.match(markdown, /`implemented-assumed`\s*\|\s*22\s*\|/);
  assert.match(markdown, /(?:其余|remaining)\s*`planned`\s*\|\s*174\s*\|/i);
});

test("P02-02 manifest owns only the tracer slice and local fixture evidence", async () => {
  const [manifest, markdown] = await Promise.all([
    readFile(MANIFEST_PATH, "utf8").then(JSON.parse),
    readFile(TRACEABILITY_PATH, "utf8"),
  ]);
  assert.equal(manifest.workItemId, "P02-02");
  assert.equal(manifest.phase, "P02");
  assert.equal(manifest.risk, "R1");
  assert.deepEqual(sorted(manifest.featureIds), sorted(IMPLEMENTED_FEATURE_IDS));
  assert.deepEqual(sorted(manifest.evidence.map(({ id }) => id)), sorted(REQUIRED_EVIDENCE_IDS));

  const traceability = traceabilityRows(markdown);
  const manifestTests = new Set(manifest.tests.map(({ id }) => id));
  const manifestEvidence = new Set(manifest.evidence.map(({ id }) => id));
  for (const featureId of IMPLEMENTED_FEATURE_IDS) {
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
