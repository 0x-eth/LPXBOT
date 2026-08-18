import { spawnSync } from "node:child_process";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import Ajv from "ajv";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const ACCEPTANCE = path.join(ROOT, "artifacts/acceptance/P05-01");
const MANIFEST_PATH = path.join(ACCEPTANCE, "artifact-manifest.json");
const SCHEMA_PATH = path.join(ROOT, "schemas/p05-reference-artifacts.schema.json");
const GOVERNANCE_TEST_PATH = path.join(ROOT, "tests/governance/p05-reference.test.mjs");
const CODEC_TEST_PATH = path.join(ROOT, "tests/observed-helper-codec.test.ts");

function formatAjvErrors(errors = []) {
  return errors.map((error) => `${error.instancePath || "/"} ${error.message}`).join("\n");
}

function run(command, args, label) {
  const result = spawnSync(command, args, {
    cwd: ROOT,
    encoding: "utf8",
    env: {
      ...process.env,
      LPBOT_P05_CI_OFFLINE: "1",
    },
    maxBuffer: 64 * 1024 * 1024,
  });
  if (result.status !== 0) {
    process.stdout.write(result.stdout ?? "");
    process.stderr.write(result.stderr ?? "");
    throw new Error(`${label} exited ${result.status ?? "without a status"}`);
  }
}

async function main() {
  const [manifest, schema] = await Promise.all([
    readFile(MANIFEST_PATH, "utf8").then(JSON.parse),
    readFile(SCHEMA_PATH, "utf8").then(JSON.parse),
  ]);
  const validate = new Ajv({ allErrors: true, strict: false }).compile(schema);
  if (!validate(manifest)) {
    throw new Error(`artifact schema validation failed:\n${formatAjvErrors(validate.errors)}`);
  }

  run(process.execPath, ["--test", GOVERNANCE_TEST_PATH], "governance test");
  const pnpm = process.platform === "win32" ? "pnpm.cmd" : "pnpm";
  run(pnpm, ["exec", "vitest", "run", CODEC_TEST_PATH], "fixture codec test");

  const [coverage, fixtures] = await Promise.all([
    readFile(path.join(ACCEPTANCE, "coverage.json"), "utf8").then(JSON.parse),
    readFile(path.join(ACCEPTANCE, "fixture-index.json"), "utf8").then(JSON.parse),
  ]);
  console.log(
    `P05-01 reference artifacts valid: ${coverage.counts["implemented-assumed"]} implemented-assumed, ${coverage.counts.planned} planned; ${fixtures.counts.total} observed calldata fixtures plus ${fixtures.counts.registrySnapshots} registry snapshot; sign/broadcast/write/funds = 0/0/0/0.`,
  );
}

main().catch((error) => {
  console.error(`P05-01 reference artifact check failed: ${error.message}`);
  process.exitCode = 1;
});
