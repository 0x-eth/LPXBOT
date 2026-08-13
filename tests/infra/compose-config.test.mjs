import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import path from "node:path";

const repoRoot = path.resolve(fileURLToPath(new URL("../..", import.meta.url)));
const composeFile = path.join(repoRoot, "infra/docker/compose.yaml");
const envFile = path.join(repoRoot, ".env.example");
const projectName = "lpbot-p00-local";

function readComposeConfig() {
  const output = execFileSync(
    "docker",
    [
      "compose",
      "--project-name",
      projectName,
      "--env-file",
      envFile,
      "--file",
      composeFile,
      "--profile",
      "tools",
      "config",
      "--format",
      "json",
    ],
    { cwd: repoRoot, encoding: "utf8", timeout: 10_000 },
  );

  return JSON.parse(output);
}

test("Compose defines an isolated, persistent local LPBot stack", () => {
  const config = readComposeConfig();
  const expectedImages = {
    postgres: "timescale/timescaledb:2.21.3-pg16",
    redis: "redis:7.4.5-alpine",
    minio: "minio/minio:RELEASE.2025-04-22T22-12-26Z",
    "minio-init": "minio/mc:RELEASE.2025-04-16T18-13-26Z",
    anvil: "ghcr.io/foundry-rs/foundry:v1.3.1",
    dbmate: "amacneil/dbmate:2.28.0",
  };
  const persistentServices = ["postgres", "redis", "minio", "anvil"];

  assert.equal(config.name, projectName);

  for (const [serviceName, image] of Object.entries(expectedImages)) {
    const service = config.services[serviceName];
    assert.ok(service, `missing ${serviceName} service`);
    assert.equal(service.image, image);
  }

  for (const serviceName of persistentServices) {
    const service = config.services[serviceName];
    assert.ok(service.healthcheck?.test, `${serviceName} needs a healthcheck`);
    assert.ok(service.volumes?.length, `${serviceName} needs persistent storage`);

    for (const port of service.ports ?? []) {
      assert.equal(port.host_ip, "127.0.0.1", `${serviceName} must bind to loopback`);
    }
  }

  assert.deepEqual(Object.keys(config.volumes).sort(), [
    "anvil-data",
    "minio-data",
    "postgres-data",
    "redis-data",
  ]);

  const expectedVolumes = {
    "anvil-data": "lpbot-p00-local-anvil-data",
    "minio-data": "lpbot-p00-local-minio-data",
    "postgres-data": "lpbot-p00-local-postgres-data",
    "redis-data": "lpbot-p00-local-redis-data",
  };
  for (const [volumeKey, volumeName] of Object.entries(expectedVolumes)) {
    assert.equal(config.volumes[volumeKey].name, volumeName);
    assert.equal(config.volumes[volumeKey].labels["io.lpbot.local-project"], projectName);
  }

  const anvilCommand = config.services.anvil.command.join(" ");
  assert.match(anvilCommand, /--chain-id 31337/);
  assert.doesNotMatch(anvilCommand, /fork|rpc-url/i);
});
