import { readFile } from "node:fs/promises";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import Ajv from "ajv";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const MANIFEST_PATH = path.join(ROOT, "artifacts/acceptance/P02-01/artifact-manifest.json");
const SCHEMA_PATH = path.join(ROOT, "schemas/p02-reference-artifacts.schema.json");
const TEST_PATH = path.join(ROOT, "tests/governance/p02-reference.test.mjs");

function formatAjvErrors(errors = []) {
  return errors.map((error) => `${error.instancePath || "/"} ${error.message}`).join("\n");
}

async function main() {
  const [manifest, schema] = await Promise.all([
    readFile(MANIFEST_PATH, "utf8").then(JSON.parse),
    readFile(SCHEMA_PATH, "utf8").then(JSON.parse),
  ]);
  const ajv = new Ajv({ allErrors: true, strict: false });
  const validate = ajv.compile(schema);
  if (!validate(manifest)) {
    throw new Error(`artifact schema validation failed:\n${formatAjvErrors(validate.errors)}`);
  }

  const result = spawnSync(process.execPath, ["--test", TEST_PATH], {
    cwd: ROOT,
    encoding: "utf8",
  });
  if (result.status !== 0) {
    process.stdout.write(result.stdout);
    process.stderr.write(result.stderr);
    throw new Error(`governance test exited ${result.status}`);
  }

  const coverage = JSON.parse(
    await readFile(path.join(ROOT, "artifacts/acceptance/P02-01/coverage.json"), "utf8"),
  );
  const fixtures = JSON.parse(
    await readFile(path.join(ROOT, "artifacts/acceptance/P02-01/fixture-index.json"), "utf8"),
  );
  const api = JSON.parse(
    await readFile(path.join(ROOT, "artifacts/acceptance/P02-01/api-contracts.json"), "utf8"),
  );
  console.log(
    `P02-01 reference artifacts valid: ${coverage.features.length} planned feature IDs, ${api.endpoints.length} API endpoints, ${fixtures.fixtures.length} offline fixtures.`,
  );
}

main().catch((error) => {
  console.error(`P02-01 reference artifact check failed: ${error.message}`);
  process.exitCode = 1;
});
