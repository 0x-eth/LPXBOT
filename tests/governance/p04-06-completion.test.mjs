import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { access, readFile, readdir, stat } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(fileURLToPath(new URL("../..", import.meta.url)));
const BASELINE = "bcf7d80035e7884fa390a5d37f30569e637ff4ad";
const ACCEPTANCE = path.join(ROOT, "artifacts/acceptance/P04-06");
const ACCEPTANCE_ROOT = path.join(ROOT, "artifacts/acceptance");
const TRACEABILITY = path.join(ROOT, "docs/TRACEABILITY_MATRIX.md");
const FUNCTION_MATRIX = path.join(ROOT, "docs/FUNCTION_MATRIX.md");
const ROADMAP = path.join(ROOT, "docs/DEVELOPMENT_ROADMAP.md");
const MANIFEST = path.join(ACCEPTANCE, "manifest.json");
const FEATURE_IDS = [
  "WALLET-01",
  "WALLET-02",
  "WALLET-03",
  "WALLET-04",
  "WALLET-05",
  "WALLET-06",
  "WALLET-07",
  "WALLET-08",
  "WALLET-09",
  "WALLET-10",
  "SET-06",
  "SET-07",
];
const IMPLEMENTED = FEATURE_IDS;
const REQUIRED_EVIDENCE = [
  "E-API",
  "E-CHAIN",
  "E-DATA",
  "E-OPS",
  "E-RBAC",
  "E-REC",
  "E-SEC",
  "E-UI",
  "E-VIS",
];
const REQUIRED_TESTS = ["T-API", "T-CHAIN", "T-MIG", "T-REC", "T-SEC", "T-UI", "T-UNIT", "T-VIS"];

function digest(value) {
  return createHash("sha256").update(value).digest("hex");
}

function sorted(values) {
  return [...values].sort();
}

function statusRows(markdown) {
  const rows = new Map();
  const section =
    markdown
      .split("<!-- P04_STATUS_TABLE_START -->")[1]
      ?.split("<!-- P04_STATUS_TABLE_END -->")[0] ?? "";
  for (const line of section.split("\n")) {
    if (!line.startsWith("|")) continue;
    const columns = line
      .split("|")
      .slice(1, -1)
      .map((value) => value.trim());
    if (!FEATURE_IDS.includes(columns[0])) continue;
    assert.equal(rows.has(columns[0]), false, `duplicate P04 status row ${columns[0]}`);
    rows.set(columns[0], {
      evidence: columns[4],
      implementation: columns[2],
      status: columns[1].replaceAll("`", ""),
      tests: columns[3],
    });
  }
  return rows;
}

function parseChecksums(source) {
  return source
    .trimEnd()
    .split("\n")
    .map((line, index) => {
      const match = /^([0-9a-f]{64}) {2}(.+)$/u.exec(line);
      assert.ok(match, `sha256sums line ${index + 1}`);
      return { path: match[2], sha256: match[1] };
    });
}

async function filesBelow(directory, prefix = "") {
  const files = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const relative = path.posix.join(prefix, entry.name);
    if (entry.isDirectory()) {
      files.push(...(await filesBelow(path.join(directory, entry.name), relative)));
    } else if (entry.isFile()) {
      files.push(relative);
    } else {
      assert.fail(`unsupported acceptance entry ${relative}`);
    }
  }
  return sorted(files);
}

test("P04 status remains complete after P04-07 with global 61 / 135", async () => {
  const [traceability, functionMatrix, roadmap] = await Promise.all([
    readFile(TRACEABILITY, "utf8"),
    readFile(FUNCTION_MATRIX, "utf8"),
    readFile(ROADMAP, "utf8"),
  ]);
  const rows = statusRows(traceability);
  assert.deepEqual(sorted(rows.keys()), sorted(FEATURE_IDS));
  assert.deepEqual(
    sorted([...rows].filter(([, row]) => row.status === "implemented-assumed").map(([id]) => id)),
    sorted(IMPLEMENTED),
  );
  assert.deepEqual(
    [...rows].filter(([, row]) => row.status === "planned").map(([id]) => id),
    [],
  );
  assert.match(rows.get("WALLET-10").implementation, /wallet-transfer/u);
  assert.match(rows.get("WALLET-10").tests, /p04-06-wallet-transfer/u);
  assert.match(rows.get("WALLET-10").evidence, /P04-06/u);
  assert.match(rows.get("WALLET-10").evidence, /local-fixture-verified/u);
  assert.match(functionMatrix, /\| WALLET-10 \|[^\n]*implemented-assumed[^\n]*P04-06/u);
  assert.match(traceability, /P04[^\n]*12[^\n]*implemented-assumed[^\n]*0[^\n]*planned/iu);
  assert.match(traceability, /\| 当前产品实现 \| 61 \|/u);
  assert.match(traceability, /\| `implemented-assumed` \| 61 \|/u);
  assert.match(traceability, /\| 其余 `planned` \| 135 \|/u);
  assert.match(roadmap, /全局为 61 项 `implemented-assumed`、135 项 `planned`/u);
});

test("P04-06 manifest owns WALLET-10 and preserves the approval boundary", async () => {
  const manifest = JSON.parse(await readFile(MANIFEST, "utf8"));
  assert.equal(manifest.workItemId, "P04-06");
  assert.equal(manifest.phase, "P04");
  assert.equal(manifest.risk, "R3");
  assert.equal(manifest.status, "accepted-with-gaps");
  assert.deepEqual(manifest.featureIds, ["WALLET-10"]);
  assert.deepEqual(sorted(manifest.tests.map(({ id }) => id)), REQUIRED_TESTS);
  assert.deepEqual(sorted(manifest.evidence.map(({ id }) => id)), REQUIRED_EVIDENCE);
  assert.ok(manifest.tests.every(({ result }) => result === "passed"));
  assert.match(manifest.completedAt, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/u);
  const assumptions = manifest.assumptions.join("\n");
  assert.match(assumptions, /local-fixture-verified only/u);
  assert.match(assumptions, /non-local write.*ready-for-approval.*zero signing.*broadcast/iu);
  assert.match(assumptions, /SET-07.*outside/u);
  assert.match(assumptions, /not custody-ready/iu);
  assert.match(assumptions, /not parity-verified/iu);
  assert.match(assumptions, /not released/iu);
  for (const evidence of manifest.evidence) await access(path.join(ROOT, evidence.path));
});

test("P00 through P04-05 acceptance files remain byte-identical to the fixed baseline", async () => {
  const baselineFiles = execFileSync(
    "git",
    ["ls-tree", "-r", "--name-only", BASELINE, "--", "artifacts/acceptance"],
    { cwd: ROOT, encoding: "utf8" },
  )
    .trim()
    .split("\n")
    .filter(Boolean);
  const currentPriorFiles = (await filesBelow(ACCEPTANCE_ROOT))
    .map((file) => `artifacts/acceptance/${file}`)
    .filter((file) => !file.startsWith("artifacts/acceptance/P04-06/"));
  assert.deepEqual(currentPriorFiles, sorted(baselineFiles));
  const changed = execFileSync(
    "git",
    ["diff", "--name-only", BASELINE, "--", "artifacts/acceptance"],
    { cwd: ROOT, encoding: "utf8" },
  )
    .trim()
    .split("\n")
    .filter(Boolean)
    .filter((file) => !file.startsWith("artifacts/acceptance/P04-06/"));
  assert.deepEqual(changed, []);
});

test("P04-06 required evidence and sha256 inventory are complete", async () => {
  const files = await filesBelow(ACCEPTANCE);
  for (const required of [
    ...REQUIRED_EVIDENCE.map((id) => `${id}.md`),
    "command-output.md",
    "initial-failure.md",
    "manifest.json",
    "sha256sums.txt",
  ]) {
    assert.ok(files.includes(required), required);
  }
  const rows = parseChecksums(await readFile(path.join(ACCEPTANCE, "sha256sums.txt"), "utf8"));
  assert.deepEqual(
    rows.map(({ path: value }) => value),
    files.filter((file) => file !== "sha256sums.txt"),
  );
  assert.equal(new Set(rows.map(({ path: value }) => value)).size, rows.length);
  for (const row of rows) {
    assert.equal(digest(await readFile(path.join(ACCEPTANCE, row.path))), row.sha256, row.path);
  }
});

test("P04-06 screenshots and evidence freeze local-only write execution", async () => {
  const images = new Map([
    ["transfer-approval-chromium-desktop.png", [1440, 1483]],
    ["transfer-approval-chromium-mobile.png", [390, 2622]],
    ["transfer-confirmed-chromium-desktop.png", [1440, 1483]],
    ["transfer-confirmed-chromium-mobile.png", [390, 2622]],
  ]);
  for (const [file, dimensions] of images) {
    const imagePath = path.join(ACCEPTANCE, "E-VIS", file);
    assert.ok((await stat(imagePath)).size > 10_000, file);
    const bytes = await readFile(imagePath);
    assert.deepEqual([bytes.readUInt32BE(16), bytes.readUInt32BE(20)], dimensions, file);
  }
  const evidence = await Promise.all(
    ["E-API.md", "E-CHAIN.md", "E-REC.md", "E-SEC.md", "E-OPS.md"].map((file) =>
      readFile(path.join(ACCEPTANCE, file), "utf8"),
    ),
  ).then((parts) => parts.join("\n"));
  assert.match(evidence, /public RPC calls[^\n]*0/iu);
  assert.match(evidence, /non-local signing and broadcast calls[^\n]*0/iu);
  assert.match(
    evidence,
    /raw transaction[^\n]*did not enter PostgreSQL, Redis, queues, logs, audit, telemetry/iu,
  );
  assert.match(evidence, /ready-for-approval/iu);
});
