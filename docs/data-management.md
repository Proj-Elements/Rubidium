# 数据管理

## 网页数据导入与导出

在「设置 → 记录维护」分别打开导出或导入弹窗。导出密码为 12–200 个字符，导入时必须提供相同密码；密码不会保存到服务器，遗失后无法恢复文件。

导出文件使用 scrypt 派生密钥和 AES-256-GCM 加密，内容包括提醒、投递历史、设备和通知设置，不包括访问密码哈希、活动会话、API 凭据或调度器运行状态。导入会替换这些业务数据，需二次确认；访问密码、会话和 API 凭据保留。认证失败、文件损坏或格式不兼容时，不会修改现有数据。该功能仅在网页中提供，不对应 HTTP API 或 MCP 工具。

## 运维备份

普通备份使用 SQLite 在线备份接口生成一致快照。建议在生产环境使用加密模式：

```sh
pnpm data:backup:encrypted /secure/backups/rubidium-20261122.enc
```

恢复到一个尚不存在的新目录：

```sh
pnpm data:restore:encrypted /srv/rubidium/data-restored /secure/backups/rubidium-20261122.enc
```

加密模式使用 scrypt（N=32768）和 AES-256-GCM；恢复前会验证认证标签、校验和、SQLite 完整性、外键和 schema 兼容性。错误口令、损坏文件或不兼容版本会中止，已有目录不会覆盖。加密口令需为 16–1024 UTF-8 字节，可用 `RUBIDIUM_BACKUP_KEY` 或权限为 `0600` 的 `RUBIDIUM_BACKUP_KEY_FILE` 提供；口令不得写入命令行参数、版本库或备份所在位置。

本机环境可在命令前无回显地读取口令：

```sh
printf '备份加密密钥：'
IFS= read -r -s RUBIDIUM_BACKUP_KEY
printf '\n'
export RUBIDIUM_BACKUP_KEY
pnpm data:backup:encrypted /secure/backups/rubidium-20261122.enc
unset RUBIDIUM_BACKUP_KEY
```

恢复时使用相同方式读取原口令，并执行：

```sh
printf '恢复加密密钥：'
IFS= read -r -s RUBIDIUM_BACKUP_KEY
printf '\n'
export RUBIDIUM_BACKUP_KEY
pnpm data:restore:encrypted /srv/rubidium/data-restored /secure/backups/rubidium-20261122.enc
unset RUBIDIUM_BACKUP_KEY
```

运维快照包含 SQLite 中的 Bark Device Key，以及可能存在的访问密码兼容文件和会话签名密钥。恢复后的目录仍是明文运行数据，必须限制文件系统访问。普通 `data:backup` / `data:restore` 生成明文快照，只应写入权限受控的加密存储。

数据库运行时可能使用 WAL/SHM 辅助文件，不要直接复制正在运行的 SQLite 主文件作为备份。不要将数据目录放在不支持文件锁和可靠写入的网络文件系统，也不要让多个实例共享同一 SQLite 数据目录。恢复不会覆盖目标目录；恢复后将 `RUBIDIUM_DATA_DIR` 指向新目录，再启动服务。

## Docker Compose 命名卷

GHCR 部署使用下面的命令；源码 Compose 可去掉 `-f docker-compose.ghcr.yml`。创建本机临时口令文件并限制权限，再复制到容器：

```sh
KEY_FILE="$(mktemp)"
chmod 600 "$KEY_FILE"
trap 'rm -f "$KEY_FILE"; docker compose -f docker-compose.ghcr.yml exec -u 0 rubidium rm -f /tmp/rubidium-backup-key >/dev/null 2>&1 || true' EXIT
printf '备份加密密钥：'
IFS= read -r -s RUBIDIUM_BACKUP_KEY
printf '\n'
printf '%s' "$RUBIDIUM_BACKUP_KEY" > "$KEY_FILE"
unset RUBIDIUM_BACKUP_KEY
mkdir -p /secure/backups
docker cp "$KEY_FILE" rubidium:/tmp/rubidium-backup-key
docker compose -f docker-compose.ghcr.yml exec -u 0 rubidium chmod 600 /tmp/rubidium-backup-key
docker compose -f docker-compose.ghcr.yml exec -u 0 -e RUBIDIUM_BACKUP_KEY_FILE=/tmp/rubidium-backup-key rubidium node /app/scripts/data-tools.mjs backup-encrypted /tmp/rubidium-backup-20261122.enc
docker cp rubidium:/tmp/rubidium-backup-20261122.enc /secure/backups/
docker compose -f docker-compose.ghcr.yml exec -u 0 rubidium rm -r /tmp/rubidium-backup-20261122.enc
docker compose -f docker-compose.ghcr.yml exec -u 0 rubidium rm -f /tmp/rubidium-backup-key
```

恢复前停止服务；目标必须是卷中尚不存在的新目录。将备份目录以只读方式挂载，并把密钥文件只读挂载到一次性容器：

```sh
KEY_FILE="$(mktemp)"
chmod 600 "$KEY_FILE"
trap 'rm -f "$KEY_FILE"' EXIT
printf '恢复加密密钥：'
IFS= read -r -s RUBIDIUM_BACKUP_KEY
printf '\n'
printf '%s' "$RUBIDIUM_BACKUP_KEY" > "$KEY_FILE"
unset RUBIDIUM_BACKUP_KEY
docker compose -f docker-compose.ghcr.yml stop rubidium
docker compose -f docker-compose.ghcr.yml run --rm --no-deps --user 0 \
  -e RUBIDIUM_BACKUP_KEY_FILE=/run/secrets/rubidium-backup-key \
  -v "$KEY_FILE:/run/secrets/rubidium-backup-key:ro" \
  -v /secure/backups:/backups:ro \
  --entrypoint node rubidium \
  /app/scripts/data-tools.mjs restore-encrypted \
  /app/data/restore-20261122 /backups/rubidium-backup-20261122.enc
docker compose -f docker-compose.ghcr.yml run --rm --no-deps --user 0 \
  --entrypoint chown rubidium -R 1001:1001 /app/data/restore-20261122
```

将 `.env` 中 `RUBIDIUM_DATA_DIR` 改为 `/app/data/restore-20261122`，再启动服务。确认恢复数据前保留原目录和卷；不要使用会删除卷的 Compose 清理选项。把 `/secure/backups`、快照名称和恢复目录替换为实际路径，并在退出时删除临时口令文件。
