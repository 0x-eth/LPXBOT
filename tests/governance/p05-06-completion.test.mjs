import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { access, readFile, readdir, stat } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(fileURLToPath(new URL("../..", import.meta.url)));
const BASELINE = "1bf9a68dfba1bb42ff558dfe3df1c5097ef6969a";
const ACCEPTANCE = path.join(ROOT, "artifacts/acceptance/P05-06");
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
  "HELPER-03",
  "HELPER-05",
  "HELPER-06",
];
const P05_06_NON_GOALS = ["POS-02", "POS-03", "HELPER-03", "HELPER-04", "HELPER-06"];
const CURRENT_PLANNED = ["HELPER-04"];
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
  "E-VIS/direct-succeeded-chromium-desktop.png",
  "E-VIS/direct-succeeded-chromium-mobile.png",
  "command-output.md",
  "execution-contract.json",
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
    assert.equal(rows.has(columns[0]), false, `duplicate status row ${columns[0]}`);
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

test("P05-06 owns SWAP-02 while P05-09 advances P05 to 11 / 1 with global 72 / 124", async () => {
  const [functionMatrix, traceability, roadmap] = await Promise.all([
    readFile(path.join(ROOT, "docs/FUNCTION_MATRIX.md"), "utf8"),
    readFile(path.join(ROOT, "docs/TRACEABILITY_MATRIX.md"), "utf8"),
    readFile(path.join(ROOT, "docs/DEVELOPMENT_ROADMAP.md"), "utf8"),
  ]);
  const rows = statusRows(traceability);
  assert.deepEqual(sorted(rows.keys()), sorted(FEATURE_IDS));
  assert.deepEqual(
    sorted([...rows].filter(([, row]) => row.status === "implemented-assumed").map(([id]) => id)),
    sorted(IMPLEMENTED),
  );
  assert.deepEqual(
    sorted([...rows].filter(([, row]) => row.status === "planned").map(([id]) => id)),
    sorted(CURRENT_PLANNED),
  );
  const swap = rows.get("SWAP-02");
  assert.match(swap.implementation, /local-swap-execution|local Registry/u);
  assert.match(swap.tests, /anvil-local-swap-execution/u);
  assert.match(swap.evidence, /P05-06/u);
  assert.match(functionMatrix, /\| SWAP-02 \|[^\n]*implemented-assumed[^\n]*P05-06/u);
  for (const document of [traceability, roadmap]) {
    assert.match(document, /P05[^\n]*11[^\n]*implemented-assumed[^\n]*1[^\n]*planned/iu);
    assert.match(document, /72[^\n]*implemented-assumed[^\n]*124[^\n]*planned/iu);
    assert.match(
      document,
      /testnet\/production[^\n]*CLOSED|testnet\/production gates[^\n]*`CLOSED`/iu,
    );
  }
  assert.match(traceability, /\| 当前产品实现 \| 72 \|/u);
  assert.match(traceability, /\| 其余 `planned` \| 124 \|/u);
});

test("P05-06 manifest, evidence inventory, visuals, and checksums are complete", async () => {
  const manifest = JSON.parse(await readFile(path.join(ACCEPTANCE, "manifest.json"), "utf8"));
  assert.equal(manifest.workItemId, "P05-06");
  assert.equal(manifest.phase, "P05");
  assert.equal(manifest.risk, "R4");
  assert.equal(manifest.status, "accepted-with-gaps");
  assert.deepEqual(manifest.featureIds, ["SWAP-02"]);
  assert.deepEqual(sorted(manifest.evidence.map(({ id }) => id)), EVIDENCE);
  assert.ok(manifest.tests.every(({ result }) => result === "passed"));
  assert.match(manifest.completedAt, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/u);
  for (const item of [...manifest.tests, ...manifest.evidence]) {
    await access(path.join(ROOT, item.evidencePath ?? item.path));
  }

  const files = await filesBelow(ACCEPTANCE);
  assert.deepEqual(files, sorted(REQUIRED_FILES));
  for (const [file, dimensions] of [
    ["direct-succeeded-chromium-desktop.png", [984, 640]],
    ["direct-succeeded-chromium-mobile.png", [358, 1165]],
  ]) {
    const imagePath = path.join(ACCEPTANCE, "E-VIS", file);
    assert.ok((await stat(imagePath)).size > 8_000, file);
    const bytes = await readFile(imagePath);
    assert.deepEqual([bytes.readUInt32BE(16), bytes.readUInt32BE(20)], dimensions, file);
  }
  const inventory = checksums(await readFile(path.join(ACCEPTANCE, "sha256sums.txt"), "utf8"));
  assert.deepEqual(
    inventory.map(({ path: file }) => file),
    files.filter((file) => file !== "sha256sums.txt"),
  );
  for (const row of inventory) {
    assert.equal(digest(await readFile(path.join(ACCEPTANCE, row.path))), row.sha256, row.path);
  }
});

test("execution contract and gates freeze local-only quote, authorization, and recovery", async () => {
  const [contract, gate] = await Promise.all([
    readFile(path.join(ACCEPTANCE, "execution-contract.json"), "utf8").then(JSON.parse),
    readFile(path.join(ACCEPTANCE, "execution-gate.json"), "utf8").then(JSON.parse),
  ]);
  assert.equal(contract.registry.chainId, 31_337);
  assert.equal(contract.registry.registryVersion, "p05-local-swap-execution-v2");
  assert.equal(contract.registry.quoteVersion, "p05-local-swap-quote-v2");
  assert.equal(contract.registry.planVersion, "p05-local-swap-plan-v2");
  assert.equal(contract.registry.productionInheritance, false);
  assert.equal(contract.registry.serviceFeeBps, 0);
  assert.equal(contract.bscBoundary.registryVersion, "p05-bsc-execution-v1");
  assert.equal(contract.bscBoundary.quoteExecutionEnabled, false);
  assert.deepEqual(contract.api.previewRequestFields, [
    "authorizationMode",
    "quoteDigest",
    "walletId",
  ]);
  assert.deepEqual(contract.steps.order, [
    "allowance-reset?",
    "approve",
    "swap",
    "cleanup-on-failure?",
  ]);
  for (const field of ["target", "router", "spender", "selector", "calldata"]) {
    assert.ok(contract.api.clientControlledFieldsDenied.includes(field));
  }
  assert.match(contract.authorization.direct.nonzeroMismatch, /reset-to-zero/u);
  assert.match(contract.recovery.approvalConfirmedSwapFailure, /reconciling/u);
  assert.deepEqual(contract.nonGoals, P05_06_NON_GOALS);
  assert.equal(contract.executionCounters.localOperations, 3);
  assert.equal(contract.executionCounters.localCanonicalStepReceipts, 7);
  assert.equal(contract.executionCounters.testnetSignatures, 0);
  assert.equal(contract.executionCounters.productionBroadcasts, 0);
  assert.equal(contract.executionCounters.realFundOperations, 0);

  assert.equal(gate.gates.local.status, "OPEN");
  assert.deepEqual(gate.gates.local.chainIds, [31_337]);
  assert.deepEqual(gate.gates.local.allowedOperations, ["SWAP-02:local-swap"]);
  assert.equal(gate.gates.bsc.status, "CLOSED");
  assert.equal(gate.gates.bsc.quoteExecutionEnabled, false);
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

test("evidence covers direct, Permit2, cleanup, recovery, injection, and adversarial contracts", async () => {
  const evidence = await Promise.all(
    [
      "E-API.md",
      "E-CHAIN.md",
      "E-DATA.md",
      "E-OPS.md",
      "E-RBAC.md",
      "E-REC.md",
      "E-SEC.md",
      "E-UI.md",
    ].map((file) => readFile(path.join(ACCEPTANCE, file), "utf8")),
  ).then((parts) => parts.join("\n"));
  for (const expression of [
    /direct success/iu,
    /Permit2 success/iu,
    /ALLOWANCE_CLEANUP_REQUIRED/u,
    /nonce drift/iu,
    /replacement/iu,
    /dropped/iu,
    /reorg/iu,
    /restart/iu,
    /target.*router.*spender.*selector.*calldata/isu,
    /false-return/iu,
    /no-return/iu,
    /fee-on-transfer/iu,
    /reentrancy/iu,
    /service fee 0/iu,
  ]) {
    assert.match(evidence, expression);
  }
});

test("P05-03, P05-04, and P05-05 acceptance are byte-identical to the requested baseline", async () => {
  for (const directory of ["P05-03", "P05-04", "P05-05"]) {
    const repositoryPath = `artifacts/acceptance/${directory}`;
    const baselineFiles = execFileSync(
      "git",
      ["ls-tree", "-r", "--name-only", BASELINE, "--", repositoryPath],
      { cwd: ROOT, encoding: "utf8" },
    )
      .trim()
      .split("\n")
      .filter(Boolean)
      .sort((left, right) => left.localeCompare(right));
    const currentFiles = (await filesBelow(path.join(ROOT, repositoryPath))).map(
      (file) => `${repositoryPath}/${file}`,
    );
    assert.deepEqual(currentFiles, baselineFiles, directory);
    for (const file of baselineFiles) {
      const baselineBytes = execFileSync("git", ["show", `${BASELINE}:${file}`], {
        cwd: ROOT,
        encoding: null,
        maxBuffer: 64 * 1024 * 1024,
      });
      assert.deepEqual(await readFile(path.join(ROOT, file)), baselineBytes, file);
    }
  }
});
