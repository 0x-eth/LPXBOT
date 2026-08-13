import { readFile } from "node:fs/promises";
import { parsers } from "prettier/plugins/markdown";

export async function parseMarkdownFile(filePath) {
  const source = await readFile(filePath, "utf8");
  return parsers.markdown.parse(source, { filepath: filePath });
}

export function visit(node, visitor) {
  visitor(node);
  if (!Array.isArray(node?.children)) {
    return;
  }
  for (const child of node.children) {
    visit(child, visitor);
  }
}

export function nodeText(node) {
  if (!node) {
    return "";
  }
  if (typeof node.value === "string") {
    return node.value;
  }
  if (!Array.isArray(node.children)) {
    return "";
  }
  return node.children.map(nodeText).join("");
}

export function tablesWithHeader(ast, requiredHeaders) {
  const tables = [];
  visit(ast, (node) => {
    if (node.type !== "table" || !node.children?.length) {
      return;
    }

    const header = node.children[0].children.map((cell) => nodeText(cell).trim());
    if (requiredHeaders.every((required) => header.includes(required))) {
      tables.push({ header, rows: node.children.slice(1) });
    }
  });
  return tables;
}

export function tableRowsByHeader(ast, requiredHeaders) {
  return tablesWithHeader(ast, requiredHeaders).flatMap(({ header, rows }) =>
    rows.map((row) =>
      Object.fromEntries(
        header.map((name, index) => [name, nodeText(row.children[index]).trim()]),
      ),
    ),
  );
}
