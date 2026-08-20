#!/usr/bin/env node
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readdir, readFile, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const ACCEPTANCE = path.join(ROOT, "artifacts/acceptance/P05-09");
const BASELINE = "9e520339f7c3a975a7f5d4370a28ee0ca59a28bb";
const FROZEN = ["P05-02", "P05-03", "P05-04", "P05-05", "P05-06", "P05-07", "P05-08"];
const CURSORS = [
  "preflight",
  "deploy-v2",
  "verify-v2",
  "sweep-v1",
  "final-rescan-v1",
  "atomic-binding-switch",
  "completed",
];
const REQUIRED = [
  "E-API.md",
  "E-CHAIN.md",
  "E-DATA.md",
  "E-OPS.md",
  "E-RBAC.md",
  "E-REC.md",
  "E-SEC.md",
  "E-UI.md",
  "E-VIS.md",
  "E-VIS/upgrade-completed-chromium-desktop.png",
  "E-VIS/upgrade-completed-chromium-mobile.png",
  "command-output.md",
  "execution-contract.json",
  "execution-gate.json",
  "initial-failure.md",
  "manifest.json",
].sort((left, right) => left.localeCompare(right));

async function filesBelow(directory, prefix = "", omitChecksums = false) {
  const files = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const relative = path.posix.join(prefix, entry.name);
    if (entry.isDirectory()) {
      files.push(...(await filesBelow(path.join(directory, entry.name), relative, omitChecksums)));
    } else if (entry.isFile() && (!omitChecksums || relative !== "sha256sums.txt")) {
      files.push(relative);
    } else if (!entry.isFile()) {
      throw new Error(`unsupported acceptance entry: ${relative}`);
    }
  }
  return files.sort((left, right) => left.localeCompare(right));
}

function digest(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

for (const directory of FROZEN) {
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
  if (JSON.stringify(currentFiles) !== JSON.stringify(baselineFiles)) {
    throw new Error(`${directory} acceptance inventory differs from ${BASELINE}`);
  }
  for (const file of baselineFiles) {
    const baselineBytes = execFileSync("git", ["show", `${BASELINE}:${file}`], {
      cwd: ROOT,
      encoding: null,
      maxBuffer: 64 * 1024 * 1024,
    });
    const currentBytes = await readFile(path.join(ROOT, file));
    if (!currentBytes.equals(baselineBytes)) {
      throw new Error(`${file} differs byte-for-byte from ${BASELINE}`);
    }
  }
}

execFileSync(
  "git",
  ["diff", "--quiet", BASELINE, "--", "contracts/src/WalletHelperV1.sol", "foundry.toml"],
  { cwd: ROOT },
);

const files = await filesBelow(ACCEPTANCE, "", true);
if (JSON.stringify(files) !== JSON.stringify(REQUIRED)) {
  const missing = REQUIRED.filter((file) => !files.includes(file));
  const unexpected = files.filter((file) => !REQUIRED.includes(file));
  throw new Error(
    `P05-09 acceptance inventory mismatch; missing=${missing.join(",")}; unexpected=${unexpected.join(",")}`,
  );
}

const [contract, gate, manifest] = await Promise.all(
  ["execution-contract.json", "execution-gate.json", "manifest.json"].map((file) =>
    readFile(path.join(ACCEPTANCE, file), "utf8").then(JSON.parse),
  ),
);
if (
  JSON.stringify(contract.featureIds) !== JSON.stringify(["HELPER-03"]) ||
  contract.registry.chainId !== 31_337 ||
  contract.registry.registryVersion !== "p05-local-helper-upgrade-v3" ||
  contract.registry.snapshotVersion !== "p05-local-helper-upgrade-snapshot-v3" ||
  contract.registry.planVersion !== "p05-local-helper-upgrade-plan-v3" ||
  contract.registry.registryDigest !==
    "sha256:5b588c0d214067e7759f9a0c3a7e053d3cea50f8910873aba76bc54cd73753b1" ||
  contract.registry.target.abiHash !==
    "sha256:e7c79a2f0882dc97d19a42e5fe3868ae986e08817b2aed4c66d1f55fcdb16219" ||
  contract.registry.target.creationCodeHash !==
    "0xed00df31c585db148d0a25bb5db4d982e762b9bd59f5bfea5b78ba2fe15e9063" ||
  contract.registry.target.runtimeTemplateHash !==
    "0x972616e68e263322b1b5b69f9f55a34d76c1ea6915cc622059c14a01c537e8f5" ||
  contract.registry.target.runtimeBytes !== 8_633 ||
  contract.registry.target.selectors.length !== 18 ||
  JSON.stringify(contract.upgrade.cursors) !== JSON.stringify(CURSORS) ||
  contract.upgrade.model !== "deploy-new" ||
  contract.upgrade.proxy !== false ||
  gate.gates.local.status !== "OPEN" ||
  gate.gates.atomicLiquidity.status !== "CLOSED" ||
  gate.gates.bsc.status !== "CLOSED" ||
  gate.gates.testnet.status !== "CLOSED" ||
  gate.gates.production.status !== "CLOSED" ||
  JSON.stringify(gate.plannedOnly) !== JSON.stringify(["HELPER-04"]) ||
  manifest.workItemId !== "P05-09" ||
  manifest.status !== "accepted-with-gaps"
) {
  throw new Error("P05-09 execution contract, gate, or manifest invariant failed");
}

for (const [file, dimensions] of [
  ["upgrade-completed-chromium-desktop.png", [984, 694]],
  ["upgrade-completed-chromium-mobile.png", [358, 1311]],
]) {
  const imagePath = path.join(ACCEPTANCE, "E-VIS", file);
  if ((await stat(imagePath)).size <= 8_000) throw new Error(`${file} is too small`);
  const bytes = await readFile(imagePath);
  if (bytes.readUInt32BE(16) !== dimensions[0] || bytes.readUInt32BE(20) !== dimensions[1]) {
    throw new Error(`${file} dimensions differ from ${dimensions.join("x")}`);
  }
}

const rows = [];
for (const file of files) rows.push(`${digest(await readFile(path.join(ACCEPTANCE, file)))}  ${file}`);
await writeFile(path.join(ACCEPTANCE, "sha256sums.txt"), `${rows.join("\n")}\n`, "utf8");

console.log(
  `Finalized P05-09 acceptance: ${files.length} checksummed files; ${FROZEN.join(", ")} match ${BASELINE}.`,
);
