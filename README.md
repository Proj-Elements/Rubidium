# Rubidium

Rubidium 是一款可自托管的 Bark 周期提醒服务，使用 Docker Compose 即可部署。容器镜像托管于 [`ghcr.io/proj-elements/rubidium`](https://github.com/Proj-Elements/Rubidium/pkgs/container/rubidium)，数据保存在本地持久卷中。

## 快速部署

需要 Docker Engine 与 Docker Compose v2。

```sh
git clone https://github.com/Proj-Elements/Rubidium.git
cd Rubidium
cp .env.example .env
chmod 600 .env
```

编辑 `.env`，设置至少 32 个随机字符的 `RUBIDIUM_SETUP_TOKEN`，然后拉取并启动 GHCR 预构建镜像：

```sh
docker compose -f docker-compose.ghcr.yml pull
docker compose -f docker-compose.ghcr.yml up -d
```

访问 `http://localhost:3000`，输入引导令牌并创建访问密码。默认只监听本机地址；通过反向代理对外提供服务时，按需调整 `RUBIDIUM_BIND_ADDR` 和代理配置。

GHCR Compose 文件默认固定使用 `1.1.0`。升级时将 `RUBIDIUM_IMAGE` 改为目标版本，然后重新执行 `pull` 与 `up -d`。任务数据和设置保存在 `barker-data` 命名卷中；除非要永久删除数据，不要使用 `docker compose down -v`。

也可在 `.env` 设置 `RUBIDIUM_PASSWORD` 预置访问密码并跳过初始化。界面默认按浏览器语言选择；首次访问可在右上角切换简体中文、繁體中文或 English。其他环境变量见[环境配置](docs/configuration.md)；源码构建、升级与密码重置见[部署指南](docs/deployment.md)。

其他配置、升级、数据管理与 API/MCP 使用说明见 [`docs/`](docs/)。

## 许可

Rubidium 采用 [AGPL-3.0-only](LICENSE)。
