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
  "screenshot-redaction-policy.json",
  "contracts/p01-02-contract.json",
  "checks/artifact-integrity.txt",
  "checks/initial-failure.txt",
  "checks/read-only-audit.json",
  "checks/secret-scan.txt",
  "checks/frozen-baseline.txt",
  "checks/repository-quality.txt"
];
const REQUIRED_ROUTES = [
  "/tasks/running",
  "/tasks/paused",
  "/tasks/stopped",
  "/pools",
  "/strategies",
  "/activity",
  "/wallets",
  "/developer",
  "/settings"
];
const REQUIRED_FEATURE_REFERENCES = [
  "AUTH-01",
  "AUTH-02",
  "AUTH-03",
  "AUTH-04",
  "AUTH-05",
  "AUTH-06",
  "AUTH-07",
  "AUTH-08",
  "AUTH-09",
  "AUTH-10",
  "SHELL-01",
  "SHELL-02",
  "SHELL-03",
  "SHELL-04",
  "SHELL-05",
  "SHELL-06",
  "SET-01",
  "SET-02"
];
const REQUIRED_CHECK_IDS = [
  "artifact-integrity",
  "secret-scan",
  "read-only-methods",
  "frozen-baseline",
  "repository-quality"
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

    const checks = Array.isArray(manifest.checks) ? manifest.checks : [];
    const checkIds = checks.map((check) => check.id);
    for (const duplicate of duplicateValues(checkIds)) errors.push(`duplicate manifest check: ${duplicate}`);
    for (const checkId of REQUIRED_CHECK_IDS) {
      if (!checkIds.includes(checkId)) errors.push(`manifest missing passed check: ${checkId}`);
    }
    for (const check of checks) {
      if (!recordPaths.includes(check.evidencePath)) {
        errors.push(`manifest check evidence is not inventoried: ${check.id}`);
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
      const routePaths = (routeMatrix.routes ?? []).map((route) => route.path);
      for (const duplicate of duplicateValues(routePaths)) errors.push(`duplicate route path: ${duplicate}`);
      if (JSON.stringify(routePaths) !== JSON.stringify(REQUIRED_ROUTES)) {
        errors.push("route-state-matrix.json does not contain the canonical route inventory");
      }
      const screenshotPaths = [];
      for (const route of routeMatrix.routes ?? []) {
        if (!route.path?.startsWith("/")) errors.push(`invalid route path: ${route.path ?? "<missing>"}`);
        if (route.canonical !== true || route.evidenceLevel !== "live-observed") {
          errors.push(`${route.path}: canonical live-observed evidence is required`);
        }
        if (route.access === "verified") {
          for (const viewport of ["desktop", "mobile"]) {
            const state = route.viewports?.[viewport];
            if (state?.status !== "observed" || !state.screenshot) {
              errors.push(`${route.path}: ${viewport} observation or screenshot missing`);
              continue;
            }
            screenshotPaths.push(state.screenshot);
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
      for (const duplicate of duplicateValues(screenshotPaths)) {
        errors.push(`duplicate route screenshot: ${duplicate}`);
      }
      if (screenshotPaths.length !== REQUIRED_ROUTES.length * 2) {
        errors.push(`expected ${REQUIRED_ROUTES.length * 2} route screenshots, found ${screenshotPaths.length}`);
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
      if (JSON.stringify(expected) !== JSON.stringify(REQUIRED_ROUTES)) {
        errors.push("coverage.json does not contain the canonical ordinary-user route inventory");
      }
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
      if (
        network.webmcp?.operation !== "webmcp_list_tools" ||
        network.webmcp?.userApproval !== "approved" ||
        network.webmcp?.result !== "capability-not-exposed" ||
        network.webmcp?.toolsCalled?.length !== 0
      ) {
        errors.push("network observations must preserve the approved capability-not-exposed WebMCP result");
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

  if (actualFiles.includes("checks/read-only-audit.json")) {
    try {
      const audit = await readJson(path.join(artifactDirectory, "checks/read-only-audit.json"));
      const zeroFields = [
        "formsSubmitted",
        "settingsChanged",
        "walletOperations",
        "signatures",
        "broadcasts",
        "fundsOperations",
        "targetFetchesInitiatedByAgent",
        "webmcpToolsCalled"
      ];
      if (audit.result !== "passed" || audit.target !== "https://www.lpbot.cc") {
        errors.push("read-only audit has an invalid result or target");
      }
      if (audit.completeNetworkMethodTelemetry !== false) {
        errors.push("read-only audit must not claim complete network method telemetry");
      }
      if (!Array.isArray(audit.prohibitedControlsTriggered) || audit.prohibitedControlsTriggered.length !== 0) {
        errors.push("read-only audit recorded a prohibited control");
      }
      for (const field of zeroFields) {
        if (audit[field] !== 0) errors.push(`read-only audit ${field} must be zero`);
      }
    } catch (error) {
      errors.push(`checks/read-only-audit.json: ${error.message}`);
    }
  }

  if (actualFiles.includes("screenshot-redaction-policy.json")) {
    try {
      const policy = await readJson(path.join(artifactDirectory, "screenshot-redaction-policy.json"));
      const entries = policy.files ?? [];
      const policyPaths = entries.map((entry) => entry.path);
      const screenshotPaths = actualFiles.filter((file) => file.startsWith("screenshots/") && file.endsWith(".png"));
      for (const duplicate of duplicateValues(policyPaths)) errors.push(`duplicate redaction policy path: ${duplicate}`);
      if (JSON.stringify([...policyPaths].sort()) !== JSON.stringify(screenshotPaths)) {
        errors.push("screenshot redaction policy must inventory every PNG exactly once");
      }
      for (const entry of entries) {
        const expected = entry.path.startsWith("screenshots/desktop-")
          ? { width: 1440, height: 900 }
          : { width: 390, height: 844 };
        if (entry.viewport?.width !== expected.width || entry.viewport?.height !== expected.height) {
          errors.push(`${entry.path}: redaction policy viewport mismatch`);
        }
        if (!Array.isArray(entry.redactions)) {
          errors.push(`${entry.path}: redactions must be an array`);
          continue;
        }
        for (const rectangle of entry.redactions) {
          const withinBounds =
            Number.isInteger(rectangle.x) &&
            Number.isInteger(rectangle.y) &&
            Number.isInteger(rectangle.width) &&
            Number.isInteger(rectangle.height) &&
            rectangle.x >= 0 &&
            rectangle.y >= 0 &&
            rectangle.width > 0 &&
            rectangle.height > 0 &&
            rectangle.x + rectangle.width <= expected.width &&
            rectangle.y + rectangle.height <= expected.height;
          if (!withinBounds || typeof rectangle.reason !== "string" || rectangle.reason.length === 0) {
            errors.push(`${entry.path}: invalid redaction rectangle`);
          }
        }
      }
    } catch (error) {
      errors.push(`screenshot-redaction-policy.json: ${error.message}`);
    }
  }

  if (actualFiles.includes("contracts/p01-02-contract.json")) {
    try {
      const contract = await readJson(path.join(artifactDirectory, "contracts/p01-02-contract.json"));
      if (
        contract.sourceWorkItem !== "P01-01" ||
        contract.status !== "adoptable-with-unverified-fixtures" ||
        JSON.stringify(contract.featureIds) !== JSON.stringify(REQUIRED_FEATURE_REFERENCES)
      ) {
        errors.push("P01-02 contract identity, status, or feature reference inventory is invalid");
      }
      if (!contract.testGate?.requestBoundary?.includes("unexpected non-GET request")) {
        errors.push("P01-02 contract must retain the default non-GET abort boundary");
      }
    } catch (error) {
      errors.push(`contracts/p01-02-contract.json: ${error.message}`);
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
    ["password value", /["']?password["']?\s*[:=]\s*["'][^"'[]+/gi]
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
