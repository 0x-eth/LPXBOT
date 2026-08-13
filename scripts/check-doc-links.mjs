#!/usr/bin/env node
import { lstat, readdir } from "node:fs/promises";
import path from "node:path";
import { ROOT, parseOptions } from "./lib/governance.mjs";
import { parseMarkdownFile, visit } from "./lib/markdown-ast.mjs";

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
    url.startsWith("#") ||
    url.startsWith("/") ||
    url.startsWith("//") ||
    /^[a-z][a-z\d+.-]*:/i.test(url)
  ) {
    return null;
  }
  const withoutFragment = url.split("#", 1)[0].split("?", 1)[0];
  if (!withoutFragment) {
    return null;
  }
  try {
    return decodeURIComponent(withoutFragment);
  } catch {
    return withoutFragment;
  }
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
  let checked = 0;

  for (const file of files) {
    const ast = await parseMarkdownFile(file);
    const links = [];
    visit(ast, (node) => {
      if (["link", "image", "definition"].includes(node.type) && typeof node.url === "string") {
        links.push({ url: node.url, line: node.position?.start?.line ?? 1 });
      }
    });

    for (const link of links) {
      const target = relativeTarget(link.url);
      if (!target) {
        continue;
      }
      checked += 1;
      if (!(await exists(path.resolve(path.dirname(file), target)))) {
        broken.push(`${path.relative(ROOT, file)}:${link.line} broken relative link ${link.url}`);
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
