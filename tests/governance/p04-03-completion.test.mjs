import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { access, readFile, readdir } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(fileURLToPath(new URL("../..", import.meta.url)));
const BASELINE = "0b01bae2a68da75837711c9901f42ff266000a6c";
const ACCEPTANCE = path.join(ROOT, "artifacts/acceptance/P04-03");
const TRACEABILITY = path.join(ROOT, "docs/TRACEABILITY_MATRIX.md");
const ROADMAP = path.join(ROOT, "docs/DEVELOPMENT_ROADMAP.md");
const FUNCTION_MATRIX = path.join(ROOT, "docs/FUNCTION_MATRIX.md");
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
const IMPLEMENTED = ["WALLET-01", "WALLET-02", "WALLET-04", "WALLET-05", "WALLET-06"];
const REQUIRED_EVIDENCE = ["E-API", "E-DATA", "E-OPS", "E-RBAC", "E-REC", "E-SEC", "E-UI", "E-VIS"];
const REQUIRED_FILES = [
  ...REQUIRED_EVIDENCE.map((id) => `${id}.md`),
  "manifest.json",
  "sha256sums.txt",
];

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
    if (entry.isDirectory())
      files.push(...(await filesBelow(path.join(directory, entry.name), relative)));
    else if (entry.isFile()) files.push(relative);
    else assert.fail(`unsupported acceptance entry ${relative}`);
  }
  return sorted(files);
}

test("P04-03 implemented IDs remain attributed after later P04 work items", async () => {
  const [traceability, roadmap, functionMatrix] = await Promise.all([
    readFile(TRACEABILITY, "utf8"),
    readFile(ROADMAP, "utf8"),
    readFile(FUNCTION_MATRIX, "utf8"),
  ]);
  const rows = statusRows(traceability);
  assert.deepEqual(sorted(rows.keys()), sorted(FEATURE_IDS));
  for (const id of IMPLEMENTED) assert.equal(rows.get(id).status, "implemented-assumed", id);
  for (const id of ["WALLET-05", "WALLET-06"]) {
    assert.match(rows.get(id).evidence, /P04-03/u, id);
    assert.match(rows.get(id).evidence, /local-fixture-verified/u, id);
    assert.match(
      functionMatrix,
      new RegExp(`\\| ${id} \\|[^\\n]*implemented-assumed[^\\n]*P04-03`, "u"),
    );
  }
  assert.match(roadmap, /P04-03/u);
});

test("P04-03 manifest closes only WALLET-05 and WALLET-06 and remains accepted-with-gaps", async () => {
  const manifest = JSON.parse(await readFile(MANIFEST, "utf8"));
  assert.equal(manifest.workItemId, "P04-03");
  assert.equal(manifest.phase, "P04");
  assert.equal(manifest.risk, "R2");
  assert.equal(manifest.status, "accepted-with-gaps");
  assert.deepEqual(manifest.featureIds, ["WALLET-05", "WALLET-06"]);
  assert.deepEqual(sorted(manifest.evidence.map(({ id }) => id)), REQUIRED_EVIDENCE);
  assert.ok(manifest.tests.every(({ result }) => result === "passed"));
  assert.match(manifest.completedAt, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/u);
  const assumptions = manifest.assumptions.join("\n");
  assert.match(assumptions, /local-fixture-verified only/u);
  assert.match(assumptions, /signing.*0.*raw transaction.*0.*broadcast.*0.*external RPC.*0/iu);
  assert.match(assumptions, /accepted-with-gaps/u);
  assert.match(assumptions, /not custody-ready/iu);
  assert.match(assumptions, /not parity-verified/iu);
  assert.match(assumptions, /not released/iu);
  for (const evidence of manifest.evidence) await access(path.join(ROOT, evidence.path));
});

test("P00 through P04-02 acceptance files are byte-identical to the requested baseline", () => {
  const changed = execFileSync(
    "git",
    ["diff", "--name-only", BASELINE, "--", "artifacts/acceptance"],
    { cwd: ROOT, encoding: "utf8" },
  )
    .trim()
    .split("\n")
    .filter(Boolean)
    .filter(
      (file) =>
        !file.startsWith("artifacts/acceptance/P04-03/") &&
        !file.startsWith("artifacts/acceptance/P04-04/") &&
        !file.startsWith("artifacts/acceptance/P04-05/") &&
        !file.startsWith("artifacts/acceptance/P04-06/"),
    );
  assert.deepEqual(changed, []);
});

test("P04-03 required evidence and sha256 inventory are complete", async () => {
  const files = await filesBelow(ACCEPTANCE);
  for (const required of REQUIRED_FILES) assert.ok(files.includes(required), required);
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

test("P04-03 evidence records zero signing, raw transactions, broadcast, and external RPC", async () => {
  const evidence = await Promise.all(
    ["E-API.md", "E-OPS.md", "E-SEC.md"].map((file) =>
      readFile(path.join(ACCEPTANCE, file), "utf8"),
    ),
  ).then((parts) => parts.join("\n"));
  assert.match(evidence, /signing[^\n]*0/iu);
  assert.match(evidence, /raw transaction[^\n]*0/iu);
  assert.match(evidence, /broadcast[^\n]*0/iu);
  assert.match(evidence, /external RPC[^\n]*0/iu);
});
