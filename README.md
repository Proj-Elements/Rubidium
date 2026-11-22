# Rubidium

Rubidium 是一个可以自己部署的周期提醒服务，通过 Bark 把提醒推送到你的设备上。用 Docker Compose 就能跑起来，镜像发布在 [`ghcr.io/proj-elements/rubidium`](https://github.com/Proj-Elements/Rubidium/pkgs/container/rubidium)，所有数据都保存在本地的持久卷里。

## 快速部署

先确认机器上装好了 Docker Engine 和 Docker Compose v2，然后：

```sh
git clone https://github.com/Proj-Elements/Rubidium.git
cd Rubidium
cp .env.example .env
chmod 600 .env
```

打开 `.env`，给 `RUBIDIUM_SETUP_TOKEN` 填一串随机字符（至少 32 位），它是首次初始化时用的引导令牌。接着拉取预构建镜像并启动：

```sh
docker compose -f docker-compose.ghcr.yml pull
docker compose -f docker-compose.ghcr.yml up -d
```

在浏览器里打开 `http://localhost:3000`，输入刚才的引导令牌，再设置一个访问密码，就可以开始用了。

如果不想走初始化页面，也可以直接在 `.env` 里用 `RUBIDIUM_PASSWORD` 预设访问密码。

## 几点说明

- **只监听本机**：服务默认只绑定 `127.0.0.1`。如果要通过反向代理对外开放，记得调整 `RUBIDIUM_BIND_ADDR` 和代理相关配置。
- **版本与升级**：Compose 文件默认锁定 `1.1.0`。想升级时，把 `.env` 里的 `RUBIDIUM_IMAGE` 改成目标版本，再执行一次 `pull` 和 `up -d`。
- **数据存放**：任务和设置都在名为 `barker-data` 的卷里。除非你确实想把数据全部删掉，否则不要运行 `docker compose down -v`。
- **界面语言**：默认跟随浏览器语言，也可以随时在右上角切换简体中文、繁體中文或 English。

## 更多文档

- [环境配置](docs/configuration.md)：所有环境变量的含义和默认值
- [部署指南](docs/deployment.md)：源码构建、升级、重置访问密码
- [数据管理](docs/data-management.md)：网页导入导出、运维备份与恢复
- [提醒与投递](docs/reminders-and-delivery.md)：重复规则和投递状态是怎么运作的
- [API 与 MCP](docs/api-mcp.md)：HTTP API 和 MCP 工具的使用方法

## 许可

Rubidium 采用 [AGPL-3.0-only](LICENSE) 许可。
