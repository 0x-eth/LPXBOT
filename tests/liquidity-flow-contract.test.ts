import {
  canonicalizeLiquidityProtocols,
  liquidityFlowEventTypes,
  liquidityFlowProtocols,
  liquidityFlowSchemaVersion,
  marketStreamKey,
  parseLiquidityProtocolFilter,
} from "../packages/api-contract/src/index.js";
import { describe, expect, it } from "vitest";

describe("P02-04 shared liquidity flow contracts", () => {
  it("freezes BSC flow schema, event types, and the four production protocols", () => {
    expect(liquidityFlowSchemaVersion).toBe("1.0.0");
    expect(liquidityFlowEventTypes).toEqual(["create", "add", "remove"]);
    expect(liquidityFlowProtocols).toEqual(["pcsv3", "univ3", "pcsv4", "univ4"]);
  });

  it("sorts and deduplicates DEX sets into one stable stream key", () => {
    const protocols = canonicalizeLiquidityProtocols(["univ4", "pcsv3", "univ4"]);

    expect(protocols).toEqual(["pcsv3", "univ4"]);
    expect(parseLiquidityProtocolFilter("univ4,pcsv3,univ4")).toEqual(protocols);
    expect(marketStreamKey({ chainId: 56, minutes: 5, protocols })).toBe(
      "top-fees:56:5:dex=pcsv3,univ4",
    );
  });

  it.each(["", "pancake", "pcsv3,", "pcsv3,univ2", ["pcsv3", "ethereum"]])(
    "rejects an invalid DEX filter: %j",
    (value) => {
      expect(() => parseLiquidityProtocolFilter(value)).toThrowError("DEX_FILTER_INVALID");
    },
  );
});
