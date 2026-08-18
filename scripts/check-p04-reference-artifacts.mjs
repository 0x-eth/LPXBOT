import { spawnSync } from "node:child_process";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import Ajv from "ajv";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const ACCEPTANCE = path.join(ROOT, "artifacts/acceptance/P04-01");
const MANIFEST_PATH = path.join(ACCEPTANCE, "artifact-manifest.json");
const SCHEMA_PATH = path.join(ROOT, "schemas/p04-reference-artifacts.schema.json");
const TEST_PATH = path.join(ROOT, "tests/governance/p04-reference.test.mjs");
const COMPLETION_TEST_PATHS = [
  "p04-03-completion.test.mjs",
  "p04-04-completion.test.mjs",
  "p04-05-completion.test.mjs",
].map((file) => path.join(ROOT, "tests/governance", file));

function formatAjvErrors(errors = []) {
  return errors.map((error) => `${error.instancePath || "/"} ${error.message}`).join("\n");
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

  const result = spawnSync(process.execPath, ["--test", TEST_PATH, ...COMPLETION_TEST_PATHS], {
    cwd: ROOT,
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
  });
  if (result.status !== 0) {
    process.stdout.write(result.stdout);
    process.stderr.write(result.stderr);
    throw new Error(`governance test exited ${result.status}`);
  }

  const [coverage, fixtures] = await Promise.all([
    readFile(path.join(ACCEPTANCE, "coverage.json"), "utf8").then(JSON.parse),
    readFile(path.join(ACCEPTANCE, "fixture-index.json"), "utf8").then(JSON.parse),
  ]);
  console.log(
    `P04-01 reference artifacts valid: ${coverage.counts["implemented-assumed"]} implemented-assumed, ${coverage.counts.planned} planned, ${fixtures.fixtures.length} offline fixtures; decrypt/sign/broadcast/external-RPC = 0/0/0/0.`,
  );
}

main().catch((error) => {
  console.error(`P04-01 reference artifact check failed: ${error.message}`);
  process.exitCode = 1;
});
