import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";

import {
  PROTOCOL_ABI_HASHES,
  PROTOCOL_EVENT_TOPICS,
} from "../packages/chain-adapters/src/index.js";
import { BSC_PROTOCOL_DEPLOYMENTS } from "../packages/chain-registry/src/index.js";
import { describe, expect, it } from "vitest";

const root = path.resolve("artifacts/acceptance/P02-03");

function json(file: string) {
  return JSON.parse(readFileSync(path.join(root, file), "utf8"));
}

describe("P02-03 acceptance integrity", () => {
  it("keeps P02-01 gaps immutable and records only forward resolutions", () => {
    const frozenGaps = readFileSync("artifacts/acceptance/P02-01/gaps.json");
    expect(createHash("sha256").update(frozenGaps).digest("hex")).toBe(
      "bb043d63634c1e0944bd62b7864e3353dfbfe92e17efbfc176175c6ba8a4f505",
    );
    const resolution = json("gap-resolution.json");
    expect(resolution.direction).toBe("forward-only");
    expect(resolution.sourceGapArtifactModified).toBe(false);
    expect(
      resolution.items.find(({ id }: { id: string }) => id === "GAP-FINALITY-DEPTH"),
    ).toMatchObject({ status: "unresolved" });
  });

  it("matches the code registry and canonical ABI hashes", () => {
    const registry = json("deployment-registry.json");
    expect(
      registry.deployments.map((deployment: Record<string, unknown>) => ({
        abiHash: deployment.abiHash,
        evidenceRefs: deployment.evidenceRefs,
        factory: deployment.factory,
        generation: deployment.generation,
        platformId: deployment.platformId,
        poolManager: deployment.poolManager,
        protocolId: deployment.protocolId,
        runtimeCodeHash: deployment.runtimeCodeHash,
        validFromBlock: deployment.validFromBlock,
        validToBlock: deployment.validToBlock,
      })),
    ).toEqual(
      BSC_PROTOCOL_DEPLOYMENTS.map((deployment) => ({
        abiHash: deployment.abiHash,
        evidenceRefs: [...deployment.evidenceRefs],
        factory: deployment.factory,
        generation: deployment.generation,
        platformId: deployment.platformId,
        poolManager: deployment.poolManager,
        protocolId: deployment.protocolId,
        runtimeCodeHash: deployment.runtimeCodeHash,
        validFromBlock: deployment.validFromBlock,
        validToBlock: deployment.validToBlock,
      })),
    );
    const abiIndex = json("abi-index.json");
    expect(
      Object.fromEntries(
        abiIndex.protocols.map(
          ({ abiHash, platformId }: { abiHash: string; platformId: string }) => [
            platformId,
            abiHash,
          ],
        ),
      ),
    ).toEqual(PROTOCOL_ABI_HASHES);
    expect(
      abiIndex.protocols
        .flatMap(({ events }: { events: { topic0: string }[] }) => events)
        .map(({ topic0 }: { topic0: string }) => topic0),
    ).toEqual(
      expect.arrayContaining([
        ...Object.values(PROTOCOL_EVENT_TOPICS.v3),
        ...Object.values(PROTOCOL_EVENT_TOPICS.v4),
      ]),
    );
  });

  it("provides raw and normalized golden files for every supported row", () => {
    const coverage = json("decoder-coverage.json");
    expect(coverage.supported).toHaveLength(16);
    for (const row of coverage.supported as Array<{
      event: string;
      golden: string;
      protocol: string;
    }>) {
      const raw = json(row.golden);
      const normalized = json(`golden/normalized/${row.protocol}/${row.event}.json`);
      expect(raw).toMatchObject({
        amountSignEvidence: { status: expect.any(String) },
        eventName: row.event,
        protocol: row.protocol,
        schemaVersion: 1,
      });
      expect(normalized).toMatchObject({ chainId: 56, schemaVersion: "1.0.0" });
    }
  });

  it("uses the requested featureless accepted-with-gaps manifest", () => {
    expect(json("manifest.json")).toMatchObject({
      featureIds: [],
      risk: "R1",
      status: "accepted-with-gaps",
      workItemId: "P02-03",
    });
  });
});
