import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const ACCEPTANCE = path.join(ROOT, "artifacts/acceptance/P04-01");
const BASELINE = "37cb850c149168bbfff5a98768067a1a63bff2f9";
const MANIFEST_PATH = path.join(ACCEPTANCE, "artifact-manifest.json");
const CHECKSUM_PATH = path.join(ACCEPTANCE, "sha256sums.txt");
const PRIOR_CHECKSUM_PATH = path.join(ACCEPTANCE, "prior-acceptance-sha256s.txt");
const EXCLUDED = new Set(["artifact-manifest.json", "sha256sums.txt"]);

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
    .filter((relativePath) => /^artifacts\/acceptance\/P0[0-3]-[^/]+\//u.test(relativePath))
    .sort((left, right) => left.localeCompare(right));
  const rows = paths.map((relativePath) => `${digest(baselineBytes(relativePath))}  ${relativePath}`);
  await writeFile(PRIOR_CHECKSUM_PATH, `${rows.join("\n")}\n`);
  return paths.length;
}

async function updateFixtureIndex() {
  const indexPath = path.join(ACCEPTANCE, "fixture-index.json");
  const index = JSON.parse(await readFile(indexPath, "utf8"));
  for (const fixture of index.fixtures) {
    const bytes = await readFile(path.join(ACCEPTANCE, fixture.path));
    fixture.bytes = bytes.length;
    fixture.sha256 = digest(bytes);
  }
  await writeFile(indexPath, `${JSON.stringify(index, null, 2)}\n`);
  return index.fixtures.length;
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
    `Finalized P04-01 reference artifacts: ${files.length} files, ${fixtureCount} fixtures, ${priorCount} frozen prior-acceptance files, ${manifest.references.length} references.`,
  );
}

main().catch((error) => {
  console.error(`P04-01 reference artifact finalization failed: ${error.message}`);
  process.exitCode = 1;
});
