import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { access, readFile, readdir } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const ACCEPTANCE = path.join(ROOT, "artifacts/acceptance/P03-04");
const MANIFEST = path.join(ACCEPTANCE, "manifest.json");
const PRIOR_CHECKSUMS = path.join(ACCEPTANCE, "prior-acceptance-sha256s.txt");
const REQUIRED_EVIDENCE = [
  "E-API",
  "E-DATA",
  "E-OPS",
  "E-RBAC",
  "E-REC",
  "E-SEC",
  "E-UI",
  "E-VIS",
];
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
    if (entry.isDirectory()) files.push(...(await filesBelow(path.join(directory, entry.name), relative)));
    else if (entry.isFile()) files.push(relative);
    else assert.fail(`unsupported acceptance entry ${relative}`);
  }
  return sorted(files);
}

test("P03-04 manifest closes MON-05 and MON-06 with local fixture evidence", async () => {
  const manifest = JSON.parse(await readFile(MANIFEST, "utf8"));
  assert.equal(manifest.workItemId, "P03-04");
  assert.equal(manifest.phase, "P03");
  assert.equal(manifest.risk, "R2");
  assert.equal(manifest.status, "accepted-with-gaps");
  assert.deepEqual(manifest.featureIds, ["MON-05", "MON-06"]);
  assert.deepEqual(sorted(manifest.tests.map(({ id }) => id)), REQUIRED_TESTS);
  assert.deepEqual(sorted(manifest.evidence.map(({ id }) => id)), REQUIRED_EVIDENCE);
  assert.ok(manifest.tests.every(({ result }) => result === "passed"));
  assert.match(manifest.completedAt, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/u);
  assert.match(manifest.commit, /^[0-9a-f]{40}$/u);
  for (const evidence of manifest.evidence) await access(path.join(ROOT, evidence.path));
  const assumptions = manifest.assumptions.join("\n");
  assert.match(assumptions, /local-fixture-verified only/u);
  assert.match(assumptions, /zero real DNS, HTTP, TLS, or Telegram calls/iu);
  assert.match(assumptions, /active TVL/u);
  assert.match(assumptions, /Fee\/aTVL/u);
  assert.match(assumptions, /target UI parity/u);
  assert.match(assumptions, /live Telegram\/Webhook delivery/u);
  assert.match(assumptions, /delivery SLO/u);
  assert.match(assumptions, /retention/u);
  assert.doesNotMatch(assumptions, /parity-verified|released/u);
});

test("P00 through P03-03 remain byte-identical to the frozen 448-file inventory", async () => {
  const inventory = parseChecksums(await readFile(PRIOR_CHECKSUMS, "utf8"), "prior checksums");
  const current = (await filesBelow(path.join(ROOT, "artifacts/acceptance")))
    .filter((file) => !file.startsWith("P03-04/"))
    .map((file) => `artifacts/acceptance/${file}`);
  assert.equal(inventory.length, 448);
  assert.deepEqual(
    inventory.map(({ path: value }) => value),
    current,
  );
  for (const row of inventory) {
    assert.equal(digest(await readFile(path.join(ROOT, row.path))), row.sha256, row.path);
  }
});

test("P03-04 sha256sums covers every evidence file exactly once", async () => {
  const rows = parseChecksums(
    await readFile(path.join(ACCEPTANCE, "sha256sums.txt"), "utf8"),
    "P03-04 checksums",
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
