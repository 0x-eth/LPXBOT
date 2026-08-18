import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const ACCEPTANCE = path.join(ROOT, "artifacts/acceptance/P05-01");
const OBSERVED_FIXTURES = path.join(ACCEPTANCE, "fixtures/observed-helper");
const BASELINE = "1ae85706d4c17c5dbfeebee447a76d069b14c845";
const MANIFEST_PATH = path.join(ACCEPTANCE, "artifact-manifest.json");
const CHECKSUM_PATH = path.join(ACCEPTANCE, "sha256sums.txt");
const PRIOR_CHECKSUM_PATH = path.join(ACCEPTANCE, "prior-acceptance-sha256s.txt");
const EXCLUDED = new Set(["artifact-manifest.json", "sha256sums.txt"]);
const REQUIRED_PATHS = [
  "observed-v3-path-a",
  "observed-v3-path-b",
  "observed-v4-path-a",
  "observed-v4-path-b",
];

function digest(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

function git(args, encoding) {
  const result = spawnSync("git", args, {
    cwd: ROOT,
    encoding,
    maxBuffer: 64 * 1024 * 1024,
  });
  if (result.status !== 0) {
    throw new Error(
      `git ${args.join(" ")} failed: ${result.stderr?.toString("utf8") ?? "unknown error"}`,
    );
  }
  return result.stdout;
}

function baselineBytes(relativePath) {
  return git(["show", `${BASELINE}:${relativePath}`], null);
}

async function filesBelow(directory, prefix = "") {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const relativePath = path.posix.join(prefix, entry.name);
    if (entry.isDirectory()) {
      files.push(...(await filesBelow(path.join(directory, entry.name), relativePath)));
    } else if (entry.isFile() && !EXCLUDED.has(relativePath)) {
      files.push(relativePath);
    }
  }
  return files.sort((left, right) => left.localeCompare(right));
}

function metadata(relativePath) {
  if (relativePath.startsWith("checks/")) {
    return { mediaType: "text/plain", category: "check" };
  }
  if (relativePath.startsWith("fixtures/")) {
    return { mediaType: "application/json", category: "fixture" };
  }
  if (relativePath === "prior-acceptance-sha256s.txt") {
    return { mediaType: "text/plain", category: "integrity" };
  }
  if (relativePath.endsWith("-contracts.json")) {
    return { mediaType: "application/json", category: "contract" };
  }
  return { mediaType: "application/json", category: "catalog" };
}

async function updatePriorAcceptanceInventory() {
  const paths = git(
    ["ls-tree", "-r", "--name-only", BASELINE, "--", "artifacts/acceptance"],
    "utf8",
  )
    .trimEnd()
    .split("\n")
    .filter((relativePath) => /^artifacts\/acceptance\/P0[0-4]-[^/]+\//u.test(relativePath))
    .sort((left, right) => left.localeCompare(right));
  const rows = paths.map((relativePath) => `${digest(baselineBytes(relativePath))}  ${relativePath}`);
  await writeFile(PRIOR_CHECKSUM_PATH, `${rows.join("\n")}\n`);
  return paths.length;
}

async function updateFixtureIndex() {
  const indexPath = path.join(ACCEPTANCE, "fixture-index.json");
  const index = JSON.parse(await readFile(indexPath, "utf8"));
  const fixtures = [];
  const hashes = new Set();
  const counts = Object.fromEntries(REQUIRED_PATHS.map((name) => [name, 0]));

  for (const observedPath of REQUIRED_PATHS) {
    const directory = path.join(OBSERVED_FIXTURES, observedPath);
    const files = (await readdir(directory)).filter((file) => file.endsWith(".json")).sort();
    if (files.length < 10) throw new Error(`${observedPath} has only ${files.length} samples`);
    for (const [fixtureIndex, file] of files.entries()) {
      const relativePath = `fixtures/observed-helper/${observedPath}/${file}`;
      const bytes = await readFile(path.join(ACCEPTANCE, relativePath));
      const value = JSON.parse(bytes.toString("utf8"));
      if (
        value.classification !== "OBSERVED" ||
        value.observedPath !== observedPath ||
        value.rawInput !== value.transaction.input ||
        value.selector !== value.rawInput.slice(0, 10) ||
        value.receipt.status !== "0x1" ||
        value.network.chainId !== 56
      ) {
        throw new Error(`${relativePath} is not a valid successful observed fixture`);
      }
      if (hashes.has(value.transaction.hash)) {
        throw new Error(`${relativePath} duplicates transaction ${value.transaction.hash}`);
      }
      hashes.add(value.transaction.hash);
      counts[observedPath] += 1;
      fixtures.push({
        id: `P05-${observedPath.toUpperCase()}-${String(fixtureIndex + 1).padStart(2, "0")}`,
        fixtureType: "observed-helper-calldata",
        observedPath,
        selector: value.selector,
        transactionHash: value.transaction.hash,
        blockNumber: value.network.blockNumber,
        helper: value.helper.address,
        owner: value.helper.owner,
        runtimeCodeHash: value.helper.runtimeCodeHash,
        path: relativePath,
        bytes: bytes.length,
        sha256: digest(bytes),
      });
    }
  }

  const registryPath = "fixtures/registry-code-snapshot.json";
  const registryBytes = await readFile(path.join(ACCEPTANCE, registryPath));
  const registry = JSON.parse(registryBytes.toString("utf8"));
  fixtures.push({
    id: "P05-REGISTRY-CODE-SNAPSHOT-01",
    fixtureType: registry.fixtureType,
    registryVersion: registry.registryVersion,
    blockNumber: registry.network.blockNumber,
    componentCount: registry.components.length,
    path: registryPath,
    bytes: registryBytes.length,
    sha256: digest(registryBytes),
  });

  index.counts = { ...counts, total: hashes.size, registrySnapshots: 1 };
  index.fixtures = fixtures;
  await writeFile(indexPath, `${JSON.stringify(index, null, 2)}\n`);
  return fixtures.length;
}

async function updateReferences(manifest) {
  for (const reference of manifest.references) {
    const bytes = baselineBytes(reference.path);
    reference.commit = BASELINE;
    reference.bytes = bytes.length;
    reference.sha256 = digest(bytes);
  }
}

async function main() {
  const [priorCount, fixtureCount] = await Promise.all([
    updatePriorAcceptanceInventory(),
    updateFixtureIndex(),
  ]);
  const manifest = JSON.parse(await readFile(MANIFEST_PATH, "utf8"));
  await updateReferences(manifest);

  const paths = await filesBelow(ACCEPTANCE);
  const files = [];
  for (const relativePath of paths) {
    const bytes = await readFile(path.join(ACCEPTANCE, relativePath));
    files.push({
      path: relativePath,
      bytes: bytes.length,
      sha256: digest(bytes),
      ...metadata(relativePath),
    });
  }
  manifest.files = files;
  await writeFile(MANIFEST_PATH, `${JSON.stringify(manifest, null, 2)}\n`);
  await writeFile(
    CHECKSUM_PATH,
    `${files.map((file) => `${file.sha256}  ${file.path}`).join("\n")}\n`,
  );
  console.log(
    `Finalized P05-01 reference artifacts: ${files.length} files, ${fixtureCount} fixtures, ${priorCount} frozen prior-acceptance files, ${manifest.references.length} references.`,
  );
}

main().catch((error) => {
  console.error(`P05-01 reference artifact finalization failed: ${error.message}`);
  process.exitCode = 1;
});
