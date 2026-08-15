import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
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
const EXPECTED_REFERENCE_PATHS = [
  "artifacts/lpbot/2026-08-13/artifact-manifest.json",
  "artifacts/lpbot/2026-08-13/api-calls.json",
  "artifacts/lpbot/2026-08-13/api-docs.json",
  "artifacts/lpbot/2026-08-13/api-docs.md",
  "artifacts/lpbot/2026-08-13/assets/index-D0FmPqGc.js",
  "artifacts/lpbot/2026-08-13/assets/TopPoolsView-BmMrLEMA.js",
  "artifacts/lpbot/2026-08-13/assets/LiquidityFlowSheet-DEk34LQj.js",
  "artifacts/lpbot/2026-08-13/assets/KlineLiquidityChart-0xvlAqf1.js",
  "artifacts/acceptance/P01-01/screenshots/desktop-pools.png",
  "artifacts/acceptance/P01-01/screenshots/mobile-pools.png",
  "docs/FUNCTION_MATRIX.md",
  "docs/DEVELOPMENT_ROADMAP.md",
  "docs/TRACEABILITY_MATRIX.md",
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

function readBaselineReference(commit, relativePath) {
  assert.match(commit, /^[0-9a-f]{40}$/, "referenceBaseline must be a full Git commit");
  assert.equal(path.isAbsolute(relativePath), false, `${relativePath} must be repository-relative`);
  assert.equal(
    relativePath.includes(".."),
    false,
    `${relativePath} must remain inside the repository`,
  );

  const result = spawnSync("git", ["show", `${commit}:${relativePath}`], {
    cwd: ROOT,
    encoding: null,
    maxBuffer: 2 * 1024 * 1024,
  });
  assert.equal(
    result.status,
    0,
    `${relativePath} is unavailable at ${commit}: ${result.stderr?.toString("utf8") ?? ""}`,
  );
  return result.stdout;
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
  assert.equal(manifest.referenceBaseline, "3ff4eb9ed84e1d459671695618a67a2932f5abd6");
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
  assert.deepEqual(index.coverage.chainIds, [56]);
  assert.deepEqual(sorted(index.coverage.protocols), ["pcsv3", "pcsv4", "univ3", "univ4"]);
  assert.deepEqual(sorted(index.coverage.eventKinds), [
    "collect",
    "liquidity.add",
    "liquidity.remove",
    "pool.created",
    "swap",
  ]);
  const scenarios = by(index.fixtures, "scenario");
  assert.deepEqual(sorted(scenarios.keys()), ["duplicate", "normal", "out-of-order", "reorg"]);

  for (const [scenario, fixture] of scenarios) {
    assert.match(fixture.path, /^fixtures\/[a-z0-9-]+\.json$/);
    const bytes = await readFile(path.join(ACCEPTANCE, fixture.path));
    assert.equal(createHash("sha256").update(bytes).digest("hex"), fixture.sha256, scenario);
    const contents = JSON.parse(bytes.toString("utf8"));
    assert.equal(contents.scenario, scenario);
    assert.equal(contents.fixtureOnly, true, `${scenario} must be fixture-only`);
    assert.ok(contents.input.length > 0, `${scenario} input must not be empty`);
    assert.ok(contents.expected, `${scenario} expected result is required`);
    for (const delivery of contents.input) {
      const rawLog = delivery.rawLog;
      assert.equal(rawLog.chainId, 56, `${scenario} chainId`);
      assert.match(rawLog.blockNumber, /^\d+$/, `${scenario} blockNumber`);
      assert.match(rawLog.blockHash, /^0x[0-9a-f]{64}$/, `${scenario} blockHash`);
      assert.match(rawLog.transactionHash, /^0x[0-9a-f]{64}$/, `${scenario} tx hash`);
      assert.ok(Number.isInteger(rawLog.transactionIndex), `${scenario} transactionIndex`);
      assert.ok(Number.isInteger(rawLog.logIndex), `${scenario} logIndex`);
      assert.match(rawLog.address, /^0x[0-9a-f]{40}$/, `${scenario} address`);
      assert.ok(rawLog.topics.length > 0, `${scenario} topics`);
      for (const topic of rawLog.topics)
        assert.match(topic, /^0x[0-9a-f]{64}$/, `${scenario} topic`);
      assert.match(rawLog.data, /^0x(?:[0-9a-f]{2})*$/, `${scenario} data`);
      assert.equal(typeof rawLog.removed, "boolean", `${scenario} removed`);
      assert.match(delivery.decoderFixtureId, /^fixture:\/\//, `${scenario} decoder scope`);
    }
  }
  assert.equal(scenarios.get("duplicate").expectedSemantics, "deduplicate-idempotently");
  assert.equal(scenarios.get("out-of-order").expectedSemantics, "canonical-order");
  assert.equal(scenarios.get("reorg").expectedSemantics, "rollback-and-replay");

  const normal = await readJson("fixtures/normal.json");
  assert.deepEqual(sorted(normal.expected.protocolCoverage), ["pcsv3", "pcsv4", "univ3", "univ4"]);
  assert.deepEqual(sorted(normal.expected.eventKindCoverage), [
    "collect",
    "liquidity.add",
    "liquidity.remove",
    "pool.created",
    "swap",
  ]);

  const duplicate = await readJson("fixtures/duplicate.json");
  assert.deepEqual(duplicate.input[0].rawLog, duplicate.input[1].rawLog);
  assert.equal(duplicate.expected.acceptedCount, 1);
  assert.equal(duplicate.expected.aggregateApplications, 1);

  const outOfOrder = await readJson("fixtures/out-of-order.json");
  assert.deepEqual(outOfOrder.expected.arrivalBlockOrder, ["108", "106", "107"]);
  assert.deepEqual(outOfOrder.expected.committedBlockOrder, ["106", "107", "108"]);

  const reorg = await readJson("fixtures/reorg.json");
  assert.equal(
    reorg.input.some(({ rawLog }) => rawLog.removed),
    true,
  );
  assert.equal(reorg.input[0].rawLog.blockNumber, reorg.input[2].rawLog.blockNumber);
  assert.notEqual(reorg.input[0].rawLog.blockHash, reorg.input[2].rawLog.blockHash);
  assert.equal(reorg.expected.tombstoneCount, 1);
  assert.equal(reorg.expected.oldCursorValid, false);
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
  assert.deepEqual(
    sorted(metrics.keys()),
    sorted(["Fees", "Volume", "TVL", "Txs", "FDV", "aTVL", "Fee/TVL", "Fee/aTVL"]),
  );
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

test("manifest inventory and sha256sums cover artifacts and frozen references byte-for-byte", async () => {
  const manifest = await readJson("artifact-manifest.json");
  const checksumText = await readFile(path.join(ACCEPTANCE, "sha256sums.txt"), "utf8");
  const checksumRows = checksumText
    .trim()
    .split("\n")
    .map((line) => line.match(/^([0-9a-f]{64}) {2}(.+)$/))
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

  assert.deepEqual(
    sorted(manifest.references.map(({ path: referencePath }) => referencePath)),
    sorted(EXPECTED_REFERENCE_PATHS),
  );
  for (const reference of manifest.references) {
    const bytes = readBaselineReference(manifest.referenceBaseline, reference.path);
    assert.equal(reference.bytes, bytes.length, `${reference.path} reference bytes`);
    assert.equal(
      createHash("sha256").update(bytes).digest("hex"),
      reference.sha256,
      reference.path,
    );
    assertEvidence(reference, `reference ${reference.path}`);
  }
});
