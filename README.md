# LPBot

LPBot 的 pnpm/Turborepo monorepo。研究基线、架构和交付索引见 [docs/README.md](./docs/README.md)。

## 本地基础设施

需要 Node.js 22、pnpm 11.17.0、Docker Engine 和 Docker Compose。首次启动：

```bash
cp .env.example .env
pnpm infra:up
pnpm db:migrate
pnpm db:seed
pnpm infra:verify
pnpm test:infra
```

`.env.example` 只含本地占位凭证，`.env` 保持 Git 忽略。默认端口均只绑定 `127.0.0.1`：PostgreSQL `15432`、Redis `16379`、MinIO API/Console `19000`/`19001`、Anvil `18545`。Anvil 使用独立本地 chain ID `31337`，不使用外部 RPC。

## 运行与重置

```bash
pnpm infra:status
pnpm infra:logs
pnpm infra:down
pnpm infra:reset
```

`infra:down` 保留数据；`infra:reset` 只删除具有 `lpbot-p00-local` 项目标签的四个精确命名卷。重置后重新执行首次启动命令即可建立干净环境。

## 数据库与测试

```bash
pnpm db:migrate
pnpm db:status
pnpm db:seed
pnpm infra:verify
pnpm test:infra
```

`pnpm test` 不依赖 Docker；只有 `pnpm test:infra` 运行 PostgreSQL/TimescaleDB、Redis、MinIO 和 Anvil 协议集成测试。

## 常见故障

- Docker 未启动：启动 Docker Desktop 或 Colima 后重试。
- 端口冲突：在 `.env` 中修改对应 `*_PORT` 和同文件的宿主机 URL。
- 健康检查超时：运行 `pnpm infra:status` 和 `pnpm infra:logs`；必要时在 `.env` 中增大 `INFRA_WAIT_TIMEOUT_SECONDS`。
- migration 或 Seed 报 PostgreSQL 未运行：先运行 `pnpm infra:up`。
- MinIO bucket 缺失：重跑幂等的 `pnpm infra:up` 初始化命令。
