# 数据管理

v2.0.0-alpha 的网页导出封装为 version 2、数据库 schema 6；运维备份 manifest 为 format 2，加密文件头为 `RUBIDIUM-OPS-BACKUP-2`。只接受这些 v2 格式，不支持 v1 数据库、导出文件或备份。原 v1 数据和备份应保留给 v1 实例。

## 网页导入与导出

在「设置 → 记录维护」里打开导出或导入弹窗。导出密码为 12–200 个字符，导入时必须提供同一个密码；密码不会存到服务器上，弄丢了就解不开文件。

导出文件用 scrypt 派生密钥、AES-256-GCM 加密，内容包括提醒、投递历史、通知渠道和偏好设置，但不含访问密码哈希、活动会话、API 凭据和调度器运行状态。导入会替换掉这些业务数据，操作前要二次确认；访问密码、会话和 API 凭据会保留。认证失败、文件损坏或格式不兼容时，现有数据不会被改动。网页通过仅限浏览器会话的 `/api/data/export` 和 `/api/data/import` 执行；API token 和 MCP 不能调用。

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

运维快照包含 `rubidium.sqlite` 中的通知渠道凭据与访问密码哈希，以及存在时的 `session-secret.txt`。不再备份旧版明文访问密码文件。恢复出来的目录仍然是明文运行数据，必须限制文件系统访问。普通 `data:backup` / `data:restore` 生成的是明文快照，只应该写到权限受控的加密存储里。

数据库运行时可能用 WAL/SHM 辅助文件，所以别直接复制正在运行的 SQLite 主文件当备份。也不要把数据目录放在不支持文件锁和可靠写入的网络文件系统上，更不要让多个实例共用一个 SQLite 数据目录。恢复不会覆盖目标目录；恢复完把 `RUBIDIUM_DATA_DIR` 指向新目录，再启动服务。

## Docker 命名卷

下面的命令同时适用于直接运行镜像和源码 Compose 部署，容器默认都叫 `rubidium`；修改过名称时请替换。先在本机建临时口令文件并限制权限，再复制进容器：

```sh
KEY_FILE="$(mktemp)"
chmod 600 "$KEY_FILE"
trap 'rm -f "$KEY_FILE"; docker exec -u 0 rubidium rm -f /tmp/rubidium-backup-key >/dev/null 2>&1 || true' EXIT
printf '备份加密密钥：'
IFS= read -r -s RUBIDIUM_BACKUP_KEY
printf '\n'
printf '%s' "$RUBIDIUM_BACKUP_KEY" > "$KEY_FILE"
unset RUBIDIUM_BACKUP_KEY
mkdir -p /secure/backups
docker cp "$KEY_FILE" rubidium:/tmp/rubidium-backup-key
docker exec -u 0 rubidium chmod 600 /tmp/rubidium-backup-key
docker exec -u 0 -e RUBIDIUM_BACKUP_KEY_FILE=/tmp/rubidium-backup-key rubidium node /app/scripts/data-tools.mjs backup-encrypted /tmp/rubidium-backup-20261122.enc
docker cp rubidium:/tmp/rubidium-backup-20261122.enc /secure/backups/
docker exec -u 0 rubidium rm -r /tmp/rubidium-backup-20261122.enc
docker exec -u 0 rubidium rm -f /tmp/rubidium-backup-key
```

恢复前读取现有容器使用的卷名和镜像，继续使用同一个卷；直接镜像部署的默认卷为 `rubidium-v2-data`，源码 Compose 的卷名包含项目名前缀。下面命令面向命名卷；使用宿主机目录挂载时，请改成实际路径。

停服务后，将备份目录及密钥文件只读挂进一次性容器；恢复目标必须是卷里尚不存在的新目录：

```sh
KEY_FILE="$(mktemp)"
chmod 600 "$KEY_FILE"
trap 'rm -f "$KEY_FILE"' EXIT
printf '恢复加密密钥：'
IFS= read -r -s RUBIDIUM_BACKUP_KEY
printf '\n'
printf '%s' "$RUBIDIUM_BACKUP_KEY" > "$KEY_FILE"
unset RUBIDIUM_BACKUP_KEY
DATA_VOLUME="$(docker inspect rubidium --format '{{range .Mounts}}{{if eq .Destination "/app/data"}}{{.Name}}{{end}}{{end}}')"
IMAGE="$(docker inspect rubidium --format '{{.Image}}')"
: "${DATA_VOLUME:?未找到 /app/data 命名卷，请确认实际挂载}"
docker stop rubidium
docker run --rm --user 0 \
  -e RUBIDIUM_BACKUP_KEY_FILE=/run/secrets/rubidium-backup-key \
  -v "$DATA_VOLUME:/app/data" \
  -v "$KEY_FILE:/run/secrets/rubidium-backup-key:ro" \
  -v /secure/backups:/backups:ro \
  --entrypoint node "$IMAGE" \
  /app/scripts/data-tools.mjs restore-encrypted \
  /app/data/restore-20261122 /backups/rubidium-backup-20261122.enc
docker run --rm --user 0 -v "$DATA_VOLUME:/app/data" \
  --entrypoint chown "$IMAGE" -R 1001:1001 /app/data/restore-20261122
```

把启动环境里的 `RUBIDIUM_DATA_DIR` 改成 `/app/data/restore-20261122`：直接镜像部署编辑 `rubidium.env` 并按[部署指南](deployment.md)仅重建容器、复用原卷；源码 Compose 编辑 `.env` 后执行 `docker compose up -d`。只执行 `docker start` 不会更新容器环境。

确认数据没问题之前，原目录和原卷都留着，不要使用会删卷的清理选项。命令里的 `/secure/backups`、快照名和恢复目录需换成实际路径，退出时删除临时口令文件。
