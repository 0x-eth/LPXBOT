#!/usr/bin/env node
import { readFile, readdir, stat } from "node:fs/promises";
import path from "node:path";
import Ajv from "ajv";
import { ROOT, parseOptions, readFeatureIds, resolveInside } from "./lib/governance.mjs";

async function manifests(directory) {
  const result = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const entryPath = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      result.push(...(await manifests(entryPath)));
    } else if (entry.isFile() && entry.name === "manifest.json") {
      result.push(entryPath);
    }
  }
  return result.sort();
}

async function existingRepositoryPath(repoRoot, value) {
  try {
    const resolved = resolveInside(repoRoot, value);
    await stat(resolved);
    return null;
  } catch (error) {
    return error.message;
  }
}

function schemaErrors(validate) {
  return (validate.errors ?? [])
    .map((error) => `${error.dataPath || "/"} ${error.message}`)
    .join("; ");
}

async function main() {
  const options = parseOptions({
    "repo-root": ROOT,
    "acceptance-dir": path.join(ROOT, "artifacts/acceptance"),
    "function-matrix": path.join(ROOT, "docs/FUNCTION_MATRIX.md"),
    schema: path.join(ROOT, "schemas/acceptance-manifest.schema.json"),
  });
  const repoRoot = path.resolve(options["repo-root"]);
  const schema = JSON.parse(await readFile(options.schema, "utf8"));
  const ajv = new Ajv({ allErrors: true, jsonPointers: true });
  const validate = ajv.compile(schema);
  const validFeatureIds = new Set(await readFeatureIds(options["function-matrix"]));
  const files = await manifests(path.resolve(options["acceptance-dir"]));
  const errors = [];

  if (files.length === 0) {
    errors.push("no acceptance manifest.json files found");
  }

  for (const file of files) {
    const label = path.relative(repoRoot, file);
    let manifest;
    try {
      manifest = JSON.parse(await readFile(file, "utf8"));
    } catch (error) {
      errors.push(`${label}: invalid JSON: ${error.message}`);
      continue;
    }

    if (!validate(manifest)) {
      errors.push(`${label}: manifest schema validation failed: ${schemaErrors(validate)}`);
      continue;
    }

    const directoryName = path.basename(path.dirname(file));
    if (directoryName !== manifest.workItemId) {
      errors.push(`${label}: workItemId ${manifest.workItemId} does not match directory ${directoryName}`);
    }
    if (manifest.phase !== manifest.workItemId.slice(0, 3)) {
      errors.push(`${label}: phase ${manifest.phase} does not match workItemId ${manifest.workItemId}`);
    }
    const isFeaturelessPhaseCompletion = new Set(["P01-08", "P02-03", "P05-04"]).has(
      manifest.workItemId,
    );
    if (
      manifest.phase !== "P00" &&
      !isFeaturelessPhaseCompletion &&
      manifest.featureIds.length === 0
    ) {
      errors.push(`${label}: business work items must reference at least one feature ID`);
    }
    for (const id of manifest.featureIds) {
      if (!validFeatureIds.has(id)) {
        errors.push(`${label}: unknown feature ID ${id}`);
      }
    }
    if (manifest.status === "accepted") {
      if (manifest.completedAt === null) {
        errors.push(`${label}: accepted manifest must have completedAt`);
      }
      for (const test of manifest.tests) {
        if (test.result !== "passed") {
          errors.push(`${label}: accepted manifest contains a non-passing test ${test.command}`);
        }
      }
    }

    for (const value of [
      ...manifest.tests.map((entry) => entry.evidencePath),
      ...manifest.evidence.map((entry) => entry.path),
    ]) {
      const pathError = await existingRepositoryPath(repoRoot, value);
      if (pathError) {
        errors.push(`${label}: invalid evidence path ${value}: ${pathError}`);
      }
    }
  }

  if (errors.length > 0) {
    console.error(`Acceptance check failed with ${errors.length} error(s):`);
    for (const error of errors) {
      console.error(`- ${error}`);
    }
    process.exitCode = 1;
    return;
  }

  console.log(`${files.length} acceptance manifest(s) valid.`);
}

main().catch((error) => {
  console.error(`Acceptance check failed: ${error.message}`);
  process.exitCode = 1;
});
