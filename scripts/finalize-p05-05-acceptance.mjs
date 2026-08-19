#!/usr/bin/env node
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const ACCEPTANCE = path.join(ROOT, "artifacts/acceptance/P05-05");
const BASELINE = "ad695e0afbcbc84096a9b97ee48e6161031305cc";
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
  "E-VIS/helper-preview-chromium-desktop.png",
  "E-VIS/helper-preview-chromium-mobile.png",
  "E-VIS/helper-succeeded-chromium-desktop.png",
  "E-VIS/helper-succeeded-chromium-mobile.png",
  "command-output.md",
  "deployment-contract.json",
  "execution-gate.json",
  "initial-failure.md",
  "manifest.json",
];

async function filesBelow(directory, prefix = "") {
  const files = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const relative = path.posix.join(prefix, entry.name);
    if (entry.isDirectory()) files.push(...(await filesBelow(path.join(directory, entry.name), relative)));
    else if (entry.isFile() && relative !== "sha256sums.txt") files.push(relative);
  }
  return files.sort((left, right) => left.localeCompare(right));
}

function digest(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

const changedP0504 = execFileSync(
  "git",
  ["diff", "--name-only", BASELINE, "--", "artifacts/acceptance/P05-04"],
  { cwd: ROOT, encoding: "utf8" },
).trim();
if (changedP0504) throw new Error(`P05-04 acceptance changed:\n${changedP0504}`);

const files = await filesBelow(ACCEPTANCE);
for (const required of REQUIRED) {
  if (!files.includes(required)) throw new Error(`missing P05-05 acceptance file: ${required}`);
}
const rows = [];
for (const file of files) rows.push(`${digest(await readFile(path.join(ACCEPTANCE, file)))}  ${file}`);
await writeFile(path.join(ACCEPTANCE, "sha256sums.txt"), `${rows.join("\n")}\n`, "utf8");
console.log(`Finalized P05-05 acceptance: ${files.length} checksummed files; P05-04 matches ${BASELINE}.`);
