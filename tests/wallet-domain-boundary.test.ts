import { readFile } from "node:fs/promises";

import { describe, expect, it } from "vitest";

const authFiles = [
  "apps/api/src/app.ts",
  "apps/api/src/login-wallet-auth-config.ts",
  "apps/api/src/postgres-session-store.ts",
  "apps/web/src/App.tsx",
  "apps/web/src/auth-client.ts",
  "apps/web/src/eip1193-wallet.ts",
  "packages/security/src/login-wallet-auth.ts",
];

describe("P01-04 auth identity domain boundary", () => {
  it("keeps login wallets separate from signer and transaction capabilities", async () => {
    const sources = (await Promise.all(authFiles.map((path) => readFile(path, "utf8")))).join("\n");

    expect(sources).not.toMatch(/from\s+["'][^"']*signer/iu);
    expect(sources).not.toContain("eth_sendTransaction");
    expect(sources).not.toContain("eth_signTransaction");
    expect(sources).not.toContain("wallet_switchEthereumChain");
    expect(sources).not.toContain("wallet_addEthereumChain");
    expect(sources).not.toMatch(/\b(?:privateKey|mnemonic|seedPhrase|encryptedWallet)\b/u);
  });

  it("does not persist wallet auth material in browser storage", async () => {
    const webAuth = await Promise.all(
      ["apps/web/src/auth-client.ts", "apps/web/src/eip1193-wallet.ts"].map((path) =>
        readFile(path, "utf8"),
      ),
    );
    expect(webAuth.join("\n")).not.toContain("localStorage");
    expect(webAuth.join("\n")).not.toContain("sessionStorage");
  });
});
