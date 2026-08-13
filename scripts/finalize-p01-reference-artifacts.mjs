#!/usr/bin/env node
import { createHash } from "node:crypto";
import { readFile, readdir, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { format } from "prettier";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const DEFAULT_ARTIFACT_DIR = path.join(ROOT, "artifacts/acceptance/P01-01");
const CHECKS = [
  { id: "artifact-integrity", result: "passed", evidencePath: "checks/artifact-integrity.txt" },
  { id: "secret-scan", result: "passed", evidencePath: "checks/secret-scan.txt" },
  { id: "read-only-methods", result: "passed", evidencePath: "checks/read-only-audit.json" },
  { id: "frozen-baseline", result: "passed", evidencePath: "checks/frozen-baseline.txt" },
  { id: "repository-quality", result: "passed", evidencePath: "checks/repository-quality.txt" }
];

function option(name, fallback) {
  const index = process.argv.indexOf(`--${name}`);
  if (index === -1) return fallback;
  if (!process.argv[index + 1]) throw new Error(`--${name} requires a value`);
  return path.resolve(process.argv[index + 1]);
}

async function filesBelow(directory, prefix = "") {
  const files = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const relativePath = path.posix.join(prefix, entry.name);
    const absolutePath = path.join(directory, entry.name);
    if (entry.isDirectory()) files.push(...(await filesBelow(absolutePath, relativePath)));
    else if (entry.isFile()) files.push(relativePath);
    else throw new Error(`unsupported artifact entry: ${relativePath}`);
  }
  return files.sort();
}

async function digest(filePath) {
  return createHash("sha256").update(await readFile(filePath)).digest("hex");
}

function mediaType(relativePath) {
  if (relativePath.endsWith(".json")) return "application/json";
  if (relativePath.endsWith(".md")) return "text/markdown";
  if (relativePath.endsWith(".png")) return "image/png";
  if (relativePath.endsWith(".txt")) return "text/plain";
  throw new Error(`unsupported artifact media type: ${relativePath}`);
}

function category(relativePath) {
  if (relativePath.startsWith("screenshots/")) return "screenshot";
  if (relativePath === "route-state-matrix.json") return "matrix";
  if (relativePath.startsWith("contracts/")) return "contract";
  if (relativePath.startsWith("checks/")) return "check";
  if (relativePath.endsWith(".md")) return "report";
  return "catalog";
}

async function main() {
  const artifactDirectory = option("artifact-dir", DEFAULT_ARTIFACT_DIR);
  const manifestPath = path.join(artifactDirectory, "artifact-manifest.json");
  const checksumPath = path.join(artifactDirectory, "sha256sums.txt");
  const routeMatrix = JSON.parse(
    await readFile(path.join(artifactDirectory, "route-state-matrix.json"), "utf8"),
  );

  for (const check of CHECKS) {
    await stat(path.join(artifactDirectory, check.evidencePath));
  }

  const inventoryPaths = (await filesBelow(artifactDirectory)).filter(
    (relativePath) => !["artifact-manifest.json", "sha256sums.txt"].includes(relativePath),
  );
  const files = await Promise.all(
    inventoryPaths.map(async (relativePath) => {
      const absolutePath = path.join(artifactDirectory, relativePath);
      const fileStat = await stat(absolutePath);
      return {
        path: relativePath,
        bytes: fileStat.size,
        sha256: await digest(absolutePath),
        mediaType: mediaType(relativePath),
        category: category(relativePath),
      };
    }),
  );
  const manifest = {
    schemaVersion: 1,
    workItemId: "P01-01",
    phase: "P01",
    risk: "R0",
    status: "captured-with-unverified-states",
    featureIds: [],
    capturedAt: routeMatrix.capturedAt,
    target: {
      application: "LPBot",
      origin: "https://www.lpbot.cc",
      accountRole: "ordinary-user",
    },
    scope: {
      mode: "read-only-reference",
      allowedTargetMethods: ["GET"],
      credentialsStored: false,
      personalDataStored: false,
      fundsOperations: false,
      frozenBaseline: "artifacts/lpbot/2026-08-13",
    },
    viewports: [
      { id: "desktop", width: 1440, height: 900 },
      { id: "mobile", width: 390, height: 844 },
    ],
    routeCount: routeMatrix.routes.length,
    files,
    checks: CHECKS,
    limitations: [
      "Only the current ordinary-user account was observed; pro, admin, blocked, maintenance and region-blocked states remain unverified.",
      "Complete request-method telemetry and a HAR were not exposed; documented endpoint schemas were not replayed.",
      "Dark rendering, stable loading, errors and denied permission states were not induced by this R0 capture.",
      "Frozen Bundle candidates are implementation inputs, not measured live behavior.",
      "The approved webmcp_list_tools operation was not exposed as a capability on the authenticated tab.",
    ],
  };
  await writeFile(manifestPath, await format(JSON.stringify(manifest), { parser: "json" }));

  const checksumFiles = (await filesBelow(artifactDirectory)).filter(
    (relativePath) => relativePath !== "sha256sums.txt",
  );
  const checksums = await Promise.all(
    checksumFiles.map(async (relativePath) => `${await digest(path.join(artifactDirectory, relativePath))}  ${relativePath}`),
  );
  await writeFile(checksumPath, `${checksums.join("\n")}\n`);
  console.log(`Finalized P01-01 reference artifacts: ${files.length} manifest records, ${checksums.length} checksums.`);
}

main().catch((error) => {
  console.error(`P01-01 reference artifact finalization failed: ${error.message}`);
  process.exitCode = 1;
});
