#!/usr/bin/env node
import { createHash } from "node:crypto";
import { readFile, readdir, stat } from "node:fs/promises";
import path from "node:path";
import { ROOT, parseOptions, resolveInside } from "./lib/governance.mjs";

const FROZEN_MANIFEST_SHA256 = "70cfa06dbbd4034d04ec3b2f663c9adcc6fb1e71831cb6f077d19ec22150295d";
const FROZEN_CHECKSUMS_SHA256 = "14a4ba87b588e666ef37780b24d58fa70f13d9545ce128b5751d8a1e14d85236";

async function filesBelow(directory, prefix = "") {
  const files = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const relativePath = path.posix.join(prefix, entry.name);
    const entryPath = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      files.push(...(await filesBelow(entryPath, relativePath)));
    } else if (entry.isFile()) {
      files.push(relativePath);
    } else {
      throw new Error(`unsupported baseline entry: ${relativePath}`);
    }
  }
  return files.sort();
}

async function digest(filePath) {
  return createHash("sha256").update(await readFile(filePath)).digest("hex");
}

function checksumRecords(source) {
  const records = [];
  for (const [index, line] of source.trimEnd().split("\n").entries()) {
    const match = /^([0-9a-f]{64}) {2}(.+)$/.exec(line);
    if (!match) {
      throw new Error(`invalid sha256sums.txt line ${index + 1}`);
    }
    records.push({ hash: match[1], relativePath: match[2] });
  }
  return records;
}

async function main() {
  const options = parseOptions({
    "baseline-dir": path.join(ROOT, "artifacts/lpbot/2026-08-13"),
    "expected-manifest-sha256": FROZEN_MANIFEST_SHA256,
    "expected-checksums-sha256": FROZEN_CHECKSUMS_SHA256,
  });
  const baselineDirectory = path.resolve(options["baseline-dir"]);
  const manifestPath = path.join(baselineDirectory, "artifact-manifest.json");
  const checksumPath = path.join(baselineDirectory, "sha256sums.txt");
  const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
  const records = checksumRecords(await readFile(checksumPath, "utf8"));
  const errors = [];
  const checksumPaths = records.map((record) => record.relativePath);
  const manifestPaths = (manifest.files ?? []).map((record) => record.path);
  const duplicatePaths = checksumPaths.filter((value, index) => checksumPaths.indexOf(value) !== index);

  if (!Array.isArray(manifest.files) || manifest.files.length === 0) {
    errors.push("artifact-manifest.json has no file records");
  }
  const [manifestHash, checksumsHash] = await Promise.all([
    digest(manifestPath),
    digest(checksumPath),
  ]);
  if (manifestHash !== options["expected-manifest-sha256"]) {
    errors.push("frozen manifest anchor mismatch");
  }
  if (checksumsHash !== options["expected-checksums-sha256"]) {
    errors.push("frozen checksum inventory anchor mismatch");
  }
  for (const duplicate of new Set(duplicatePaths)) {
    errors.push(`duplicate checksum path: ${duplicate}`);
  }

  for (const record of records) {
    try {
      const filePath = resolveInside(baselineDirectory, record.relativePath);
      const actual = await digest(filePath);
      if (actual !== record.hash) {
        errors.push(`sha256 mismatch: ${record.relativePath}`);
      }
    } catch (error) {
      errors.push(`${record.relativePath}: ${error.message}`);
    }
  }

  for (const record of manifest.files ?? []) {
    if (
      typeof record.path !== "string" ||
      typeof record.sha256 !== "string" ||
      typeof record.bytes !== "number"
    ) {
      errors.push("artifact-manifest.json contains an invalid file record");
      continue;
    }
    try {
      const filePath = resolveInside(baselineDirectory, record.path);
      const [actualHash, fileStat] = await Promise.all([digest(filePath), stat(filePath)]);
      if (actualHash !== record.sha256) {
        errors.push(`manifest sha256 mismatch: ${record.path}`);
      }
      if (fileStat.size !== record.bytes) {
        errors.push(`manifest byte count mismatch: ${record.path}`);
      }
    } catch (error) {
      errors.push(`${record.path}: ${error.message}`);
    }
  }

  const actualFiles = await filesBelow(baselineDirectory);
  const expectedFiles = new Set([...checksumPaths, "sha256sums.txt"]);
  for (const file of actualFiles) {
    if (!expectedFiles.has(file)) {
      errors.push(`file missing from checksum inventory: ${file}`);
    }
  }
  for (const file of expectedFiles) {
    if (!actualFiles.includes(file)) {
      errors.push(`checksum inventory references missing file: ${file}`);
    }
  }

  const expectedManifestFiles = actualFiles.filter(
    (file) => !["artifact-manifest.json", "sha256sums.txt"].includes(file),
  );
  for (const file of expectedManifestFiles) {
    if (!manifestPaths.includes(file)) {
      errors.push(`artifact manifest missing file record: ${file}`);
    }
  }
  for (const file of manifestPaths) {
    if (!expectedManifestFiles.includes(file)) {
      errors.push(`artifact manifest has unexpected file record: ${file}`);
    }
  }

  if (errors.length > 0) {
    console.error(`Frozen baseline check failed with ${errors.length} error(s):`);
    for (const error of errors) {
      console.error(`- ${error}`);
    }
    process.exitCode = 1;
    return;
  }
  console.log(
    `Frozen baseline valid: ${records.length} checksums and ${manifest.files.length} manifest records.`,
  );
}

main().catch((error) => {
  console.error(`Frozen baseline check failed: ${error.message}`);
  process.exitCode = 1;
});
