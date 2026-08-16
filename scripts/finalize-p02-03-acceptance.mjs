#!/usr/bin/env node
import { createHash } from "node:crypto";
import { readFile, readdir, writeFile } from "node:fs/promises";
import path from "node:path";

const ROOT = path.resolve(import.meta.dirname, "..");
const ACCEPTANCE_ROOT = path.join(ROOT, "artifacts/acceptance/P02-03");

async function filesBelow(directory, prefix = "") {
  const entries = await readdir(path.join(directory, prefix), { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const relative = path.join(prefix, entry.name);
    if (entry.isDirectory()) files.push(...(await filesBelow(directory, relative)));
    else files.push(relative);
  }
  return files;
}

async function sha256(file) {
  return createHash("sha256").update(await readFile(file)).digest("hex");
}

async function main() {
  const rawFiles = (await filesBelow(path.join(ACCEPTANCE_ROOT, "golden/raw"))).sort();
  const combinedRaw = createHash("sha256");
  for (const file of rawFiles) {
    combinedRaw.update(await readFile(path.join(ACCEPTANCE_ROOT, "golden/raw", file)));
  }

  const sourceManifestPath = path.join(ACCEPTANCE_ROOT, "source-manifest.json");
  const sourceManifest = JSON.parse(await readFile(sourceManifestPath, "utf8"));
  const chainSource = sourceManifest.sources.find(({ id }) => id === "SRC-BSC-GOLDEN-RPC");
  if (!chainSource) throw new Error("SRC-BSC-GOLDEN-RPC is missing from source-manifest.json");
  chainSource.sha256 = combinedRaw.digest("hex");
  await writeFile(sourceManifestPath, `${JSON.stringify(sourceManifest, null, 2)}\n`);

  const acceptanceFiles = (await filesBelow(ACCEPTANCE_ROOT))
    .filter((file) => file !== "sha256sums.txt")
    .sort();
  const rows = [];
  for (const file of acceptanceFiles) {
    rows.push(`${await sha256(path.join(ACCEPTANCE_ROOT, file))}  ${file}`);
  }
  await writeFile(path.join(ACCEPTANCE_ROOT, "sha256sums.txt"), `${rows.join("\n")}\n`);
  process.stdout.write(
    `Finalized ${String(acceptanceFiles.length)} P02-03 acceptance checksums.\n`,
  );
}

main().catch((error) => {
  process.stderr.write(`P02-03 acceptance finalization failed: ${error.message}\n`);
  process.exitCode = 1;
});
