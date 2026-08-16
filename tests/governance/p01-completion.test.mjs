import assert from "node:assert/strict";
import { access, readFile, readdir } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const ACCEPTANCE_ROOT = path.join(ROOT, "artifacts/acceptance");
const TRACEABILITY_PATH = path.join(ROOT, "docs/TRACEABILITY_MATRIX.md");
const COVERAGE_PATH = path.join(ACCEPTANCE_ROOT, "P01-08/feature-coverage.json");
const IMPLEMENTATION_WORK_ITEMS = ["P01-02", "P01-03", "P01-04", "P01-05", "P01-06", "P01-07"];
const EXPECTED_FEATURE_IDS = [
  "AUTH-01",
  "AUTH-02",
  "AUTH-03",
  "AUTH-04",
  "AUTH-05",
  "AUTH-06",
  "AUTH-07",
  "AUTH-08",
  "AUTH-09",
  "AUTH-10",
  "SHELL-01",
  "SHELL-02",
  "SHELL-03",
  "SHELL-04",
  "SHELL-05",
  "SHELL-06",
  "SET-01",
  "SET-02",
];
const COMPLETED_FEATURE_STATUSES = new Set(["implemented-assumed", "parity-verified"]);

async function readJson(file) {
  return JSON.parse(await readFile(file, "utf8"));
}

async function exists(file) {
  try {
    await access(file);
    return true;
  } catch {
    return false;
  }
}

function sorted(values) {
  return [...values].sort((left, right) => left.localeCompare(right));
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
    assert.equal(rows.has(match[1]), false, `duplicate traceability row for ${match[1]}`);
    rows.set(match[1], {
      phase: match[2],
      tests: commaSeparated(match[3]),
      evidence: commaSeparated(match[4]),
    });
  }
  return rows;
}

function statusRows(markdown) {
  const section = markdown.match(
    /<!-- P01_STATUS_TABLE_START -->([\s\S]*?)<!-- P01_STATUS_TABLE_END -->/,
  );
  assert.ok(section, "TRACEABILITY_MATRIX is missing the machine-checkable P01 status table");

  const rows = new Map();
  const rowPattern =
    /^\|\s*(AUTH-(?:0[1-9]|10)|SHELL-0[1-6]|SET-0[1-2])\s*\|\s*`?([a-z-]+)`?\s*\|/gm;
  for (const match of section[1].matchAll(rowPattern)) {
    assert.equal(rows.has(match[1]), false, `duplicate P01 status row for ${match[1]}`);
    rows.set(match[1], match[2]);
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

test("P01-02 through P01-07 accepted manifests cover every P01 feature exactly once", async () => {
  const traceability = traceabilityRows(await readFile(TRACEABILITY_PATH, "utf8"));
  const occurrences = new Map(EXPECTED_FEATURE_IDS.map((id) => [id, []]));

  for (const workItemId of IMPLEMENTATION_WORK_ITEMS) {
    const manifest = await readJson(path.join(ACCEPTANCE_ROOT, workItemId, "manifest.json"));
    assert.equal(manifest.workItemId, workItemId);
    assert.equal(manifest.phase, "P01", `${workItemId} has an incorrect phase`);
    assert.equal(
      manifest.status,
      "accepted",
      `${workItemId} is not an accepted implementation manifest`,
    );
    assert.ok(manifest.featureIds.length > 0, `${workItemId} has no implementation feature IDs`);

    for (const featureId of manifest.featureIds) {
      assert.ok(occurrences.has(featureId), `${workItemId} claims non-P01 feature ${featureId}`);
      occurrences.get(featureId).push(workItemId);
      assert.equal(
        traceability.get(featureId)?.phase,
        "P01",
        `${featureId} has an incorrect phase`,
      );
    }
  }

  assert.deepEqual(sorted(occurrences.keys()), sorted(EXPECTED_FEATURE_IDS));
  for (const [featureId, workItems] of occurrences) {
    assert.equal(
      workItems.length,
      1,
      `${featureId} must occur exactly once; found ${workItems.length} in ${workItems.join(", ") || "none"}`,
    );
  }
});

test("each P01 implementation manifest meets its feature traceability minimums", async () => {
  const traceability = traceabilityRows(await readFile(TRACEABILITY_PATH, "utf8"));

  for (const workItemId of IMPLEMENTATION_WORK_ITEMS) {
    const manifest = await readJson(path.join(ACCEPTANCE_ROOT, workItemId, "manifest.json"));
    const manifestTests = new Set(manifest.tests.map((entry) => entry.id));
    const manifestEvidence = new Set(manifest.evidence.map((entry) => entry.id));

    for (const featureId of manifest.featureIds) {
      const minimums = traceability.get(featureId);
      assert.ok(minimums, `${featureId} is missing from TRACEABILITY_MATRIX`);
      for (const testId of minimums.tests) {
        assert.ok(manifestTests.has(testId), `${workItemId}/${featureId} is missing ${testId}`);
      }
      for (const evidenceId of minimums.evidence) {
        assert.ok(
          manifestEvidence.has(evidenceId),
          `${workItemId}/${featureId} is missing ${evidenceId}`,
        );
      }
    }
  }
});

test("P01-01 remains reference-only and P01-08 claims no implementation features", async () => {
  assert.equal(
    await exists(path.join(ACCEPTANCE_ROOT, "P01-01/artifact-manifest.json")),
    true,
    "P01-01 reference manifest is missing",
  );
  assert.equal(
    await exists(path.join(ACCEPTANCE_ROOT, "P01-01/manifest.json")),
    false,
    "P01-01 must not become an implementation manifest",
  );

  const p01Directories = (await readdir(ACCEPTANCE_ROOT, { withFileTypes: true }))
    .filter((entry) => entry.isDirectory() && /^P01-\d{2}$/.test(entry.name))
    .map((entry) => entry.name)
    .sort();
  assert.deepEqual(p01Directories, ["P01-01", ...IMPLEMENTATION_WORK_ITEMS, "P01-08"]);

  const manifest = await readJson(path.join(ACCEPTANCE_ROOT, "P01-08/manifest.json"));
  assert.equal(manifest.workItemId, "P01-08");
  assert.equal(manifest.phase, "P01");
  assert.equal(manifest.status, "accepted-with-gaps");
  assert.deepEqual(manifest.featureIds, []);
});

test("P01 feature coverage records inspectable implementation, tests, evidence, and status", async () => {
  const coverage = await readJson(COVERAGE_PATH);
  assert.equal(coverage.workItemId, "P01-08");
  assert.equal(coverage.phase, "P01");
  assert.equal(coverage.acceptanceStatus, "accepted-with-gaps");
  assert.deepEqual(
    sorted(coverage.features.map((entry) => entry.id)),
    sorted(EXPECTED_FEATURE_IDS),
  );
  assert.equal(
    new Set(coverage.features.map((entry) => entry.id)).size,
    EXPECTED_FEATURE_IDS.length,
  );

  const traceabilityMarkdown = await readFile(TRACEABILITY_PATH, "utf8");
  const traceability = traceabilityRows(traceabilityMarkdown);
  const documentedStatuses = statusRows(traceabilityMarkdown);
  assert.deepEqual(sorted(documentedStatuses.keys()), sorted(EXPECTED_FEATURE_IDS));
  assert.match(traceabilityMarkdown, /(?:其余|remaining)\s*168[^\n]*`planned`/i);

  for (const feature of coverage.features) {
    const minimums = traceability.get(feature.id);
    assert.equal(feature.phase, "P01", `${feature.id} has an incorrect coverage phase`);
    assert.ok(
      COMPLETED_FEATURE_STATUSES.has(feature.status),
      `${feature.id} has invalid status ${feature.status}`,
    );
    assert.notEqual(
      feature.status,
      "released",
      `${feature.id} must not be released during P01 closeout`,
    );
    assert.equal(
      documentedStatuses.get(feature.id),
      feature.status,
      `${feature.id} documentation status differs from feature coverage`,
    );
    assert.ok(feature.implementationFiles.length > 0, `${feature.id} has no implementation files`);
    assert.ok(feature.testLinks.length > 0, `${feature.id} has no test links`);
    assert.ok(feature.evidenceLinks.length > 0, `${feature.id} has no evidence links`);
    assert.ok(feature.evidenceLevels.length > 0, `${feature.id} has no evidence classification`);
    assert.equal(
      feature.status === "parity-verified",
      feature.parityEvidenceComplete,
      `${feature.id} parity status must follow complete target-comparison evidence`,
    );

    const testIds = new Set(feature.testLinks.map((entry) => entry.id));
    const evidenceIds = new Set(feature.evidenceLinks.map((entry) => entry.id));
    for (const testId of minimums.tests) {
      assert.ok(testIds.has(testId), `${feature.id} coverage is missing ${testId}`);
    }
    for (const evidenceId of minimums.evidence) {
      assert.ok(evidenceIds.has(evidenceId), `${feature.id} coverage is missing ${evidenceId}`);
    }

    for (const implementationPath of feature.implementationFiles) {
      await access(assertRepositoryPath(implementationPath, `${feature.id} implementation path`));
    }
    for (const testLink of feature.testLinks) {
      await access(assertRepositoryPath(testLink.path, `${feature.id}/${testLink.id} test path`));
    }
    for (const evidenceLink of feature.evidenceLinks) {
      await access(
        assertRepositoryPath(evidenceLink.path, `${feature.id}/${evidenceLink.id} evidence path`),
      );
    }
    await access(
      assertRepositoryPath(feature.acceptanceDirectory, `${feature.id} acceptance directory`),
    );
  }
});
