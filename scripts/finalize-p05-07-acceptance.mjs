#!/usr/bin/env node
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const ACCEPTANCE = path.join(ROOT, "artifacts/acceptance/P05-07");
const BASELINE = "c71791936d6382879e4c8342c50852030de9ab18";
const FROZEN = ["P05-02", "P05-03", "P05-04", "P05-05", "P05-06"];
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
  "E-VIS/remove-succeeded-chromium-desktop.png",
  "E-VIS/remove-succeeded-chromium-mobile.png",
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
);

const files = await filesBelow(ACCEPTANCE, "", true);
if (JSON.stringify(files) !== JSON.stringify(REQUIRED)) {
  const missing = REQUIRED.filter((file) => !files.includes(file));
  const unexpected = files.filter((file) => !REQUIRED.includes(file));
  throw new Error(
    `P05-07 acceptance inventory mismatch; missing=${missing.join(",")}; unexpected=${unexpected.join(",")}`,
  );
}

const [contract, gate, manifest] = await Promise.all(
  ["execution-contract.json", "execution-gate.json", "manifest.json"].map((file) =>
    readFile(path.join(ACCEPTANCE, file), "utf8").then(JSON.parse),
  ),
);
if (
  JSON.stringify(contract.featureIds) !== JSON.stringify(["POS-02", "POS-03"]) ||
  contract.registry.chainId !== 31_337 ||
  contract.registry.registryVersion !== "p05-local-position-execution-v2" ||
  contract.registry.snapshotVersion !== "p05-local-position-snapshot-v2" ||
  contract.registry.planVersion !== "p05-local-position-plan-v2" ||
  contract.registry.serviceFeeBps !== 0 ||
  gate.gates.local.status !== "OPEN" ||
  gate.gates.bsc.status !== "CLOSED" ||
  gate.gates.testnet.status !== "CLOSED" ||
  gate.gates.production.status !== "CLOSED" ||
  manifest.workItemId !== "P05-07" ||
  manifest.status !== "accepted-with-gaps"
) {
  throw new Error("P05-07 execution contract, gate, or manifest invariant failed");
}

const rows = [];
for (const file of files) rows.push(`${digest(await readFile(path.join(ACCEPTANCE, file)))}  ${file}`);
await writeFile(path.join(ACCEPTANCE, "sha256sums.txt"), `${rows.join("\n")}\n`, "utf8");

console.log(
  `Finalized P05-07 acceptance: ${files.length} checksummed files; ${FROZEN.join(", ")} match ${BASELINE}.`,
);
