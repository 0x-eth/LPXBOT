import {
  IndexerRunner,
  type CanonicalCommit,
  type CanonicalEventStore,
  type IndexerCursor,
  validateProductionIndexerConfig,
} from "../apps/indexer/src/index.js";
import {
  FixtureEventDecoder,
  FixtureRawLogSource,
} from "../apps/indexer/src/testing.js";
import { describe, expect, it } from "vitest";

import { fixtureBlockTimestamp, readP02Fixture } from "./helpers/p02-fixture.js";

class RecordingStore implements CanonicalEventStore {
  commits: CanonicalCommit[] = [];
  currentCursor: IndexerCursor | null = null;

  async commit(commit: CanonicalCommit) {
    this.commits.push(commit);
    const last = commit.events.at(-1);
    if (last) this.currentCursor = last.cursor;
    return {
      acceptedCount: commit.events.filter((event) => !event.removed).length,
      conflictCount: 0,
      cursor: this.currentCursor,
      duplicateCount: 0,
      revertedCount: commit.events.filter((event) => event.removed).length,
    };
  }

  async getCursor(): Promise<IndexerCursor | null> {
    return this.currentCursor;
  }
}

describe("P02-02 IndexerRunner tracer seam", () => {
  it("normalizes the frozen normal fixture with the contracted IDs and cursor", async () => {
    const fixture = readP02Fixture("normal");
    const store = new RecordingStore();
    const runner = new IndexerRunner({
      decoder: new FixtureEventDecoder(fixture.input),
      evaluationTime: () => new Date("2026-08-16T00:05:00.000Z"),
      source: new FixtureRawLogSource(fixture.input, fixtureBlockTimestamp),
      store,
    });

    const result = await runner.runOnce();

    expect(result.acceptedCount).toBe(fixture.expected.acceptedCount);
    expect(store.commits).toHaveLength(1);
    expect(store.commits[0]!.events.map(({ eventId }) => eventId)).toEqual(
      fixture.expected.eventIdsInCanonicalOrder,
    );
    expect(store.commits[0]!.events.at(-1)?.cursor.value).toBe(fixture.expected.lastCursor);
  });

  it("sorts the out-of-order fixture before crossing the store seam", async () => {
    const fixture = readP02Fixture("out-of-order");
    const store = new RecordingStore();
    const runner = new IndexerRunner({
      decoder: new FixtureEventDecoder(fixture.input),
      evaluationTime: () => new Date("2026-08-16T00:05:00.000Z"),
      source: new FixtureRawLogSource(fixture.input, fixtureBlockTimestamp),
      store,
    });

    await runner.runOnce();

    expect(store.commits[0]!.events.map(({ blockNumber }) => blockNumber)).toEqual(
      fixture.expected.committedBlockOrder,
    );
    expect(store.commits[0]!.events.map(({ eventId }) => eventId)).toEqual(
      fixture.expected.eventIdsInCanonicalOrder,
    );
  });

  it("orders an explicit removal before its replacement branch", async () => {
    const fixture = readP02Fixture("reorg");
    const store = new RecordingStore();
    const runner = new IndexerRunner({
      decoder: new FixtureEventDecoder(fixture.input),
      evaluationTime: () => new Date("2026-08-16T00:05:00.000Z"),
      source: new FixtureRawLogSource(fixture.input, fixtureBlockTimestamp),
      store,
    });

    await runner.runOnce();

    expect(store.commits[0]!.events.map(({ removed, blockHash }) => [removed, blockHash])).toEqual([
      [false, fixture.input[0]!.rawLog.blockHash],
      [true, fixture.input[1]!.rawLog.blockHash],
      [false, fixture.input[2]!.rawLog.blockHash],
    ]);
  });

  it("fails closed when production ABI, topic, or protocol address is absent", () => {
    expect(() => validateProductionIndexerConfig({ chainId: 56, protocols: [] })).toThrowError(
      /PRODUCTION_DECODER_CONFIG_MISSING/u,
    );
    expect(() =>
      validateProductionIndexerConfig({
        chainId: 56,
        protocols: [
          {
            abi: [],
            address: null,
            id: "pcsv3",
            topic0: null,
          },
        ],
      }),
    ).toThrowError(/PRODUCTION_DECODER_CONFIG_MISSING/u);
  });

  it("rejects decoderFixtureId anywhere in production configuration", () => {
    expect(() =>
      validateProductionIndexerConfig({
        chainId: 56,
        decoderFixtureId: "fixture://univ3/swap/v1",
        protocols: [],
      }),
    ).toThrowError(/FIXTURE_DECODER_FORBIDDEN/u);
  });
});

