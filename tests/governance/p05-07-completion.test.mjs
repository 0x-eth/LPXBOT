import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { access, readFile, readdir, stat } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(fileURLToPath(new URL("../..", import.meta.url)));
const BASELINE = "c71791936d6382879e4c8342c50852030de9ab18";
const ACCEPTANCE = path.join(ROOT, "artifacts/acceptance/P05-07");
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
const PLANNED = ["HELPER-04"];
const P05_07_NON_GOALS = ["HELPER-03", "HELPER-04", "HELPER-06"];
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
  "E-VIS/remove-succeeded-chromium-desktop.png",
  "E-VIS/remove-succeeded-chromium-mobile.png",
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

test("P05-07 owns POS-02/POS-03 while P05-09 advances P05 to 11 / 1 with global 72 / 124", async () => {
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
    sorted(PLANNED),
  );
  for (const id of ["POS-02", "POS-03"]) {
    const row = rows.get(id);
    assert.match(row.implementation, /local-position-execution|local Position Registry/u, id);
    assert.match(row.tests, /anvil-local-position-execution/u, id);
    assert.match(row.evidence, /P05-07/u, id);
    assert.match(row.evidence, /local-fixture-verified/u, id);
    assert.match(
      functionMatrix,
      new RegExp(`\\| ${id} \\|[^\\n]*implemented-assumed[^\\n]*P05-07`, "u"),
    );
  }
  for (const document of [traceability, roadmap]) {
    assert.match(document, /P05[^\n]*11[^\n]*implemented-assumed[^\n]*1[^\n]*planned/iu);
    assert.match(document, /72[^\n]*implemented-assumed[^\n]*124[^\n]*planned/iu);
    assert.match(document, /accepted-with-gaps/u);
    assert.match(document, /BSC\/testnet\/production[^\n]*(?:均为 0|CLOSED|closed)/iu);
    assert.match(document, /not parity-verified|不标记 `parity-verified`/iu);
    assert.match(document, /not released|不标记[^\n]*`released`/iu);
  }
  assert.match(traceability, /\| 当前产品实现 \| 72 \|/u);
  assert.match(traceability, /\| `implemented-assumed` \| 72 \|/u);
  assert.match(traceability, /\| 其余 `planned` \| 124 \|/u);
});

test("P05-07 manifest, evidence inventory, visuals, and checksums are complete", async () => {
  const manifest = JSON.parse(await readFile(path.join(ACCEPTANCE, "manifest.json"), "utf8"));
  assert.equal(manifest.workItemId, "P05-07");
  assert.equal(manifest.phase, "P05");
  assert.equal(manifest.risk, "R4");
  assert.equal(manifest.status, "accepted-with-gaps");
  assert.deepEqual(manifest.featureIds, ["POS-02", "POS-03"]);
  assert.deepEqual(sorted(manifest.evidence.map(({ id }) => id)), EVIDENCE);
  assert.ok(manifest.tests.every(({ result }) => result === "passed"));
  assert.match(manifest.completedAt, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/u);
  for (const item of [...manifest.tests, ...manifest.evidence]) {
    await access(path.join(ROOT, item.evidencePath ?? item.path));
  }

  const files = await filesBelow(ACCEPTANCE);
  assert.deepEqual(files, sorted(REQUIRED_FILES));
  for (const [file, dimensions] of [
    ["remove-succeeded-chromium-desktop.png", [984, 648]],
    ["remove-succeeded-chromium-mobile.png", [358, 1206]],
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

test("execution contract and gates freeze local-only position execution", async () => {
  const [contract, gate] = await Promise.all([
    readFile(path.join(ACCEPTANCE, "execution-contract.json"), "utf8").then(JSON.parse),
    readFile(path.join(ACCEPTANCE, "execution-gate.json"), "utf8").then(JSON.parse),
  ]);
  assert.deepEqual(contract.featureIds, ["POS-02", "POS-03"]);
  assert.equal(contract.registry.chainId, 31_337);
  assert.equal(contract.registry.registryVersion, "p05-local-position-execution-v2");
  assert.equal(contract.registry.snapshotVersion, "p05-local-position-snapshot-v2");
  assert.equal(contract.registry.planVersion, "p05-local-position-plan-v2");
  assert.equal(contract.registry.productionInheritance, false);
  assert.equal(contract.registry.serviceFeeBps, 0);
  assert.equal(contract.registry.manager.address, "0xa513e6e4b8f2a923d98304ec87f64353c4d5c853");
  assert.equal(
    contract.registry.manager.runtimeCodeHash,
    "0x6218a887ec7babb0af09bf8e4c71880954fcfeb5872b055e2f858f146bb25106",
  );
  assert.deepEqual(contract.registry.manager.selectors, {
    burn: "0x42966c68",
    collect: "0xfc6f7865",
    decreaseLiquidity: "0x0c49ccbe",
  });
  assert.deepEqual(contract.registry.platforms, [
    { generation: "v3", platformId: 1 },
    { generation: "v3", platformId: 2 },
    { generation: "v4", platformId: 4 },
    { generation: "v4", platformId: 5 },
  ]);
  assert.deepEqual(contract.api.collectPreviewRequestFields, [
    "platformId",
    "snapshotDigest",
    "tokenId",
    "walletId",
  ]);
  assert.deepEqual(contract.api.removePreviewRequestFields, [
    "burnIfEmpty",
    "percent",
    "platformId",
    "slippageBps",
    "snapshotDigest",
    "tokenId",
    "walletId",
  ]);
  for (const field of [
    "manager",
    "target",
    "selector",
    "calldata",
    "recipient",
    "liquidityDelta",
    "amount0Max",
    "amount1Max",
    "amount0Min",
    "amount1Min",
    "fee",
  ]) {
    assert.ok(contract.api.clientControlledFieldsDenied.includes(field), field);
  }
  assert.deepEqual(contract.steps.collectFees, ["collect"]);
  assert.deepEqual(contract.steps.partialRemove, ["decrease", "collect"]);
  assert.deepEqual(contract.steps.fullRemoveWithBurn, ["decrease", "collect", "burn"]);
  assert.match(contract.recovery.decreaseConfirmed, /never replayed|禁止重复/u);
  assert.match(contract.recovery.collectPending, /principal[^\n]*unavailable|本金[^\n]*不可用/iu);
  assert.deepEqual(contract.nonGoals, P05_07_NON_GOALS);
  assert.equal(contract.executionCounters.testnetSignatures, 0);
  assert.equal(contract.executionCounters.productionBroadcasts, 0);
  assert.equal(contract.executionCounters.realFundOperations, 0);

  assert.equal(gate.gates.local.status, "OPEN");
  assert.deepEqual(gate.gates.local.chainIds, [31_337]);
  assert.deepEqual(gate.gates.local.allowedOperations, [
    "POS-02:local-position-collect-fees",
    "POS-03:local-position-remove-liquidity",
  ]);
  assert.equal(gate.gates.bsc.status, "CLOSED");
  assert.equal(gate.gates.bsc.readOnly, true);
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

test("evidence covers platform, recovery, injection, RBAC, and UI requirements", async () => {
  const evidence = await Promise.all(
    EVIDENCE.map((id) => readFile(path.join(ACCEPTANCE, `${id}.md`), "utf8")),
  ).then((parts) => parts.join("\n"));
  for (const expression of [
    /platform(?:s)? 1\/2\/4\/5|平台 1\/2\/4\/5/iu,
    /1\/25\/50\/99\/100/iu,
    /zero liquidity delta|零 liquidity delta/iu,
    /stale.*reorg.*changed snapshot/isu,
    /owner.*approval.*manager code hash/isu,
    /zero-owed.*canonical.*idempotent|零余额.*canonical.*幂等/isu,
    /decrease[^\n]*collect[^\n]*fail/iu,
    /collect[^\n]*burn[^\n]*fail/iu,
    /replacement/iu,
    /dropped/iu,
    /restart/iu,
    /provider divergence/iu,
    /manager.*target.*selector.*calldata.*recipient.*liquidityDelta/isu,
    /amount0Max.*amount1Max.*amount0Min.*amount1Min.*fee/isu,
    /non-owner.*unknown NFT.*wrong platform.*malicious manager.*token/isu,
    /tenant.*user.*wallet/isu,
    /desktop.*mobile.*keyboard.*Axe.*visual/isu,
    /service fee 0/iu,
  ]) {
    assert.match(evidence, expression);
  }
});

test("P05-02 through P05-06 acceptance are byte-identical to the requested baseline", async () => {
  for (const directory of ["P05-02", "P05-03", "P05-04", "P05-05", "P05-06"]) {
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

test("existing Manager, Adapter, and Helper sources remain unchanged", () => {
  assert.doesNotThrow(() =>
    execFileSync(
      "git",
      [
        "diff",
        "--quiet",
        BASELINE,
        "--",
        "contracts/src/TestOnlyPositionManager.sol",
        "contracts/src/LocalExecutionAdapter.sol",
        "contracts/src/WalletHelperV1.sol",
        "foundry.toml",
      ],
      { cwd: ROOT },
    ),
  );
  const changed = execFileSync("git", ["diff", "--name-only", BASELINE, "--", "contracts"], {
    cwd: ROOT,
    encoding: "utf8",
  })
    .trim()
    .split("\n")
    .filter(Boolean);
  assert.deepEqual(changed, [
    "contracts/src/TestOnlyPositionManagerV2.sol",
    "contracts/src/WalletHelperV2.sol",
    "contracts/test/TestOnlyPositionManagerV2.t.sol",
    "contracts/test/WalletHelperV2.t.sol",
  ]);
});
