import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { access, readFile, readdir, stat } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(fileURLToPath(new URL("../..", import.meta.url)));
const ACCEPTANCE = path.join(ROOT, "artifacts/acceptance/P04-07");
const ACCEPTANCE_ROOT = path.join(ROOT, "artifacts/acceptance");
const FUNCTION_MATRIX = path.join(ROOT, "docs/FUNCTION_MATRIX.md");
const TRACEABILITY = path.join(ROOT, "docs/TRACEABILITY_MATRIX.md");
const ROADMAP = path.join(ROOT, "docs/DEVELOPMENT_ROADMAP.md");
const MANIFEST = path.join(ACCEPTANCE, "manifest.json");
const PRIOR_CHECKSUMS = path.join(ACCEPTANCE, "prior-acceptance-sha256s.txt");
const REQUIRED_EVIDENCE = ["E-API", "E-DATA", "E-OPS", "E-RBAC", "E-REC", "E-SEC", "E-UI", "E-VIS"];
const REQUIRED_TESTS = ["T-API", "T-MIG", "T-REC", "T-SEC", "T-UI", "T-UNIT", "T-VIS"];

function digest(value) {
  return createHash("sha256").update(value).digest("hex");
}

function sorted(values) {
  return [...values].sort();
}

function parseChecksums(source, label) {
  const rows = source
    .trimEnd()
    .split("\n")
    .map((line, index) => {
      const match = /^([0-9a-f]{64}) {2}(.+)$/u.exec(line);
      assert.ok(match, `${label} line ${index + 1} is invalid`);
      return { path: match[2], sha256: match[1] };
    });
  assert.equal(new Set(rows.map(({ path: value }) => value)).size, rows.length, `${label} paths`);
  return rows;
}

async function filesBelow(directory, prefix = "") {
  const files = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const relative = path.posix.join(prefix, entry.name);
    if (entry.isDirectory())
      files.push(...(await filesBelow(path.join(directory, entry.name), relative)));
    else if (entry.isFile()) files.push(relative);
    else assert.fail(`unsupported acceptance entry ${relative}`);
  }
  return sorted(files);
}

test("P04 remains at 12 implemented-assumed / 0 planned with global 64 / 132", async () => {
  const [functionMatrix, traceability, roadmap] = await Promise.all([
    readFile(FUNCTION_MATRIX, "utf8"),
    readFile(TRACEABILITY, "utf8"),
    readFile(ROADMAP, "utf8"),
  ]);
  const p04Status =
    traceability
      .split("<!-- P04_STATUS_TABLE_START -->")[1]
      ?.split("<!-- P04_STATUS_TABLE_END -->")[0] ?? "";
  const set07 = p04Status.split("\n").find((line) => line.startsWith("| SET-07 |"));
  assert.ok(set07);
  assert.match(set07, /implemented-assumed/u);
  assert.match(set07, /okx-connector/u);
  assert.match(set07, /p04-07-okx-key/u);
  assert.match(set07, /artifacts\/acceptance\/P04-07\/manifest\.json/u);
  assert.match(functionMatrix, /\| SET-07 \|[^\n]*implemented-assumed[^\n]*P04-07/u);
  for (const document of [traceability, roadmap]) {
    assert.match(document, /P04[^\n]*12[^\n]*implemented-assumed[^\n]*0[^\n]*planned/iu);
    assert.match(document, /accepted-with-gaps/u);
    assert.match(document, /GAP-P04-OKX-LIVE/u);
    assert.match(document, /生产 KMS\/IAM/u);
    assert.match(document, /独立安全评审/u);
    assert.match(document, /真实只读 sandbox 验证/u);
  }
  assert.match(traceability, /\| 当前产品实现 \| 64 \|/u);
  assert.match(traceability, /\| `implemented-assumed` \| 64 \|/u);
  assert.match(traceability, /\| 其余 `planned` \| 132 \|/u);
  assert.match(roadmap, /全局为 64 项 `implemented-assumed`、132 项 `planned`/u);
});

test("P04-07 manifest owns SET-07 and preserves all unresolved boundaries", async () => {
  const manifest = JSON.parse(await readFile(MANIFEST, "utf8"));
  assert.equal(manifest.workItemId, "P04-07");
  assert.equal(manifest.phase, "P04");
  assert.equal(manifest.risk, "R2");
  assert.equal(manifest.status, "accepted-with-gaps");
  assert.deepEqual(manifest.featureIds, ["SET-07"]);
  assert.deepEqual(sorted(manifest.tests.map(({ id }) => id)), REQUIRED_TESTS);
  assert.deepEqual(sorted(manifest.evidence.map(({ id }) => id)), REQUIRED_EVIDENCE);
  assert.ok(manifest.tests.every(({ result }) => result === "passed"));
  assert.match(manifest.completedAt, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/u);
  for (const evidence of manifest.evidence) await access(path.join(ROOT, evidence.path));
  const assumptions = manifest.assumptions.join("\n");
  assert.match(assumptions, /local-fixture-verified only/u);
  assert.match(assumptions, /real OKX requests[^\n]*0/iu);
  assert.match(assumptions, /GAP-P04-OKX-LIVE/u);
  assert.match(assumptions, /production KMS\/IAM/iu);
  assert.match(assumptions, /independent security review/iu);
  assert.match(assumptions, /real read-only sandbox validation/iu);
  assert.match(assumptions, /not parity-verified/iu);
  assert.match(assumptions, /not released/iu);
});

test("P00 through P04-06 remain byte-identical to the frozen 568-file inventory", async () => {
  const inventory = parseChecksums(await readFile(PRIOR_CHECKSUMS, "utf8"), "prior checksums");
  const current = (await filesBelow(ACCEPTANCE_ROOT))
    .filter((file) => file === "README.md" || /^P0[0-4]-[^/]+\//u.test(file))
    .filter((file) => !file.startsWith("P04-07/"))
    .map((file) => `artifacts/acceptance/${file}`);
  assert.equal(inventory.length, 568);
  assert.deepEqual(
    inventory.map(({ path: value }) => value),
    current,
  );
  for (const row of inventory) {
    assert.equal(digest(await readFile(path.join(ROOT, row.path))), row.sha256, row.path);
  }
});

test("P04-07 sha256sums covers every evidence file exactly once", async () => {
  const rows = parseChecksums(
    await readFile(path.join(ACCEPTANCE, "sha256sums.txt"), "utf8"),
    "P04-07 checksums",
  );
  const files = (await filesBelow(ACCEPTANCE)).filter((file) => file !== "sha256sums.txt");
  assert.deepEqual(
    rows.map(({ path: value }) => value),
    files,
  );
  for (const row of rows) {
    assert.equal(digest(await readFile(path.join(ACCEPTANCE, row.path))), row.sha256, row.path);
  }
});

test("P04-07 visual and security evidence freezes a secret-free local-only run", async () => {
  for (const [file, width] of [
    ["okx-usable-chromium-desktop.png", 1440],
    ["okx-usable-chromium-mobile.png", 390],
  ]) {
    const imagePath = path.join(ACCEPTANCE, "E-VIS", file);
    assert.ok((await stat(imagePath)).size > 10_000, file);
    const bytes = await readFile(imagePath);
    assert.equal(bytes.readUInt32BE(16), width, file);
    assert.ok(bytes.readUInt32BE(20) >= 844, file);
  }
  const evidence = await Promise.all(
    ["E-API.md", "E-DATA.md", "E-OPS.md", "E-RBAC.md", "E-REC.md", "E-SEC.md", "E-UI.md"].map(
      (file) => readFile(path.join(ACCEPTANCE, file), "utf8"),
    ),
  ).then((parts) => parts.join("\n"));
  assert.match(evidence, /real OKX requests[^\n]*0/iu);
  assert.match(evidence, /https:\/\/www\.okx\.com:443/u);
  assert.match(evidence, /GAP-P04-OKX-LIVE/u);
  assert.match(evidence, /secret[^\n]*(?:logs|queues|audit|telemetry|screenshots)/iu);
});
