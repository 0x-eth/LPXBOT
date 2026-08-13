import { spawnSync } from "node:child_process";
import { readFile, readdir, stat } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const SCRIPT_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function option(name, fallback) {
  const index = process.argv.indexOf(`--${name}`);
  return index === -1 ? fallback : process.argv[index + 1];
}

const ROOT = path.resolve(option("repo-root", SCRIPT_ROOT));
const failures = [];

async function file(relativePath) {
  return readFile(path.join(ROOT, relativePath), "utf8");
}

async function json(relativePath) {
  return JSON.parse(await file(relativePath));
}

function requireCondition(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

async function check(label, validation) {
  try {
    await validation();
    console.log(`PASS  ${label}`);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    failures.push(`${label}: ${message}`);
    console.error(`FAIL  ${label}: ${message}`);
  }
}

await check("monorepo and strict TypeScript", async () => {
  const [packageJson, workspace, baseTsconfig, turbo] = await Promise.all([
    json("package.json"),
    file("pnpm-workspace.yaml"),
    json("tsconfig.base.json"),
    json("turbo.json"),
  ]);

  requireCondition(packageJson.private === true, "root package must be private");
  requireCondition(/^pnpm@\d+\.\d+\.\d+$/.test(packageJson.packageManager), "pnpm must be pinned");
  requireCondition(workspace.includes("apps/*") && workspace.includes("packages/*"), "workspace globs are incomplete");
  requireCondition(baseTsconfig.compilerOptions?.strict === true, "tsconfig.base.json must enable strict mode");
  requireCondition(turbo.tasks?.build && turbo.tasks?.lint && turbo.tasks?.typecheck && turbo.tasks?.test, "Turbo quality tasks are incomplete");

  for (const parent of ["apps", "packages"]) {
    const entries = await readdir(path.join(ROOT, parent), { withFileTypes: true });
    const workspaces = entries.filter((entry) => entry.isDirectory());
    requireCondition(workspaces.length > 0, `${parent} has no workspaces`);
    for (const workspaceEntry of workspaces) {
      const workspaceRoot = `${parent}/${workspaceEntry.name}`;
      const workspacePackage = await json(`${workspaceRoot}/package.json`);
      const workspaceTsconfig = await json(`${workspaceRoot}/tsconfig.json`);
      requireCondition(workspacePackage.name?.startsWith("@lpbot/"), `${workspaceRoot} has no @lpbot package name`);
      requireCondition(workspaceTsconfig.extends === "../../tsconfig.base.json", `${workspaceRoot} does not inherit strict TypeScript`);
    }
  }
});

await check("Compose, migration, and seed", async () => {
  const [packageJson, compose, seed] = await Promise.all([
    json("package.json"),
    file("infra/docker/compose.yaml"),
    file("infra/seed.sql"),
  ]);
  const migrations = (await readdir(path.join(ROOT, "infra/migrations"))).filter((name) => name.endsWith(".sql"));

  for (const service of ["postgres", "redis", "minio", "anvil", "dbmate"]) {
    requireCondition(new RegExp(`^  ${service}:`, "m").test(compose), `Compose service ${service} is missing`);
  }
  requireCondition(migrations.length > 0, "no SQL migration exists");
  requireCondition(seed.trim().length > 0, "infra/seed.sql is empty");
  for (const script of ["infra:up", "infra:down", "infra:reset", "infra:verify", "db:migrate", "db:seed", "test:infra"]) {
    requireCondition(Boolean(packageJson.scripts?.[script]), `root script ${script} is missing`);
  }
});

await check("CI gates", async () => {
  const workflow = await file(".github/workflows/ci.yml");
  const required = [
    "pnpm format:check",
    "pnpm lint",
    "pnpm typecheck",
    "pnpm test",
    "pnpm build",
    "pnpm check:p00",
    "pnpm test:e2e",
    "forge fmt --check",
    "forge build",
    "forge test -vvv",
    "pnpm db:migrate && pnpm db:migrate",
    "pnpm db:seed && pnpm db:seed",
    "pnpm test:infra",
    "gitleaks/gitleaks-action@",
    "pnpm audit:dependencies",
  ];
  for (const token of required) {
    requireCondition(workflow.includes(token), `CI does not run ${token}`);
  }
});

await check("196/196 feature IDs", async () => {
  const result = spawnSync(process.execPath, [path.join(ROOT, "scripts/check-traceability.mjs")], {
    cwd: ROOT,
    encoding: "utf8",
  });
  const output = `${result.stdout}\n${result.stderr}`;
  requireCondition(result.status === 0, output.trim());
  requireCondition(/196\/196 unique feature IDs match/.test(output), "traceability checker did not report 196/196");
});

await check("Changesets release workflow", async () => {
  const [packageJson, config] = await Promise.all([json("package.json"), json(".changeset/config.json")]);
  requireCondition(/^\d+\.\d+\.\d+$/.test(packageJson.devDependencies?.["@changesets/cli"] ?? ""), "@changesets/cli must be pinned");
  requireCondition(packageJson.scripts?.changeset === "changeset", "changeset script is missing");
  requireCondition(packageJson.scripts?.["changeset:status"] === "changeset status", "changeset:status script is missing");
  requireCondition(packageJson.scripts?.["version-packages"] === "changeset version", "version-packages script is missing");
  requireCondition(packageJson.scripts?.release === "changeset publish", "release script is missing");
  requireCondition(config.baseBranch === "main", "Changesets baseBranch must be main");
  requireCondition(config.privatePackages?.version === true, "private workspace versioning must be explicit");
  requireCondition(config.privatePackages?.tag === false, "private workspace tagging must stay disabled");
});

await check("ADR index and key decisions", async () => {
  const [docsIndex, adrIndex, modularMonolith, planes] = await Promise.all([
    file("docs/README.md"),
    file("docs/adr/README.md"),
    file("docs/adr/0001-modular-monolith.md"),
    file("docs/adr/0002-separate-data-and-execution-planes.md"),
  ]);
  requireCondition(docsIndex.includes("./adr/README.md"), "docs index does not link the ADR index");
  requireCondition(adrIndex.includes("0001-modular-monolith.md"), "ADR-0001 is not indexed");
  requireCondition(adrIndex.includes("0002-separate-data-and-execution-planes.md"), "ADR-0002 is not indexed");
  requireCondition(/状态：已接受/.test(modularMonolith) && /模块化单体/.test(modularMonolith), "ADR-0001 is not an accepted modular-monolith decision");
  requireCondition(/状态：已接受/.test(planes) && /市场数据面/.test(planes) && /交易执行面/.test(planes), "ADR-0002 does not record the accepted plane separation");
});

await check("clean-start environment template", async () => {
  const [environment, compose, readme] = await Promise.all([
    file(".env.example"),
    file("infra/docker/compose.yaml"),
    file("README.md"),
  ]);
  const values = new Map(
    environment
      .split(/\r?\n/)
      .filter((line) => /^[A-Z][A-Z0-9_]*=/.test(line))
      .map((line) => {
        const separator = line.indexOf("=");
        return [line.slice(0, separator), line.slice(separator + 1)];
      }),
  );
  const composeVariables = [...compose.matchAll(/\$\{([A-Z][A-Z0-9_]*)/g)].map((match) => match[1]);
  const requiredVariables = new Set([
    ...composeVariables,
    "DATABASE_URL",
    "REDIS_URL",
    "MINIO_ENDPOINT",
    "ANVIL_RPC_URL",
    "INFRA_WAIT_TIMEOUT_SECONDS",
    "INFRA_COMMAND_TIMEOUT_SECONDS",
  ]);
  for (const variable of requiredVariables) {
    requireCondition(values.get(variable)?.trim(), `.env.example does not define ${variable}`);
  }
  requireCondition(values.get("ANVIL_RPC_URL")?.startsWith("http://127.0.0.1:"), "Anvil must use a local RPC URL");
  requireCondition(readme.includes("cp .env.example .env"), "README omits environment creation");
  requireCondition(readme.includes("pnpm install --frozen-lockfile"), "README omits frozen dependency installation");
});

await check("repeatable P00 full-stack acceptance entry", async () => {
  const [packageJson, script, readme] = await Promise.all([
    json("package.json"),
    file("scripts/accept-p00.sh"),
    file("README.md"),
  ]);
  requireCondition(packageJson.scripts?.["accept:p00"] === "bash scripts/accept-p00.sh", "accept:p00 root script is missing");
  for (const command of [
    "pnpm check:all",
    "pnpm format:check",
    "pnpm lint",
    "pnpm typecheck",
    "pnpm test",
    "pnpm build",
    "pnpm infra:up",
    "pnpm infra:verify",
    "pnpm test:infra",
    "pnpm test:e2e",
    "forge fmt --check",
    "forge build",
    "pnpm test:contracts",
    "pnpm infra:down",
    "pnpm infra:reset",
  ]) {
    requireCondition(script.includes(command), `accept:p00 does not run ${command}`);
  }
  requireCondition((script.match(/pnpm db:migrate/g) ?? []).length >= 2, "accept:p00 must run migration twice");
  requireCondition((script.match(/pnpm db:seed/g) ?? []).length >= 2, "accept:p00 must run seed twice");
  requireCondition(script.includes("trap cleanup EXIT"), "accept:p00 must guarantee cleanup");
  requireCondition((await stat(path.join(ROOT, "scripts/accept-p00.sh"))).mode & 0o111, "scripts/accept-p00.sh is not executable");
  requireCondition(readme.includes("pnpm accept:p00"), "README omits the full-stack acceptance entry");
});

if (failures.length > 0) {
  console.error(`\nP00 completion definition failed (${failures.length}):`);
  for (const failure of failures) {
    console.error(`- ${failure}`);
  }
  process.exitCode = 1;
} else {
  console.log("P00 completion definition satisfied.");
}
