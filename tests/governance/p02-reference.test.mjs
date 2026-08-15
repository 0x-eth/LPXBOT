import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { access, readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const ACCEPTANCE = path.join(ROOT, "artifacts/acceptance/P02-01");
const EXPECTED_FEATURE_IDS = [
  ...Array.from({ length: 16 }, (_, index) => `POOL-${String(index + 1).padStart(2, "0")}`),
  ...Array.from({ length: 5 }, (_, index) => `FLOW-${String(index + 1).padStart(2, "0")}`),
  ...Array.from({ length: 2 }, (_, index) => `STATS-${String(index + 1).padStart(2, "0")}`),
];
const REQUIRED_ARTIFACTS = [
  "artifact-manifest.json",
  "coverage.json",
  "gaps.json",
  "fixture-index.json",
  "api-contracts.json",
  "chain-event-contracts.json",
  "metric-contracts.json",
  "sse-contracts.json",
  "ui-state-catalog.json",
  "sha256sums.txt",
];

async function readJson(relativePath) {
  return JSON.parse(await readFile(path.join(ACCEPTANCE, relativePath), "utf8"));
}

function sorted(values) {
  return [...values].sort((left, right) => left.localeCompare(right));
}

function unique(values, label) {
  assert.equal(new Set(values).size, values.length, `${label} must not contain duplicates`);
}

function by(items, key) {
  return new Map(items.map((item) => [item[key], item]));
}

function assertEvidence(record, label) {
  assert.equal(typeof record.source, "string", `${label} source is required`);
  assert.ok(record.source.length > 0, `${label} source must not be empty`);
  assert.match(
    record.evidenceLevel,
    /^(observed|bundle-derived|documented|locally-defined|unresolved)$/,
    `${label} evidenceLevel is invalid`,
  );
}

function assertGap(gaps, id) {
  const gap = gaps.get(id);
  assert.ok(gap, `missing gap ${id}`);
  assert.equal(gap.status, "unresolved", `${id} must remain unresolved`);
  assert.equal(typeof gap.reason, "string", `${id} reason is required`);
  assert.ok(gap.reason.length > 0, `${id} reason must not be empty`);
}

test("P02-01 required reference artifacts exist", async () => {
  for (const relativePath of REQUIRED_ARTIFACTS) {
    await access(path.join(ACCEPTANCE, relativePath));
  }
});

test("P02-01 preserves all 23 feature IDs as planned and claims no implementation", async () => {
  const [manifest, coverage] = await Promise.all([
    readJson("artifact-manifest.json"),
    readJson("coverage.json"),
  ]);

  assert.equal(manifest.workItemId, "P02-01");
  assert.equal(manifest.risk, "R0");
  assert.deepEqual(manifest.featureIds, []);
  assert.equal(manifest.scope.mode, "read-only-reference");
  assert.equal(manifest.scope.externalRpc, false);
  assert.equal(manifest.scope.targetWrites, false);
  assert.equal(manifest.scope.signing, false);
  assert.equal(manifest.scope.broadcasting, false);
  assert.equal(manifest.scope.fundsOperations, false);

  assert.equal(coverage.workItemId, "P02-01");
  assert.deepEqual(coverage.workItemFeatureIds, []);
  assert.equal(coverage.implementationOwnership, "none");
  const ids = coverage.features.map(({ id }) => id);
  unique(ids, "coverage feature IDs");
  assert.deepEqual(sorted(ids), sorted(EXPECTED_FEATURE_IDS));
  for (const feature of coverage.features) {
    assert.equal(feature.phase, "P02", `${feature.id} phase`);
    assert.equal(feature.status, "planned", `${feature.id} status`);
    assert.equal(feature.implementationOwner, null, `${feature.id} implementation owner`);
  }
});

test("API contracts freeze every requested endpoint and evidence boundary", async () => {
  const contract = await readJson("api-contracts.json");
  const endpoints = by(contract.endpoints, "path");
  const expected = [
    "/api/pools/top-fees/:minutes",
    "/api/pools/by-token/:address",
    "/api/pools/liquidity/:poolAddress",
    "/api/market/candles",
    "/api/stats",
    "/api/stats/stream",
  ];
  assert.deepEqual(sorted(endpoints.keys()), sorted(expected));

  for (const endpointPath of expected) {
    const endpoint = endpoints.get(endpointPath);
    assert.equal(endpoint.method, "GET", `${endpointPath} must be read-only`);
    assert.ok(Array.isArray(endpoint.parameters), `${endpointPath} parameters`);
    assert.ok(endpoint.response?.schema, `${endpointPath} response schema`);
    assert.ok(endpoint.nullability, `${endpointPath} nullability`);
    assert.ok(
      Array.isArray(endpoint.errors) && endpoint.errors.length > 0,
      `${endpointPath} errors`,
    );
    assertEvidence(endpoint, endpointPath);
  }
  assert.equal(endpoints.get("/api/stats/stream").transport, "text/event-stream");
});

test("chain event contract freezes BSC normalization and ingestion semantics", async () => {
  const contract = await readJson("chain-event-contracts.json");
  assert.equal(contract.chain.chainId, 56);
  assert.equal(contract.chain.name, "BSC");
  assert.equal(contract.sourcePolicy.externalRpc, false);
  assert.deepEqual(sorted(contract.protocols.map(({ id }) => id)), [
    "pcsv3",
    "pcsv4",
    "univ3",
    "univ4",
  ]);
  assert.deepEqual(sorted(contract.eventKinds.map(({ kind }) => kind)), [
    "collect",
    "liquidity.add",
    "liquidity.remove",
    "pool.created",
    "swap",
  ]);
  assert.deepEqual(contract.normalizedEvent.deduplicationKey, [
    "chainId",
    "blockHash",
    "transactionHash",
    "logIndex",
  ]);
  for (const field of ["chainId", "blockHash", "transactionHash", "logIndex", "protocol", "kind"])
    assert.ok(contract.normalizedEvent.fields[field], `normalized event missing ${field}`);
  for (const semantic of ["reorg", "finality", "cursor", "backfill", "replay", "idempotency"])
    assert.ok(contract.ingestionSemantics[semantic], `missing ${semantic} semantics`);

  const unresolved = contract.eventKinds.filter(
    (event) => event.abiStatus === "unresolved" || event.topic0Status === "unresolved",
  );
  assert.ok(unresolved.length > 0, "unconfirmed ABI/topics must remain explicitly unresolved");
  for (const event of contract.eventKinds) assertEvidence(event, `event ${event.kind}`);
});

test("local fixtures cover normal, duplicate, out-of-order, and reorg deterministically", async () => {
  const index = await readJson("fixture-index.json");
  assert.equal(index.networkPolicy, "offline-only");
  const scenarios = by(index.fixtures, "scenario");
  assert.deepEqual(sorted(scenarios.keys()), ["duplicate", "normal", "out-of-order", "reorg"]);

  for (const [scenario, fixture] of scenarios) {
    assert.match(fixture.path, /^fixtures\/[a-z0-9-]+\.json$/);
    const bytes = await readFile(path.join(ACCEPTANCE, fixture.path));
    assert.equal(createHash("sha256").update(bytes).digest("hex"), fixture.sha256, scenario);
    const contents = JSON.parse(bytes.toString("utf8"));
    assert.equal(contents.scenario, scenario);
    assert.ok(contents.input.length > 0, `${scenario} input must not be empty`);
    assert.ok(contents.expected, `${scenario} expected result is required`);
  }
  assert.equal(scenarios.get("duplicate").expectedSemantics, "deduplicate-idempotently");
  assert.equal(scenarios.get("out-of-order").expectedSemantics, "canonical-order");
  assert.equal(scenarios.get("reorg").expectedSemantics, "rollback-and-replay");
});

test("metric contract defines windows, units, arithmetic, nulls, rounding, and stable sort", async () => {
  const contract = await readJson("metric-contracts.json");
  assert.deepEqual(
    contract.windows.map(({ minutes }) => minutes),
    [1, 5, 15, 30, 60],
  );
  assert.equal(contract.windowBoundary.interval, "[start,end)");
  assert.equal(contract.windowBoundary.timezone, "UTC");
  const metrics = by(contract.metrics, "id");
  assert.deepEqual(sorted(metrics.keys()), [
    "Fee/aTVL",
    "Fee/TVL",
    "Fees",
    "Txs",
    "Volume",
    "aTVL",
    "FDV",
    "TVL",
  ]);
  for (const metric of metrics.values()) {
    assert.ok(metric.unit, `${metric.id} unit`);
    assert.ok(metric.precision, `${metric.id} precision`);
    assert.ok(metric.nullPolicy, `${metric.id} null policy`);
    assert.ok(metric.rounding, `${metric.id} rounding`);
    assertEvidence(metric, `metric ${metric.id}`);
  }
  assert.equal(metrics.get("aTVL").status, "unresolved");
  assert.equal(metrics.get("Fee/aTVL").status, "unresolved");
  assert.deepEqual(contract.sorting.tieBreak, ["poolAddress:asc", "chainId:asc"]);
});

test("SSE contract defines envelope, lifecycle, replay, and sequence failure handling", async () => {
  const contract = await readJson("sse-contracts.json");
  for (const field of ["schemaVersion", "eventType", "sequence", "cursor", "mode", "data"])
    assert.ok(contract.envelope.fields[field], `SSE envelope missing ${field}`);
  assert.deepEqual(sorted(contract.modes), ["diff", "snapshot"]);
  for (const semantic of [
    "heartbeat",
    "replay",
    "reconnect",
    "duplicateSequence",
    "missingSequence",
  ])
    assert.ok(contract.semantics[semantic], `missing SSE ${semantic} semantics`);
  assert.equal(contract.semantics.duplicateSequence.action, "ignore");
  assert.equal(contract.semantics.missingSequence.action, "reconnect-from-last-cursor");
});

test("/pools UI catalog covers features and operational states without claiming implementation", async () => {
  const catalog = await readJson("ui-state-catalog.json");
  assert.equal(catalog.route, "/pools");
  assert.equal(catalog.implementationStatus, "planned");
  assert.deepEqual(
    sorted(catalog.capabilities.map(({ id }) => id)),
    sorted([
      "table",
      "filtering",
      "sorting",
      "grouping",
      "column-preferences",
      "comparison",
      "candles",
      "tick-liquidity",
      "liquidity-flow",
    ]),
  );
  assert.deepEqual(sorted(catalog.operationalStates.map(({ id }) => id)), [
    "empty",
    "error",
    "loading",
    "reconnecting",
    "stale",
  ]);
});

test("all unresolved fields, formulas, events, and algorithms are closed through gaps", async () => {
  const [api, chain, metrics, ui, gapFile] = await Promise.all([
    readJson("api-contracts.json"),
    readJson("chain-event-contracts.json"),
    readJson("metric-contracts.json"),
    readJson("ui-state-catalog.json"),
    readJson("gaps.json"),
  ]);
  const gaps = by(gapFile.items, "id");
  unique(
    gapFile.items.map(({ id }) => id),
    "gap IDs",
  );

  const references = [
    ...api.unresolvedRefs,
    ...chain.unresolvedRefs,
    ...metrics.unresolvedRefs,
    ...ui.unresolvedRefs,
  ];
  unique(references, "unresolved references");
  for (const id of references) assertGap(gaps, id);
  assert.deepEqual(sorted(gaps.keys()), sorted(references));
  assert.ok(gapFile.items.some(({ category }) => category === "field"));
  assert.ok(gapFile.items.some(({ category }) => category === "formula"));
  assert.ok(gapFile.items.some(({ category }) => category === "event"));
});

test("manifest inventory and sha256sums cover every reference artifact byte-for-byte", async () => {
  const manifest = await readJson("artifact-manifest.json");
  const checksumText = await readFile(path.join(ACCEPTANCE, "sha256sums.txt"), "utf8");
  const checksumRows = checksumText
    .trim()
    .split("\n")
    .map((line) => line.match(/^([0-9a-f]{64})  (.+)$/))
    .map((match) => {
      assert.ok(match, "invalid sha256sums row");
      return { sha256: match[1], path: match[2] };
    });
  unique(
    checksumRows.map(({ path: relativePath }) => relativePath),
    "checksum paths",
  );
  const checksums = by(checksumRows, "path");
  const records = by(manifest.files, "path");
  assert.deepEqual(sorted(checksums.keys()), sorted(records.keys()));

  for (const [relativePath, record] of records) {
    assert.equal(path.isAbsolute(relativePath), false);
    assert.equal(relativePath.includes(".."), false);
    const bytes = await readFile(path.join(ACCEPTANCE, relativePath));
    const digest = createHash("sha256").update(bytes).digest("hex");
    assert.equal(record.bytes, bytes.length, `${relativePath} bytes`);
    assert.equal(record.sha256, digest, `${relativePath} manifest digest`);
    assert.equal(checksums.get(relativePath).sha256, digest, `${relativePath} checksum digest`);
  }

  for (const reference of manifest.references) {
    const bytes = await readFile(path.join(ROOT, reference.path));
    assert.equal(
      createHash("sha256").update(bytes).digest("hex"),
      reference.sha256,
      reference.path,
    );
    assertEvidence(reference, `reference ${reference.path}`);
  }
});
