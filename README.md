# LPBot

LPBot 的 pnpm/Turborepo monorepo。研究基线、架构和交付索引见 [docs/README.md](./docs/README.md)。

## 前置条件

需要 Node.js `22.23.1`、pnpm `11.17.0`、Docker Engine、Docker Compose 和 Foundry `1.7.1`。Playwright Chromium 可通过 `pnpm exec playwright install chromium` 安装；Linux CI 使用 `--with-deps` 同时安装系统依赖。

## 干净环境启动

从新检出开始执行：

```bash
cp .env.example .env
pnpm install --frozen-lockfile
pnpm infra:up
pnpm db:migrate
pnpm db:seed
pnpm infra:verify
pnpm test:infra
```

`.env.example` 只含本地占位凭证，`.env` 保持 Git 忽略。默认端口均只绑定 `127.0.0.1`：PostgreSQL `15432`、Redis `16379`、MinIO API/Console `19000`/`19001`、Anvil `18545`。Anvil 使用独立本地 chain ID `31337`，不使用外部 RPC。

## 验证

普通质量和治理门禁不依赖 Docker：

```bash
pnpm check:all
pnpm format:check
pnpm lint
pnpm typecheck
pnpm test
pnpm build
```

浏览器、合约和基础设施验收：

```bash
pnpm test:e2e
forge fmt --check
forge build
pnpm test:contracts
pnpm test:infra
```

`pnpm accept:p00` 是可重复的 P00 全栈验收入口。它要求 `.env` 已由模板创建，依次运行治理、格式、lint、类型、单元、构建、幂等 migration/seed、基础设施、Playwright 和 Foundry 门禁，复核冻结基线，并在成功或失败后停止容器和删除本项目本地卷：

```bash
cp .env.example .env
pnpm install --frozen-lockfile
pnpm accept:p00
```

## 运行与清理

```bash
pnpm infra:status
pnpm infra:logs
pnpm infra:down  # 停止容器并保留数据
pnpm infra:reset # 停止容器并删除本项目四个本地卷
rm -f .env       # 删除本地环境副本
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

## 版本变更

对可发布 workspace 的变更运行 `pnpm changeset` 并提交生成的变更说明。`pnpm changeset:status` 检查待发布计划，`pnpm version-packages` 应用版本，`pnpm release` 仅由发布流程执行。

## 常见故障

- Docker 未启动：启动 Docker Desktop 或 Colima 后重试。
- migration 报 `no migration files found`：确认仓库所在目录已共享给 Docker VM；Colima 默认不共享 macOS 的 `/tmp`，临时 worktree 应放在已共享的用户目录。
- 端口冲突：在 `.env` 中修改对应 `*_PORT` 和同文件的宿主机 URL。
- 健康检查超时：运行 `pnpm infra:status` 和 `pnpm infra:logs`；必要时在 `.env` 中增大 `INFRA_WAIT_TIMEOUT_SECONDS`。
- migration 或 Seed 报 PostgreSQL 未运行：先运行 `pnpm infra:up`。
- MinIO bucket 缺失：重跑幂等的 `pnpm infra:up` 初始化命令。
