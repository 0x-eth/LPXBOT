import assert from "node:assert/strict";
import path from "node:path";
import { spawnSync } from "node:child_process";
import test from "node:test";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

function checkP00(...args) {
  return spawnSync(process.execPath, [path.join(ROOT, "scripts/check-p00.mjs"), ...args], {
    cwd: ROOT,
    encoding: "utf8",
  });
}

function output(result) {
  return `${result.stdout}\n${result.stderr}`;
}

test("repository satisfies the P00 completion definition", () => {
  const result = checkP00();

  assert.equal(result.status, 0, output(result));
  assert.match(result.stdout, /PASS\s+monorepo and strict TypeScript/i);
  assert.match(result.stdout, /PASS\s+Compose, migration, and seed/i);
  assert.match(result.stdout, /PASS\s+CI gates/i);
  assert.match(result.stdout, /PASS\s+196\/196 feature IDs/i);
  assert.match(result.stdout, /PASS\s+Changesets release workflow/i);
  assert.match(result.stdout, /PASS\s+ADR index and key decisions/i);
  assert.match(result.stdout, /PASS\s+clean-start environment template/i);
  assert.match(result.stdout, /PASS\s+repeatable P00 full-stack acceptance entry/i);
});
