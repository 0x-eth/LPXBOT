import path from "node:path";
import { fileURLToPath } from "node:url";
import { parseMarkdownFile, tableRowsByHeader } from "./markdown-ast.mjs";

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
export const FEATURE_ID_PATTERN = /^[A-Z][A-Z0-9]*-\d{2}$/;
export const TEST_IDS = new Set([
  "T-UNIT",
  "T-API",
  "T-SSE",
  "T-UI",
  "T-VIS",
  "T-CHAIN",
  "T-REC",
  "T-SEC",
  "T-PERF",
  "T-MIG",
]);
export const EVIDENCE_IDS = new Set([
  "E-UI",
  "E-VIS",
  "E-API",
  "E-SSE",
  "E-DATA",
  "E-CHAIN",
  "E-REC",
  "E-RBAC",
  "E-SEC",
  "E-OPS",
]);

export function parseOptions(defaults) {
  const options = { ...defaults };
  for (let index = 2; index < process.argv.length; index += 1) {
    const argument = process.argv[index];
    if (!argument.startsWith("--") || index + 1 >= process.argv.length) {
      throw new Error(`Invalid argument: ${argument}`);
    }
    const key = argument.slice(2);
    if (!(key in options)) {
      throw new Error(`Unknown option: ${argument}`);
    }
    options[key] = process.argv[index + 1];
    index += 1;
  }
  return options;
}

export async function readFeatureIds(filePath) {
  const ast = await parseMarkdownFile(filePath);
  const rows = tableRowsByHeader(ast, ["ID"]);
  if (rows.length === 0) {
    throw new Error(`${filePath}: no Markdown table with an ID column was found`);
  }
  return rows.map((row) => row.ID);
}

export function duplicates(values) {
  const seen = new Set();
  const repeated = new Set();
  for (const value of values) {
    if (seen.has(value)) {
      repeated.add(value);
    }
    seen.add(value);
  }
  return [...repeated].sort();
}

export function resolveInside(root, relativePath) {
  if (path.isAbsolute(relativePath)) {
    throw new Error(`path must be relative: ${relativePath}`);
  }
  const resolvedRoot = path.resolve(root);
  const resolvedPath = path.resolve(resolvedRoot, relativePath);
  if (resolvedPath !== resolvedRoot && !resolvedPath.startsWith(`${resolvedRoot}${path.sep}`)) {
    throw new Error(`path escapes repository root: ${relativePath}`);
  }
  return resolvedPath;
}
