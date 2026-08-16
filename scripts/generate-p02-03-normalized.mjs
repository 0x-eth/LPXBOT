#!/usr/bin/env node
import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import path from "node:path";

import { ProductionBscEventDecoder } from "../packages/chain-adapters/dist/index.js";
import { BSC_PROTOCOL_DEPLOYMENTS } from "../packages/chain-registry/dist/index.js";

const ROOT = path.resolve(import.meta.dirname, "..");
const RAW_ROOT = path.join(ROOT, "artifacts/acceptance/P02-03/golden/raw");
const NORMALIZED_ROOT = path.join(ROOT, "artifacts/acceptance/P02-03/golden/normalized");

async function main() {
  const protocols = (await readdir(RAW_ROOT, { withFileTypes: true }))
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort();
  let count = 0;
  for (const protocol of protocols) {
    const directory = path.join(RAW_ROOT, protocol);
    const files = (await readdir(directory)).filter((file) => file.endsWith(".json")).sort();
    await mkdir(path.join(NORMALIZED_ROOT, protocol), { recursive: true });
    for (const file of files) {
      const raw = JSON.parse(await readFile(path.join(directory, file), "utf8"));
      const quarantined = [];
      const decoder = new ProductionBscEventDecoder({
        deployments: BSC_PROTOCOL_DEPLOYMENTS,
        quarantine: { write: (entry) => quarantined.push(entry) },
      });
      for (const prerequisite of raw.prerequisites ?? []) {
        await decoder.decode(prerequisite.delivery);
      }
      const normalized = await decoder.decode(raw.delivery);
      if (quarantined.length > 0) {
        throw new Error(`${protocol}/${file} was quarantined: ${JSON.stringify(quarantined)}`);
      }
      await writeFile(
        path.join(NORMALIZED_ROOT, protocol, file),
        `${JSON.stringify(normalized, null, 2)}\n`,
      );
      count += 1;
    }
  }
  process.stdout.write(`Generated ${String(count)} deterministic normalized golden events.\n`);
}

main().catch((error) => {
  process.stderr.write(`P02-03 normalized golden generation failed: ${error.message}\n`);
  process.exitCode = 1;
});
