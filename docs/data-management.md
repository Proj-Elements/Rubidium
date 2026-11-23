# 数据管理

## 网页导入与导出

在「设置 → 记录维护」里打开导出或导入弹窗。导出密码为 12–200 个字符，导入时必须提供同一个密码；密码不会存到服务器上，弄丢了就解不开文件。

导出文件用 scrypt 派生密钥、AES-256-GCM 加密，内容包括提醒、投递历史、设备和通知设置，但不含访问密码哈希、活动会话、API 凭据和调度器运行状态。导入会替换掉这些业务数据，操作前要二次确认；访问密码、会话和 API 凭据会保留。认证失败、文件损坏或格式不兼容时，现有数据不会被改动。这个功能只在网页里提供，没有对应的 HTTP API 或 MCP 工具。

## 运维备份

普通备份走 SQLite 的在线备份接口，生成一致的快照。生产环境建议用加密模式：

```sh
pnpm data:backup:encrypted /secure/backups/rubidium-20261122.enc
```

恢复时指定一个还不存在的新目录：

```sh
pnpm data:restore:encrypted /srv/rubidium/data-restored /secure/backups/rubidium-20261122.enc
```

加密模式用 scrypt（N=32768）和 AES-256-GCM；恢复前会校验认证标签、校验和、SQLite 完整性、外键和 schema 兼容性。口令错误、文件损坏或版本不兼容都会中止，已有目录不会被覆盖。加密口令需为 16–1024 个 UTF-8 字节，可以用 `RUBIDIUM_BACKUP_KEY` 或权限为 `0600` 的 `RUBIDIUM_BACKUP_KEY_FILE` 提供；口令不要写进命令行参数、版本库或备份所在的目录。

本机环境可以这样无回显地读口令：

```sh
printf '备份加密密钥：'
IFS= read -r -s RUBIDIUM_BACKUP_KEY
printf '\n'
export RUBIDIUM_BACKUP_KEY
pnpm data:backup:encrypted /secure/backups/rubidium-20261122.enc
unset RUBIDIUM_BACKUP_KEY
```

恢复时用同样的方式读取原口令，然后执行：

```sh
printf '恢复加密密钥：'
IFS= read -r -s RUBIDIUM_BACKUP_KEY
printf '\n'
export RUBIDIUM_BACKUP_KEY
pnpm data:restore:encrypted /srv/rubidium/data-restored /secure/backups/rubidium-20261122.enc
unset RUBIDIUM_BACKUP_KEY
```

运维快照里包含 SQLite 中的 Bark Device Key，可能还有访问密码兼容文件和会话签名密钥。恢复出来的目录仍然是明文运行数据，必须限制文件系统访问。普通 `data:backup` / `data:restore` 生成的是明文快照，只应该写到权限受控的加密存储里。

数据库运行时可能用 WAL/SHM 辅助文件，所以别直接复制正在运行的 SQLite 主文件当备份。也不要把数据目录放在不支持文件锁和可靠写入的网络文件系统上，更不要让多个实例共用一个 SQLite 数据目录。恢复不会覆盖目标目录；恢复完把 `RUBIDIUM_DATA_DIR` 指向新目录，再启动服务。

## Docker Compose 命名卷

GHCR 部署用下面的命令；源码 Compose 去掉 `-f docker-compose.ghcr.yml` 即可。先在本机建一个临时口令文件并限制权限，再复制进容器：

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

恢复前先停服务；目标必须是卷里还不存在的新目录。把备份目录以只读方式挂载，密钥文件也只读挂进一次性容器：

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

把 `.env` 里的 `RUBIDIUM_DATA_DIR` 改成 `/app/data/restore-20261122`，再启动服务。确认数据没问题之前，原目录和原卷都留着；也别用会删卷的 Compose 清理选项。命令里的 `/secure/backups`、快照名和恢复目录要换成你的实际路径，退出时记得删掉临时口令文件。
