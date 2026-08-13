import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");

const expectedWorkspaces = new Map([
  ["apps/web", "@lpbot/web"],
  ["apps/api", "@lpbot/api"],
  ["apps/worker", "@lpbot/worker"],
  ["apps/indexer", "@lpbot/indexer"],
  ["apps/signer", "@lpbot/signer"],
  ["apps/telegram-bot", "@lpbot/telegram-bot"],
  ["packages/api-contract", "@lpbot/api-contract"],
  ["packages/domain", "@lpbot/domain"],
  ["packages/chain-registry", "@lpbot/chain-registry"],
  ["packages/market-metrics", "@lpbot/market-metrics"],
  ["packages/security", "@lpbot/security"],
  ["packages/observability", "@lpbot/observability"],
  ["packages/test-fixtures", "@lpbot/test-fixtures"],
]);

type PackageManifest = {
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
  exports?: string | Record<string, unknown>;
  name: string;
  optionalDependencies?: Record<string, string>;
  peerDependencies?: Record<string, string>;
  private?: boolean;
};

const dependencyFields = [
  "dependencies",
  "devDependencies",
  "optionalDependencies",
  "peerDependencies",
] as const;

function readManifest(workspacePath: string): PackageManifest {
  return JSON.parse(
    readFileSync(resolve(repositoryRoot, workspacePath, "package.json"), "utf8"),
  ) as PackageManifest;
}

function workspaceDependencies(manifest: PackageManifest): Map<string, string> {
  return new Map(dependencyFields.flatMap((field) => Object.entries(manifest[field] ?? {})));
}

describe("LPBot workspace", () => {
  it("contains every expected app and package scaffold", () => {
    const missingFiles = [...expectedWorkspaces.keys()].flatMap((workspacePath) =>
      ["package.json", "tsconfig.json", "src/index.ts"]
        .map((file) => `${workspacePath}/${file}`)
        .filter((file) => !existsSync(resolve(repositoryRoot, file))),
    );

    expect(missingFiles).toEqual([]);
  });

  it("is discovered by pnpm with unique package names", () => {
    const output = execFileSync("pnpm", ["--recursive", "list", "--depth", "-1", "--json"], {
      cwd: repositoryRoot,
      encoding: "utf8",
    });
    const discovered = (JSON.parse(output) as PackageManifest[])
      .map(({ name }) => name)
      .filter((name) => name.startsWith("@lpbot/"))
      .sort();
    const expected = [...expectedWorkspaces.values()].sort();

    expect(discovered).toEqual(expected);
    expect(new Set(discovered).size).toBe(discovered.length);
  });

  it("resolves every public entry from its package name", () => {
    for (const [workspacePath, expectedName] of expectedWorkspaces) {
      const manifestPath = resolve(repositoryRoot, workspacePath, "package.json");
      const manifest = readManifest(workspacePath);
      const workspaceRequire = createRequire(manifestPath);

      expect(manifest.name).toBe(expectedName);
      expect(manifest.private).toBe(true);
      expect(manifest.exports).toBeDefined();
      const resolvedEntry = workspaceRequire.resolve(expectedName);
      expect(resolvedEntry.startsWith(`${resolve(repositoryRoot, workspacePath)}/`)).toBe(true);
      expect(existsSync(resolvedEntry)).toBe(true);
    }
  });

  it("uses workspace protocol for an acyclic internal dependency graph", () => {
    const manifests = new Map(
      [...expectedWorkspaces].map(([workspacePath, packageName]) => [
        packageName,
        readManifest(workspacePath),
      ]),
    );
    const graph = new Map<string, string[]>();

    for (const [packageName, manifest] of manifests) {
      const internalDependencies = [...workspaceDependencies(manifest)].filter(([dependency]) =>
        manifests.has(dependency),
      );

      for (const [dependency, version] of internalDependencies) {
        expect(version, `${packageName} -> ${dependency}`).toBe("workspace:*");
      }
      graph.set(
        packageName,
        internalDependencies.map(([dependency]) => dependency),
      );
    }

    const visited = new Set<string>();
    const active = new Set<string>();
    const visit = (packageName: string): void => {
      expect(active.has(packageName), `dependency cycle at ${packageName}`).toBe(false);
      if (visited.has(packageName)) return;

      active.add(packageName);
      for (const dependency of graph.get(packageName) ?? []) visit(dependency);
      active.delete(packageName);
      visited.add(packageName);
    };

    for (const packageName of graph.keys()) visit(packageName);
  });

  it("keeps foundational packages and signer inside their boundaries", () => {
    const packageNames = new Map(
      [...expectedWorkspaces].map(([workspacePath, packageName]) => [
        packageName,
        workspaceDependencies(readManifest(workspacePath)),
      ]),
    );
    const appNames = new Set(
      [...expectedWorkspaces]
        .filter(([workspacePath]) => workspacePath.startsWith("apps/"))
        .map(([, packageName]) => packageName),
    );

    for (const packageName of ["@lpbot/api-contract", "@lpbot/domain", "@lpbot/chain-registry"]) {
      const dependencies = packageNames.get(packageName);
      expect(dependencies).toBeDefined();
      for (const appName of appNames) expect(dependencies?.has(appName)).toBe(false);
    }

    expect(packageNames.get("@lpbot/web")?.has("@lpbot/signer")).toBe(false);
    expect(packageNames.get("@lpbot/api")?.has("@lpbot/signer")).toBe(false);
  });
});
