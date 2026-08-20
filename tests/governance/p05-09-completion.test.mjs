import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { access, readFile, readdir, stat } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(fileURLToPath(new URL("../..", import.meta.url)));
const BASELINE = "9e520339f7c3a975a7f5d4370a28ee0ca59a28bb";
const ACCEPTANCE = path.join(ROOT, "artifacts/acceptance/P05-09");
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
const IMPLEMENTED = FEATURE_IDS.filter((id) => id !== "HELPER-04");
const PLANNED = ["HELPER-04"];
const CURSORS = [
  "preflight",
  "deploy-v2",
  "verify-v2",
  "sweep-v1",
  "final-rescan-v1",
  "atomic-binding-switch",
  "completed",
];
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
  "E-VIS/upgrade-completed-chromium-desktop.png",
  "E-VIS/upgrade-completed-chromium-mobile.png",
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

test("P05-09 owns HELPER-03 and advances P05 to 11 / 1 with global 72 / 124", async () => {
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
  const helper = rows.get("HELPER-03");
  assert.match(helper.implementation, /WalletHelperV2|local-helper-upgrade/u);
  assert.match(helper.tests, /anvil-local-helper-upgrade/u);
  assert.match(helper.evidence, /P05-09/u);
  assert.match(helper.evidence, /local-fixture-verified/u);
  assert.match(functionMatrix, /\| HELPER-03 \|[^\n]*implemented-assumed[^\n]*P05-09/u);
  assert.match(functionMatrix, /\| HELPER-04 \|[^\n]*planned/u);
  for (const document of [traceability, roadmap]) {
    assert.match(document, /P05[^\n]*11[^\n]*implemented-assumed[^\n]*1[^\n]*planned/iu);
    assert.match(document, /72[^\n]*implemented-assumed[^\n]*124[^\n]*planned/iu);
    assert.match(document, /accepted-with-gaps/u);
    assert.match(document, /atomic liquidity[^\n]*(?:CLOSED|closed)/iu);
    assert.match(document, /not parity-verified|不标记 `parity-verified`/iu);
    assert.match(document, /not released|不标记[^\n]*`released`/iu);
  }
  assert.match(traceability, /\| 当前产品实现 \| 72 \|/u);
  assert.match(traceability, /\| `implemented-assumed` \| 72 \|/u);
  assert.match(traceability, /\| 其余 `planned` \| 124 \|/u);
});

test("P05-09 manifest, evidence inventory, visuals, and checksums are complete", async () => {
  const manifest = JSON.parse(await readFile(path.join(ACCEPTANCE, "manifest.json"), "utf8"));
  assert.equal(manifest.workItemId, "P05-09");
  assert.equal(manifest.phase, "P05");
  assert.equal(manifest.risk, "R4");
  assert.equal(manifest.status, "accepted-with-gaps");
  assert.deepEqual(manifest.featureIds, ["HELPER-03"]);
  assert.deepEqual(sorted(manifest.evidence.map(({ id }) => id)), EVIDENCE);
  assert.ok(manifest.tests.every(({ result }) => result === "passed"));
  assert.match(manifest.completedAt, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/u);
  for (const item of [...manifest.tests, ...manifest.evidence]) {
    await access(path.join(ROOT, item.evidencePath ?? item.path));
  }

  const files = await filesBelow(ACCEPTANCE);
  assert.deepEqual(files, sorted(REQUIRED_FILES));
  for (const [file, dimensions] of [
    ["upgrade-completed-chromium-desktop.png", [984, 694]],
    ["upgrade-completed-chromium-mobile.png", [358, 1311]],
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

test("execution contract freezes deploy-new identities, selectors, cursors, and gates", async () => {
  const [contract, gate] = await Promise.all([
    readFile(path.join(ACCEPTANCE, "execution-contract.json"), "utf8").then(JSON.parse),
    readFile(path.join(ACCEPTANCE, "execution-gate.json"), "utf8").then(JSON.parse),
  ]);
  assert.deepEqual(contract.featureIds, ["HELPER-03"]);
  assert.equal(contract.registry.chainId, 31_337);
  assert.equal(contract.registry.registryVersion, "p05-local-helper-upgrade-v3");
  assert.equal(contract.registry.snapshotVersion, "p05-local-helper-upgrade-snapshot-v3");
  assert.equal(contract.registry.planVersion, "p05-local-helper-upgrade-plan-v3");
  assert.equal(
    contract.registry.registryDigest,
    "sha256:5b588c0d214067e7759f9a0c3a7e053d3cea50f8910873aba76bc54cd73753b1",
  );
  assert.equal(contract.registry.productionInheritance, false);
  assert.equal(contract.registry.serviceFeeBps, 0);
  assert.deepEqual(
    contract.registry.components.map(({ role }) => role),
    ["adapter", "permit2"],
  );
  assert.deepEqual(
    contract.registry.tokens.map(({ fixture }) => fixture),
    ["TestOnlyERC20", "TestOnlyWBNB"],
  );
  assert.equal(
    contract.registry.target.abiHash,
    "sha256:e7c79a2f0882dc97d19a42e5fe3868ae986e08817b2aed4c66d1f55fcdb16219",
  );
  assert.equal(
    contract.registry.target.creationCodeHash,
    "0xed00df31c585db148d0a25bb5db4d982e762b9bd59f5bfea5b78ba2fe15e9063",
  );
  assert.equal(
    contract.registry.target.runtimeTemplateHash,
    "0x972616e68e263322b1b5b69f9f55a34d76c1ea6915cc622059c14a01c537e8f5",
  );
  assert.equal(contract.registry.target.runtimeBytes, 8_633);
  assert.equal(contract.registry.target.selectors.length, 18);
  assert.equal(
    new Set(contract.registry.target.selectors.map(({ selector }) => selector)).size,
    18,
  );
  assert.ok(
    contract.registry.target.selectors.some(
      ({ selector, signature }) =>
        selector === "0xe25f4c85" && signature.startsWith("executeAtomicLiquidity("),
    ),
  );
  assert.equal(contract.registry.target.atomicLiquidity.executionEnabled, false);
  assert.equal(contract.registry.target.atomicLiquidity.gate, "CLOSED");
  assert.equal(contract.upgrade.model, "deploy-new");
  assert.equal(contract.upgrade.proxy, false);
  assert.deepEqual(contract.upgrade.cursors, CURSORS);
  assert.equal(contract.bindingSwitch.isolation, "SERIALIZABLE");
  assert.deepEqual(contract.replacement.mutableFields, ["maxFeePerGas", "maxPriorityFeePerGas"]);
  assert.deepEqual(contract.api.previewRequestFields, ["chainId", "walletId"]);
  assert.deepEqual(contract.api.submitRequestFields, [
    "chainId",
    "previewDigest",
    "previewToken",
    "walletId",
  ]);
  for (const field of [
    "bytecode",
    "helper",
    "target",
    "selector",
    "calldata",
    "recipient",
    "registryOverride",
    "feeOverride",
  ]) {
    assert.ok(contract.api.clientControlledFieldsDenied.includes(field), field);
  }
  assert.deepEqual(contract.v1Supersede.manualRecoveryBlockers, [
    "NON_ZERO_ALLOWANCE",
    "NFT_CUSTODY",
    "UNKNOWN_TOKEN",
  ]);
  assert.match(contract.recovery.confirmedDeployment, /never sign or broadcast again/u);
  assert.match(contract.recovery.confirmedSweep, /never create or replay/u);
  assert.equal(contract.executionCounters.bscSignatures, 0);
  assert.equal(contract.executionCounters.testnetBroadcasts, 0);
  assert.equal(contract.executionCounters.productionBroadcasts, 0);
  assert.equal(contract.executionCounters.realFundOperations, 0);

  assert.equal(gate.gates.local.status, "OPEN");
  assert.deepEqual(gate.gates.local.chainIds, [31_337]);
  assert.deepEqual(gate.gates.local.allowedOperations, [
    "HELPER-03:local-helper-deploy-new-upgrade",
  ]);
  assert.equal(gate.gates.local.proxy, false);
  assert.equal(gate.gates.atomicLiquidity.status, "CLOSED");
  assert.equal(gate.gates.bsc.status, "CLOSED");
  assert.equal(gate.gates.bsc.readOnly, true);
  assert.equal(gate.gates.testnet.status, "CLOSED");
  assert.equal(gate.gates.production.status, "CLOSED");
  assert.deepEqual(gate.plannedOnly, PLANNED);
});

test("source freezes V2 safety, strict ingress, no-replay recovery, and atomic binding CAS", async () => {
  const [artifact, registry, domain, helper, api, client, recovery, migration] = await Promise.all([
    readFile(path.join(ROOT, "packages/chain-registry/src/wallet-helper-v2-artifact.ts"), "utf8"),
    readFile(path.join(ROOT, "packages/chain-registry/src/local-helper-upgrade.ts"), "utf8"),
    readFile(path.join(ROOT, "packages/domain/src/local-helper-upgrade.ts"), "utf8"),
    readFile(path.join(ROOT, "contracts/src/WalletHelperV2.sol"), "utf8"),
    readFile(path.join(ROOT, "apps/api/src/local-helper-upgrades.ts"), "utf8"),
    readFile(path.join(ROOT, "apps/web/src/local-helper-upgrade-client.ts"), "utf8"),
    readFile(path.join(ROOT, "apps/worker/src/postgres-local-helper-upgrade-recovery.ts"), "utf8"),
    readFile(
      path.join(ROOT, "infra/migrations/20260821000100_create_local_helper_upgrade.sql"),
      "utf8",
    ),
  ]);
  const contract = JSON.parse(
    await readFile(path.join(ACCEPTANCE, "execution-contract.json"), "utf8"),
  );
  const selectorSection = artifact
    .split("export const WALLET_HELPER_V2_SELECTORS = ")[1]
    ?.split("] as const;")[0];
  assert.ok(selectorSection);
  const selectors = [
    ...selectorSection.matchAll(/selector: "(0x[0-9a-f]+)",\s*signature:\s*"([^"]+)"/gs),
  ].map(([, selector, signature]) => ({ selector, signature }));
  assert.deepEqual(selectors, contract.registry.target.selectors);
  assert.match(artifact, /WALLET_HELPER_V2_RUNTIME_BYTES = 8633 as const/u);
  assert.match(registry, /p05-local-helper-upgrade-v3/u);
  assert.match(registry, /Object\.values\(registry\.gates\).*atomicLiquidity/isu);
  assert.match(
    domain,
    /"preflight"[\s\S]*"deploy-v2"[\s\S]*"verify-v2"[\s\S]*"sweep-v1"[\s\S]*"final-rescan-v1"[\s\S]*"atomic-binding-switch"[\s\S]*"completed"/u,
  );
  assert.match(domain, /NON_ZERO_ALLOWANCE[\s\S]*NFT_CUSTODY[\s\S]*UNKNOWN_TOKEN/u);
  assert.match(helper, /address public immutable owner/u);
  assert.match(helper, /address public immutable adapter/u);
  assert.match(helper, /address public immutable permit2/u);
  assert.match(helper, /ATOMIC_LIQUIDITY_EXECUTION_ENABLED = false/u);
  assert.match(helper, /modifier onlyOwner\(\)/u);
  assert.match(helper, /modifier nonReentrant\(\)/u);
  assert.match(helper, /serviceFeeBps != 0/u);
  assert.match(helper, /recipient: owner[\s\S]*refundRecipient: owner/u);
  assert.match(api, /exact\(value, \["chainId", "walletId"\]\)/u);
  assert.match(api, /exact\(value, \["chainId", "previewDigest", "previewToken", "walletId"\]\)/u);
  assert.match(
    client,
    /body: JSON\.stringify\(\{\s*chainId: 31_337,\s*walletId: request\.walletId/isu,
  );
  assert.match(recovery, /continue at verify-v2|operation\.cursor !== "verify-v2"/iu);
  assert.match(recovery, /operation\.cursor !== "final-rescan-v1"/u);
  assert.match(recovery, /SET state = 'superseded'/u);
  assert.match(recovery, /SET state = 'active'/u);
  assert.match(recovery, /"SERIALIZABLE"/u);
  assert.match(migration, /wallet_helper_deployment_bindings_active_unique/u);
  assert.match(migration, /WHERE state = 'active'/u);
});

test("evidence covers deploy, cleanup, recovery, security, RBAC, and UI requirements", async () => {
  const evidence = await Promise.all(
    EVIDENCE.map((id) => readFile(path.join(ACCEPTANCE, `${id}.md`), "utf8")),
  ).then((parts) => parts.join("\n"));
  for (const expression of [
    /WalletHelperV1.*WalletHelperV2/isu,
    /deploy-new/iu,
    /preflight.*deploy-v2.*verify-v2.*sweep-v1.*final-rescan-v1.*atomic-binding-switch.*completed/isu,
    /owner.*runtime.*Registry.*nonce/isu,
    /adapter.*Permit2.*Token identities/isu,
    /allowance.*NFT custody.*unknown Token/isu,
    /manual-recovery-required/iu,
    /confirmed.*never.*replay|without signing or deployment observation/isu,
    /replacement.*fee-only|fee-only.*replacement/isu,
    /SERIALIZABLE.*compare-and-swap/isu,
    /one active binding/iu,
    /bytecode.*helper.*target.*selector.*calldata.*recipient.*Registry override.*fee override/isu,
    /tenant.*user.*wallet/isu,
    /desktop.*mobile.*keyboard.*Axe/isu,
    /atomic liquidity.*CLOSED/isu,
    /BSC.*testnet.*production/isu,
  ]) {
    assert.match(evidence, expression);
  }
});

test("P05-02 through P05-08 acceptance are byte-identical to the requested baseline", async () => {
  for (const directory of ["P05-02", "P05-03", "P05-04", "P05-05", "P05-06", "P05-07", "P05-08"]) {
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

test("WalletHelperV1 source and compiler boundary remain unchanged", () => {
  assert.doesNotThrow(() =>
    execFileSync(
      "git",
      ["diff", "--quiet", BASELINE, "--", "contracts/src/WalletHelperV1.sol", "foundry.toml"],
      { cwd: ROOT },
    ),
  );
});
