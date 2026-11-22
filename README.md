# Rubidium

一个私有部署的 Bark 周期提醒工作空间。Next.js App Router、React 19、HeroUI React V3 与 SQLite 组成单一应用；唯一包管理器是 pnpm，运行时要求 Node.js 24 或更高版本。

## 工作流程

1. 首次部署需由部署者提供 `BARKER_SETUP_TOKEN`，或在受限网络中显式启用 `BARKER_ALLOW_SETUP=1`，随后创建访问密码；后续访问使用该密码登录。也可通过 `BARKER_PASSWORD` 在启动前预设访问密码并跳过初始化。
2. 在「推送设置」填写 Bark 服务地址与 Device Key，保存后发送测试通知。
3. 创建提醒：名称、可选正文、开始时间、重复周期、任务时区，以及重复次数或截止日期。
4. 在「工作概览」查看接下来七天的安排、待投递数量和最近活动。
5. 在「所有提醒」编辑、暂停、恢复、复制或归档；在「投递记录」查看尝试历史、手动重试或取消等待中的单次投递。

所有列表、统计和排期都来自服务端数据，没有内置演示任务。尚未配置 Bark 时也可以创建提醒，到期消息会持久保存在队列中。

## 首次部署与时区

- 新数据目录默认关闭首次初始化。部署者可设置至少 32 个随机字符的 `BARKER_SETUP_TOKEN`，并在初始化页输入该令牌后创建访问密码；令牌不会保存到数据库或日志。也可仅在本机或受限网络中显式设置 `BARKER_ALLOW_SETUP=1`，不使用引导令牌。两者都未设置时，初始化页会保持关闭。访问密码以 scrypt 哈希保存在 SQLite；也可在首次启动前通过 `BARKER_PASSWORD` 预设访问密码并跳过初始化。初始化成功后建议移除部署引导令牌。
- 初始化页会预选浏览器当前的 IANA 时区，可以搜索并改选其他时区。之后可在「设置」更改全局显示时区；新提醒默认使用全局时区，每个提醒也可以单独指定时区。日期和重复时间按该提醒自己的时区执行。
- 若在浏览器或主机之间切换时区，请分别检查「设置」里的显示时区和提醒编辑器里的任务时区；它们控制不同的显示/排期行为。
- 外观设置支持浅色、深色和跟随系统。

## 排期规则

- 每个任务使用一个有效 IANA 时区，默认 `Asia/Shanghai`。预设周期会按该任务时区的墙上时间生成五段 cron。
- 概览、投递记录、今日统计与侧栏时间使用「设置」中选定的显示时区；任务本身仍按各自时区执行。
- 开始时间是最早允许执行的分钟。新建任务时已经过去的排期不会补发。
- 每月预设沿用相同日历日；29–31 日在不存在的月份跳过。
- 次数指累计排期次数，包含已入队、已取消或已过期的排期。失败重试不额外消耗次数。
- 截止日期包含当天；「排期结束」只表示不再生成未来排期，已有队列仍会继续处理。
- 服务停机期间，进行中的任务会在重启后补排；用户明确暂停的时间段不补发。
- 编辑、暂停、归档或删除前，会先保存在操作时已经到期的提醒。历史投递保留创建时的标题和正文快照。
- 更新任务内容时，请求内最多补排 500 个历史时刻；仍有积压会返回冲突。暂停、恢复和归档会保存明确的时间边界，由调度器继续分批追平，避免截断或丢消息。

## 投递模型

每个到期时刻先以唯一的 `(task_id, occurrence_at)` 写入 SQLite outbox：

```text
pending -> sending（2 分钟租约）-> sent
   |             |
   |             +-> pending（失败退避）
   +-> cancelled / expired
```

- 每轮最多补排 500 个时刻、发送 20 条，并使用 4 个并发发送 worker；补排会主动让出事件循环。
- 网络错误、超时、HTTP 错误、无效响应和错误 Device Key 都保留消息。失败后从 5 秒开始指数退避，单条退避上限为 1 小时。
- HTTP `429` 和 `503` 的 `Retry-After` 同时支持秒数与 HTTP 日期，最长延后 7 天。
- 同一 Bark 端点失败后会短暂冷却：永久错误冷却 60 秒，临时错误冷却 5 秒，减少并发请求同时撞上坏配置。
- Device Key 只在服务端使用，响应、错误和日志会脱敏；修改设置会提前唤醒等待中的消息并清除旧冷却。
- 成功条件必须是 HTTP 2xx 且 Bark JSON 返回数值 `200` 或规范字符串 `"200"`。空响应、HTML、数组及可强转的伪 200 都不算送达。
- 最终 Bark JSON 不超过 4096 字节。任务标题和正文合计不超过 3000 个 UTF-8 字节，密钥与通知选项合计最多 1096 字节，为正文保留空间。
- 任务可以设置「允许延迟」；超过计划时间加允许延迟仍处于 `pending` 的消息会标记为 `expired`。发送中的请求可能已经被上游接收，无法撤回。
- 投递记录可以手动重试；等待中的单次消息也可以取消。设置页可配置结束记录自动保留天数：默认 `0`（关闭），`1–36500` 天启用。调度器每轮最多删除 100 条过期的已结束记录，并分轮处理积压；待投递、重试中和发送中记录不会删除，任务累计计数不变。设置页也可手动分批清理 30 天前的结束记录；清理 API 接受至少 7 天前的截止点。

**这是至少一次投递，不是恰好一次投递。** 如果 Bark 已接收请求但确认包丢失，或进程在确认落库前退出，重试可能产生重复通知。「Bark 已接收」表示 Bark API 确认接收，不代表设备一定展示通知。服务可用性、磁盘空间和数据安全仍需由部署者负责。

## 并发编辑与 API

- API 凭据在「推送设置 → 访问安全」中创建，可选择只读或读写权限；有效天数为 `1–365`，`0` 表示永不过期。永久凭据不会自动失效，应在不再使用时主动撤销。
- 任务编辑、暂停/恢复、归档以及设置保存都带修订号；版本落后时返回 `409`，缺少修订号时返回 `428`。
- 新建任务可带 `Idempotency-Key: <16–128 位 A-Z/a-z/0-9/_/->`。相同键和相同内容会返回同一任务，不同内容返回 `409`。
- API 请求体上限为 64 KiB；`POST`、`PUT`、`PATCH` 只接受同源 `application/json`，所有写请求都会拒绝跨站浏览器来源。
- API 处理函数中的错误统一返回 JSON；数据库或认证存储故障返回脱敏后的 500。启动配置或数据库迁移失败时，服务拒绝启动，健康检查不会返回成功。
- 会话与 API 凭据可以在「设置 → 访问安全」查看和撤销。凭据原文仅在创建时显示一次；`read` 不能写入，`write` 同时允许读取。永久凭据不会自动过期，应在不再使用时撤销。
- API/MCP 接口、字段、权限、错误码和协议版本详见 [docs/api-mcp.md](docs/api-mcp.md)。MCP 地址为 `/api/mcp`，使用 Streamable HTTP 和 Bearer API 凭据；它不接受浏览器 Cookie。

## 加密数据导入与导出

在「设置 → 记录维护 → 数据导入与导出」创建加密文件或导入已有文件。导出密码须为 12–200 个字符；导入时必须提供相同密码。密码不保存在服务器，遗失后不能恢复导出文件。

导出使用 scrypt 派生密钥与 AES-256-GCM 加密，快照压缩后最多 40 MiB。文件包含提醒、投递历史、设备和通知设置，但不含访问密码哈希、活动会话、API 凭据或运行期调度状态。把文件和加密密码分开保管，不要将两者放在同一备份位置。

导入会替换当前提醒、投递历史、设备和通知设置，且需二次确认；当前访问密码、活动会话及 API 凭据保留。错误密码、篡改或不兼容文件不会修改现有数据。导入前仍建议另外创建管理员备份。该工作流只在网页中提供，目前没有对应 HTTP API 或 MCP 工具。

## Docker 运行

首次构建或更新镜像前，需要提供 `HEROUI_KEY`（见下方「HeroUI Pro 开发依赖」）。下面用无回显的交互输入避免把访问码写入 shell 历史；Compose 仅将它作为 BuildKit secret 提供，不会传入运行容器或镜像层。

```bash
cp .env.example .env
# 编辑 .env：首次初始化需配置随机 BARKER_SETUP_TOKEN；也可仅在受限网络中设置 BARKER_ALLOW_SETUP=1
chmod 600 .env
# 可选：预设 16–300 字符的管理员访问密码并跳过首次初始化

read -r -s -p "HeroUI Pro access key: " HEROUI_KEY
printf '\n'
export HEROUI_KEY
docker compose up -d --build
unset HEROUI_KEY
docker compose ps
curl -fsS http://127.0.0.1:3000/api/health
docker compose logs -f rubidium
# 访问 http://localhost:3000
```

Compose 从当前代码构建 `rubidium:local`，服务和容器名为 `rubidium`。默认只绑定 `127.0.0.1`；跨设备访问时设置 `BARKER_BIND_ADDR`，并建议放在 HTTPS 反向代理后。`.env` 在运行时传入容器，不进入镜像。Compose 继续使用历史命名卷 `barker-data`，与仓库中的 `data/` 不同；保留该卷名是为了让现有部署升级后继续挂载原数据。迁移已有本地实例时，先按「备份与恢复」创建快照，并在首次启动容器前恢复到该卷。不要先用空数据卷启动新实例。

配置 `BARKER_SETUP_TOKEN` 后，首次访问 `http://localhost:3000` 输入引导令牌并创建访问密码。若两种初始化授权均未配置，页面会显示初始化未启用，且服务器不会接受初始化请求。预设 `BARKER_PASSWORD` 时应在首次访问前准备好该值；清空环境变量不会自动重置已经创建的密码。

忘记访问密码时，可在运行中的容器内安全重置；密码交互输入时不回显，不会删除任务、队列或设置，会撤销所有会话和 API 凭据：

```bash
docker compose exec -it rubidium node /app/scripts/password-reset.mjs
```

该命令需要真实交互终端，输入两次新密码（16–300 个字符）。若设置了 `BARKER_PASSWORD`，重置结果与当时的环境变量绑定；之后更改该环境变量会切换回新的环境密码配置。API token 和旧会话会立即失效。

从旧版 Compose 升级时，旧容器名为 `barker`。首次切换前移除旧容器（不会删除 `barker-data` 卷），再启动新服务：

```bash
docker rm -f barker
docker compose up -d --build
```

也可以使用命名卷直接运行：

```bash
docker build --secret id=HEROUI_KEY,env=HEROUI_KEY -t rubidium:local .
docker run -d --init --name rubidium \
  --stop-timeout 30 \
  -p 127.0.0.1:3000:3000 \
  -v barker-data:/app/data \
  rubidium:local
docker logs rubidium
```

镜像使用固定 Node 24 Alpine 摘要、多阶段 standalone 构建和 UID/GID `1001:1001` 非 root 用户。健康检查同时验证 SQLite 可写和调度器心跳；调度器被禁用、数据库只读或心跳过期时，`/api/health` 返回 `503`。部分 `BARKER_*` 环境变量、`barker.sqlite` 数据库文件名、`barker_session` Cookie 和 `barker-data` 卷名为既有安装兼容保留，不影响产品显示名。

生产启动入口会先等待正在发送的请求，再把终止信号转发给 Next.js，最长等待 20 秒。转发后再次收到终止信号会强制关闭服务。被中断的租约由下次启动恢复。

停止与更新：

```bash
docker compose stop
docker compose up -d --build
```

`docker compose down -v` 会删除任务、队列、配置和密钥，除非明确希望清空数据，否则不要使用。

正式发布后，多架构镜像按 SemVer 推送到 `ghcr.io/proj-elements/rubidium`。首次使用空数据卷前，先安全设置 `BARKER_SETUP_TOKEN`；已有初始化数据卷无需该值。例如拉取指定版本：

```bash
docker pull ghcr.io/proj-elements/rubidium:v1.0.1
docker run -d --init --name rubidium \
  --stop-timeout 30 \
  -p 127.0.0.1:3000:3000 \
  -e BARKER_SETUP_TOKEN \
  -v barker-data:/app/data \
  ghcr.io/proj-elements/rubidium:v1.0.1
```

不要把 `:latest` 当作可复现版本；生产部署应固定明确版本或镜像摘要。若 GHCR 镜像尚未随对应 Tag 发布，先使用上面的 Compose 本地构建方式。

## 环境变量

| 变量 | 默认值 | 说明 |
| --- | --- | --- |
| `BARKER_PASSWORD` | 未设置 | 16–300 字符；设置后预先配置访问密码并跳过初始化 |
| `BARKER_SETUP_TOKEN` | 未设置 | 32–300 字符；允许首次初始化并要求在页面输入。令牌不保存，初始化完成后建议移除 |
| `BARKER_ALLOW_SETUP` | 未启用 | `1/true/yes` 显式允许不带令牌初始化；仅在本机或受限网络临时使用。已设置 `BARKER_SETUP_TOKEN` 时仍要求令牌 |
| `BARKER_SESSION_SECRET` | 自动生成并持久化 | 16–300 字符，用于 HMAC 会话签名 |
| `BARKER_BACKUP_KEY` | 未设置 | 仅用于 `data:backup:encrypted` / `data:restore:encrypted`；16–1024 UTF-8 字节，不要与备份存放在同一位置 |
| `BARKER_BACKUP_KEY_FILE` | 未设置 | 仅用于加密备份 CLI；从权限为 `0600` 的密钥文件读取，设置时优先于 `BARKER_BACKUP_KEY` |
| `BARKER_DATA_DIR` | `./data`；容器 `/app/data` | SQLite、密码和会话密钥目录 |
| `BARKER_TRUST_PROXY` | 不信任 | 仅在可信反代后设置 `1/true/yes`，用于限流地址与 HTTPS Cookie 判断 |
| `BARKER_COOKIE_SECURE` | 不强制 | `1/true/yes` 强制 Secure Cookie；纯 HTTP 环境不要开启 |
| `BARKER_BIND_ADDR` | `127.0.0.1` | 仅 Compose，宿主机绑定地址 |
| `BARKER_PORT` | `3000` | 仅 Compose，宿主机端口 |
| `PORT` | `3000` | standalone 服务内部监听端口 |
| `HOSTNAME` | 容器 `0.0.0.0` | standalone 监听地址 |

`BARKER_DISABLE_SCHEDULER=1` 只用于隔离构建、浏览器回归和预览。正常运行时必须移除该变量，否则健康检查会失败且不会投递。

会话有效期 12 小时，退出登录会撤销服务端会话，密码指纹变化会使旧会话失效。同一客户端键在 10 分钟内输错 5 次会被锁定 10 分钟。全服务在 10 分钟内累计 1000 次错误会暂停密码校验 30 秒。限流期间的登录和密码修改请求均返回 `429` 和 `Retry-After`，即使输入了正确密码。直接暴露服务时仍应使用足够长的随机密码。

访问密码只在初始化页面输入，不会写入服务启动日志。部署引导令牌也不会写入启动日志或数据库。旧安装可能仍通过 `access-password.txt` 兼容原有密码；新安装将初始化密码的 scrypt 哈希保存在 SQLite 中。

## 本地开发与验证

```bash
corepack enable
pnpm install --frozen-lockfile
# 当前终端已设置 HEROUI_KEY
pnpm ui:setup
pnpm dev

pnpm test
pnpm exec next typegen
pnpm typecheck
pnpm lint
BARKER_DATA_DIR="$(mktemp -d)" BARKER_DISABLE_SCHEDULER=1 pnpm build
pnpm exec playwright install chromium webkit
pnpm test:browser
```

单元与集成测试使用临时数据目录，不读取现有 `data/`。浏览器测试会启动隔离的生产服务，禁用调度器，不连接真实 Bark。

概览在请求完成 15 秒后刷新。其他页面的侧栏计数和概览状态每次同步完成后间隔 60 秒再刷新，以减少预测和统计查询。投递列表每 5 秒刷新，侧栏计数可能稍晚更新。

工作流语法回归需要 Bash；在 Alpine 测试环境中运行 `pnpm test` 前需要安装该测试依赖。

构建后使用 `pnpm start` 启动 standalone 服务；入口会补齐本地静态资源。可通过 `HOSTNAME` 和 `PORT` 指定监听地址及端口。

### 容器端到端冒烟

```bash
docker build --secret id=HEROUI_KEY,env=HEROUI_KEY -t rubidium:local .
pnpm test:container
```

脚本使用独立命名卷、随机本地端口和本地模拟 Bark，验证非 root 启动、认证、设置密钥脱敏、失败入库、归档后继续投递、停止/重启恢复、自动重试及健康检查。通常需要 1–2 分钟，完成后会清理自己的容器与卷。

## 备份与恢复

不要只复制正在运行的 `barker.sqlite`，因为 WAL 中可能还有数据。项目提供基于 SQLite 在线备份 API 的一致性快照：

```bash
# 默认从 ./data 或 BARKER_DATA_DIR 备份到新目录
pnpm data:backup /secure/backups/rubidium-20261112

# 从新目录恢复，源目录必须已经备份
pnpm data:restore /srv/rubidium/data-restored /secure/backups/rubidium-20261112
```

备份目录必须不存在；命令创建权限为 `0700` 的目录和 `0600` 的文件，并生成包含 SHA-256 校验和的 `manifest.json`。恢复同样拒绝覆盖任何已有目录，会验证校验和、完整性、外键和当前工具支持的 schema 版本；遇到更新或不兼容的版本时会拒绝恢复、清理临时目标并保留源备份。成功恢复后会清除副本中的会话与运行期调度状态。

完整运维快照含 SQLite 中的 Bark Device Key，以及可能存在的访问密码兼容文件和会话签名密钥。建议使用加密模式；它对快照中的每个文件使用随机盐、随机 nonce、scrypt（N=32768）和 AES-256-GCM，输出目录不含明文 manifest。恢复时必须提供同一密钥；错误密钥、认证标签错误或文件损坏都会中止，已有目标目录不会被覆盖。密钥长度为 16–1024 UTF-8 字节，可通过 `BARKER_BACKUP_KEY` 环境变量或权限为 `0600` 的 `BARKER_BACKUP_KEY_FILE` 文件传递；密钥值不会放在 `data-tools` 命令参数或程序输出中：

```bash
printf '备份加密密钥：'
IFS= read -r -s BARKER_BACKUP_KEY
printf '\n'
export BARKER_BACKUP_KEY
pnpm data:backup:encrypted /secure/backups/rubidium-20261122.enc
unset BARKER_BACKUP_KEY

printf '恢复加密密钥：'
IFS= read -r -s BARKER_BACKUP_KEY
printf '\n'
export BARKER_BACKUP_KEY
pnpm data:restore:encrypted /srv/rubidium/data-restored /secure/backups/rubidium-20261122.enc
unset BARKER_BACKUP_KEY
```

加密命令会在权限为 `0700` 的系统临时目录短暂准备明文快照，完成后清理暂存目录；若本机临时目录不属于可信的本地用户边界，应确保该目录位于加密存储或内存文件系统。加密密钥应单独保管，不能与备份放在同一位置；遗失密钥无法恢复数据。普通 `data:backup` / `data:restore` 仍生成明文快照，只应写入权限受控的加密存储。

Compose 使用命名卷，宿主机上的 `./data` 与容器数据不是同一目录。使用 Compose 时，可通过容器内备份命令创建快照，再复制到受限的宿主机目录：

```bash
set -e
KEY_FILE="$(mktemp)"
chmod 600 "$KEY_FILE"
trap 'rm -f "$KEY_FILE"; docker compose exec -u 0 rubidium rm -f /tmp/rubidium-backup-key >/dev/null 2>&1 || true' EXIT
printf '备份加密密钥：'
IFS= read -r -s BARKER_BACKUP_KEY
printf '\n'
printf '%s' "$BARKER_BACKUP_KEY" > "$KEY_FILE"
unset BARKER_BACKUP_KEY
mkdir -p /secure/backups
docker cp "$KEY_FILE" rubidium:/tmp/rubidium-backup-key
docker compose exec -u 0 rubidium chmod 600 /tmp/rubidium-backup-key
docker compose exec -e BARKER_BACKUP_KEY_FILE=/tmp/rubidium-backup-key -u 0 rubidium node /app/scripts/data-tools.mjs backup-encrypted /tmp/rubidium-backup-20261122.enc
docker cp rubidium:/tmp/rubidium-backup-20261122.enc /secure/backups/
test -f /secure/backups/rubidium-backup-20261122.enc/barker.sqlite.enc
docker compose exec -u 0 rubidium rm -r /tmp/rubidium-backup-20261122.enc
docker compose exec -u 0 rubidium rm -f /tmp/rubidium-backup-key
```

Compose 恢复到同一卷中的新目录，不覆盖当前数据。先停止服务，将快照目录按只读方式挂入一次性容器；恢复目标必须不存在：

```bash
KEY_FILE="$(mktemp)"
chmod 600 "$KEY_FILE"
trap 'rm -f "$KEY_FILE"' EXIT
printf '恢复加密密钥：'
IFS= read -r -s BARKER_BACKUP_KEY
printf '\n'
printf '%s' "$BARKER_BACKUP_KEY" > "$KEY_FILE"
unset BARKER_BACKUP_KEY
docker compose stop rubidium
docker compose run --rm --no-deps --user 0 \
  -e BARKER_BACKUP_KEY_FILE=/run/secrets/rubidium-backup-key \
  -v "$KEY_FILE:/run/secrets/rubidium-backup-key:ro" \
  -v /secure/backups:/backups:ro \
  --entrypoint node rubidium \
  /app/scripts/data-tools.mjs restore-encrypted \
  /app/data/restore-20261122 /backups/rubidium-backup-20261122.enc
docker compose run --rm --no-deps --user 0 \
  --entrypoint chown rubidium -R 1001:1001 /app/data/restore-20261122
```

确认恢复命令成功后，将 `.env` 中的 `BARKER_DATA_DIR` 设为 `/app/data/restore-20261122`，再运行 `docker compose up -d rubidium`。旧数据仍留在原卷的 `/app/data`，可在核对新实例前用于回退；不要运行 `docker compose down -v`。`/secure/backups` 必须替换为实际绝对路径，备份目录与加密密钥应分别限制访问。

运维快照恢复后仍是明文数据目录，不等同于网页里的加密导出。解密后的 SQLite 中包含 Bark Device Key；数据目录和运行时文件仍须限制访问。

先从旧实例停机，再把 `BARKER_DATA_DIR` 指向恢复目录并启动。没有既有访问凭据且未设置 `BARKER_PASSWORD` 时，服务只会在设置 `BARKER_SETUP_TOKEN` 或显式启用 `BARKER_ALLOW_SETUP=1` 后开放初始化；缺少会话签名密钥时会生成新密钥，既有会话随之失效。

数据目录包含 `barker.sqlite`、WAL/SHM、`session-secret.txt`；升级中的旧安装还可能保留 `access-password.txt`。Device Key 保存在 SQLite 中，**没有静态加密**，数据目录和备份都应按秘密材料保护。不要把 SQLite 放在不支持文件锁和可靠写入的网络文件系统上，也不要让多个实例共同挂载同一数据目录。

升级时自动执行事务式增量迁移，保留旧版任务和投递历史，并补齐旧版暂停任务的排期边界。升级前仍应先备份；升级后不要用旧版本继续写新数据库。

升级建议：

1. 使用 `pnpm data:backup:encrypted` 创建一份新快照，并确认 `.enc` 文件齐全；安全保管 `BARKER_BACKUP_KEY`。
2. 拉取或检出目标版本。源码构建需提供有效 `HEROUI_KEY`；直接使用 GHCR 镜像则无需该构建密钥。
3. 保持原有 `barker-data` 命名卷与 `.env`，仅重建/更新容器，不要执行 `docker compose down -v`。
4. 检查 `docker compose ps`、`docker compose logs --tail=100 rubidium` 和 `/api/health`。
5. 确认提醒、排期和设备设置正常后，再保留旧镜像或清理空间。

回滚前先停止新版本。数据库迁移可能改变 schema；旧版本不能在新版本已写入数据库后继续运行。需要回滚数据时，使用升级前独立快照恢复到一个新的数据目录，再切回旧版本。

## 发布与 CI

`.github/workflows/ci.yml` 根据改动选择所属测试、类型检查、生产构建、浏览器交互和容器冒烟，不会用全量测试掩盖选择错误。

`.github/workflows/release.yml` 只对新建的 `v<semver>` tag 发布镜像，并要求 tag 与 `package.json` 版本一致。流程会：

- 在发布前运行测试、构建和浏览器回归；
- 分别构建并冒烟 `linux/amd64` 与 `linux/arm64`；
- 拒绝覆盖版本镜像或同一版本对应的平台镜像，失败后使用新版本继续发布；
- 推送不可变的 per-architecture 摘要，再创建多架构版本清单；
- 只允许 `latest` 和次版本通道向前移动；
- 重新按清单摘要拉取两个平台并再次运行容器冒烟。

本地构建、分支 CI、tag 发布与生产部署是不同步骤；合并代码不会自动部署。

发布在推送平台镜像后若失败，先在运行记录中确认已推送的标签和摘要。版本及源码标签会保留，自动发布会拒绝覆盖它们，稳定通道只在两个平台的摘要回拉和冒烟通过后更新。修复故障后使用新的版本和 tag 发布。

## 代码结构

```text
app/                         概览、提醒、投递、设置及 API
components/                  认证、导航、编辑器、HeroUI 组合组件
lib/db.ts                    SQLite 迁移、outbox、租约、修订、备份所需数据模型
lib/cron.ts                  任务时区、cron 预设、七日预测
lib/scheduler.ts             有界补排、并发发送、端点冷却、健康心跳
lib/bark.ts                  Bark 协议、超时、Retry-After、严格成功确认
lib/auth.ts                  密码、持久会话、撤销、按客户端失败限流
lib/http.ts                  请求上限、CSRF 防线、JSON 错误边界
scripts/start-server.mjs     调度收尾与 HTTP 退出之间的进程协调
scripts/data-tools.mjs       一致性备份、校验和、拒绝覆盖的恢复
scripts/release-guard.mjs    SemVer、镜像不可变性与通道保护
scripts/container-smoke.mjs  隔离容器端到端检查
tests/                       业务、安全、迁移、重启、UI、CI 与发布回归
```

前端使用 `@heroui/react` V3 与 `@heroui-pro/react`，自托管 Manrope 字体和本地 Gravity 图标。Pro 用于 Sidebar 导航、DataGrid 表格、ListView 列表、ActionBar 批量操作、KPI / KPIGroup 指标、EmptyState 空状态、ItemCard / ItemCardGroup 条目、InlineSelect 筛选和 Segment 结束条件。界面不依赖运行时 CDN。

### HeroUI Pro 开发依赖

项目通过 `heroui-setup` 下载 Pro 组件，安装器固定为 1.0.4，组件固定为 1.0.0-beta.11。先将访问码设置为当前终端的 `HEROUI_KEY` 环境变量，再执行：

```bash
pnpm install --frozen-lockfile
pnpm ui:setup
```

`ui:setup` 使用安装器的 CI 模式，避免自动生成包含访问码的 Vercel 配置。CI 需要在仓库 Secrets 中配置 `HEROUI_KEY`；凭据只用于依赖安装。Fork PR 默认拿不到该 secret，需要在有授权的本地环境完成构建验证。Docker 使用 BuildKit secret：

```bash
docker build --secret id=HEROUI_KEY,env=HEROUI_KEY -t rubidium:local .
```

不要将访问码写入 Dockerfile、构建参数或版本库。生产运行镜像无需此访问码。HeroUI Pro 依赖按其独立商业许可使用；该许可与 Rubidium 自身的 AGPL-3.0-only 许可相互独立。

## License

Rubidium 自身源代码采用 [GNU Affero General Public License v3.0 only](LICENSE)，项目仓库位于 [Proj-Elements/Rubidium](https://github.com/Proj-Elements/Rubidium)。

第三方组件保留各自原有许可，不因 Rubidium 的 AGPL 声明而改变；请同时阅读 [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md)。`@heroui-pro/react` 使用 HeroUI Pro 独立许可，构建/使用它需要有效的 Pro 许可；该许可不属于 AGPL。CI 与本地源码构建使用的 `HEROUI_KEY` 只能作为密钥注入，不能写入源码或镜像。

## 故障排查

- **无法登录或忘记密码**：不要查容器日志找密码。先启动服务容器，再使用上方交互式重置命令；该操作不会删除任务和设置，但会撤销所有会话及 API 凭据。
- **健康检查返回 503**：查看 `docker compose ps` 和 `docker compose logs --tail=100 rubidium`。确认没有设置 `BARKER_DISABLE_SCHEDULER=1`、`/app/data` 可写，且数据库没有被其他进程占用。
- **首次构建失败并提示 HeroUI Pro 缺失**：确认已设置有效的 `HEROUI_KEY` 环境变量后重新运行 `docker compose up -d --build`；不要把 key 放在 `--build-arg`、Dockerfile 或普通构建日志中。
- **提醒没有投递**：检查设备 Endpoint/Device Key、调度器健康和投递记录中的脱敏错误；使用设置页的测试推送确认 Bark 连通性。`sent` 仅表示 Bark API 确认接收，不保证设备已展示通知。
- **时间看起来偏移**：确认全局「显示时区」和单条提醒的任务时区。重复周期按任务时区计算，列表与统计按全局显示时区格式化。
- **备份/恢复拒绝目标目录**：这是防覆盖保护。为每次操作选择一个不存在的新目录，并确认备份目录不在源数据目录内部。
- **服务启动失败或 SQLite 错误**：停止所有共享该数据目录的进程，先复制并妥善保护数据，再检查磁盘空间、目录写权限和文件系统锁支持；不要删除数据库、WAL/SHM 或密钥文件尝试“修复”。
