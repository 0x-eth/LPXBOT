#!/usr/bin/env node
import { createHash } from "node:crypto";
import { readFile, readdir, stat } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import Ajv from "ajv";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const DEFAULT_ARTIFACT_DIR = path.join(ROOT, "artifacts/acceptance/P01-01");
const DEFAULT_SCHEMA = path.join(ROOT, "schemas/reference-baseline-manifest.schema.json");
const REQUIRED_FILES = [
  "capture-methodology.md",
  "coverage.json",
  "gaps.json",
  "route-state-matrix.json",
  "network-observations.json",
  "dom-accessibility-summary.json",
  "state-catalog.json",
  "contracts/p01-02-contract.json",
  "checks/initial-failure.txt",
  "checks/read-only-audit.json",
  "checks/secret-scan.txt",
  "checks/frozen-baseline.txt",
  "checks/repository-quality.txt"
];
const REQUIRED_STATE_CATEGORIES = [
  "sidebar",
  "mobile-navigation",
  "bottom-status-bar",
  "theme",
  "settings",
  "empty",
  "loading",
  "error",
  "permission"
];
const REQUIRED_UNVERIFIED_SUBJECTS = [
  "role:pro",
  "role:admin",
  "state:blocked",
  "state:maintenance",
  "state:region-blocked"
];
const TEXT_EXTENSIONS = new Set([".json", ".md", ".txt"]);

function option(name, fallback) {
  const marker = `--${name}`;
  const index = process.argv.indexOf(marker);
  if (index === -1) return fallback;
  if (!process.argv[index + 1]) throw new Error(`${marker} requires a value`);
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

function inside(directory, relativePath) {
  const resolved = path.resolve(directory, relativePath);
  const prefix = `${path.resolve(directory)}${path.sep}`;
  if (!resolved.startsWith(prefix)) throw new Error(`path escapes artifact directory: ${relativePath}`);
  return resolved;
}

async function digest(filePath) {
  return createHash("sha256").update(await readFile(filePath)).digest("hex");
}

async function readJson(filePath) {
  return JSON.parse(await readFile(filePath, "utf8"));
}

function schemaErrors(validate) {
  return (validate.errors ?? [])
    .map((error) => `${error.dataPath || "/"} ${error.message}`)
    .join("; ");
}

function duplicateValues(values) {
  return [...new Set(values.filter((value, index) => values.indexOf(value) !== index))];
}

function pngDimensions(buffer) {
  const signature = "89504e470d0a1a0a";
  if (buffer.length < 24 || buffer.subarray(0, 8).toString("hex") !== signature) return null;
  return { width: buffer.readUInt32BE(16), height: buffer.readUInt32BE(20) };
}

async function main() {
  const artifactDirectory = option("artifact-dir", DEFAULT_ARTIFACT_DIR);
  const schemaPath = option("schema", DEFAULT_SCHEMA);
  const errors = [];
  let manifest = null;
  let actualFiles = [];

  try {
    actualFiles = await filesBelow(artifactDirectory);
  } catch (error) {
    errors.push(`artifact directory: ${error.message}`);
  }

  try {
    manifest = await readJson(path.join(artifactDirectory, "artifact-manifest.json"));
    const schema = await readJson(schemaPath);
    const validate = new Ajv({ allErrors: true, jsonPointers: true }).compile(schema);
    if (!validate(manifest)) errors.push(`manifest schema validation failed: ${schemaErrors(validate)}`);
  } catch (error) {
    errors.push(`artifact-manifest.json: ${error.message}`);
  }

  for (const required of REQUIRED_FILES) {
    if (!actualFiles.includes(required)) errors.push(`missing required artifact: ${required}`);
  }
  if (!actualFiles.includes("sha256sums.txt")) errors.push("missing required artifact: sha256sums.txt");

  if (manifest) {
    const records = Array.isArray(manifest.files) ? manifest.files : [];
    const recordPaths = records.map((record) => record.path);
    for (const duplicate of duplicateValues(recordPaths)) errors.push(`duplicate manifest path: ${duplicate}`);
    const expectedFiles = actualFiles.filter(
      (file) => !["artifact-manifest.json", "sha256sums.txt"].includes(file),
    );
    for (const file of expectedFiles) {
      if (!recordPaths.includes(file)) errors.push(`manifest missing file record: ${file}`);
    }
    for (const file of recordPaths) {
      if (!expectedFiles.includes(file)) errors.push(`manifest references missing file: ${file}`);
    }
    for (const record of records) {
      try {
        const filePath = inside(artifactDirectory, record.path);
        const [hash, fileStat] = await Promise.all([digest(filePath), stat(filePath)]);
        if (record.sha256 !== hash) errors.push(`manifest sha256 mismatch: ${record.path}`);
        if (record.bytes !== fileStat.size) errors.push(`manifest byte count mismatch: ${record.path}`);
      } catch (error) {
        errors.push(`${record.path}: ${error.message}`);
      }
    }

    const viewportMap = new Map((manifest.viewports ?? []).map((entry) => [entry.id, entry]));
    const desktop = viewportMap.get("desktop");
    const mobile = viewportMap.get("mobile");
    if (desktop?.width !== 1440 || desktop?.height !== 900) {
      errors.push("desktop viewport must be 1440x900");
    }
    if (mobile?.width !== 390 || mobile?.height !== 844) {
      errors.push("mobile viewport must be 390x844");
    }
  }

  let checksumPaths = [];
  if (actualFiles.includes("sha256sums.txt")) {
    try {
      const lines = (await readFile(path.join(artifactDirectory, "sha256sums.txt"), "utf8"))
        .trimEnd()
        .split("\n")
        .filter(Boolean);
      const records = lines.map((line, index) => {
        const match = /^([0-9a-f]{64}) {2}(.+)$/.exec(line);
        if (!match) throw new Error(`invalid line ${index + 1}`);
        return { hash: match[1], path: match[2] };
      });
      checksumPaths = records.map((record) => record.path);
      for (const duplicate of duplicateValues(checksumPaths)) errors.push(`duplicate checksum path: ${duplicate}`);
      const expected = actualFiles.filter((file) => file !== "sha256sums.txt");
      for (const file of expected) {
        if (!checksumPaths.includes(file)) errors.push(`checksum inventory missing: ${file}`);
      }
      for (const record of records) {
        if (!expected.includes(record.path)) errors.push(`checksum references missing file: ${record.path}`);
        else if ((await digest(inside(artifactDirectory, record.path))) !== record.hash) {
          errors.push(`checksum mismatch: ${record.path}`);
        }
      }
    } catch (error) {
      errors.push(`sha256sums.txt: ${error.message}`);
    }
  }

  let routeMatrix = null;
  if (actualFiles.includes("route-state-matrix.json")) {
    try {
      routeMatrix = await readJson(path.join(artifactDirectory, "route-state-matrix.json"));
      if (routeMatrix.schemaVersion !== 1 || routeMatrix.workItemId !== "P01-01") {
        errors.push("route-state-matrix.json has an invalid identity");
      }
      if (!Array.isArray(routeMatrix.routes) || routeMatrix.routes.length === 0) {
        errors.push("route-state-matrix.json has no routes");
      }
      if (manifest && manifest.routeCount !== routeMatrix.routes?.length) {
        errors.push("manifest routeCount does not match route-state-matrix.json");
      }
      for (const route of routeMatrix.routes ?? []) {
        if (!route.path?.startsWith("/")) errors.push(`invalid route path: ${route.path ?? "<missing>"}`);
        if (route.access === "verified") {
          for (const viewport of ["desktop", "mobile"]) {
            const state = route.viewports?.[viewport];
            if (state?.status !== "observed" || !state.screenshot) {
              errors.push(`${route.path}: ${viewport} observation or screenshot missing`);
              continue;
            }
            try {
              const buffer = await readFile(inside(artifactDirectory, state.screenshot));
              const dimensions = pngDimensions(buffer);
              const expected = viewport === "desktop" ? { width: 1440, height: 900 } : { width: 390, height: 844 };
              if (!dimensions || dimensions.width !== expected.width || dimensions.height !== expected.height) {
                errors.push(`${state.screenshot}: expected ${expected.width}x${expected.height} PNG`);
              }
            } catch (error) {
              errors.push(`${state.screenshot}: ${error.message}`);
            }
          }
        }
      }
    } catch (error) {
      errors.push(`route-state-matrix.json: ${error.message}`);
    }
  }

  if (actualFiles.includes("coverage.json")) {
    try {
      const coverage = await readJson(path.join(artifactDirectory, "coverage.json"));
      const expected = coverage.ordinaryUserNoFundsRoutes?.expected ?? [];
      const captured = coverage.ordinaryUserNoFundsRoutes?.captured ?? [];
      const missing = coverage.ordinaryUserNoFundsRoutes?.missing ?? [];
      const matrixPaths = (routeMatrix?.routes ?? [])
        .filter((route) => route.access === "verified")
        .map((route) => route.path);
      if (expected.length === 0) errors.push("coverage.json has no expected ordinary-user routes");
      if (missing.length !== 0) errors.push(`coverage.json has missing routes: ${missing.join(", ")}`);
      for (const route of expected) {
        if (!captured.includes(route) || !matrixPaths.includes(route)) {
          errors.push(`coverage.json route not captured in matrix: ${route}`);
        }
      }
    } catch (error) {
      errors.push(`coverage.json: ${error.message}`);
    }
  }

  if (actualFiles.includes("state-catalog.json")) {
    try {
      const catalog = await readJson(path.join(artifactDirectory, "state-catalog.json"));
      const categories = (catalog.categories ?? []).map((entry) => entry.id);
      for (const category of REQUIRED_STATE_CATEGORIES) {
        if (!categories.includes(category)) errors.push(`state catalog missing category: ${category}`);
      }
    } catch (error) {
      errors.push(`state-catalog.json: ${error.message}`);
    }
  }

  if (actualFiles.includes("gaps.json")) {
    try {
      const gaps = await readJson(path.join(artifactDirectory, "gaps.json"));
      const unverified = (gaps.items ?? [])
        .filter((entry) => entry.status === "unverified")
        .map((entry) => entry.subject);
      for (const subject of REQUIRED_UNVERIFIED_SUBJECTS) {
        if (!unverified.includes(subject)) errors.push(`gap list must mark ${subject} unverified`);
      }
    } catch (error) {
      errors.push(`gaps.json: ${error.message}`);
    }
  }

  if (actualFiles.includes("network-observations.json")) {
    try {
      const network = await readJson(path.join(artifactDirectory, "network-observations.json"));
      if (JSON.stringify(network.allowedMethods) !== JSON.stringify(["GET"])) {
        errors.push("network observations must allow only GET");
      }
      if (network.bodyValuesStored !== false || network.headersStored !== false) {
        errors.push("network observations must not store body values or headers");
      }
      for (const request of network.requests ?? []) {
        if (request.method !== "GET") errors.push(`non-GET request recorded: ${request.method} ${request.path}`);
        if (!request.path?.startsWith("/") || request.path.includes("?")) {
          errors.push(`request path must be origin-free and query-free: ${request.path ?? "<missing>"}`);
        }
        if ("body" in request || "headers" in request || "url" in request) {
          errors.push(`request contains prohibited raw data fields: ${request.path}`);
        }
      }
    } catch (error) {
      errors.push(`network-observations.json: ${error.message}`);
    }
  }

  const secretPatterns = [
    ["JWT", /\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\b/g],
    ["Bearer token", /\bBearer\s+[A-Za-z0-9._~+/=-]{12,}/gi],
    ["private key", /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/g],
    ["wallet address", /\b0x[a-fA-F0-9]{40}\b/g],
    ["email address", /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi],
    ["Telegram initData", /\b(?:query_id|auth_date|hash)=[^&\s]+&(?:user|auth_date|hash)=/gi],
    ["cookie header", /["']?(?:set-cookie|cookie)["']?\s*:\s*["'][^"']+/gi],
    ["password value", /["']?password["']?\s*[:=]\s*["'][^"'\[]+/gi]
  ];
  for (const relativePath of actualFiles) {
    if (!TEXT_EXTENSIONS.has(path.extname(relativePath))) continue;
    const source = await readFile(inside(artifactDirectory, relativePath), "utf8");
    for (const [label, pattern] of secretPatterns) {
      pattern.lastIndex = 0;
      if (pattern.test(source)) errors.push(`secret scan matched ${label}: ${relativePath}`);
    }
  }

  if (errors.length > 0) {
    console.error(`P01-01 reference artifact check failed with ${errors.length} error(s):`);
    for (const error of errors) console.error(`- ${error}`);
    process.exitCode = 1;
    return;
  }

  console.log(
    `P01-01 reference artifacts valid: ${manifest.files.length} manifest records, ${checksumPaths.length} checksums, ${routeMatrix.routes.length} routes.`,
  );
}

main().catch((error) => {
  console.error(`P01-01 reference artifact check failed: ${error.message}`);
  process.exitCode = 1;
});
