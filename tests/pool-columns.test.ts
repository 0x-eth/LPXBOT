import {
  DEFAULT_POOL_COLUMNS,
  POOL_COLUMN_KEYS,
  movePoolColumn,
  normalizePoolColumns,
  reorderPoolColumn,
  setPoolColumnVisibility,
} from "../apps/web/src/pool-table-state.js";
import { describe, expect, it } from "vitest";

describe("P02-06 pool column preferences", () => {
  it("normalizes legacy, unknown and duplicate columns without moving locked edges", () => {
    const normalized = normalizePoolColumns([
      { key: "fdv", visible: false },
      { key: "unknown", visible: true },
      { key: "fdv", visible: true },
      { key: "actions", visible: false },
      { key: "pool", visible: false },
      { key: "volume", visible: true },
    ]);

    expect(POOL_COLUMN_KEYS).toEqual([
      "pool",
      "protocol",
      "fees",
      "volume",
      "tvl",
      "txs",
      "fdv",
      "actions",
    ]);
    expect(normalized).toEqual([
      { key: "pool", visible: true },
      { key: "fdv", visible: false },
      { key: "volume", visible: true },
      { key: "protocol", visible: true },
      { key: "fees", visible: true },
      { key: "tvl", visible: true },
      { key: "txs", visible: true },
      { key: "actions", visible: true },
    ]);
  });

  it("supports visibility, pointer order, keyboard order and deterministic reset", () => {
    const hidden = setPoolColumnVisibility(DEFAULT_POOL_COLUMNS, "volume", false);
    expect(hidden.find(({ key }) => key === "volume")?.visible).toBe(false);
    expect(setPoolColumnVisibility(hidden, "pool", false)).toEqual(hidden);
    expect(setPoolColumnVisibility(hidden, "actions", false)).toEqual(hidden);

    const pointer = reorderPoolColumn(DEFAULT_POOL_COLUMNS, "fdv", "protocol");
    expect(pointer.map(({ key }) => key)).toEqual([
      "pool",
      "fdv",
      "protocol",
      "fees",
      "volume",
      "tvl",
      "txs",
      "actions",
    ]);
    const keyboard = movePoolColumn(pointer, "fdv", 1);
    expect(keyboard.map(({ key }) => key)).toEqual([
      "pool",
      "protocol",
      "fdv",
      "fees",
      "volume",
      "tvl",
      "txs",
      "actions",
    ]);
    expect(movePoolColumn(keyboard, "pool", 1)).toEqual(keyboard);
    expect(movePoolColumn(keyboard, "actions", -1)).toEqual(keyboard);

    expect(normalizePoolColumns(null)).toEqual(DEFAULT_POOL_COLUMNS);
    expect(normalizePoolColumns(undefined)).toEqual(DEFAULT_POOL_COLUMNS);
  });
});
