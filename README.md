# Rubidium

Rubidium 是一个可以自己部署的定时提醒服务：你写好提醒和重复规则，它到点通过 Bark 把消息推到你设备上。整套服务用 Docker Compose 跑，镜像发布在 [`ghcr.io/proj-elements/rubidium`](https://github.com/Proj-Elements/Rubidium/pkgs/container/rubidium)，所有数据都留在本地持久卷里。

## 快速部署

先确认机器上装好了 Docker Engine 和 Docker Compose v2，然后拉代码、准备环境文件：

```sh
git clone https://github.com/Proj-Elements/Rubidium.git
cd Rubidium
cp .env.example .env
chmod 600 .env
```

打开 `.env`，给 `RUBIDIUM_SETUP_TOKEN` 填一串随机字符（至少 32 位）。这是首次初始化用的引导令牌，用来防止别人抢在你前面把实例占掉。

接着登录 GHCR 并启动：

```sh
docker login ghcr.io --username YOUR_GITHUB_USERNAME
docker compose -f docker-compose.ghcr.yml pull
docker compose -f docker-compose.ghcr.yml up -d
```

GHCR 上的包需要认证，所以要准备一个有 `read:packages` 权限的 GitHub Token。`docker login` 会提示你输入，不会把它留在命令行里。

用浏览器打开 `http://localhost:3000`，输入引导令牌，再设一个访问密码，就能开始用了。

如果不想走初始化页面，也可以直接在 `.env` 里用 `RUBIDIUM_PASSWORD` 预设访问密码。

## 几点说明

- **默认只监听本机**：服务绑定在 `127.0.0.1`。要通过反向代理对外开放，先改 `RUBIDIUM_BIND_ADDR`，再把代理相关的配置补上。
- **版本与升级**：Compose 文件把镜像固定在 `1.1.1`。想升级时，把 `.env` 里的 `RUBIDIUM_IMAGE` 改成目标版本，再执行一次 `pull` 和 `up -d`。
- **数据存放**：提醒和设置都在名为 `barker-data` 的卷里。除非你确定要把数据全部删掉，否则别运行 `docker compose down -v`。
- **界面语言**：默认跟随浏览器语言，也可以随时在右上角切换简体中文、繁體中文或 English。

## 更多文档

- [环境配置](docs/configuration.md)：每个环境变量的含义和默认值
- [部署指南](docs/deployment.md)：源码构建、升级、重置访问密码
- [数据管理](docs/data-management.md)：网页导入导出、运维备份与恢复
- [提醒与投递](docs/reminders-and-delivery.md)：重复规则怎么算、投递状态怎么流转
- [API 与 MCP](docs/api-mcp.md)：HTTP API 和 MCP 工具的用法

## 许可

Rubidium 采用 [AGPL-3.0-only](LICENSE) 许可。
