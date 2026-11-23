# Rubidium

Rubidium 是可自部署的定时提醒服务，支持重复规则、Bark / Ntfy 通知渠道和 API / MCP 接入。

## 方式一：直接运行镜像

只需安装 Docker，无需克隆仓库或提供构建凭据。[GHCR 镜像](https://github.com/Proj-Elements/Rubidium/pkgs/container/rubidium)目前需要认证：用有该包访问权限及 `read:packages` 权限的 GitHub Token 登录，在提示中输入 Token。

```sh
umask 077
printf 'RUBIDIUM_SETUP_TOKEN=%s\n' "$(openssl rand -hex 32)" > rubidium.env
docker login ghcr.io --username YOUR_GITHUB_USERNAME
docker pull ghcr.io/proj-elements/rubidium:1.1.2
docker run -d --name rubidium --init --restart unless-stopped --stop-timeout 30 \
  -p 127.0.0.1:3000:3000 --env-file rubidium.env \
  -v rubidium-data:/app/data ghcr.io/proj-elements/rubidium:1.1.2
```

## 方式二：克隆源码并用 Docker Compose 构建

安装 Docker 和 Compose v2，准备有使用权限的 HeroUI Pro 访问码。此方式在本机构建，不从 GHCR 拉取 Rubidium 镜像。

```sh
git clone https://github.com/Proj-Elements/Rubidium.git
cd Rubidium
cp .env.example .env
chmod 600 .env
```

编辑 `.env`，填入至少 32 个随机字符的 `RUBIDIUM_SETUP_TOKEN`，然后运行：

```sh
printf 'HeroUI Pro 访问码：'
IFS= read -r -s HEROUI_KEY
printf '\n'
export HEROUI_KEY
docker compose up -d --build
unset HEROUI_KEY
```

## 首次配置

- 打开 `http://localhost:3000`，输入环境文件中的引导令牌，设置访问密码和时区；也可在环境文件中预设 `RUBIDIUM_PASSWORD` 跳过初始化。
- 在「设置 → 通知渠道」配置 Bark 或 Ntfy，发送测试通知后即可创建提醒；右上角可切换简中、繁中或 English。
- 默认仅监听本机；公网访问请配置 HTTPS 反向代理。数据保存在 `/app/data` 的命名卷中，升级必须复用原卷，不要删卷。

## 更多文档

- [环境配置](docs/configuration.md)：每个环境变量的含义和默认值
- [部署指南](docs/deployment.md)：镜像或源码部署、升级、重置访问密码
- [数据管理](docs/data-management.md)：网页导入导出、运维备份与恢复
- [提醒与投递](docs/reminders-and-delivery.md)：重复规则怎么算、投递状态怎么流转
- [API 与 MCP](docs/api-mcp.md)：HTTP API 和 MCP 工具的用法

## 许可

Rubidium 采用 [AGPL-3.0-only](LICENSE) 许可。
