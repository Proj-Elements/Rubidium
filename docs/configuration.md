# 环境配置

Rubidium 用环境变量做配置。建议把它们写进 `.env`，再用 `chmod 600` 收紧权限，因为里面通常会有密码、令牌这类敏感信息。

> 从旧版本升级过来的话，旧变量名还能用，但建议尽快把 `.env` 里换成下面这些以 `RUBIDIUM_` 开头的新名字。

| 变量 | 默认值 | 说明 |
| --- | --- | --- |
| `RUBIDIUM_PASSWORD` | 未设置 | 访问密码，8–300 个字符。设好之后直接用它登录，跳过首次初始化页面。 |
| `RUBIDIUM_SETUP_TOKEN` | 未设置 | 引导令牌，32–300 个字符。设置后会开放首次初始化，但得先输入这个令牌才能设密码。初始化完成后可以删掉。 |
| `RUBIDIUM_ALLOW_SETUP` | 未启用 | 设为 `1`、`true` 或 `yes` 时，不带令牌也能初始化。只建议在本机或内网这类受控环境里开。如果同时配了引导令牌，那仍然要输令牌。 |
| `RUBIDIUM_SESSION_SECRET` | 自动生成，存在数据目录 | 用来给登录会话签名，16–300 个字符。把它固定下来，重建容器就不会让所有人掉线；反过来，改掉它会让现有会话全部失效。 |
| `RUBIDIUM_DATA_DIR` | `./data`（容器内是 `/app/data`） | 放 SQLite 数据库和会话签名密钥的目录，不能放在 `.next` 目录里。 |
| `RUBIDIUM_TRUST_PROXY` | 不信任代理头 | 只有在可信的 HTTPS 反向代理后面才设成 `1`、`true` 或 `yes`。开了之后，应用才会采信代理转发的客户端地址和协议。 |
| `RUBIDIUM_COOKIE_SECURE` | 跟随可信代理的协议 | 设成 `1`、`true` 或 `yes` 会强制 Cookie 带 Secure 标记。如果只用 HTTP 访问，别开这个，否则会登录不上。 |
| `RUBIDIUM_BIND_ADDR` | `127.0.0.1` | Compose 在宿主机上绑定的地址。只有前面有代理、网络层也做了防护，才改成 `0.0.0.0`。 |
| `RUBIDIUM_PORT` | `3000` | Compose 在宿主机上暴露的端口。容器内部固定是 `3000`。 |
| `RUBIDIUM_IMAGE` | `ghcr.io/proj-elements/rubidium:1.1.1` | GHCR Compose 用的镜像。生产环境请固定到具体版本号或镜像摘要。 |
| `RUBIDIUM_BACKUP_KEY` | 未设置 | 运维加密备份用的口令，16–1024 个 UTF-8 字节。别把口令和备份文件放在一起。 |
| `RUBIDIUM_BACKUP_KEY_FILE` | 未设置 | 从文件读备份口令。文件权限必须是 `0600`；设了它就优先于 `RUBIDIUM_BACKUP_KEY`。 |

## 界面语言与时区

第一次打开时，界面会根据浏览器的 `Accept-Language` 自动选简体中文、繁體中文或 English。如果开了 `RUBIDIUM_TRUST_PROXY`，应用还会参考代理传来的国家码（`X-Vercel-IP-Country`、`CF-IPCountry` 或 `Fly-Client-Country`）猜一下语言。之后只要你手动选过，就一直按你的选择来。登录页和工作区右上角都有语言菜单，随时可以切。

语言和时区是分开的，切换语言不会顺带改时区：

- 初始化时默认用浏览器报告的时区，之后可以在设置页改全局显示时区。
- 每条提醒也可以单独指定自己的时区。

访问密码只会以 scrypt 哈希的形式保存，不存明文。

网页端的加密导入导出，以及运维备份命令，见[数据管理](data-management.md)。
