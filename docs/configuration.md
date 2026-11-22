# 环境配置

Rubidium 使用以下环境变量。新部署请使用 `RUBIDIUM_` 前缀，并将秘密值保存在权限受限的 `.env` 文件中。升级现有部署时，请将 `.env` 中的旧变量名替换为下表对应的新名称。

| 变量 | 默认值 | 说明 |
| --- | --- | --- |
| `RUBIDIUM_PASSWORD` | 未设置 | 8–300 个字符。设置后预先配置访问密码并跳过首次初始化。 |
| `RUBIDIUM_SETUP_TOKEN` | 未设置 | 32–300 个字符。开放首次初始化并要求输入此令牌；初始化完成后可移除。 |
| `RUBIDIUM_ALLOW_SETUP` | 未启用 | 设为 `1`、`true` 或 `yes` 可无令牌初始化。仅适合本机或受限网络；配置引导令牌时仍必须输入令牌。 |
| `RUBIDIUM_SESSION_SECRET` | 自动生成并保存到数据目录 | 16–300 个字符，用于签署会话。固定此值可在容器重建后保留会话；修改会使已有会话失效。 |
| `RUBIDIUM_DATA_DIR` | `./data`；容器内 `/app/data` | SQLite 数据库与会话签名密钥所在目录；必须在 `.next` 目录之外。 |
| `RUBIDIUM_TRUST_PROXY` | 不信任代理头 | 仅在可信 HTTPS 反向代理后设为 `1`、`true` 或 `yes`，以使用转发的客户端地址和协议。 |
| `RUBIDIUM_COOKIE_SECURE` | 跟随可信代理协议 | 设为 `1`、`true` 或 `yes` 强制 Secure Cookie；纯 HTTP 环境不要开启。 |
| `RUBIDIUM_BIND_ADDR` | `127.0.0.1` | Compose 宿主机绑定地址。只在有防护的代理网络环境中改为 `0.0.0.0`。 |
| `RUBIDIUM_PORT` | `3000` | Compose 宿主机端口；容器内部端口固定为 `3000`。 |
| `RUBIDIUM_IMAGE` | `ghcr.io/proj-elements/rubidium:1.0.2` | GHCR Compose 使用的镜像标签；生产环境固定到明确版本或摘要。 |
| `RUBIDIUM_BACKUP_KEY` | 未设置 | 运维加密备份命令使用的口令，16–1024 UTF-8 字节。不要将口令与备份放在同一位置。 |
| `RUBIDIUM_BACKUP_KEY_FILE` | 未设置 | 运维备份命令从该文件读取口令；文件权限必须为 `0600`，设置后优先于口令变量。 |

首次初始化页面默认选择浏览器报告的 IANA 时区，之后可在设置页更改全局显示时区；每条提醒也可使用独立时区。初始化访问密码以 scrypt 哈希保存。

网页加密导入导出与运维备份命令见[数据管理](data-management.md)。
