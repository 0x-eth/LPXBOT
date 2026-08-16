import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, mkdir, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { parsers as yamlParsers } from "prettier/plugins/yaml";

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

function yamlValue(node) {
  if (!node) {
    return null;
  }
  if (node.type === "root") {
    return yamlValue(node.children[0]);
  }
  if (node.type === "document") {
    return yamlValue(node.children.find((child) => child.type === "documentBody"));
  }
  if (["documentBody", "mappingKey", "mappingValue", "sequenceItem"].includes(node.type)) {
    return yamlValue(node.children[0]);
  }
  if (node.type === "mapping") {
    return Object.fromEntries(
      node.children.map((item) => [
        yamlValue(item.children.find((child) => child.type === "mappingKey")),
        yamlValue(item.children.find((child) => child.type === "mappingValue")),
      ]),
    );
  }
  if (node.type === "sequence") {
    return node.children.map(yamlValue);
  }
  if (typeof node.value === "string") {
    return node.value;
  }
  throw new Error(`Unsupported YAML AST node: ${node.type}`);
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
  const acceptanceDirectory = path.join(repoRoot, "artifacts/acceptance", manifest.workItemId);
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

test("accepts only named featureless phase evidence manifests with no feature IDs", async () => {
  const completionManifest = {
    ...validP00Manifest(),
    workItemId: "P01-08",
    phase: "P01",
    status: "accepted-with-gaps",
    tests: [
      {
        id: "T-UNIT",
        command: "node --test fixture.test.mjs",
        result: "passed",
        evidencePath: "artifacts/acceptance/P01-08/evidence.md",
      },
    ],
    evidence: [{ id: "E-OPS", path: "artifacts/acceptance/P01-08/evidence.md" }],
  };
  const completionFixture = await acceptanceFixture(completionManifest);
  const completionResult = run("scripts/check-acceptance.mjs", [
    "--repo-root",
    completionFixture.repoRoot,
    "--acceptance-dir",
    completionFixture.acceptanceDirectory,
    "--function-matrix",
    path.join(completionFixture.repoRoot, "docs/FUNCTION_MATRIX.md"),
  ]);
  assert.equal(completionResult.status, 0, output(completionResult));

  const decoderEvidenceManifest = {
    ...completionManifest,
    workItemId: "P02-03",
    phase: "P02",
    tests: completionManifest.tests.map((entry) => ({
      ...entry,
      evidencePath: "artifacts/acceptance/P02-03/evidence.md",
    })),
    evidence: completionManifest.evidence.map((entry) => ({
      ...entry,
      path: "artifacts/acceptance/P02-03/evidence.md",
    })),
  };
  const decoderEvidenceFixture = await acceptanceFixture(decoderEvidenceManifest);
  const decoderEvidenceResult = run("scripts/check-acceptance.mjs", [
    "--repo-root",
    decoderEvidenceFixture.repoRoot,
    "--acceptance-dir",
    decoderEvidenceFixture.acceptanceDirectory,
    "--function-matrix",
    path.join(decoderEvidenceFixture.repoRoot, "docs/FUNCTION_MATRIX.md"),
  ]);
  assert.equal(decoderEvidenceResult.status, 0, output(decoderEvidenceResult));

  const implementationManifest = { ...completionManifest, workItemId: "P01-09" };
  const implementationFixture = await acceptanceFixture(implementationManifest);
  const implementationResult = run("scripts/check-acceptance.mjs", [
    "--repo-root",
    implementationFixture.repoRoot,
    "--acceptance-dir",
    implementationFixture.acceptanceDirectory,
    "--function-matrix",
    path.join(implementationFixture.repoRoot, "docs/FUNCTION_MATRIX.md"),
  ]);
  assert.notEqual(implementationResult.status, 0);
  assert.match(output(implementationResult), /must reference at least one feature ID/i);
});

test("accepts migration evidence in an acceptance manifest", async () => {
  const manifest = validP00Manifest();
  manifest.evidence.push({
    id: "E-MIG",
    path: "artifacts/acceptance/P00-99/evidence.md",
  });
  const fixture = await acceptanceFixture(manifest);
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
  const checksumsHash = createHash("sha256")
    .update(
      await import("node:fs/promises").then(({ readFile }) =>
        readFile(path.join(baselineDirectory, "sha256sums.txt")),
      ),
    )
    .digest("hex");

  const result = run("scripts/check-baseline.mjs", [
    "--baseline-dir",
    baselineDirectory,
    "--expected-manifest-sha256",
    manifestHash,
    "--expected-checksums-sha256",
    checksumsHash,
  ]);

  assert.notEqual(result.status, 0);
  assert.match(output(result), /manifest.*missing file record.*payload\.txt/i);
});

test("rejects a self-consistent baseline that does not match its frozen anchor", async () => {
  const baselineDirectory = await mkdtemp(path.join(tmpdir(), "lpbot-baseline-anchor-"));
  const payload = "frozen fixture\n";
  const payloadHash = createHash("sha256").update(payload).digest("hex");
  await writeFile(path.join(baselineDirectory, "payload.txt"), payload);
  await writeFile(
    path.join(baselineDirectory, "artifact-manifest.json"),
    `${JSON.stringify(
      { files: [{ path: "payload.txt", bytes: Buffer.byteLength(payload), sha256: payloadHash }] },
      null,
      2,
    )}\n`,
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
  const checksumsHash = createHash("sha256")
    .update(
      await import("node:fs/promises").then(({ readFile }) =>
        readFile(path.join(baselineDirectory, "sha256sums.txt")),
      ),
    )
    .digest("hex");

  const result = run("scripts/check-baseline.mjs", [
    "--baseline-dir",
    baselineDirectory,
    "--expected-manifest-sha256",
    "0".repeat(64),
    "--expected-checksums-sha256",
    checksumsHash,
  ]);

  assert.notEqual(result.status, 0);
  assert.match(output(result), /frozen manifest anchor mismatch/i);
});

test("repository exposes a real Playwright browser suite", async () => {
  const packageJson = JSON.parse(await readFile(path.join(ROOT, "package.json"), "utf8"));
  const config = await readFile(path.join(ROOT, "playwright.config.ts"), "utf8");
  const browserTest = await readFile(path.join(ROOT, "tests/e2e/web-rendering.spec.ts"), "utf8");

  assert.equal(
    packageJson.scripts["test:e2e"],
    "pnpm --filter @lpbot/web^... build && playwright test",
  );
  assert.match(packageJson.devDependencies["@playwright/test"], /^\d+\.\d+\.\d+$/);
  assert.match(config, /pnpm --filter @lpbot\/web dev/);
  assert.match(config, /reporter:[\s\S]*html/);
  assert.match(config, /browserName:\s*["']chromium["']/);
  assert.match(config, /viewport:\s*\{\s*width:\s*1440,\s*height:\s*900\s*\}/);
  assert.match(config, /viewport:\s*\{\s*width:\s*390,\s*height:\s*844\s*\}/);
  assert.match(browserTest, /page\.goto\(/);
  assert.match(browserTest, /toBeVisible\(/);
  assert.match(browserTest, /pageerror/);
  assert.match(browserTest, /requestfailed/);
  assert.match(browserTest, /console/);
});

test("repository exposes a real local Foundry contract suite", async () => {
  const packageJson = JSON.parse(await readFile(path.join(ROOT, "package.json"), "utf8"));
  const config = await readFile(path.join(ROOT, "foundry.toml"), "utf8");
  const contract = await readFile(path.join(ROOT, "contracts/src/TestOnlyCounter.sol"), "utf8");
  const contractTest = await readFile(
    path.join(ROOT, "contracts/test/TestOnlyCounter.t.sol"),
    "utf8",
  );

  assert.equal(packageJson.scripts["test:contracts"], "forge test -vvv");
  assert.match(config, /src\s*=\s*["']contracts\/src["']/);
  assert.match(config, /test\s*=\s*["']contracts\/test["']/);
  assert.doesNotMatch(config, /rpc_endpoints|fork_url/i);
  assert.match(contract, /contract\s+TestOnlyCounter\b/);
  assert.match(contractTest, /contract\s+TestOnlyCounterTest\b/);
  assert.match(contractTest, /new\s+TestOnlyCounter\s*\(/);
  assert.match(contractTest, /test\w*(?:Deploy|Initial)/i);
  assert.match(contractTest, /test\w*(?:Increment|State)/i);
  assert.match(contractTest, /test\w*(?:Owner|Permission|Unauthorized|Revert|Fail)/i);
});

test("CI defines six pinned, bounded jobs with real browser and contract gates", async () => {
  const packageJson = JSON.parse(await readFile(path.join(ROOT, "package.json"), "utf8"));
  const workflowPath = path.join(ROOT, ".github/workflows/ci.yml");
  const workflow = yamlValue(
    await yamlParsers.yaml.parse(
      await import("node:fs/promises").then(({ readFile }) => readFile(workflowPath, "utf8")),
      { filepath: workflowPath },
    ),
  );
  const jobs = workflow.jobs;

  assert.deepEqual(Object.keys(jobs).sort(), [
    "browser",
    "contracts",
    "governance",
    "infrastructure",
    "quality",
    "security",
  ]);
  assert.equal(workflow.permissions.contents, "read");
  assert.equal(workflow.concurrency["cancel-in-progress"], "true");
  assert.ok(Object.hasOwn(workflow.on, "pull_request"));
  assert.ok(Object.hasOwn(workflow.on, "workflow_dispatch"));
  assert.deepEqual(workflow.on.push.branches, ["main"]);

  const steps = Object.values(jobs).flatMap((job) => job.steps);
  const actions = steps.map((step) => step.uses).filter(Boolean);
  assert.equal(actions.length, 14);
  assert.ok(actions.every((action) => /@[0-9a-f]{40}$/.test(action)));
  assert.ok(Object.values(jobs).every((job) => /^\d+$/.test(job["timeout-minutes"])));

  for (const job of [jobs.quality, jobs.governance]) {
    const checkout = job.steps.find((step) => step.uses?.startsWith("actions/checkout@"));
    assert.equal(
      checkout?.with?.["fetch-depth"],
      "0",
      `${job.name} must fetch history for frozen reference commits`,
    );
  }

  for (const job of [
    jobs.quality,
    jobs.governance,
    jobs.infrastructure,
    jobs.security,
    jobs.browser,
  ]) {
    assert.ok(
      job.steps.some((step) => step.with?.["node-version"] === "22.23.1"),
      `${job.name} must use Node 22.23.1`,
    );
    assert.ok(
      job.steps.some((step) => step.run?.includes("pnpm@11.17.0")),
      `${job.name} must use pnpm 11.17.0`,
    );
  }

  const cleanupSteps = jobs.infrastructure.steps.filter((step) => step.if === "always()");
  assert.equal(cleanupSteps.length, 2);
  assert.match(cleanupSteps.map((step) => step.run).join("\n"), /infra:down/);
  assert.match(cleanupSteps.map((step) => step.run).join("\n"), /infra:reset/);

  assert.equal(jobs.browser.name, "Browser");
  assert.equal(jobs.browser.env.NO_PROXY, "127.0.0.1,localhost");
  assert.equal(
    jobs.browser.container,
    `mcr.microsoft.com/playwright:v${packageJson.devDependencies["@playwright/test"]}-noble@sha256:dcc5531e97840b9b5e794f2814476b21571c5124a3fca2267d73041f56e7580e`,
  );
  const browserCommands = jobs.browser.steps.map((step) => step.run).join("\n");
  assert.doesNotMatch(browserCommands, /playwright install/);
  assert.match(browserCommands, /pnpm test:e2e/);
  const reportUpload = jobs.browser.steps.find((step) =>
    step.uses?.startsWith("actions/upload-artifact@"),
  );
  assert.equal(reportUpload?.if, "failure()");
  assert.equal(reportUpload?.with?.path, "playwright-report/");

  assert.equal(jobs.contracts.name, "Contracts");
  assert.match(jobs.contracts.steps.map((step) => step.run).join("\n"), /forge fmt --check/);
  assert.match(jobs.contracts.steps.map((step) => step.run).join("\n"), /forge build/);
  assert.match(jobs.contracts.steps.map((step) => step.run).join("\n"), /forge test -vvv/);
  assert.match(
    jobs.contracts.steps.find((step) => step.uses?.startsWith("foundry-rs/foundry-toolchain@"))
      ?.with?.version,
    /^v\d+\.\d+\.\d+$/,
  );

  const constantSuccessStep = steps.find((step) => {
    if (!step.run) return false;
    const command = step.run.trim();
    return /^(?:true|:|exit\s+0|(?:echo|printf)\b[^;&|]*)$/s.test(command);
  });
  assert.equal(constantSuccessStep, undefined, "CI must not contain constant-success placeholders");
});
