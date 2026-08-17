import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash, createHmac } from "node:crypto";
import { access, readFile, readdir } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import Ajv from "ajv";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const ACCEPTANCE = path.join(ROOT, "artifacts/acceptance/P03-01");
const BASELINE = "059d1b56e50a877ec0391a9188eae55dff1c6354";
const FEATURE_IDS = [
  ...Array.from({ length: 6 }, (_, index) => `MON-${String(index + 1).padStart(2, "0")}`),
  ...Array.from({ length: 2 }, (_, index) =>
    `NOTIFY-${String(index + 1).padStart(2, "0")}`,
  ),
];
const REQUIRED_ARTIFACTS = [
  "api-contracts.json",
  "artifact-manifest.json",
  "coverage.json",
  "delivery-contracts.json",
  "domain-contracts.json",
  "fixture-index.json",
  "gaps.json",
  "prior-acceptance-sha256s.txt",
  "security-contracts.json",
  "sha256sums.txt",
  "ui-state-contracts.json",
  "checks/artifact-schema.txt",
  "checks/governance-test.txt",
  "checks/initial-failure.txt",
  "checks/prior-acceptance-integrity.txt",
  "checks/quality-gates.txt",
  "checks/security-audit.txt",
];
const REFERENCE_PATHS = [
  "artifacts/acceptance/P02-01/metric-contracts.json",
  "artifacts/acceptance/P02-11/blocklist-action-contract.json",
  "artifacts/acceptance/P02-11/manifest.json",
  "docs/ARCHITECTURE_AND_WORKFLOWS.md",
  "docs/DEVELOPMENT_ROADMAP.md",
  "docs/FUNCTION_MATRIX.md",
  "docs/TRACEABILITY_MATRIX.md",
  "docs/VIBE_CODING_PLAYBOOK.md",
  "packages/domain/src/index.ts",
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

function digest(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

function parseChecksums(source, label) {
  const rows = source
    .trimEnd()
    .split("\n")
    .map((line, index) => {
      const match = /^([0-9a-f]{64}) {2}(.+)$/.exec(line);
      assert.ok(match, `${label} line ${index + 1} is invalid`);
      return { sha256: match[1], path: match[2] };
    });
  unique(
    rows.map((row) => row.path),
    `${label} paths`,
  );
  return rows;
}

function git(args, options = {}) {
  const result = spawnSync("git", args, {
    cwd: ROOT,
    encoding: Object.hasOwn(options, "encoding") ? options.encoding : "utf8",
    maxBuffer: 64 * 1024 * 1024,
  });
  assert.equal(
    result.status,
    0,
    `git ${args.join(" ")} failed: ${result.stderr?.toString("utf8") ?? ""}`,
  );
  return result.stdout;
}

function baselineBytes(relativePath) {
  assert.equal(path.isAbsolute(relativePath), false, `${relativePath} must be relative`);
  assert.equal(relativePath.includes(".."), false, `${relativePath} must stay in the repository`);
  return git(["show", `${BASELINE}:${relativePath}`], { encoding: null });
}

async function filesBelow(directory, prefix = "") {
  const files = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const relativePath = path.posix.join(prefix, entry.name);
    if (entry.isDirectory()) {
      files.push(...(await filesBelow(path.join(directory, entry.name), relativePath)));
    } else if (entry.isFile()) {
      files.push(relativePath);
    } else {
      assert.fail(`unsupported artifact entry: ${relativePath}`);
    }
  }
  return sorted(files);
}

test("P03-01 required reference artifacts exist", async () => {
  for (const relativePath of REQUIRED_ARTIFACTS) {
    await access(path.join(ACCEPTANCE, relativePath));
  }
});

test("P03-01 manifest satisfies its JSON Schema and freezes reference-only scope", async () => {
  const [manifest, schema] = await Promise.all([
    readJson("artifact-manifest.json"),
    readFile(path.join(ROOT, "schemas/p03-reference-artifacts.schema.json"), "utf8").then(
      JSON.parse,
    ),
  ]);
  const validate = new Ajv({ allErrors: true, strict: false }).compile(schema);
  assert.equal(
    validate(manifest),
    true,
    (validate.errors ?? [])
      .map((error) => `${error.instancePath || "/"} ${error.message}`)
      .join("\n"),
  );
  assert.equal(manifest.referenceBaseline, BASELINE);
  assert.deepEqual(manifest.featureIds, []);
  assert.deepEqual(manifest.scope, {
    mode: "reference-only",
    implementationOwnership: "none",
    databaseChanges: false,
    businessTables: false,
    productionRoutes: false,
    workers: false,
    realNotificationAdapters: false,
    externalNetwork: false,
    productionSecrets: false,
  });
});

test("MON-01..06 and NOTIFY-01..02 remain 0 implemented-assumed / 8 planned", async () => {
  const coverage = await readJson("coverage.json");
  assert.equal(coverage.workItemId, "P03-01");
  assert.equal(coverage.phase, "P03");
  assert.deepEqual(coverage.workItemFeatureIds, []);
  assert.equal(coverage.implementationOwnership, "none");
  assert.equal(coverage.counts["implemented-assumed"], 0);
  assert.equal(coverage.counts.planned, 8);
  unique(
    coverage.features.map(({ id }) => id),
    "coverage feature IDs",
  );
  assert.deepEqual(sorted(coverage.features.map(({ id }) => id)), sorted(FEATURE_IDS));
  for (const feature of coverage.features) {
    assert.equal(feature.phase, "P03", `${feature.id} phase`);
    assert.equal(feature.status, "planned", `${feature.id} status`);
    assert.equal(feature.implementationOwner, null, `${feature.id} implementation owner`);
  }
});

test("monitor API contract freezes CRUD, lifecycle, preferences, history, and test delivery", async () => {
  const contract = await readJson("api-contracts.json");
  assert.equal(contract.implementationStatus, "planned");
  assert.equal(contract.authentication, "session-required");
  assert.equal(contract.ownership.crossUserAccess, "deny-not-found");
  const endpoints = new Map(
    contract.endpoints.map((endpoint) => [`${endpoint.method} ${endpoint.path}`, endpoint]),
  );
  const expected = [
    "GET /api/monitors",
    "POST /api/monitors",
    "GET /api/monitors/:monitorId",
    "PATCH /api/monitors/:monitorId",
    "DELETE /api/monitors/:monitorId",
    "POST /api/monitors/:monitorId/enable",
    "POST /api/monitors/:monitorId/disable",
    "GET /api/notifications/history",
    "GET /api/notification-preferences",
    "PATCH /api/notification-preferences",
    "GET /api/notification-destinations",
    "POST /api/notification-destinations",
    "PATCH /api/notification-destinations/:destinationId",
    "DELETE /api/notification-destinations/:destinationId",
    "POST /api/notification-destinations/test",
  ];
  assert.deepEqual(sorted(endpoints.keys()), sorted(expected));
  for (const key of expected) {
    const endpoint = endpoints.get(key);
    assert.equal(endpoint.authentication, "session-required", `${key} authentication`);
    assert.equal(endpoint.ownerScope, "current-user", `${key} ownership`);
    assert.equal(endpoint.cacheControl, "no-store", `${key} cache policy`);
    assert.equal(endpoint.implementationStatus, "planned", `${key} implementation status`);
    assert.equal(endpoint.productionRoute, false, `${key} must not claim a route`);
    assert.ok(endpoint.success, `${key} success contract`);
    assert.ok(endpoint.errors.length > 0, `${key} errors`);
  }
  for (const key of [
    "PATCH /api/monitors/:monitorId",
    "DELETE /api/monitors/:monitorId",
    "POST /api/monitors/:monitorId/enable",
    "POST /api/monitors/:monitorId/disable",
    "PATCH /api/notification-preferences",
    "PATCH /api/notification-destinations/:destinationId",
    "DELETE /api/notification-destinations/:destinationId",
  ]) {
    assert.equal(endpoints.get(key).concurrency, "expected-revision-required", key);
  }
  assert.equal(
    endpoints.get("POST /api/notification-destinations/test").persistence,
    "never-persist-draft-or-test",
  );
});

test("domain contract freezes monitor ownership, AND evaluation, freshness, and fail-closed metrics", async () => {
  const contract = await readJson("domain-contracts.json");
  assert.deepEqual(contract.monitor.requiredFields, [
    "monitorId",
    "userId",
    "revision",
    "name",
    "poolKey",
    "windowMinutes",
    "enabled",
    "conditions",
    "createdAt",
    "updatedAt",
    "enabledAt",
    "disabledAt",
  ]);
  assert.equal(contract.monitor.monitorId.authority, "server-generated");
  assert.equal(contract.monitor.userId.authority, "authenticated-session");
  assert.equal(contract.monitor.userId.mutable, false);
  assert.equal(contract.monitor.revision.initial, 1);
  assert.equal(contract.monitor.revision.increment, "each-effective-mutation");
  assert.deepEqual(contract.monitor.lifecycle.states, ["disabled", "enabled"]);
  assert.equal(contract.conditions.combination, "AND");
  assert.equal(contract.conditions.disabledConditions, "excluded-from-conjunction");
  assert.equal(contract.conditions.zeroEnabledConditions, "invalid-monitor-no-match");

  const metricConditions = by(contract.conditions.metricConditions, "id");
  assert.deepEqual(
    sorted(metricConditions.keys()),
    sorted([
      "feeTvlRatio",
      "feesUsd",
      "metricVersion",
      "transactionCount",
      "tvlUsd",
      "volumeUsd",
    ]),
  );
  assert.deepEqual(
    sorted(contract.conditions.unresolved.map(({ id }) => id)),
    ["activeTvlUsd", "feeAtvlRatio"],
  );
  for (const unresolved of contract.conditions.unresolved) {
    assert.equal(unresolved.status, "unresolved");
    assert.equal(unresolved.configurable, false);
    assert.equal(unresolved.matchable, false);
  }

  assert.deepEqual(contract.evaluationInput.requiredFields, [
    "poolKey",
    "windowEnd",
    "generatedAt",
    "metricVersion",
  ]);
  assert.equal(contract.evaluationInput.poolKey.stability, "P02-stable-poolKey");
  assert.equal(contract.freshness.maxAgeSeconds, 120);
  assert.equal(contract.freshness.boundary, "age <= maxAgeSeconds");
  assert.equal(contract.freshness.clock, "server-UTC");
  assert.deepEqual(contract.failClosedMetricStates, [
    "missing",
    "null",
    "non-finite",
    "not-ready",
    "partial-required-metric",
    "stale",
  ]);
  assert.equal(contract.eligibility.order[0], "authenticate-owner");
  assert.ok(contract.eligibility.order.indexOf("P02-11-blocklist") < contract.eligibility.order.indexOf("conditions-AND"));
  assert.equal(contract.eligibility.blocklist.authority, "server");
  assert.equal(
    contract.eligibility.blocklist.source,
    "artifacts/acceptance/P02-11/blocklist-action-contract.json",
  );
  assert.deepEqual(contract.eligibility.blocklist.blockedWhen, [
    "poolKey-blocked",
    "token0Address-blocked",
    "token1Address-blocked",
  ]);
  assert.equal(contract.evaluator.networkIo, "forbidden");
  assert.deepEqual(contract.evaluator.effects, []);
  assert.deepEqual(contract.evaluator.output, ["no-match", "candidate"]);
  assert.equal(
    contract.candidate.candidateKey.canonicalInput,
    "monitor-candidate/v1\\n{monitorId}\\n{revision}\\n{poolKey}\\n{windowEnd}\\n{metricVersion}",
  );
  assert.equal(contract.candidate.candidateKey.algorithm, "SHA-256");
  assert.equal(contract.candidate.generatedAt.binding, "evidence-field-not-key-field");
});

test("evaluation fixtures cover boundaries, invalid inputs, duplicates, ordering, and reorg replacement", async () => {
  const evaluation = await readJson("fixtures/evaluation-cases.json");
  const cases = by(evaluation.input.cases, "id");
  const requiredCases = [
    "all-and-match",
    "one-and-condition-fails",
    "exact-lower-boundary",
    "just-below-lower-boundary",
    "exact-freshness-boundary",
    "stale-beyond-boundary",
    "metric-missing",
    "metric-null",
    "metric-non-finite",
    "snapshot-not-ready",
    "snapshot-partial-required-metric",
    "pool-blocklisted",
    "token-blocklisted",
    "active-tvl-unresolved",
    "fee-atvl-unresolved",
  ];
  assert.deepEqual(sorted(cases.keys()), sorted(requiredCases));
  for (const id of ["all-and-match", "exact-lower-boundary", "exact-freshness-boundary"]) {
    assert.equal(cases.get(id).expected.matched, true, id);
    assert.match(cases.get(id).expected.candidateKey, /^[0-9a-f]{64}$/, id);
  }
  const monitor = evaluation.input.monitor;
  const snapshot = evaluation.input.snapshotDefaults;
  const candidateInput = [
    "monitor-candidate/v1",
    monitor.monitorId,
    String(monitor.revision),
    monitor.poolKey,
    snapshot.windowEnd,
    snapshot.metricVersion,
  ].join("\n");
  assert.equal(
    digest(Buffer.from(candidateInput, "utf8")),
    cases.get("all-and-match").expected.candidateKey,
    "candidate key known-answer vector",
  );
  for (const id of requiredCases.filter(
    (id) => !["all-and-match", "exact-lower-boundary", "exact-freshness-boundary"].includes(id),
  )) {
    assert.equal(cases.get(id).expected.matched, false, id);
    assert.equal(typeof cases.get(id).expected.reason, "string", `${id} reason`);
  }

  const dedupe = await readJson("fixtures/dedupe-ordering.json");
  assert.deepEqual(dedupe.expected.arrivalWindowOrder, [
    "2026-08-17T09:10:00Z",
    "2026-08-17T09:05:00Z",
    "2026-08-17T09:10:00Z",
  ]);
  assert.deepEqual(dedupe.expected.evaluationWindowOrder, [
    "2026-08-17T09:05:00Z",
    "2026-08-17T09:10:00Z",
  ]);
  assert.equal(dedupe.expected.uniqueCandidateCount, 2);
  assert.equal(dedupe.expected.uniqueOutboxCount, 2);
  assert.equal(dedupe.expected.duplicateCreatesSecondNotification, false);

  const reorg = await readJson("fixtures/reorg-replacement.json");
  assert.equal(reorg.input.generations.length, 2);
  assert.equal(reorg.input.generations[1].replacesGenerationId, reorg.input.generations[0].id);
  assert.notEqual(
    reorg.input.generations[0].canonicalBlockHash,
    reorg.input.generations[1].canonicalBlockHash,
  );
  assert.equal(reorg.expected.candidateKeyStable, true);
  assert.equal(reorg.expected.uniqueCandidateCount, 1);
  assert.equal(reorg.expected.uniqueOutboxCount, 1);
  assert.equal(reorg.expected.selectedGenerationId, reorg.input.generations[1].id);
  assert.equal(reorg.expected.secondNotification, false);
});

test("delivery contract freezes outbox leases, retries, idempotency, and worker isolation", async () => {
  const contract = await readJson("delivery-contracts.json");
  assert.deepEqual(contract.outbox.states, [
    "pending",
    "leased",
    "retry-wait",
    "delivered",
    "dead",
  ]);
  assert.deepEqual(contract.outbox.terminalStates, ["delivered", "dead"]);
  assert.equal(contract.outbox.uniqueConstraint, "dedupeKey");
  assert.equal(contract.outbox.duplicateInsert, "return-existing-without-second-row");
  assert.equal(contract.outbox.lease.clock, "database-UTC");
  assert.equal(contract.outbox.lease.durationSeconds, 60);
  assert.equal(contract.outbox.lease.claim, "atomic-skip-locked-compare-and-set");
  assert.equal(contract.outbox.lease.tokenRequiredForCompletion, true);
  assert.equal(contract.outbox.attempt.incrementAt, "lease-before-network-attempt");
  assert.equal(contract.outbox.attempt.maxAttempts, 6);
  assert.deepEqual(contract.outbox.retry.backoffSeconds, [30, 120, 600, 1800, 3600]);
  assert.equal(contract.outbox.crashRecovery.expiredLease, "reclaim-with-attempt-preserved");
  assert.equal(contract.outbox.crashRecovery.lateLeaseResult, "ignore-token-mismatch");
  assert.equal(contract.workerIsolation.evaluatorNetworkIo, false);
  assert.equal(contract.workerIsolation.marketWorkerWaitsForDelivery, false);
  assert.equal(contract.workerIsolation.deliveryFailureAffectsMarketCommit, false);
  assert.equal(
    contract.dedupeKey.canonicalInput,
    "notification/v1\\n{candidateKey}\\n{destinationId}\\n{destinationRevision}",
  );
  assert.equal(contract.dedupeKey.algorithm, "SHA-256");
  assert.equal(contract.testDelivery.sink, "local-sink://p03-01");
  assert.equal(contract.testDelivery.realTelegram, false);
  assert.equal(contract.testDelivery.realWebhook, false);

  const recovery = await readJson("fixtures/outbox-recovery.json");
  const scenarios = by(recovery.input.scenarios, "id");
  assert.deepEqual(sorted(scenarios.keys()), [
    "crash-after-lease",
    "duplicate-consumption",
    "permanent-failure",
    "retry-then-deliver",
  ]);
  assert.equal(scenarios.get("crash-after-lease").expected.reclaimable, true);
  assert.equal(scenarios.get("crash-after-lease").expected.attemptAfterReclaim, 2);
  assert.equal(scenarios.get("duplicate-consumption").expected.outboxRows, 1);
  assert.equal(scenarios.get("retry-then-deliver").expected.finalState, "delivered");
  assert.equal(scenarios.get("permanent-failure").expected.finalState, "dead");
});

test("security contract freezes templates, SSRF controls, signatures, and local-only tests", async () => {
  const contract = await readJson("security-contracts.json");
  assert.deepEqual(contract.webhook.methods, ["GET", "POST"]);
  assert.equal(contract.webhook.url.allowedSchemes, "https-only-production");
  assert.equal(contract.webhook.url.templateLocations.host, false);
  assert.equal(contract.webhook.url.templateLocations.path, false);
  assert.equal(contract.webhook.url.templateLocations.queryValues, true);
  assert.equal(contract.templates.unknownVariable, "validation-error");
  assert.equal(contract.templates.getEncoding, "RFC3986-percent-encode-each-value");
  assert.equal(contract.templates.postEncoding, "JSON-string-escape-before-substitution");
  assert.equal(contract.templates.telegramEncoding, "Telegram-HTML-escape-&-less-than-greater-than");
  assert.deepEqual(contract.templates.limits, {
    templateBytes: 16384,
    expandedUrlBytes: 4096,
    requestBodyBytes: 65536,
    responseBodyBytes: 65536,
    telegramMessageCodePoints: 4096,
  });

  assert.equal(contract.ssrf.resolveBeforeConnect, true);
  assert.equal(contract.ssrf.allResolvedAddressesMustPass, true);
  assert.equal(contract.ssrf.pinValidatedAddressForConnection, true);
  assert.equal(contract.ssrf.revalidateOnEveryRedirect, true);
  assert.equal(contract.ssrf.reResolveOnEveryConnection, true);
  assert.equal(contract.ssrf.dnsRebindingPolicy, "reject-address-set-change-to-blocked");
  assert.equal(contract.ssrf.maxRedirects, 3);
  assert.ok(contract.ssrf.blockedIpv4.includes("127.0.0.0/8"));
  assert.ok(contract.ssrf.blockedIpv4.includes("10.0.0.0/8"));
  assert.ok(contract.ssrf.blockedIpv4.includes("169.254.0.0/16"));
  assert.ok(contract.ssrf.blockedIpv6.includes("::1/128"));
  assert.ok(contract.ssrf.blockedIpv6.includes("fc00::/7"));
  assert.ok(contract.ssrf.blockedIpv6.includes("fe80::/10"));
  assert.equal(contract.ssrf.ipv4MappedIpv6, "normalize-to-IPv4-before-policy");

  assert.equal(contract.signature.algorithm, "HMAC-SHA256");
  assert.equal(contract.signature.timestamp.unit, "unix-seconds");
  assert.equal(contract.signature.timestamp.maxSkewSeconds, 300);
  assert.equal(contract.signature.deliveryId.header, "X-LPX-Delivery-Id");
  assert.equal(contract.signature.bodyDigest.header, "X-LPX-Content-SHA256");
  assert.equal(contract.signature.bodyDigest.algorithm, "SHA-256");
  assert.equal(contract.signature.signature.header, "X-LPX-Signature");
  assert.equal(contract.signature.signature.format, "v1=<lowercase-hex>");
  assert.equal(
    contract.signature.canonicalInput,
    "v1\\n{timestamp}\\n{deliveryId}\\n{method}\\n{pathAndQuery}\\n{bodySha256}",
  );
  assert.equal(contract.signature.verification, "constant-time");
  assert.equal(contract.testPolicy.onlySink, "local-sink://p03-01");
  assert.equal(contract.testPolicy.networkIo, false);
  assert.equal(contract.testPolicy.realTelegram, false);
  assert.equal(contract.testPolicy.realWebhook, false);

  const fixture = await readJson("fixtures/webhook-security.json");
  const templateCases = by(fixture.input.templateCases, "id");
  assert.deepEqual(sorted(templateCases.keys()), [
    "get-percent-escaping",
    "oversize-expanded-body",
    "post-json-escaping",
    "telegram-html-escaping",
    "unknown-variable",
  ]);
  assert.equal(templateCases.get("unknown-variable").expected.error, "UNKNOWN_TEMPLATE_VARIABLE");
  assert.equal(templateCases.get("oversize-expanded-body").expected.error, "BODY_TOO_LARGE");
  assert.equal(fixture.expected.signature.bodySha256.length, 64);
  assert.equal(fixture.expected.signature.value.startsWith("v1="), true);
  assert.equal(
    digest(Buffer.from(fixture.input.signature.body, "utf8")),
    fixture.expected.signature.bodySha256,
    "body digest known-answer vector",
  );
  assert.equal(
    `v1=${createHmac("sha256", fixture.input.signature.fixtureKey)
      .update(fixture.expected.signature.canonicalInput, "utf8")
      .digest("hex")}`,
    fixture.expected.signature.value,
    "HMAC-SHA256 known-answer vector",
  );

  const ssrf = await readJson("fixtures/ssrf-policy.json");
  const ssrfCases = by(ssrf.input.cases, "id");
  for (const id of [
    "dns-mixed-public-private",
    "dns-rebinding",
    "ipv4-loopback",
    "ipv4-private",
    "ipv6-loopback",
    "ipv6-unique-local",
    "ipv4-mapped-ipv6-loopback",
    "redirect-to-private",
  ]) {
    assert.equal(ssrfCases.get(id).expected.allowed, false, id);
  }
  for (const id of ["public-a-and-aaaa", "redirect-all-public"]) {
    assert.equal(ssrfCases.get(id).expected.allowed, true, id);
  }
});

test("UI contract freezes monitor, destination, and history states without implementation claims", async () => {
  const contract = await readJson("ui-state-contracts.json");
  assert.equal(contract.route, "/monitors");
  assert.equal(contract.implementationStatus, "planned");
  assert.equal(contract.implementedComponents, 0);
  assert.deepEqual(sorted(contract.views.map(({ id }) => id)), [
    "destination-settings",
    "monitor-editor",
    "monitor-list",
    "notification-history",
    "notification-preferences",
  ]);
  assert.deepEqual(sorted(contract.operationalStates.map(({ id }) => id)), [
    "conflict",
    "disabled",
    "empty",
    "error",
    "loading",
    "not-ready",
    "ready",
    "retrying",
    "stale",
  ]);
  assert.equal(contract.conditionEditor.combinationLabel, "All conditions (AND)");
  assert.deepEqual(contract.conditionEditor.unavailableMetrics, ["activeTvlUsd", "feeAtvlRatio"]);
  assert.equal(contract.testNotification.persistDraft, false);
  assert.equal(contract.testNotification.sink, "local-sink://p03-01");
  assert.deepEqual(contract.deliveryStatusPresentation, {
    pending: "pending",
    leased: "sending",
    "retry-wait": "retrying",
    delivered: "delivered",
    dead: "failed",
  });
});

test("fixture index hashes every offline fixture and all unresolved subjects have gaps", async () => {
  const [index, domain, security, gaps] = await Promise.all([
    readJson("fixture-index.json"),
    readJson("domain-contracts.json"),
    readJson("security-contracts.json"),
    readJson("gaps.json"),
  ]);
  assert.equal(index.networkPolicy, "offline-local-sink-only");
  assert.equal(index.realTelegram, false);
  assert.equal(index.realWebhook, false);
  const expectedScenarios = [
    "dedupe-ordering",
    "evaluation-cases",
    "outbox-recovery",
    "reorg-replacement",
    "ssrf-policy",
    "webhook-security",
  ];
  assert.deepEqual(sorted(index.fixtures.map(({ scenario }) => scenario)), expectedScenarios);
  unique(
    index.fixtures.map(({ id }) => id),
    "fixture IDs",
  );
  for (const fixture of index.fixtures) {
    assert.match(fixture.path, /^fixtures\/[a-z0-9-]+\.json$/u);
    assert.match(fixture.schemaId, /^p03-fixture:\/\/[a-z0-9-]+\/v1$/u);
    const bytes = await readFile(path.join(ACCEPTANCE, fixture.path));
    assert.equal(fixture.bytes, bytes.length, `${fixture.id} bytes`);
    assert.equal(fixture.sha256, digest(bytes), `${fixture.id} sha256`);
    const contents = JSON.parse(bytes.toString("utf8"));
    assert.equal(contents.schemaVersion, 1, `${fixture.id} schemaVersion`);
    assert.equal(contents.schemaId, fixture.schemaId, `${fixture.id} schemaId`);
    assert.equal(contents.scenario, fixture.scenario, `${fixture.id} scenario`);
    assert.equal(contents.fixtureOnly, true, `${fixture.id} fixtureOnly`);
    assert.equal(contents.networkAccess, false, `${fixture.id} networkAccess`);
    assert.ok(contents.input, `${fixture.id} input`);
    assert.ok(contents.expected, `${fixture.id} expected`);
  }

  const gapMap = by(gaps.items, "id");
  unique(
    gaps.items.map(({ id }) => id),
    "gap IDs",
  );
  const unresolvedRefs = [...domain.unresolvedRefs, ...security.unresolvedRefs];
  unique(unresolvedRefs, "unresolved references");
  assert.deepEqual(sorted(gapMap.keys()), sorted(unresolvedRefs));
  for (const id of unresolvedRefs) {
    const gap = gapMap.get(id);
    assert.equal(gap.status, "unresolved", id);
    assert.equal(gap.blocksParity, true, id);
    assert.ok(gap.reason.length > 0, `${id} reason`);
  }
  assert.equal(gapMap.get("GAP-P03-ACTIVE-TVL").subject, "active TVL");
  assert.equal(gapMap.get("GAP-P03-FEE-ATVL").subject, "Fee/aTVL");
});

test("manifest reference hashes are anchored to the requested baseline", async () => {
  const manifest = await readJson("artifact-manifest.json");
  assert.deepEqual(sorted(manifest.references.map(({ path: value }) => value)), sorted(REFERENCE_PATHS));
  unique(
    manifest.references.map(({ path: value }) => value),
    "reference paths",
  );
  for (const reference of manifest.references) {
    const bytes = baselineBytes(reference.path);
    assert.equal(reference.bytes, bytes.length, `${reference.path} bytes`);
    assert.equal(reference.sha256, digest(bytes), `${reference.path} sha256`);
    assert.equal(reference.commit, BASELINE, `${reference.path} commit`);
    assert.ok(reference.source.length > 0, `${reference.path} source`);
    assert.match(
      reference.evidenceLevel,
      /^(documented|locally-defined|unresolved)$/u,
      `${reference.path} evidence level`,
    );
  }
});

test("P00-P02 acceptance files remain byte-identical to the baseline inventory", async () => {
  const rows = parseChecksums(
    await readFile(path.join(ACCEPTANCE, "prior-acceptance-sha256s.txt"), "utf8"),
    "prior acceptance checksums",
  );
  const baselinePaths = git([
    "ls-tree",
    "-r",
    "--name-only",
    BASELINE,
    "--",
    "artifacts/acceptance",
  ])
    .trimEnd()
    .split("\n")
    .filter((relativePath) => /^artifacts\/acceptance\/P0[0-2]-[^/]+\//u.test(relativePath));
  assert.deepEqual(
    sorted(rows.map(({ path: value }) => value)),
    sorted(baselinePaths),
    "prior acceptance inventory must be exhaustive",
  );
  for (const row of rows) {
    const current = await readFile(path.join(ROOT, row.path));
    assert.equal(digest(current), row.sha256, `${row.path} current sha256`);
    assert.equal(digest(baselineBytes(row.path)), row.sha256, `${row.path} baseline sha256`);
  }
});

test("manifest inventory and sha256sums cover every non-self-referential P03-01 artifact", async () => {
  const manifest = await readJson("artifact-manifest.json");
  const rows = parseChecksums(
    await readFile(path.join(ACCEPTANCE, "sha256sums.txt"), "utf8"),
    "P03-01 checksums",
  );
  const actualPaths = (await filesBelow(ACCEPTANCE)).filter(
    (relativePath) => !["artifact-manifest.json", "sha256sums.txt"].includes(relativePath),
  );
  assert.deepEqual(sorted(rows.map(({ path: value }) => value)), actualPaths);
  assert.deepEqual(sorted(manifest.files.map(({ path: value }) => value)), actualPaths);
  const checksumMap = by(rows, "path");
  const manifestMap = by(manifest.files, "path");
  for (const relativePath of actualPaths) {
    const bytes = await readFile(path.join(ACCEPTANCE, relativePath));
    const sha256 = digest(bytes);
    assert.equal(checksumMap.get(relativePath).sha256, sha256, `${relativePath} checksum`);
    assert.equal(manifestMap.get(relativePath).sha256, sha256, `${relativePath} manifest hash`);
    assert.equal(manifestMap.get(relativePath).bytes, bytes.length, `${relativePath} manifest bytes`);
  }
});
