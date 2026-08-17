import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { access, readFile, readdir } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const ACCEPTANCE = path.join(ROOT, "artifacts/acceptance/P03-03");
const MANIFEST = path.join(ACCEPTANCE, "manifest.json");
const PRIOR_CHECKSUMS = path.join(ACCEPTANCE, "prior-acceptance-sha256s.txt");
const TRACEABILITY = path.join(ROOT, "docs/TRACEABILITY_MATRIX.md");
const FEATURE_IDS = [
  ...Array.from({ length: 6 }, (_, index) => `MON-${String(index + 1).padStart(2, "0")}`),
  ...Array.from({ length: 2 }, (_, index) => `NOTIFY-${String(index + 1).padStart(2, "0")}`),
];
const IMPLEMENTED = FEATURE_IDS;
const PLANNED = [];
const P03_03_FEATURES = ["MON-04", "NOTIFY-01", "NOTIFY-02"];
const EVIDENCE_IDS = ["E-API", "E-DATA", "E-RBAC", "E-REC", "E-SEC", "E-UI", "E-VIS"];
const TEST_IDS = ["T-API", "T-MIG", "T-REC", "T-SEC", "T-UI", "T-UNIT", "T-VIS"];

function sorted(values) {
  return [...values].sort();
}

function digest(value) {
  return createHash("sha256").update(value).digest("hex");
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

function statusRows(markdown) {
  const section = markdown.match(
    /<!-- P03_STATUS_TABLE_START -->([\s\S]*?)<!-- P03_STATUS_TABLE_END -->/u,
  );
  assert.ok(section, "TRACEABILITY_MATRIX is missing the P03 status table");
  const rows = new Map();
  for (const line of section[1].split("\n")) {
    const columns = line
      .split("|")
      .slice(1, -1)
      .map((value) => value.trim());
    if (!FEATURE_IDS.includes(columns[0])) continue;
    assert.equal(rows.has(columns[0]), false, `duplicate P03 status row ${columns[0]}`);
    rows.set(columns[0], {
      evidence: columns[4],
      implementation: columns[2],
      status: columns[1].replaceAll("`", ""),
      tests: columns[3],
    });
  }
  return rows;
}

test("P03 status is exactly 8 implemented-assumed / 0 planned with global 49 / 147", async () => {
  const markdown = await readFile(TRACEABILITY, "utf8");
  const rows = statusRows(markdown);
  assert.deepEqual(sorted(rows.keys()), sorted(FEATURE_IDS));
  assert.deepEqual(
    sorted([...rows].filter(([, row]) => row.status === "implemented-assumed").map(([id]) => id)),
    sorted(IMPLEMENTED),
  );
  assert.deepEqual(
    sorted([...rows].filter(([, row]) => row.status === "planned").map(([id]) => id)),
    sorted(PLANNED),
  );
  for (const id of IMPLEMENTED) assert.match(rows.get(id).evidence, /local-fixture-verified/u, id);
  for (const id of PLANNED) {
    assert.equal(rows.get(id).implementation, "—", `${id} implementation`);
    assert.equal(rows.get(id).tests, "—", `${id} tests`);
    assert.match(rows.get(id).evidence, /frozen reference only/u, id);
  }
  assert.match(markdown, /P03[^\n]*8[^\n]*implemented-assumed[^\n]*0[^\n]*planned/iu);
  assert.match(markdown, /当前产品实现\s*\|\s*49\s*\|/u);
  assert.match(markdown, /`implemented-assumed`\s*\|\s*49\s*\|/u);
  assert.match(markdown, /其余\s*`planned`\s*\|\s*147\s*\|/u);
  assert.match(markdown, /live Telegram\/Webhook delivery/u);
  assert.match(markdown, /delivery SLO/u);
});

test("P03-03 manifest owns three features and only local-fixture evidence", async () => {
  const manifest = JSON.parse(await readFile(MANIFEST, "utf8"));
  assert.equal(manifest.workItemId, "P03-03");
  assert.equal(manifest.phase, "P03");
  assert.equal(manifest.risk, "R1");
  assert.equal(manifest.status, "accepted-with-gaps");
  assert.deepEqual(manifest.featureIds, P03_03_FEATURES);
  assert.deepEqual(sorted(manifest.tests.map(({ id }) => id)), TEST_IDS);
  assert.deepEqual(sorted(manifest.evidence.map(({ id }) => id)), EVIDENCE_IDS);
  assert.ok(manifest.tests.every(({ result }) => result === "passed"));
  assert.match(manifest.completedAt, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/u);
  assert.match(manifest.commit, /^[0-9a-f]{40}$/u);
  for (const evidence of manifest.evidence) await access(path.join(ROOT, evidence.path));
  const assumptions = manifest.assumptions.join("\n");
  assert.match(assumptions, /local-fixture-verified only/u);
  assert.match(assumptions, /local-sink:\/\/p03-01/u);
  assert.match(assumptions, /no DNS, Telegram, Webhook/u);
  assert.match(assumptions, /MON-05 and MON-06 remain planned/u);
  assert.match(assumptions, /P00 through P03-02 acceptance artifacts remain byte-identical/u);
  assert.doesNotMatch(assumptions, /parity-verified|released/u);
});

test("P00 through P03-02 remain byte-identical to the frozen 434-file inventory", async () => {
  const inventory = parseChecksums(await readFile(PRIOR_CHECKSUMS, "utf8"), "prior checksums");
  const current = (await filesBelow(path.join(ROOT, "artifacts/acceptance")))
    .filter(
      (file) => file === "README.md" || /^(?:P0[0-2]-[^/]+|P03-0[12])\//u.test(file),
    )
    .map((file) => `artifacts/acceptance/${file}`);
  assert.equal(inventory.length, 434);
  assert.deepEqual(
    inventory.map(({ path: value }) => value),
    current,
  );
  for (const row of inventory) {
    assert.equal(digest(await readFile(path.join(ROOT, row.path))), row.sha256, row.path);
  }
});

test("P03-03 sha256sums covers every evidence file exactly once", async () => {
  const rows = parseChecksums(
    await readFile(path.join(ACCEPTANCE, "sha256sums.txt"), "utf8"),
    "P03-03 checksums",
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
