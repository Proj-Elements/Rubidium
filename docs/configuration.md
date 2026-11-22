# 环境配置

Rubidium 通过环境变量来配置。建议把它们写进 `.env` 文件，并用 `chmod 600` 限制权限，因为里面会有密码、令牌这类敏感信息。

> 从旧版本升级？旧变量名仍然能用，但请尽快把 `.env` 里的变量换成下表中以 `RUBIDIUM_` 开头的新名字。

| 变量 | 默认值 | 说明 |
| --- | --- | --- |
| `RUBIDIUM_PASSWORD` | 未设置 | 访问密码，8–300 个字符。设置后会直接使用这个密码，跳过首次初始化页面。 |
| `RUBIDIUM_SETUP_TOKEN` | 未设置 | 引导令牌，32–300 个字符。设置后会开放首次初始化，但要先输入这个令牌才能设密码。初始化完成后可以删掉。 |
| `RUBIDIUM_ALLOW_SETUP` | 未启用 | 设为 `1`、`true` 或 `yes` 时，不需要令牌就能初始化。只建议在本机或内网这类受控环境里用。如果同时配置了引导令牌，仍然要输入令牌。 |
| `RUBIDIUM_SESSION_SECRET` | 自动生成，保存在数据目录 | 用来签署登录会话，16–300 个字符。固定这个值后，重建容器也不会让大家掉线；改掉它则会让所有现有会话失效。 |
| `RUBIDIUM_DATA_DIR` | `./data`（容器内是 `/app/data`） | 存放 SQLite 数据库和会话签名密钥的目录，不能放在 `.next` 目录里。 |
| `RUBIDIUM_TRUST_PROXY` | 不信任代理头 | 只有在可信的 HTTPS 反向代理后面才设为 `1`、`true` 或 `yes`，这样应用才会采用代理转发过来的客户端地址和协议。 |
| `RUBIDIUM_COOKIE_SECURE` | 跟随可信代理的协议 | 设为 `1`、`true` 或 `yes` 会强制使用 Secure Cookie。如果你只用 HTTP 访问，不要打开它，否则会登录不上。 |
| `RUBIDIUM_BIND_ADDR` | `127.0.0.1` | Compose 在宿主机上绑定的地址。只有在前面有代理、网络也做了防护时，才改成 `0.0.0.0`。 |
| `RUBIDIUM_PORT` | `3000` | Compose 在宿主机上暴露的端口。容器内部固定是 `3000`。 |
| `RUBIDIUM_IMAGE` | `ghcr.io/proj-elements/rubidium:1.1.0` | GHCR Compose 使用的镜像。生产环境请固定到具体版本号或镜像摘要。 |
| `RUBIDIUM_BACKUP_KEY` | 未设置 | 运维加密备份用的口令，16–1024 个 UTF-8 字节。别把口令和备份文件放在一起。 |
| `RUBIDIUM_BACKUP_KEY_FILE` | 未设置 | 从文件读取备份口令。文件权限必须是 `0600`；设置后优先于 `RUBIDIUM_BACKUP_KEY`。 |

## 界面语言与时区

第一次打开时，界面会根据浏览器的 `Accept-Language` 自动选择简体中文、繁體中文或 English。如果开启了 `RUBIDIUM_TRUST_PROXY`，应用还会参考代理传来的国家码（`X-Vercel-IP-Country`、`CF-IPCountry` 或 `Fly-Client-Country`）来猜测语言。之后只要你手动选过，就一直以你的选择为准。在登录页和工作区右上角的「文A」菜单里都能切换语言。

语言和时区是分开的，切换语言不会改变时区：

- 初始化时默认使用浏览器报告的时区，之后可以在设置页修改全局的显示时区。
- 每条提醒还可以单独指定自己的时区。

访问密码只会以 scrypt 哈希的形式保存，不会存明文。

网页端的加密导入导出和运维备份命令，请看[数据管理](data-management.md)。
