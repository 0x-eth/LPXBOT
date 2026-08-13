#!/usr/bin/env node
import { lstat, readdir } from "node:fs/promises";
import path from "node:path";
import { ROOT, parseOptions } from "./lib/governance.mjs";
import { nodeText, parseMarkdownFile, visit } from "./lib/markdown-ast.mjs";

async function markdownFiles(directory) {
  const files = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const entryPath = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      files.push(...(await markdownFiles(entryPath)));
    } else if (entry.isFile() && entry.name.toLowerCase().endsWith(".md")) {
      files.push(entryPath);
    }
  }
  return files.sort();
}

function relativeTarget(url) {
  if (
    !url ||
    url.startsWith("/") ||
    url.startsWith("//") ||
    /^[a-z][a-z\d+.-]*:/i.test(url)
  ) {
    return null;
  }
  const hashIndex = url.indexOf("#");
  const withoutFragment = hashIndex === -1 ? url : url.slice(0, hashIndex);
  const rawFragment = hashIndex === -1 ? "" : url.slice(hashIndex + 1);
  const pathname = withoutFragment.split("?", 1)[0];
  try {
    return { pathname: decodeURIComponent(pathname), fragment: decodeURIComponent(rawFragment) };
  } catch {
    return { pathname, fragment: rawFragment };
  }
}

function headingSlug(value) {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^\p{L}\p{M}\p{N}\s_-]/gu, "")
    .replace(/\s+/g, "-");
}

function headingAnchors(ast) {
  const anchors = new Set();
  const occurrences = new Map();
  visit(ast, (node) => {
    if (node.type !== "heading") {
      return;
    }
    const base = headingSlug(nodeText(node));
    const occurrence = occurrences.get(base) ?? 0;
    occurrences.set(base, occurrence + 1);
    anchors.add(occurrence === 0 ? base : `${base}-${occurrence}`);
  });
  return anchors;
}

async function exists(target) {
  try {
    await lstat(target);
    return true;
  } catch (error) {
    if (error.code === "ENOENT" || error.code === "ENOTDIR") {
      return false;
    }
    throw error;
  }
}

async function main() {
  const options = parseOptions({ "docs-dir": path.join(ROOT, "docs") });
  const docsDirectory = path.resolve(options["docs-dir"]);
  const files = await markdownFiles(docsDirectory);
  const broken = [];
  const astByFile = new Map();
  let checked = 0;

  for (const file of files) {
    const ast = await parseMarkdownFile(file);
    astByFile.set(file, ast);
    const links = [];
    visit(ast, (node) => {
      if (["link", "image", "definition"].includes(node.type) && typeof node.url === "string") {
        links.push({ url: node.url, line: node.position?.start?.line ?? 1 });
      }
    });

    for (const link of links) {
      const relative = relativeTarget(link.url);
      if (!relative) {
        continue;
      }
      checked += 1;
      const target = relative.pathname
        ? path.resolve(path.dirname(file), relative.pathname)
        : file;
      if (!(await exists(target))) {
        broken.push(`${path.relative(ROOT, file)}:${link.line} broken relative link ${link.url}`);
        continue;
      }
      if (
        relative.fragment &&
        (target.toLowerCase().endsWith(".md") || target === file)
      ) {
        const targetAst = astByFile.get(target) ?? (await parseMarkdownFile(target));
        astByFile.set(target, targetAst);
        if (!headingAnchors(targetAst).has(relative.fragment)) {
          broken.push(
            `${path.relative(ROOT, file)}:${link.line} broken relative link ${link.url}: missing heading anchor #${relative.fragment}`,
          );
        }
      }
    }
  }

  if (broken.length > 0) {
    console.error(`Documentation link check failed with ${broken.length} broken relative link(s):`);
    for (const failure of broken) {
      console.error(`- ${failure}`);
    }
    process.exitCode = 1;
    return;
  }
  console.log(`Documentation links valid: ${checked} relative link(s) across ${files.length} Markdown file(s).`);
}

main().catch((error) => {
  console.error(`Documentation link check failed: ${error.message}`);
  process.exitCode = 1;
});
