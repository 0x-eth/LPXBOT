#!/usr/bin/env node
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFile, readdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import { encodeAbiParameters, keccak256, toFunctionSelector } from "viem";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const ACCEPTANCE = path.join(ROOT, "artifacts/acceptance/P05-04");
const P05_01 = path.join(ROOT, "artifacts/acceptance/P05-01");
const checksumOnly = process.argv.includes("--checksums-only");
const transferTopic = "0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef";
const referenceCoverage = [
  "SWAP-02",
  "POS-02",
  "POS-03",
  "HELPER-02",
  "HELPER-03",
  "HELPER-04",
  "HELPER-06",
];
const pathRules = {
  "observed-v3-path-a": { feeBpsWord: 14, feeRecipientWord: 13, headWords: 15 },
  "observed-v3-path-b": { feeBpsWord: 12, feeRecipientWord: 11, headWords: 13 },
  "observed-v4-path-a": { feeBpsWord: 17, feeRecipientWord: 16, headWords: 18 },
  "observed-v4-path-b": { feeBpsWord: 18, feeRecipientWord: 17, headWords: 19 },
};

function sha256Buffer(value, prefix = true) {
  const digest = createHash("sha256").update(value).digest("hex");
  return prefix ? `sha256:${digest}` : digest;
}

function sha256Json(value) {
  return sha256Buffer(Buffer.from(JSON.stringify(value)));
}

async function json(file) {
  return JSON.parse(await readFile(file, "utf8"));
}

async function writeJson(name, value) {
  await writeFile(path.join(ACCEPTANCE, name), `${JSON.stringify(value, null, 2)}\n`);
}

function addressWord(word) {
  return /^0{24}[0-9a-f]{40}$/u.test(word) ? `0x${word.slice(24)}` : null;
}

function topicAddress(topic) {
  return /^0x[0-9a-f]{64}$/u.test(topic) ? `0x${topic.slice(-40)}` : null;
}

function decimalWord(word) {
  return BigInt(`0x${word}`).toString();
}

function addDelta(deltas, token, account, delta) {
  const key = `${token}:${account}`;
  deltas.set(key, (deltas.get(key) ?? 0n) + delta);
}

function transferLogDeltas(fixture, trackedAddresses) {
  const tracked = new Set(trackedAddresses.filter(Boolean));
  const deltas = new Map();
  let transferLogCount = 0;
  for (const log of fixture.receipt.logs) {
    if (log.topics?.[0] !== transferTopic || log.topics.length < 3) continue;
    const from = topicAddress(log.topics[1]);
    const to = topicAddress(log.topics[2]);
    if (!from || !to || !/^0x[0-9a-f]+$/u.test(log.data)) continue;
    const amount = BigInt(log.data);
    transferLogCount += 1;
    if (tracked.has(from)) addDelta(deltas, log.address, from, -amount);
    if (tracked.has(to)) addDelta(deltas, log.address, to, amount);
  }
  return {
    derivation: "receipt ERC-20 Transfer logs for tracked addresses; not an eth_call balance snapshot",
    transferLogCount,
    deltas: [...deltas.entries()]
      .map(([key, delta]) => {
        const [token, account] = key.split(":");
        return { account, deltaBaseUnit: delta.toString(), token };
      })
      .sort((left, right) => `${left.token}:${left.account}`.localeCompare(`${right.token}:${right.account}`)),
  };
}

function extractFixture(indexEntry, fixture, identities) {
  const rule = pathRules[indexEntry.observedPath];
  if (!rule) throw new Error(`missing extraction rule for ${indexEntry.observedPath}`);
  const argumentsHex = fixture.rawInput.slice(10);
  const word = (index) => argumentsHex.slice(index * 64, (index + 1) * 64);
  const offset = Number(BigInt(`0x${word(1)}`));
  if (offset !== rule.headWords * 32) throw new Error(`${indexEntry.id}: dynamic offset drift`);
  const lengthOffset = offset * 2;
  const payloadBytes = Number(BigInt(`0x${argumentsHex.slice(lengthOffset, lengthOffset + 64)}`));
  const payload = argumentsHex.slice(lengthOffset + 64, lengthOffset + 64 + payloadBytes * 2);
  const payloadWord = (index) => payload.slice(8 + index * 64, 8 + (index + 1) * 64);
  const candidateSelector = payloadBytes >= 4 ? `0x${payload.slice(0, 8)}` : null;
  const candidateTokenPath =
    payloadBytes >= 4 + 7 * 32
      ? [addressWord(payloadWord(1)), addressWord(payloadWord(2))]
      : [];
  const feeRecipientCandidate = addressWord(word(rule.feeRecipientWord));
  const targetCandidate = addressWord(word(3));
  const routerEmittedLog = fixture.receipt.logs.some(
    ({ address }) => address.toLowerCase() === identities.router.address,
  );
  const tracked = [
    fixture.helper.owner,
    fixture.helper.address,
    identities.router.address,
    identities.spender.address,
    feeRecipientCandidate,
  ];
  return {
    id: indexEntry.id,
    source: {
      fixturePath: `artifacts/acceptance/P05-01/${indexEntry.path}`,
      fixtureSha256: indexEntry.sha256,
      transactionHash: fixture.transaction.hash,
    },
    observedPath: indexEntry.observedPath,
    outerSelector: fixture.selector,
    result: {
      receiptStatus: fixture.receipt.status === "0x1" ? "success" : "failure",
      valueBaseUnit: BigInt(fixture.transaction.value).toString(),
    },
    innerRouterCandidate: {
      amountCandidatesBaseUnit:
        payloadBytes >= 4 + 7 * 32
          ? [decimalWord(payloadWord(3)), decimalWord(payloadWord(4))]
          : [],
      candidateSelector,
      candidateTokenPath,
      deadlineCandidate:
        payloadBytes >= 4 + 7 * 32 ? decimalWord(payloadWord(5)) : null,
      payloadBytes,
      recipient: null,
      recipientClassification: "UNKNOWN",
      routerLogEmitterObserved: routerEmittedLog,
      targetAddressCandidate: targetCandidate,
      targetClassification: "INFERRED",
    },
    feeCandidate: {
      basis: "UNKNOWN",
      bps: decimalWord(word(rule.feeBpsWord)),
      ownership: "UNKNOWN",
      recipient: feeRecipientCandidate,
      type: "UNKNOWN",
      wordIndicesZeroBased: {
        bps: rule.feeBpsWord,
        recipient: rule.feeRecipientWord,
      },
    },
    transferLogDeltaSample: transferLogDeltas(fixture, tracked),
    productionDecision: {
      allowed: false,
      reasons: [
        "authoritative router ABI unavailable",
        "no direct call trace proving target and recipient semantics",
        "no failed receipt sample for the candidate selector",
        "no canonical before/after balance snapshots",
      ],
    },
  };
}

function frequency(values) {
  const result = {};
  for (const value of values) result[value] = (result[value] ?? 0) + 1;
  return Object.fromEntries(Object.entries(result).sort(([left], [right]) => left.localeCompare(right)));
}

function component(registry, role) {
  const value = registry.components.find((candidate) => candidate.role === role);
  if (!value) throw new Error(`local Registry component ${role} missing`);
  return value;
}

async function checksums() {
  const files = (await readdir(ACCEPTANCE, { withFileTypes: true }))
    .filter((entry) => entry.isFile() && entry.name !== "sha256sums.txt")
    .map(({ name }) => name)
    .sort();
  const rows = [];
  for (const file of files) {
    rows.push(`${sha256Buffer(await readFile(path.join(ACCEPTANCE, file)), false)}  ${file}`);
  }
  await writeFile(path.join(ACCEPTANCE, "sha256sums.txt"), `${rows.join("\n")}\n`);
}

async function main() {
  if (checksumOnly) {
    await checksums();
    return;
  }

  execFileSync("pnpm", ["--filter", "@lpbot/chain-registry", "build"], {
    cwd: ROOT,
    stdio: "pipe",
  });
  execFileSync("forge", ["build"], { cwd: ROOT, stdio: "pipe" });
  const registryModule = await import(
    `${pathToFileURL(path.join(ROOT, "packages/chain-registry/dist/index.js")).href}?p05-04`
  );
  const registry = registryModule.P05_BSC_LOCAL_EXECUTION_REGISTRY;
  const registryPayload = structuredClone(registry);
  delete registryPayload.registryDigest;
  if (sha256Json(registryPayload) !== registry.registryDigest) {
    throw new Error("local Registry digest mismatch");
  }
  for (const policyName of ["tokenPolicy", "feePolicy"]) {
    const policy = structuredClone(registry[policyName]);
    const expected = policy.policyDigest;
    delete policy.policyDigest;
    if (sha256Json(policy) !== expected) throw new Error(`${policyName} digest mismatch`);
  }

  const [fixtureIndex, productionRegistry, registrySnapshot, localSnapshot, observedCreation] =
    await Promise.all([
      json(path.join(P05_01, "fixture-index.json")),
      json(path.join(P05_01, "registry-contracts.json")),
      json(path.join(P05_01, "fixtures/registry-code-snapshot.json")),
      json(path.join(ACCEPTANCE, "local-anvil-snapshot.json")),
      json(path.join(ACCEPTANCE, "observed-helper-creation.json")),
    ]);
  const productionRegistryBytes = await readFile(path.join(P05_01, "registry-contracts.json"));
  if (productionRegistry.registryVersion !== "p05-bsc-execution-v1" || productionRegistry.executionEnabled) {
    throw new Error("production Registry boundary changed");
  }
  if (productionRegistry.deployments.some(({ router }) => router.allowedSelectors.length !== 0)) {
    throw new Error("production selector allowlist is no longer empty");
  }
  const routerSnapshot = registrySnapshot.components.find(({ id }) => id === "router");
  const spenderSnapshot = registrySnapshot.components.find(({ id }) => id === "spender");
  if (!routerSnapshot || !spenderSnapshot) throw new Error("P05-01 router/spender snapshot missing");
  const identities = {
    router: { ...routerSnapshot, address: routerSnapshot.address.toLowerCase() },
    spender: { ...spenderSnapshot, address: spenderSnapshot.address.toLowerCase() },
  };
  const indexedFixtures = fixtureIndex.fixtures.filter(
    ({ fixtureType }) => fixtureType === "observed-helper-calldata",
  );
  const rows = [];
  for (const indexEntry of indexedFixtures) {
    const fixture = await json(path.join(P05_01, indexEntry.path));
    rows.push(extractFixture(indexEntry, fixture, identities));
  }
  if (rows.length !== 40) throw new Error(`expected 40 observed fixtures, got ${rows.length}`);
  const candidateRows = rows.filter(
    ({ innerRouterCandidate }) => innerRouterCandidate.candidateSelector === "0xf2c42696",
  );
  if (candidateRows.length !== 36) throw new Error("candidate inner selector count drift");

  const evidenceMatrix = {
    schemaVersion: 1,
    workItemId: "P05-04",
    classification: "OBSERVED",
    referenceCoverage,
    source: {
      fixtureIndex: "artifacts/acceptance/P05-01/fixture-index.json",
      immutableBaselineCommit: "63ffc42e3aa371868623f0f22add6b7268df9499",
      extractionMethod: "offline deterministic ABI-envelope and receipt-log parsing",
      networkCalls: 0,
    },
    extractionBoundary: {
      dynamicPayloadOffsetWordZeroBased: 1,
      functionNamesAssignedFromFourByteCollision: false,
      opaqueOuterWordsRemainOpaque: true,
      receiptTransferLogsAreBalanceSnapshots: false,
      authoritativeRouterAbiAvailable: false,
      directCallTraceAvailable: false,
    },
    identities,
    summary: {
      totalFixtures: rows.length,
      successfulReceipts: rows.filter(({ result }) => result.receiptStatus === "success").length,
      failedReceipts: rows.filter(({ result }) => result.receiptStatus === "failure").length,
      fixturesWithEmptyInnerPayload: rows.filter(
        ({ innerRouterCandidate }) => innerRouterCandidate.payloadBytes === 0,
      ).length,
      candidateSelector: "0xf2c42696",
      candidateSelectorSamples: candidateRows.length,
      productionAllowedSelectors: 0,
      decision: "DENY",
    },
    rows,
  };

  const localRouter = component(registry, "router");
  const localSpender = component(registry, "spender");
  const routerPolicy = {
    schemaVersion: 1,
    workItemId: "P05-04",
    production: {
      registryVersion: productionRegistry.registryVersion,
      registrySource: "artifacts/acceptance/P05-01/registry-contracts.json",
      registrySha256: sha256Buffer(productionRegistryBytes),
      executionEnabled: false,
      inheritanceFromLocalRegistry: false,
      router: {
        ...identities.router,
        abi: { authoritative: false, hash: null, status: "UNKNOWN" },
        allowedSelectors: [],
        candidateSelectors: [
          {
            selector: "0xf2c42696",
            name: null,
            namingRule: "four-byte collisions do not establish function identity",
            sampleCount: candidateRows.length,
            successSamples: candidateRows.length,
            failureSamples: 0,
            recipientSemantics: "UNKNOWN",
            decision: "DENY",
          },
        ],
      },
      spender: {
        ...identities.spender,
        abi: { authoritative: false, hash: null, status: "UNKNOWN" },
      },
    },
    local: {
      registryVersion: registry.registryVersion,
      environment: registry.environment,
      chainId: registry.chainId,
      router: localRouter,
      spender: localSpender,
      allowedSelectors: registry.routerSelectorAllowlist,
      selectorEvidence: [
        {
          selector: registry.routerSelectorAllowlist[0],
          typedFunction: "swapExactInput((address,address,uint256,uint256,uint256,address))",
          success: "local-anvil-snapshot.json#/operationEvidence/swap/success",
          failure: "local-anvil-snapshot.json#/operationEvidence/swap/failure",
          tokenPath: localSnapshot.operationEvidence.swap.success.tokenPath,
          recipient: localSnapshot.operationEvidence.swap.success.recipient,
          valueBaseUnit: localSnapshot.operationEvidence.swap.success.valueBaseUnit,
          balanceAndAllowanceSamplesPresent: true,
        },
      ],
      rejectOnMismatch: [
        "chainId",
        "registry version",
        "valid block range",
        "address",
        "ABI hash",
        "runtime code hash",
        "proxy implementation identity",
        "selector allowlist",
      ],
    },
  };

  const feeMatrix = Object.keys(pathRules).map((observedPath) => {
    const pathRows = rows.filter((row) => row.observedPath === observedPath);
    return {
      observedPath,
      samples: pathRows.length,
      recipientCandidates: frequency(pathRows.map(({ feeCandidate }) => feeCandidate.recipient)),
      bpsCandidates: frequency(pathRows.map(({ feeCandidate }) => feeCandidate.bps)),
      basis: "UNKNOWN",
      feeType: "UNKNOWN",
      recipientOwnership: "UNKNOWN",
      productionUseAllowed: false,
    };
  });
  const feePolicy = {
    schemaVersion: 1,
    workItemId: "P05-04",
    categories: {
      dexProtocolFee: { accounting: "separate", localSource: "typed quote/plan", production: "UNKNOWN" },
      lpFee: { accounting: "separate", localSource: "typed quote/plan", production: "UNKNOWN" },
      productServiceFee: {
        accounting: "separate",
        observedRecipientIsProjectOwnershipFact: false,
        production: "UNKNOWN",
      },
      gas: { accounting: "separate", basis: "gasLimit and EIP-1559 fee caps" },
    },
    observedCandidateMatrix: feeMatrix,
    local: registry.feePolicy,
    nonZeroServiceFeeRequirements: {
      currentlyAllowed: false,
      requiredBindings: [
        "policyVersion",
        "recipient allowlist",
        "maximum bps",
        "fee basis",
        "authorization plan digest",
      ],
    },
    production: {
      nonZeroServiceFeeAllowed: false,
      fundsExecutionAllowed: false,
      reason: "authoritative fee policy and candidate fee semantics remain UNKNOWN",
    },
  };

  const tokenPolicy = {
    schemaVersion: 1,
    workItemId: "P05-04",
    identityRule: "address + runtime code hash + implementation address/hash + policy version",
    symbolOnlyIdentityAllowed: false,
    local: registry.tokenPolicy,
    behaviorMatrix: [
      { behavior: "standard", localEvidence: "TestOnlyERC20", registryAllowed: true },
      { behavior: "wrapped-native", localEvidence: "TestOnlyWBNB", registryAllowed: true },
      { behavior: "false-return", localEvidence: "AdversarialToken unit fixture", registryAllowed: false },
      { behavior: "no-return", localEvidence: "AdversarialToken SafeERC20 unit fixture", registryAllowed: false },
      {
        behavior: "usdt-style-approve",
        localEvidence: "AdversarialToken SafeERC20.forceApprove unit fixture",
        registryAllowed: false,
      },
      {
        behavior: "fee-on-transfer",
        localEvidence: "AdversarialToken atomic revert unit fixture",
        registryAllowed: false,
      },
      { behavior: "rebasing", localEvidence: null, registryAllowed: false },
      {
        behavior: "callback-reentrant",
        localEvidence: "AdversarialToken nonReentrant atomic revert unit fixture",
        registryAllowed: false,
      },
      { behavior: "malformed-metadata", localEvidence: null, registryAllowed: false },
    ],
    allowanceAndAmountPolicy: {
      directAllowance: "must equal plan amount before pull",
      internalAllowance: "exact plan amount and reset to zero after call",
      failedCallRecovery: "pre-existing exact owner allowance is reset to zero by an explicit recovery transaction",
      permit2ExpirationMaximumSeconds: registry.tokenPolicy.permit2MaxExpirationSeconds,
      dustLimitBaseUnit: registry.tokenPolicy.dustLimitBaseUnit,
      maxAmountBaseUnit: registry.tokenPolicy.maxAmountBaseUnit,
    },
    production: {
      unclassifiedTokenMode: "read-only",
      executionAllowed: false,
    },
  };

  const helperArtifact = await json(path.join(ROOT, "contracts/out/WalletHelperV1.sol/WalletHelperV1.json"));
  const metadata = helperArtifact.metadata;
  const sourceFiles = [];
  for (const sourcePath of Object.keys(metadata.sources).sort()) {
    const bytes = await readFile(path.join(ROOT, sourcePath));
    sourceFiles.push({ path: sourcePath, sha256: sha256Buffer(bytes) });
  }
  const aggregateSourceHash = sha256Json(sourceFiles);
  const helperAbiHash = sha256Json(helperArtifact.abi);
  const helperIdentity = component(registry, "helper");
  if (
    helperAbiHash !== localSnapshot.helperBaseline.abiHash ||
    helperAbiHash !== helperIdentity.abiHash ||
    keccak256(helperArtifact.bytecode.object) !== localSnapshot.helperBaseline.creationCodeHash ||
    helperIdentity.runtimeCodeHash !== localSnapshot.helperBaseline.runtimeCodeHash
  ) {
    throw new Error("Helper ABI/code baseline does not match local Registry and Anvil");
  }
  const expectedSelectors = helperArtifact.abi
    .filter(({ type }) => type === "function")
    .map(toFunctionSelector)
    .sort();
  if (JSON.stringify(expectedSelectors) !== JSON.stringify(localSnapshot.helperBaseline.abiSelectors)) {
    throw new Error("Helper selector set mismatch");
  }
  const localOwner = localSnapshot.network.wallet;
  const adapter = component(registry, "adapter");
  const permit2 = component(registry, "permit2");
  const [tokenA, tokenB] = registry.tokenPolicy.tokens;
  const constructorEncoding = encodeAbiParameters(
    [
      { type: "address" },
      { type: "address" },
      { type: "address" },
      { type: "address" },
      { type: "bytes32" },
      { type: "address" },
      { type: "bytes32" },
    ],
    [
      localOwner,
      adapter.address,
      permit2.address,
      tokenA.address,
      tokenA.runtimeCodeHash,
      tokenB.address,
      tokenB.runtimeCodeHash,
    ],
  );
  const constructorArgumentsHash = sha256Buffer(Buffer.from(constructorEncoding.slice(2), "hex"));
  const helperBaseline = {
    schemaVersion: 1,
    workItemId: "P05-04",
    classification: "LOCAL-DECISION",
    version: "WalletHelperV1",
    upgradeMode: "deploy-new-helper-no-proxy",
    compiler: {
      version: metadata.compiler.version,
      evmVersion: metadata.settings.evmVersion,
      optimizer: metadata.settings.optimizer,
      metadataBytecodeHash: metadata.settings.metadata.bytecodeHash,
    },
    dependencyPins: localSnapshot.dependencyPins,
    sourceFiles,
    aggregateSourceHash,
    abi: helperArtifact.abi,
    abiHash: helperAbiHash,
    creationCode: {
      bytes: localSnapshot.helperBaseline.creationCodeBytes,
      hash: localSnapshot.helperBaseline.creationCodeHash,
    },
    deterministicDeployment: {
      address: helperIdentity.address,
      constructorArgumentsHash,
      creationInputBytes: localSnapshot.helperBaseline.creationInputBytes,
      creationInputHash: localSnapshot.helperBaseline.creationInputHash,
      owner: localOwner,
      runtimeCodeBytes: localSnapshot.helperBaseline.runtimeCodeBytes,
      runtimeCodeHash: localSnapshot.helperBaseline.runtimeCodeHash,
    },
    selectorSet: expectedSelectors,
    businessSelectorAllowlist: localSnapshot.helperBaseline.businessSelectors,
    observedSelectorsReusedAsBusinessNames: false,
    observedHelperComparison: {
      source: "observed-helper-creation.json",
      creationInputHash: observedCreation.creationBuild.creationInputHash,
      deployments: observedCreation.deployments.map(
        ({ helper, owner, runtimeCodeHash, selectorSet, transactionHash }) => ({
          helper,
          owner,
          runtimeCodeHash,
          selectorSet,
          transactionHash,
        }),
      ),
      runtimeDifference: observedCreation.runtimeComparison.observedDifference,
      sourceOrAuthoritativeAbiAvailable: false,
      productionExecutionAllowed: false,
    },
  };

  const candidateRegistry = {
    schemaVersion: 1,
    workItemId: "P05-04",
    classification: "LOCAL-DECISION",
    referenceCoverage,
    registry,
    digestAlgorithm: "sha256(JSON.stringify(registry without registryDigest), UTF-8)",
    productionBoundary: {
      registryVersion: productionRegistry.registryVersion,
      source: "artifacts/acceptance/P05-01/registry-contracts.json",
      sourceSha256: sha256Buffer(productionRegistryBytes),
      executionEnabled: false,
      localAllowlistInheritance: false,
      byteModificationByP0504: false,
    },
    rejectionPolicy: {
      mismatchFields: [
        "chainId",
        "registryVersion",
        "valid block range",
        "address",
        "ABI hash",
        "runtime code hash",
        "proxy implementation address",
        "proxy implementation runtime code hash",
        "selector",
        "token identity",
      ],
      result: "REJECT",
    },
  };

  const operationPlanContracts = {
    schemaVersion: 1,
    workItemId: "P05-04",
    classification: "LOCAL-DECISION",
    planVersion: "p05-operation-plan-v1",
    source: {
      path: "packages/domain/src/execution-plans.ts",
      sha256: sha256Buffer(await readFile(path.join(ROOT, "packages/domain/src/execution-plans.ts"))),
    },
    planTypes: ["HelperDeploymentPlan", "SwapPlan", "PositionPlan", "SweepPlan"],
    commonDigestBindings: [
      "wallet address and walletId",
      "chainId",
      "nonce",
      "registry version, digest, valid block, and rollback version",
      "target address, selector, runtime code hash, and native value",
      "deadline",
      "fee policy and explicit DEX/LP/service/gas terms",
      "quote digest when required",
      "snapshot digest",
      "token policy version/digest and token runtime/implementation identities",
    ],
    typeSpecificBindings: {
      HelperDeploymentPlan: [
        "owner",
        "adapter",
        "Permit2",
        "constructor arguments hash",
        "creation code hash",
        "expected address and runtime code hash",
      ],
      SwapPlan: ["token path", "amountIn", "minOut", "Permit2 expiration", "owner recipients"],
      PositionPlan: [
        "action",
        "token identities",
        "tokenId",
        "amounts and minima",
        "owner NFT/output/refund recipients",
      ],
      SweepPlan: ["asset identity", "amount", "exact dust policy", "owner recipient"],
    },
    digestAlgorithm:
      "SHA-256 over recursively key-sorted JSON after omitting planDigest and authorizationPlanDigest",
    localValidationContext: {
      adapterAddress: adapter.address,
      chainId: registry.chainId,
      constructorArgumentsHash,
      creationCodeHash: localSnapshot.helperBaseline.creationCodeHash,
      dustLimitBaseUnit: registry.tokenPolicy.dustLimitBaseUnit,
      feePolicyDigest: registry.feePolicy.policyDigest,
      feePolicyVersion: registry.feePolicy.policyVersion,
      helperAddress: helperIdentity.address,
      helperRuntimeCodeHash: helperIdentity.runtimeCodeHash,
      maxAmountBaseUnit: registry.tokenPolicy.maxAmountBaseUnit,
      maxDeadlineWindowSeconds: 86400,
      maxPermit2ExpirationSeconds: registry.tokenPolicy.permit2MaxExpirationSeconds,
      permit2Address: permit2.address,
      registryDigest: registry.registryDigest,
      registryRollbackVersion: registry.rollbackVersion,
      registryValidity: [registry.validFromBlock, registry.validToBlock],
      tokenPolicyDigest: registry.tokenPolicy.policyDigest,
      tokenPolicyVersion: registry.tokenPolicy.policyVersion,
    },
    publicExecutionIntegration: false,
  };

  const executionGate = {
    schemaVersion: 1,
    workItemId: "P05-04",
    evaluatedAt: "2026-08-19T15:15:00.000Z",
    featureImplementationClaimed: false,
    gates: {
      local: {
        status: "OPEN",
        scope: "Foundry and non-forked local Anvil with synthetic wallet/assets only",
        chainIds: [registry.chainId],
        registryVersion: registry.registryVersion,
        allowedHelperSelectors: registry.helperSelectorAllowlist,
        allowedRouterSelectors: registry.routerSelectorAllowlist,
        serviceFeeBps: 0,
        evidence: [
          "candidate-registry.json",
          "router-policy.json",
          "token-policy.json",
          "fee-policy.json",
          "helper-abi-code-hashes.json",
          "operation-plan-contracts.json",
          "local-anvil-snapshot.json",
        ],
      },
      testnet: {
        status: "CLOSED",
        signatures: 0,
        broadcasts: 0,
        reasons: [
          "no testnet-specific Registry or deployment evidence",
          "no independent contract review",
          "production fee authority remains UNKNOWN",
        ],
      },
      production: {
        status: "CLOSED",
        signatures: 0,
        broadcasts: 0,
        realFundOperations: 0,
        reasons: [
          "p05-bsc-execution-v1 executionEnabled is false",
          "production router selector allowlists are empty",
          "candidate router ABI/recipient semantics and failed samples are insufficient",
          "authoritative non-zero fee policy is unavailable",
          "unclassified production tokens are read-only",
          "P05 funds features remain planned",
        ],
      },
    },
  };

  await Promise.all([
    writeJson("evidence-matrix.json", evidenceMatrix),
    writeJson("candidate-registry.json", candidateRegistry),
    writeJson("router-policy.json", routerPolicy),
    writeJson("token-policy.json", tokenPolicy),
    writeJson("fee-policy.json", feePolicy),
    writeJson("helper-abi-code-hashes.json", helperBaseline),
    writeJson("operation-plan-contracts.json", operationPlanContracts),
    writeJson("execution-gate.json", executionGate),
  ]);

  await checksums();
  console.log(`Finalized P05-04 deterministic artifacts from ${rows.length} observed fixtures.`);
}

main().catch((error) => {
  console.error(`P05-04 acceptance finalization failed: ${error.message}`);
  process.exitCode = 1;
});
