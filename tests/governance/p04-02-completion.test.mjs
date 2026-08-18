import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import path from "node:path";

const ROOT = path.resolve(fileURLToPath(new URL("../..", import.meta.url)));
const BASELINE = "7f7403c4afdc095e243310a2ffc05983a0e3bc3c";
const TRACEABILITY = path.join(ROOT, "docs/TRACEABILITY_MATRIX.md");
const ROADMAP = path.join(ROOT, "docs/DEVELOPMENT_ROADMAP.md");
const FUNCTION_MATRIX = path.join(ROOT, "docs/FUNCTION_MATRIX.md");
const MANIFEST = path.join(ROOT, "artifacts/acceptance/P04-02/manifest.json");
const FEATURE_IDS = [
  "WALLET-01",
  "WALLET-02",
  "WALLET-03",
  "WALLET-04",
  "WALLET-05",
  "WALLET-06",
  "WALLET-07",
  "WALLET-08",
  "WALLET-09",
  "WALLET-10",
  "SET-06",
  "SET-07",
];
const IMPLEMENTED = ["WALLET-01", "WALLET-02", "WALLET-04"];

function sorted(values) {
  return [...values].sort();
}

function statusRows(markdown) {
  const rows = new Map();
  const section =
    markdown
      .split("<!-- P04_STATUS_TABLE_START -->")[1]
      ?.split("<!-- P04_STATUS_TABLE_END -->")[0] ?? "";
  for (const line of section.split("\n")) {
    if (!line.startsWith("|")) continue;
    const columns = line
      .split("|")
      .slice(1, -1)
      .map((value) => value.trim());
    if (!FEATURE_IDS.includes(columns[0])) continue;
    assert.equal(rows.has(columns[0]), false, `duplicate P04 status row ${columns[0]}`);
    rows.set(columns[0], {
      evidence: columns[4],
      implementation: columns[2],
      status: columns[1].replaceAll("`", ""),
      tests: columns[3],
    });
  }
  return rows;
}

test("P04 status is exactly 3 implemented-assumed / 9 planned with global 52 / 144", async () => {
  const [traceability, roadmap, functionMatrix] = await Promise.all([
    readFile(TRACEABILITY, "utf8"),
    readFile(ROADMAP, "utf8"),
    readFile(FUNCTION_MATRIX, "utf8"),
  ]);
  const rows = statusRows(traceability);
  assert.deepEqual(sorted(rows.keys()), sorted(FEATURE_IDS));
  assert.deepEqual(
    sorted([...rows].filter(([, row]) => row.status === "implemented-assumed").map(([id]) => id)),
    sorted(IMPLEMENTED),
  );
  assert.equal([...rows].filter(([, row]) => row.status === "planned").length, 9);
  for (const id of IMPLEMENTED) {
    assert.match(rows.get(id).evidence, /P04-02/u, id);
    assert.match(rows.get(id).evidence, /local-fixture-verified/u, id);
  }
  assert.match(traceability, /P04[^\n]*3[^\n]*implemented-assumed[^\n]*9[^\n]*planned/iu);
  assert.match(traceability, /\| 当前产品实现 \| 52 \|/u);
  assert.match(traceability, /\| `implemented-assumed` \| 52 \|/u);
  assert.match(traceability, /\| 其余 `planned` \| 144 \|/u);
  assert.match(roadmap, /P04[^\n]*3[^\n]*implemented-assumed[^\n]*9[^\n]*planned/iu);
  for (const id of IMPLEMENTED) {
    assert.match(
      functionMatrix,
      new RegExp(`\\| ${id} \\|[^\\n]*implemented-assumed[^\\n]*P04-02`, "u"),
    );
  }
});

test("P04-02 owns only the server-KEK custody slice and remains accepted-with-gaps", async () => {
  const manifest = JSON.parse(await readFile(MANIFEST, "utf8"));
  assert.equal(manifest.workItemId, "P04-02");
  assert.equal(manifest.phase, "P04");
  assert.equal(manifest.risk, "R2");
  assert.equal(manifest.status, "accepted-with-gaps");
  assert.deepEqual(sorted(manifest.featureIds), sorted(IMPLEMENTED));
  assert.equal(manifest.commit, null);
  assert.ok(manifest.tests.every(({ result }) => result === "passed"));
  assert.match(JSON.stringify(manifest.assumptions), /local-fixture-verified/u);
  assert.match(JSON.stringify(manifest.assumptions), /user-password/u);
  assert.match(JSON.stringify(manifest.assumptions), /external RPC/u);
});

test("P00 through P04-01 acceptance files remain byte-identical to the requested baseline", () => {
  const changed = execFileSync(
    "git",
    ["diff", "--name-only", BASELINE, "--", "artifacts/acceptance"],
    { cwd: ROOT, encoding: "utf8" },
  )
    .trim()
    .split("\n")
    .filter(Boolean)
    .filter((file) => !file.startsWith("artifacts/acceptance/P04-02/"));
  assert.deepEqual(changed, []);
});
