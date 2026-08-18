import pg from "pg";

import { OkxConnectorError } from "./errors.js";
import { createOkxConnectorHttpServer } from "./http-server.js";
import { HttpOkxKmsClient } from "./http-kms-client.js";
import { PostgresOkxCredentialRepository } from "./postgres-store.js";
import { loadOkxConnectorProductionConfig } from "./production-config.js";
import { OkxCredentialService } from "./service.js";
import { OkxHttpsReadOnlyTransport, type OkxReadOnlyTransport } from "./index.js";

const { Pool } = pg;
const config = loadOkxConnectorProductionConfig(process.env);
const pool = new Pool({
  application_name: config.identity,
  connectionString: config.ciphertextDatabaseUrl,
  max: 8,
});
const transport: OkxReadOnlyTransport = config.egressEnabled
  ? new OkxHttpsReadOnlyTransport()
  : {
      async validate() {
        throw new OkxConnectorError("EGRESS_DENIED");
      },
    };
const service = new OkxCredentialService({
  environment: config.environment,
  kms: new HttpOkxKmsClient(config.kms),
  repository: new PostgresOkxCredentialRepository(pool),
  transport,
});
await service.recover();
const server = createOkxConnectorHttpServer({ apiToken: config.apiToken, service });
server.listen(config.port, config.host);

const shutdown = () => {
  server.close(() => {
    void pool.end().finally(() => process.exit(0));
  });
};
process.once("SIGINT", shutdown);
process.once("SIGTERM", shutdown);
