import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import test from "node:test";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

function run(script, args) {
  return spawnSync(process.execPath, [path.join(ROOT, script), ...args], {
    cwd: ROOT,
    encoding: "utf8",
  });
}

function output(result) {
  return `${result.stdout}\n${result.stderr}`;
}

function functionMatrix(ids) {
  return [
    "# Function matrix",
    "",
    "| ID | 功能 | 证据 | 权限 | 风险 | 复现与验收要点 |",
    "|---|---|---|---|---|---|",
    ...ids.map((id) => `| ${id} | Fixture | UI | USER | R0 | Fixture |`),
    "",
  ].join("\n");
}

function traceabilityMatrix(rows) {
  return [
    "# Traceability matrix",
    "",
    "| ID | 阶段 | 最低测试 | 最低验收证据 |",
    "|---|---|---|---|",
    ...rows.map(
      ({ id, phase = "P01", tests = "T-UNIT", evidence = "E-DATA" }) =>
        `| ${id} | ${phase} | ${tests} | ${evidence} |`,
    ),
    "",
  ].join("\n");
}

async function matrixFixture(functionIds, traceRows) {
  const directory = await mkdtemp(path.join(tmpdir(), "lpbot-traceability-"));
  const functionPath = path.join(directory, "FUNCTION_MATRIX.md");
  const traceabilityPath = path.join(directory, "TRACEABILITY_MATRIX.md");
  await writeFile(functionPath, functionMatrix(functionIds));
  await writeFile(traceabilityPath, traceabilityMatrix(traceRows));
  return { directory, functionPath, traceabilityPath };
}

function checkTraceability(fixture, expectedCount) {
  return run("scripts/check-traceability.mjs", [
    "--function-matrix",
    fixture.functionPath,
    "--traceability-matrix",
    fixture.traceabilityPath,
    "--expected-count",
    String(expectedCount),
  ]);
}

test("rejects a feature ID missing from the traceability matrix", async () => {
  const fixture = await matrixFixture(["AUTH-01", "AUTH-02"], [{ id: "AUTH-01" }]);
  const result = checkTraceability(fixture, 2);

  assert.notEqual(result.status, 0);
  assert.match(output(result), /missing.*AUTH-02/i);
});

test("rejects an extra feature ID in the traceability matrix", async () => {
  const fixture = await matrixFixture(["AUTH-01"], [{ id: "AUTH-01" }, { id: "AUTH-02" }]);
  const result = checkTraceability(fixture, 1);

  assert.notEqual(result.status, 0);
  assert.match(output(result), /extra.*AUTH-02/i);
});

test("rejects duplicate feature IDs", async () => {
  const fixture = await matrixFixture(["AUTH-01", "AUTH-01"], [{ id: "AUTH-01" }]);
  const result = checkTraceability(fixture, 1);

  assert.notEqual(result.status, 0);
  assert.match(output(result), /duplicate.*AUTH-01/i);
});

test("rejects a phase outside P01-P13", async () => {
  const fixture = await matrixFixture(["AUTH-01"], [{ id: "AUTH-01", phase: "P14" }]);
  const result = checkTraceability(fixture, 1);

  assert.notEqual(result.status, 0);
  assert.match(output(result), /invalid phase.*P14/i);
});

test("rejects an unknown Test ID", async () => {
  const fixture = await matrixFixture(["AUTH-01"], [{ id: "AUTH-01", tests: "T-UNIT,T-UNKNOWN" }]);
  const result = checkTraceability(fixture, 1);

  assert.notEqual(result.status, 0);
  assert.match(output(result), /unknown Test ID.*T-UNKNOWN/i);
});

test("rejects an unknown Evidence ID", async () => {
  const fixture = await matrixFixture(
    ["AUTH-01"],
    [{ id: "AUTH-01", evidence: "E-DATA,E-UNKNOWN" }],
  );
  const result = checkTraceability(fixture, 1);

  assert.notEqual(result.status, 0);
  assert.match(output(result), /unknown Evidence ID.*E-UNKNOWN/i);
});

test("rejects empty test and evidence cells", async () => {
  const fixture = await matrixFixture(
    ["AUTH-01", "AUTH-02"],
    [
      { id: "AUTH-01", tests: "" },
      { id: "AUTH-02", evidence: "" },
    ],
  );
  const result = checkTraceability(fixture, 2);

  assert.notEqual(result.status, 0);
  assert.match(output(result), /AUTH-01.*at least one test/i);
  assert.match(output(result), /AUTH-02.*at least one evidence/i);
});

test("declared count catches the same deletion in both matrices", async () => {
  const fixture = await matrixFixture(["AUTH-01"], [{ id: "AUTH-01" }]);
  const result = checkTraceability(fixture, 2);

  assert.notEqual(result.status, 0);
  assert.match(output(result), /expected 2.*found 1/i);
});

test("rejects a broken relative Markdown link", async () => {
  const docsDirectory = await mkdtemp(path.join(tmpdir(), "lpbot-doc-links-"));
  await writeFile(
    path.join(docsDirectory, "README.md"),
    "# Fixture\n\n[Missing document](./missing.md)\n",
  );
  const result = run("scripts/check-doc-links.mjs", ["--docs-dir", docsDirectory]);

  assert.notEqual(result.status, 0);
  assert.match(output(result), /broken relative link.*missing\.md/i);
});

test("rejects a relative Markdown link with a missing heading anchor", async () => {
  const docsDirectory = await mkdtemp(path.join(tmpdir(), "lpbot-doc-anchor-"));
  await writeFile(path.join(docsDirectory, "target.md"), "# Existing heading\n");
  await writeFile(
    path.join(docsDirectory, "README.md"),
    "# Fixture\n\n[Missing heading](./target.md#missing-heading)\n",
  );
  const result = run("scripts/check-doc-links.mjs", ["--docs-dir", docsDirectory]);

  assert.notEqual(result.status, 0);
  assert.match(output(result), /broken relative link.*missing heading anchor/i);
});

async function acceptanceFixture(manifest) {
  const repoRoot = await mkdtemp(path.join(tmpdir(), "lpbot-acceptance-"));
  const acceptanceDirectory = path.join(repoRoot, "artifacts/acceptance/P00-99");
  const docsDirectory = path.join(repoRoot, "docs");
  await mkdir(acceptanceDirectory, { recursive: true });
  await mkdir(docsDirectory, { recursive: true });
  await writeFile(path.join(docsDirectory, "FUNCTION_MATRIX.md"), functionMatrix(["AUTH-01"]));
  await writeFile(path.join(acceptanceDirectory, "evidence.md"), "# Real fixture evidence\n");
  await writeFile(
    path.join(acceptanceDirectory, "manifest.json"),
    `${JSON.stringify(manifest, null, 2)}\n`,
  );
  return { repoRoot, acceptanceDirectory };
}

function validP00Manifest() {
  return {
    schemaVersion: 1,
    workItemId: "P00-99",
    phase: "P00",
    risk: "R0",
    status: "accepted",
    featureIds: [],
    tests: [
      {
        id: "T-UNIT",
        command: "node --test fixture.test.mjs",
        result: "passed",
        evidencePath: "artifacts/acceptance/P00-99/evidence.md",
      },
    ],
    evidence: [
      {
        id: "E-OPS",
        path: "artifacts/acceptance/P00-99/evidence.md",
      },
    ],
    assumptions: ["Fixture only"],
    completedAt: "2026-08-13T12:00:00.000Z",
    commit: null,
  };
}

test("rejects an acceptance manifest that violates the JSON Schema", async () => {
  const fixture = await acceptanceFixture({
    ...validP00Manifest(),
    risk: "R9",
  });
  const result = run("scripts/check-acceptance.mjs", [
    "--repo-root",
    fixture.repoRoot,
    "--acceptance-dir",
    fixture.acceptanceDirectory,
    "--function-matrix",
    path.join(fixture.repoRoot, "docs/FUNCTION_MATRIX.md"),
  ]);

  assert.notEqual(result.status, 0);
  assert.match(output(result), /manifest schema validation failed.*risk/is);
});

test("accepts a valid P00 infrastructure manifest with no feature IDs", async () => {
  const fixture = await acceptanceFixture(validP00Manifest());
  const result = run("scripts/check-acceptance.mjs", [
    "--repo-root",
    fixture.repoRoot,
    "--acceptance-dir",
    fixture.acceptanceDirectory,
    "--function-matrix",
    path.join(fixture.repoRoot, "docs/FUNCTION_MATRIX.md"),
  ]);

  assert.equal(result.status, 0, output(result));
  assert.match(output(result), /1 acceptance manifest.*valid/i);
});

test("rejects a frozen baseline file omitted from its artifact manifest", async () => {
  const baselineDirectory = await mkdtemp(path.join(tmpdir(), "lpbot-baseline-"));
  const payload = "frozen fixture\n";
  const payloadHash = createHash("sha256").update(payload).digest("hex");
  await writeFile(path.join(baselineDirectory, "payload.txt"), payload);
  await writeFile(
    path.join(baselineDirectory, "artifact-manifest.json"),
    `${JSON.stringify({ files: [] }, null, 2)}\n`,
  );
  const manifestHash = createHash("sha256")
    .update(
      await import("node:fs/promises").then(({ readFile }) =>
        readFile(path.join(baselineDirectory, "artifact-manifest.json")),
      ),
    )
    .digest("hex");
  await writeFile(
    path.join(baselineDirectory, "sha256sums.txt"),
    `${manifestHash}  artifact-manifest.json\n${payloadHash}  payload.txt\n`,
  );

  const result = run("scripts/check-baseline.mjs", ["--baseline-dir", baselineDirectory]);

  assert.notEqual(result.status, 0);
  assert.match(output(result), /manifest.*missing file record.*payload\.txt/i);
});
