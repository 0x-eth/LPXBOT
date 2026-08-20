import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { access, readFile, readdir, stat } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(fileURLToPath(new URL("../..", import.meta.url)));
const BASELINE = "ad695e0afbcbc84096a9b97ee48e6161031305cc";
const ACCEPTANCE = path.join(ROOT, "artifacts/acceptance/P05-05");
const P05_04 = path.join(ROOT, "artifacts/acceptance/P05-04");
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
const P05_05_IMPLEMENTED = ["SWAP-01", "POS-01", "POS-04", "HELPER-01", "HELPER-02", "HELPER-05"];
const P05_05_NON_GOALS = ["SWAP-02", "POS-02", "POS-03", "HELPER-03", "HELPER-04", "HELPER-06"];
const CURRENT_IMPLEMENTED = ["SWAP-02", "POS-02", "POS-03", "HELPER-06", ...P05_05_IMPLEMENTED];
const CURRENT_PLANNED = P05_05_NON_GOALS.filter(
  (id) => !["SWAP-02", "POS-02", "POS-03", "HELPER-06"].includes(id),
);
const EVIDENCE = [
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
const REQUIRED_FILES = [
  ...EVIDENCE.map((id) => `${id}.md`),
  "E-VIS/helper-preview-chromium-desktop.png",
  "E-VIS/helper-preview-chromium-mobile.png",
  "E-VIS/helper-succeeded-chromium-desktop.png",
  "E-VIS/helper-succeeded-chromium-mobile.png",
  "command-output.md",
  "deployment-contract.json",
  "execution-gate.json",
  "initial-failure.md",
  "manifest.json",
  "sha256sums.txt",
];

function digest(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

function sorted(values) {
  return [...values].sort((left, right) => left.localeCompare(right));
}

async function filesBelow(directory, prefix = "") {
  const files = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const relative = path.posix.join(prefix, entry.name);
    if (entry.isDirectory())
      files.push(...(await filesBelow(path.join(directory, entry.name), relative)));
    else if (entry.isFile()) files.push(relative);
  }
  return sorted(files);
}

function p05Rows(markdown) {
  const section = markdown
    .split("<!-- P05_STATUS_TABLE_START -->")[1]
    ?.split("<!-- P05_STATUS_TABLE_END -->")[0];
  assert.ok(section);
  const rows = new Map();
  for (const line of section.split("\n")) {
    if (!line.startsWith("|") || !FEATURE_IDS.some((id) => line.startsWith(`| ${id} |`))) continue;
    const columns = line
      .split("|")
      .slice(1, -1)
      .map((value) => value.trim());
    rows.set(columns[0], {
      evidence: columns[4],
      implementation: columns[2],
      status: columns[1].replaceAll("`", ""),
      tests: columns[3],
    });
  }
  return rows;
}

function checksums(source) {
  return source
    .trimEnd()
    .split("\n")
    .map((line) => {
      const match = /^([0-9a-f]{64}) {2}(.+)$/u.exec(line);
      assert.ok(match, line);
      return { path: match[2], sha256: match[1] };
    });
}

test("P05-05 owns HELPER-02 while P05-08 advances P05 to 10 / 2 and global 71 / 125", async () => {
  const [functionMatrix, traceability, roadmap] = await Promise.all([
    readFile(path.join(ROOT, "docs/FUNCTION_MATRIX.md"), "utf8"),
    readFile(path.join(ROOT, "docs/TRACEABILITY_MATRIX.md"), "utf8"),
    readFile(path.join(ROOT, "docs/DEVELOPMENT_ROADMAP.md"), "utf8"),
  ]);
  const rows = p05Rows(traceability);
  assert.deepEqual(sorted(rows.keys()), sorted(FEATURE_IDS));
  assert.deepEqual(
    sorted([...rows].filter(([, row]) => row.status === "implemented-assumed").map(([id]) => id)),
    sorted(CURRENT_IMPLEMENTED),
  );
  assert.deepEqual(
    sorted([...rows].filter(([, row]) => row.status === "planned").map(([id]) => id)),
    sorted(CURRENT_PLANNED),
  );
  const helper = rows.get("HELPER-02");
  assert.match(helper.implementation, /helper-deployment|Helper deployment/u);
  assert.match(helper.tests, /anvil-helper-deployment/u);
  assert.match(helper.evidence, /P05-05/u);
  assert.match(functionMatrix, /\| HELPER-02 \|[^\n]*implemented-assumed[^\n]*P05-05/u);
  for (const document of [traceability, roadmap]) {
    assert.match(document, /P05[^\n]*10[^\n]*implemented-assumed[^\n]*2[^\n]*planned/iu);
    assert.match(document, /71[^\n]*implemented-assumed[^\n]*125[^\n]*planned/iu);
    assert.match(
      document,
      /testnet\/production[^\n]*CLOSED|testnet\/production gates[^\n]*`CLOSED`/iu,
    );
  }
});

test("P05-05 manifest, evidence inventory, screenshots, and checksums are complete", async () => {
  const manifest = JSON.parse(await readFile(path.join(ACCEPTANCE, "manifest.json"), "utf8"));
  assert.equal(manifest.workItemId, "P05-05");
  assert.equal(manifest.phase, "P05");
  assert.equal(manifest.risk, "R4");
  assert.equal(manifest.status, "accepted-with-gaps");
  assert.deepEqual(manifest.featureIds, ["HELPER-02"]);
  assert.deepEqual(sorted(manifest.evidence.map(({ id }) => id)), EVIDENCE);
  assert.ok(manifest.tests.every(({ result }) => result === "passed"));
  for (const item of [...manifest.tests, ...manifest.evidence])
    await access(path.join(ROOT, item.evidencePath ?? item.path));

  const files = await filesBelow(ACCEPTANCE);
  assert.deepEqual(files, sorted(REQUIRED_FILES));
  for (const [file, dimensions] of [
    ["helper-preview-chromium-desktop.png", [680, 476]],
    ["helper-preview-chromium-mobile.png", [370, 694]],
    ["helper-succeeded-chromium-desktop.png", [984, 247]],
    ["helper-succeeded-chromium-mobile.png", [358, 461]],
  ]) {
    const imagePath = path.join(ACCEPTANCE, "E-VIS", file);
    assert.ok((await stat(imagePath)).size > 3_000, file);
    const bytes = await readFile(imagePath);
    assert.deepEqual([bytes.readUInt32BE(16), bytes.readUInt32BE(20)], dimensions, file);
  }
  const rows = checksums(await readFile(path.join(ACCEPTANCE, "sha256sums.txt"), "utf8"));
  assert.deepEqual(
    rows.map(({ path: file }) => file),
    files.filter((file) => file !== "sha256sums.txt"),
  );
  for (const row of rows)
    assert.equal(digest(await readFile(path.join(ACCEPTANCE, row.path))), row.sha256, row.path);
});

test("deployment contract and execution gates freeze the local-only CREATE boundary", async () => {
  const [contract, gate] = await Promise.all([
    readFile(path.join(ACCEPTANCE, "deployment-contract.json"), "utf8").then(JSON.parse),
    readFile(path.join(ACCEPTANCE, "execution-gate.json"), "utf8").then(JSON.parse),
  ]);
  assert.equal(contract.registry.chainId, 31337);
  assert.equal(contract.registry.productionInheritance, false);
  assert.equal(contract.registry.instanceBinding, "chainId+walletId+helperVersion");
  assert.equal(contract.template.bytecodeAcceptedFromClient, false);
  assert.equal(contract.transaction.type, "CREATE");
  assert.equal(contract.transaction.to, null);
  assert.equal(contract.transaction.valueBaseUnit, "0");
  assert.deepEqual(contract.nonGoals, P05_05_NON_GOALS);
  for (const key of ["target", "selector", "calldata", "bytecode"])
    assert.ok(contract.api.clientControlledFieldsDenied.includes(key));
  assert.equal(contract.executionCounters.testnetSignatures, 0);
  assert.equal(contract.executionCounters.testnetBroadcasts, 0);
  assert.equal(contract.executionCounters.productionSignatures, 0);
  assert.equal(contract.executionCounters.productionBroadcasts, 0);
  assert.equal(contract.executionCounters.realFundOperations, 0);
  assert.equal(gate.gates.local.status, "OPEN");
  assert.deepEqual(gate.gates.local.chainIds, [31337]);
  assert.equal(gate.gates.testnet.status, "CLOSED");
  assert.equal(gate.gates.production.status, "CLOSED");
  assert.equal(gate.gates.testnet.signatures + gate.gates.testnet.broadcasts, 0);
  assert.equal(
    gate.gates.production.signatures +
      gate.gates.production.broadcasts +
      gate.gates.production.realFundOperations,
    0,
  );
});

test("P05-04 acceptance is byte-identical to the requested baseline", async () => {
  const baselineFiles = execFileSync(
    "git",
    ["ls-tree", "-r", "--name-only", BASELINE, "--", "artifacts/acceptance/P05-04"],
    { cwd: ROOT, encoding: "utf8" },
  )
    .trim()
    .split("\n")
    .filter(Boolean);
  const currentFiles = (await filesBelow(P05_04)).map(
    (file) => `artifacts/acceptance/P05-04/${file}`,
  );
  assert.deepEqual(sorted(currentFiles), sorted(baselineFiles));
  for (const file of baselineFiles) {
    const baselineBytes = execFileSync("git", ["show", `${BASELINE}:${file}`], {
      cwd: ROOT,
      encoding: null,
      maxBuffer: 64 * 1024 * 1024,
    });
    assert.deepEqual(await readFile(path.join(ROOT, file)), baselineBytes, file);
  }
});
