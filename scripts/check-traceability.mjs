#!/usr/bin/env node
import path from "node:path";
import {
  EVIDENCE_IDS,
  FEATURE_ID_PATTERN,
  ROOT,
  TEST_IDS,
  duplicates,
  parseOptions,
  readFeatureIds,
} from "./lib/governance.mjs";
import { parseMarkdownFile, tableRowsByHeader } from "./lib/markdown-ast.mjs";

const PHASES = new Set(Array.from({ length: 13 }, (_, index) => `P${String(index + 1).padStart(2, "0")}`));

function values(cell) {
  return cell
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);
}

function reportList(errors, label, entries) {
  for (const entry of entries) {
    errors.push(`${label}: ${entry}`);
  }
}

async function main() {
  const options = parseOptions({
    "function-matrix": path.join(ROOT, "docs/FUNCTION_MATRIX.md"),
    "traceability-matrix": path.join(ROOT, "docs/TRACEABILITY_MATRIX.md"),
    "expected-count": "196",
  });
  const expectedCount = Number(options["expected-count"]);
  if (!Number.isSafeInteger(expectedCount) || expectedCount < 1) {
    throw new Error("--expected-count must be a positive integer");
  }

  const functionIds = await readFeatureIds(options["function-matrix"]);
  const traceAst = await parseMarkdownFile(options["traceability-matrix"]);
  const traceRows = tableRowsByHeader(traceAst, ["ID", "阶段", "最低测试", "最低验收证据"]);
  if (traceRows.length === 0) {
    throw new Error("Traceability matrix has no feature coverage table");
  }
  const traceIds = traceRows.map((row) => row.ID);
  const errors = [];

  reportList(errors, "Duplicate feature ID in function matrix", duplicates(functionIds));
  reportList(errors, "Duplicate feature ID in traceability matrix", duplicates(traceIds));

  for (const [matrixName, ids] of [
    ["function matrix", functionIds],
    ["traceability matrix", traceIds],
  ]) {
    for (const id of ids) {
      if (!FEATURE_ID_PATTERN.test(id)) {
        errors.push(`Invalid feature ID in ${matrixName}: ${id || "<empty>"}`);
      }
    }
    const uniqueCount = new Set(ids).size;
    if (uniqueCount !== expectedCount) {
      errors.push(`${matrixName}: expected ${expectedCount} unique feature IDs, found ${uniqueCount}`);
    }
  }

  const functionSet = new Set(functionIds);
  const traceSet = new Set(traceIds);
  reportList(
    errors,
    "Missing from traceability matrix",
    [...functionSet].filter((id) => !traceSet.has(id)).sort(),
  );
  reportList(
    errors,
    "Extra in traceability matrix",
    [...traceSet].filter((id) => !functionSet.has(id)).sort(),
  );

  for (const row of traceRows) {
    if (!PHASES.has(row["阶段"])) {
      errors.push(`${row.ID}: invalid phase ${row["阶段"] || "<empty>"}; expected P01-P13`);
    }

    const testIds = values(row["最低测试"]);
    const evidenceIds = values(row["最低验收证据"]);
    if (testIds.length === 0) {
      errors.push(`${row.ID}: must have at least one test`);
    }
    if (evidenceIds.length === 0) {
      errors.push(`${row.ID}: must have at least one evidence ID`);
    }
    for (const id of testIds) {
      if (!TEST_IDS.has(id)) {
        errors.push(`${row.ID}: unknown Test ID ${id}`);
      }
    }
    for (const id of evidenceIds) {
      if (!EVIDENCE_IDS.has(id)) {
        errors.push(`${row.ID}: unknown Evidence ID ${id}`);
      }
    }
  }

  if (errors.length > 0) {
    console.error(`Traceability check failed with ${errors.length} error(s):`);
    for (const error of errors) {
      console.error(`- ${error}`);
    }
    process.exitCode = 1;
    return;
  }

  console.log(`Traceability valid: ${expectedCount}/${expectedCount} unique feature IDs match.`);
}

main().catch((error) => {
  console.error(`Traceability check failed: ${error.message}`);
  process.exitCode = 1;
});
