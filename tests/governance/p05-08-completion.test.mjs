import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { access, readFile, readdir, stat } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(fileURLToPath(new URL("../..", import.meta.url)));
const BASELINE = "7123512a720ad983bee2f9aee095f663fefc474f";
const ACCEPTANCE = path.join(ROOT, "artifacts/acceptance/P05-08");
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
const IMPLEMENTED = FEATURE_IDS.filter((id) => !["HELPER-03", "HELPER-04"].includes(id));
const PLANNED = ["HELPER-03", "HELPER-04"];
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
  "E-VIS/sweep-succeeded-chromium-desktop.png",
  "E-VIS/sweep-succeeded-chromium-mobile.png",
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

test("P05-08 owns HELPER-06 and advances P05 to 10 / 2 with global 71 / 125", async () => {
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
    PLANNED,
  );
  const helper = rows.get("HELPER-06");
  assert.match(helper.implementation, /local-helper-sweep|local sweep Registry/u);
  assert.match(helper.tests, /anvil-local-helper-sweep/u);
  assert.match(helper.evidence, /P05-08/u);
  assert.match(helper.evidence, /local-fixture-verified/u);
  assert.match(functionMatrix, /\| HELPER-06 \|[^\n]*implemented-assumed[^\n]*P05-08/u);
  for (const document of [traceability, roadmap]) {
    assert.match(document, /P05[^\n]*10[^\n]*implemented-assumed[^\n]*2[^\n]*planned/iu);
    assert.match(document, /71[^\n]*implemented-assumed[^\n]*125[^\n]*planned/iu);
    assert.match(document, /accepted-with-gaps/u);
    assert.match(document, /BSC\/testnet\/production[^\n]*(?:`CLOSED`|closed)/iu);
    assert.match(document, /not parity-verified|不标记 `parity-verified`/iu);
    assert.match(document, /not released|不标记[^\n]*`released`/iu);
  }
  assert.match(traceability, /\| 当前产品实现 \| 71 \|/u);
  assert.match(traceability, /\| `implemented-assumed` \| 71 \|/u);
  assert.match(traceability, /\| 其余 `planned` \| 125 \|/u);
});

test("P05-08 manifest, evidence inventory, visuals, and checksums are complete", async () => {
  const manifest = JSON.parse(await readFile(path.join(ACCEPTANCE, "manifest.json"), "utf8"));
  assert.equal(manifest.workItemId, "P05-08");
  assert.equal(manifest.phase, "P05");
  assert.equal(manifest.risk, "R4");
  assert.equal(manifest.status, "accepted-with-gaps");
  assert.deepEqual(manifest.featureIds, ["HELPER-06"]);
  assert.deepEqual(sorted(manifest.evidence.map(({ id }) => id)), EVIDENCE);
  assert.ok(manifest.tests.every(({ result }) => result === "passed"));
  assert.match(manifest.completedAt, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/u);
  for (const item of [...manifest.tests, ...manifest.evidence]) {
    await access(path.join(ROOT, item.evidencePath ?? item.path));
  }

  const files = await filesBelow(ACCEPTANCE);
  assert.deepEqual(files, sorted(REQUIRED_FILES));
  for (const [file, dimensions] of [
    ["sweep-succeeded-chromium-desktop.png", [984, 674]],
    ["sweep-succeeded-chromium-mobile.png", [358, 1330]],
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

test("execution contract and gates freeze local-only Helper sweep", async () => {
  const [contract, gate] = await Promise.all([
    readFile(path.join(ACCEPTANCE, "execution-contract.json"), "utf8").then(JSON.parse),
    readFile(path.join(ACCEPTANCE, "execution-gate.json"), "utf8").then(JSON.parse),
  ]);
  assert.deepEqual(contract.featureIds, ["HELPER-06"]);
  assert.equal(contract.registry.chainId, 31_337);
  assert.equal(contract.registry.registryVersion, "p05-local-helper-sweep-v2");
  assert.equal(contract.registry.snapshotVersion, "p05-local-helper-residual-snapshot-v2");
  assert.equal(contract.registry.planVersion, "p05-local-helper-sweep-plan-v2");
  assert.equal(
    contract.registry.registryDigest,
    "sha256:aa8f99d0f123310fd87f16f562fbbf41b3651af35198dcf12fe76f99a3cdce30",
  );
  assert.equal(contract.registry.productionInheritance, false);
  assert.equal(contract.registry.serviceFeeBps, 0);
  assert.deepEqual(contract.registry.helper.selectors, {
    owner: "0x8da5cb5b",
    sweepNative: "0x6971b189",
    sweepToken: "0x3609afa9",
  });
  assert.deepEqual(
    contract.registry.components.map(({ role }) => role),
    ["adapter", "manager", "permit2", "router"],
  );
  assert.deepEqual(
    contract.registry.tokens.map(({ fixture }) => fixture),
    ["TestOnlyERC20", "TestOnlyWBNB"],
  );
  assert.deepEqual(contract.registry.dustPolicy, {
    comparison: "balance>dust",
    nativeDustBaseUnit: "1000",
    postSweep: "balance<=dust",
    tokenDustBaseUnit: "1",
    zeroBalance: "omit-operation",
  });
  assert.deepEqual(contract.api.previewRequestFields, [
    "assetIds",
    "chainId",
    "snapshotDigest",
    "walletId",
  ]);
  assert.deepEqual(contract.api.sweepRequestFields, [
    "assetIds",
    "chainId",
    "previewDigest",
    "previewToken",
    "snapshotDigest",
    "walletId",
  ]);
  for (const field of [
    "helper",
    "token",
    "target",
    "selector",
    "calldata",
    "amount",
    "recipient",
    "fee",
  ]) {
    assert.ok(contract.api.clientControlledFieldsDenied.includes(field), field);
  }
  assert.match(contract.operation.tokenCalldata, /sweepToken/u);
  assert.match(contract.operation.nativeCalldata, /sweepNative/u);
  assert.deepEqual(contract.replacement.mutableFields, ["maxFeePerGas", "maxPriorityFeePerGas"]);
  assert.match(contract.recovery.confirmedAsset, /never replay/u);
  assert.deepEqual(contract.manualRecovery.conditions, [
    "nonzero allowance",
    "Helper NFT custody",
    "unknown Token residual",
  ]);
  assert.equal(contract.executionCounters.localSignatures, 6);
  assert.equal(contract.executionCounters.localCanonicalReceipts, 6);
  assert.equal(contract.executionCounters.bscSignatures, 0);
  assert.equal(contract.executionCounters.productionBroadcasts, 0);
  assert.equal(contract.executionCounters.realFundOperations, 0);

  assert.equal(gate.gates.local.status, "OPEN");
  assert.deepEqual(gate.gates.local.chainIds, [31_337]);
  assert.deepEqual(gate.gates.local.allowedOperations, ["HELPER-06:local-helper-residual-sweep"]);
  assert.equal(gate.gates.bsc.status, "CLOSED");
  assert.equal(gate.gates.bsc.readOnly, true);
  assert.equal(gate.gates.testnet.status, "CLOSED");
  assert.equal(gate.gates.production.status, "CLOSED");
  assert.deepEqual(gate.plannedOnly, PLANNED);
});

test("evidence covers scan, batch, recovery, injection, RBAC, and UI requirements", async () => {
  const evidence = await Promise.all(
    EVIDENCE.map((id) => readFile(path.join(ACCEPTANCE, `${id}.md`), "utf8")),
  ).then((parts) => parts.join("\n"));
  for (const expression of [
    /TestOnlyERC20.*WBNB.*native|native.*TestOnlyERC20.*WBNB/isu,
    /dust boundary|dust.*zero balance|dust.*零/iu,
    /duplicate assetId/iu,
    /changed.*reorged.*snapshot|changed\/reorged snapshot/isu,
    /replacement/iu,
    /dropped/iu,
    /restart/iu,
    /provider.diverg/iu,
    /Transfer\(helper, owner, amount\)/iu,
    /gas-adjusted|gas reconciliation/iu,
    /owner.*runtime.*binding.*Registry/isu,
    /allowance.*NFT custody.*unknown Token/isu,
    /confirmed.*never replay|successful asset.*never replay/isu,
    /helper.*token.*target.*selector.*calldata.*amount.*recipient.*fee/isu,
    /tenant.*user.*wallet.*cross-wallet/isu,
    /degraded.*Swap.*funding/isu,
    /desktop.*mobile.*keyboard.*Axe.*visual/isu,
    /BSC.*read-only/isu,
  ]) {
    assert.match(evidence, expression);
  }
});

test("P05-02 through P05-07 acceptance are byte-identical to the requested baseline", async () => {
  for (const directory of ["P05-02", "P05-03", "P05-04", "P05-05", "P05-06", "P05-07"]) {
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

test("P05-05 WalletHelperV1 source and compiler boundary remain unchanged", () => {
  assert.doesNotThrow(() =>
    execFileSync(
      "git",
      ["diff", "--quiet", BASELINE, "--", "contracts/src/WalletHelperV1.sol", "foundry.toml"],
      { cwd: ROOT },
    ),
  );
});
