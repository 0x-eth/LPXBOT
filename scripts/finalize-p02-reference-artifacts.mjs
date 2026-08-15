import { createHash } from "node:crypto";
import { readdir, readFile, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const ACCEPTANCE = path.join(ROOT, "artifacts/acceptance/P02-01");
const MANIFEST_PATH = path.join(ACCEPTANCE, "artifact-manifest.json");
const CHECKSUM_PATH = path.join(ACCEPTANCE, "sha256sums.txt");
const EXCLUDED = new Set(["artifact-manifest.json", "sha256sums.txt"]);

function digest(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
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
  if (relativePath.endsWith("-contracts.json")) {
    return { mediaType: "application/json", category: "contract" };
  }
  return { mediaType: "application/json", category: "catalog" };
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
}

async function main() {
  await updateFixtureIndex();
  const manifest = JSON.parse(await readFile(MANIFEST_PATH, "utf8"));
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
  console.log(`Finalized P02-01 reference artifacts: ${files.length} files, ${manifest.references.length} references.`);
}

main().catch((error) => {
  console.error(`P02-01 reference artifact finalization failed: ${error.message}`);
  process.exitCode = 1;
});
