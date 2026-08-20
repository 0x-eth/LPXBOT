import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { access, readFile, readdir, stat } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(fileURLToPath(new URL("../..", import.meta.url)));
const BASELINE = "fc43cdf67a564ccbd794ea9bf393bb89fa5ae845";
const ACCEPTANCE = path.join(ROOT, "artifacts/acceptance/P05-03");
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
const IMPLEMENTED = [
  "SWAP-01",
  "SWAP-02",
  "POS-01",
  "POS-02",
  "POS-03",
  "POS-04",
  "HELPER-01",
  "HELPER-02",
  "HELPER-05",
  "HELPER-06",
];
const OWNED = ["SWAP-01", "POS-04"];
const REQUIRED_EVIDENCE = [
  "E-API",
  "E-CHAIN",
  "E-DATA",
  "E-OPS",
  "E-RBAC",
  "E-REC",
  "E-SEC",
  "E-SSE",
  "E-UI",
  "E-VIS",
];
const REQUIRED_TESTS = [
  "T-API",
  "T-CHAIN",
  "T-MIG",
  "T-REC",
  "T-SEC",
  "T-SSE",
  "T-UI",
  "T-UNIT",
  "T-VIS",
];

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

test("P05-03 ownership stays frozen at P05-08 current status 10 / 2 and global 71 / 125", async () => {
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
  for (const id of OWNED) {
    const row = rows.get(id);
    assert.match(row.implementation, /quote|pricing|position|swap|台账/iu, id);
    assert.match(row.tests, /p05-/u, id);
    assert.match(row.evidence, /P05-03/u, id);
    assert.match(row.evidence, /local-fixture-verified/u, id);
    assert.match(
      functionMatrix,
      new RegExp(`\\| ${id} \\|[^\\n]*implemented-assumed[^\\n]*P05-03`, "u"),
    );
  }
  for (const document of [traceability, roadmap]) {
    assert.match(document, /P05[^\n]*10[^\n]*implemented-assumed[^\n]*2[^\n]*planned/iu);
    assert.match(document, /accepted-with-gaps/u);
    assert.match(document, /not parity-verified|不标记 `parity-verified`/iu);
    assert.match(document, /not released|不标记[^\n]*`released`/iu);
  }
  assert.match(traceability, /\| 当前产品实现 \| 71 \|/u);
  assert.match(traceability, /\| `implemented-assumed` \| 71 \|/u);
  assert.match(traceability, /\| 其余 `planned` \| 125 \|/u);
  assert.match(roadmap, /全局为 71 项 `implemented-assumed`、125 项 `planned`/u);
});

test("P05-03 manifest owns only SWAP-01 and POS-04", async () => {
  const manifest = JSON.parse(await readFile(MANIFEST, "utf8"));
  assert.equal(manifest.workItemId, "P05-03");
  assert.equal(manifest.phase, "P05");
  assert.equal(manifest.risk, "R1");
  assert.equal(manifest.status, "accepted-with-gaps");
  assert.deepEqual(manifest.featureIds, OWNED);
  assert.deepEqual(sorted(manifest.tests.map(({ id }) => id)), REQUIRED_TESTS);
  assert.deepEqual(sorted(manifest.evidence.map(({ id }) => id)), REQUIRED_EVIDENCE);
  assert.ok(manifest.tests.every(({ result }) => result === "passed"));
  assert.match(manifest.completedAt, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/u);
  for (const evidence of manifest.evidence) await access(path.join(ROOT, evidence.path));
  const assumptions = manifest.assumptions.join("\n");
  assert.match(assumptions, /local-fixture-verified only/iu);
  assert.match(assumptions, /production quote source[^\n]*unconfigured/iu);
  assert.match(assumptions, /not parity-verified/iu);
  assert.match(assumptions, /not released/iu);
});

test("P00 through P05-02 acceptance files remain byte-identical to the 660-file baseline", async () => {
  const baselineFiles = execFileSync(
    "git",
    ["ls-tree", "-r", "--name-only", BASELINE, "--", "artifacts/acceptance"],
    { cwd: ROOT, encoding: "utf8" },
  )
    .trim()
    .split("\n")
    .filter(Boolean);
  const currentPriorFiles = (await filesBelow(ACCEPTANCE_ROOT))
    .filter(
      (file) =>
        !file.startsWith("P05-03/") &&
        !file.startsWith("P05-04/") &&
        !file.startsWith("P05-05/") &&
        !file.startsWith("P05-06/") &&
        !file.startsWith("P05-07/") &&
        !file.startsWith("P05-08/"),
    )
    .map((file) => `artifacts/acceptance/${file}`);
  assert.equal(baselineFiles.length, 660);
  assert.deepEqual(currentPriorFiles, sorted(baselineFiles));
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
        !file.startsWith("artifacts/acceptance/P05-03/") &&
        !file.startsWith("artifacts/acceptance/P05-04/") &&
        !file.startsWith("artifacts/acceptance/P05-05/") &&
        !file.startsWith("artifacts/acceptance/P05-06/") &&
        !file.startsWith("artifacts/acceptance/P05-07/") &&
        !file.startsWith("artifacts/acceptance/P05-08/"),
    );
  assert.deepEqual(changed, []);
});

test("P05-03 required evidence, screenshots, and sha256 inventory are complete", async () => {
  const files = await filesBelow(ACCEPTANCE);
  for (const required of [
    ...REQUIRED_EVIDENCE.map((id) => `${id}.md`),
    "E-VIS/swap-pricing-chromium-desktop.png",
    "E-VIS/swap-pricing-chromium-mobile.png",
    "command-output.md",
    "initial-failure.md",
    "manifest.json",
    "sha256sums.txt",
  ]) {
    assert.ok(files.includes(required), required);
  }
  for (const [file, width] of [
    ["swap-pricing-chromium-desktop.png", 1440],
    ["swap-pricing-chromium-mobile.png", 390],
  ]) {
    const imagePath = path.join(ACCEPTANCE, "E-VIS", file);
    assert.ok((await stat(imagePath)).size > 8_000, file);
    const bytes = await readFile(imagePath);
    assert.equal(bytes.readUInt32BE(16), width, file);
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

test("P05-03 evidence freezes the observation-only boundary", async () => {
  const evidence = await Promise.all(
    REQUIRED_EVIDENCE.map((id) => readFile(path.join(ACCEPTANCE, `${id}.md`), "utf8")),
  ).then((parts) => parts.join("\n"));
  for (const counter of [
    "signing",
    "broadcast",
    "chain writes",
    "real-fund operations",
    "production calldata generation",
  ]) {
    assert.match(evidence, new RegExp(`${counter}[^\\n]*0`, "iu"), counter);
  }
  assert.match(evidence, /router selector allowlist[^\n]*empty/iu);
  assert.match(evidence, /raw calldata[^\n]*(?:never|not|0)/iu);
  assert.match(evidence, /Last-Event-ID/u);
  assert.match(evidence, /tenantId\+userId/u);
});
