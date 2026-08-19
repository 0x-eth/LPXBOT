import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { access, readFile, readdir, stat } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(fileURLToPath(new URL("../..", import.meta.url)));
const BASELINE = "7de9f5c6bd687965cdc275d41f2971909dc56efc";
const ACCEPTANCE = path.join(ROOT, "artifacts/acceptance/P05-02");
const ACCEPTANCE_ROOT = path.join(ROOT, "artifacts/acceptance");
const FUNCTION_MATRIX = path.join(ROOT, "docs/FUNCTION_MATRIX.md");
const TRACEABILITY = path.join(ROOT, "docs/TRACEABILITY_MATRIX.md");
const ROADMAP = path.join(ROOT, "docs/DEVELOPMENT_ROADMAP.md");
const MANIFEST = path.join(ACCEPTANCE, "manifest.json");
const FEATURE_IDS = [
  "SWAP-01",
  "SWAP-02",
  "POS-01",
  "POS-02",
  "POS-03",
  "POS-04",
  "HELPER-01",
  "HELPER-02",
  "HELPER-03",
  "HELPER-04",
  "HELPER-05",
  "HELPER-06",
];
const IMPLEMENTED = ["POS-01", "HELPER-01", "HELPER-05"];
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

function parseChecksums(source) {
  const rows = source
    .trimEnd()
    .split("\n")
    .map((line, index) => {
      const match = /^([0-9a-f]{64}) {2}(.+)$/u.exec(line);
      assert.ok(match, `sha256sums line ${index + 1}`);
      return { path: match[2], sha256: match[1] };
    });
  assert.equal(new Set(rows.map(({ path: value }) => value)).size, rows.length);
  return rows;
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

function statusRows(markdown) {
  const rows = new Map();
  const section =
    markdown
      .split("<!-- P05_STATUS_TABLE_START -->")[1]
      ?.split("<!-- P05_STATUS_TABLE_END -->")[0] ?? "";
  for (const line of section.split("\n")) {
    if (!line.startsWith("|")) continue;
    const columns = line
      .split("|")
      .slice(1, -1)
      .map((value) => value.trim());
    if (!FEATURE_IDS.includes(columns[0])) continue;
    assert.equal(rows.has(columns[0]), false, `duplicate P05 status row ${columns[0]}`);
    rows.set(columns[0], {
      evidence: columns[4],
      implementation: columns[2],
      status: columns[1].replaceAll("`", ""),
      tests: columns[3],
    });
  }
  return rows;
}

test("P05 closes P05-02 at 3 implemented-assumed / 9 planned with global 64 / 132", async () => {
  const [functionMatrix, traceability, roadmap] = await Promise.all([
    readFile(FUNCTION_MATRIX, "utf8"),
    readFile(TRACEABILITY, "utf8"),
    readFile(ROADMAP, "utf8"),
  ]);
  const rows = statusRows(traceability);
  assert.deepEqual(sorted(rows.keys()), sorted(FEATURE_IDS));
  assert.deepEqual(
    sorted([...rows].filter(([, row]) => row.status === "implemented-assumed").map(([id]) => id)),
    sorted(IMPLEMENTED),
  );
  assert.deepEqual(
    sorted([...rows].filter(([, row]) => row.status === "planned").map(([id]) => id)),
    sorted(FEATURE_IDS.filter((id) => !IMPLEMENTED.includes(id))),
  );
  for (const id of IMPLEMENTED) {
    const row = rows.get(id);
    assert.match(row.implementation, /position|helper|residual/iu, id);
    assert.match(row.tests, /p05-/u, id);
    assert.match(row.evidence, /P05-02/u, id);
    assert.match(row.evidence, /local-fixture-verified/u, id);
    assert.match(
      functionMatrix,
      new RegExp(`\\| ${id} \\|[^\\n]*implemented-assumed[^\\n]*P05-02`, "u"),
    );
  }
  for (const document of [traceability, roadmap]) {
    assert.match(document, /P05[^\n]*3[^\n]*implemented-assumed[^\n]*9[^\n]*planned/iu);
    assert.match(document, /accepted-with-gaps/u);
    assert.match(document, /not parity-verified|不标记 `parity-verified`/iu);
    assert.match(document, /not released|不标记[^\n]*`released`/iu);
  }
  assert.match(traceability, /\| 当前产品实现 \| 64 \|/u);
  assert.match(traceability, /\| `implemented-assumed` \| 64 \|/u);
  assert.match(traceability, /\| 其余 `planned` \| 132 \|/u);
  assert.match(roadmap, /全局为 64 项 `implemented-assumed`、132 项 `planned`/u);
});

test("P05-02 manifest owns only POS-01, HELPER-01, and HELPER-05", async () => {
  const manifest = JSON.parse(await readFile(MANIFEST, "utf8"));
  assert.equal(manifest.workItemId, "P05-02");
  assert.equal(manifest.phase, "P05");
  assert.equal(manifest.risk, "R1");
  assert.equal(manifest.status, "accepted-with-gaps");
  assert.deepEqual(manifest.featureIds, IMPLEMENTED);
  assert.deepEqual(sorted(manifest.tests.map(({ id }) => id)), REQUIRED_TESTS);
  assert.deepEqual(sorted(manifest.evidence.map(({ id }) => id)), REQUIRED_EVIDENCE);
  assert.ok(manifest.tests.every(({ result }) => result === "passed"));
  assert.match(manifest.completedAt, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/u);
  for (const evidence of manifest.evidence) await access(path.join(ROOT, evidence.path));
  const assumptions = manifest.assumptions.join("\n");
  assert.match(assumptions, /local-fixture-verified only/iu);
  assert.match(assumptions, /production RPC runner[^\n]*unresolved/iu);
  assert.match(assumptions, /allowlist[^\n]*coverage[^\n]*unresolved/iu);
  assert.match(assumptions, /not parity-verified/iu);
  assert.match(assumptions, /not released/iu);
});

test("P00 through P05-01 acceptance files remain byte-identical to the 645-file baseline", async () => {
  const baselineFiles = execFileSync(
    "git",
    ["ls-tree", "-r", "--name-only", BASELINE, "--", "artifacts/acceptance"],
    { cwd: ROOT, encoding: "utf8" },
  )
    .trim()
    .split("\n")
    .filter(Boolean);
  const currentPriorFiles = (await filesBelow(ACCEPTANCE_ROOT))
    .filter((file) => !file.startsWith("P05-02/"))
    .map((file) => `artifacts/acceptance/${file}`);
  assert.equal(baselineFiles.length, 645);
  assert.deepEqual(currentPriorFiles, sorted(baselineFiles));
  const changed = execFileSync(
    "git",
    ["diff", "--name-only", BASELINE, "--", "artifacts/acceptance"],
    { cwd: ROOT, encoding: "utf8" },
  )
    .trim()
    .split("\n")
    .filter(Boolean)
    .filter((file) => !file.startsWith("artifacts/acceptance/P05-02/"));
  assert.deepEqual(changed, []);
});

test("P05-02 required evidence and sha256 inventory are complete", async () => {
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
  for (const row of rows) {
    assert.equal(digest(await readFile(path.join(ACCEPTANCE, row.path))), row.sha256, row.path);
  }
});

test("P05-02 visual and chain evidence freezes the read-only boundary", async () => {
  for (const [file, width] of [
    ["position-helper-ready-chromium-desktop.png", 1440],
    ["position-helper-ready-chromium-mobile.png", 390],
  ]) {
    const imagePath = path.join(ACCEPTANCE, "E-VIS", file);
    assert.ok((await stat(imagePath)).size > 8_000, file);
    const bytes = await readFile(imagePath);
    assert.equal(bytes.readUInt32BE(16), width, file);
    assert.ok(bytes.readUInt32BE(20) >= 844, file);
  }
  const evidence = await Promise.all(
    ["E-API.md", "E-CHAIN.md", "E-OPS.md", "E-RBAC.md", "E-REC.md", "E-SEC.md"].map((file) =>
      readFile(path.join(ACCEPTANCE, file), "utf8"),
    ),
  ).then((parts) => parts.join("\n"));
  for (const method of [
    "eth_call",
    "eth_getCode",
    "eth_getLogs",
    "eth_getBalance",
    "eth_blockNumber",
    "eth_getBlockByNumber",
    "eth_getBlockByHash",
  ]) {
    assert.match(evidence, new RegExp(method, "u"));
  }
  assert.match(evidence, /signing[^\n]*0/iu);
  assert.match(evidence, /broadcast[^\n]*0/iu);
  assert.match(evidence, /deployment[^\n]*0/iu);
  assert.match(evidence, /upgrade[^\n]*0/iu);
  assert.match(evidence, /sweep[^\n]*0/iu);
  assert.match(evidence, /chain writes[^\n]*0/iu);
  assert.match(evidence, /real-fund operations[^\n]*0/iu);
  assert.doesNotMatch(evidence, /READY_FOR_APPROVAL/u);
});
