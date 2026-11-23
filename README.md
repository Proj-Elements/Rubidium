# Rubidium

Rubidium 是一个可以自己部署的定时提醒服务。你可以设一条只响一次的提醒，也可以让它每个工作日上午 9 点推送到 Bark 或 Ntfy。提醒和投递记录都能在网页上管理，也可以通过 HTTP API 或 MCP 接入自己的工具。

## 用 Docker 镜像启动

如果只是想运行 Rubidium，用现成的镜像最简单：不用克隆仓库，也不需要 HeroUI Pro 访问码。当前[镜像托管在 GHCR](https://github.com/Proj-Elements/Rubidium/pkgs/container/rubidium)，拉取前需要登录。准备一个有该包读取权限、且带 `read:packages` 权限的 GitHub 令牌。

首次安装时，在部署目录运行以下命令。第一步用 OpenSSL 生成引导令牌，保存在仅当前用户可读写的 `rubidium.env` 中；已有这个文件时不要覆盖。将 `YOUR_GITHUB_USERNAME` 换成你的 GitHub 用户名，在 `docker login` 的密码提示处输入 **GitHub 令牌**。

```sh
umask 077
printf 'RUBIDIUM_SETUP_TOKEN=%s\n' "$(openssl rand -hex 32)" > rubidium.env
docker login ghcr.io --username YOUR_GITHUB_USERNAME
docker pull ghcr.io/proj-elements/rubidium:1.2.0
docker run -d --name rubidium --init --restart unless-stopped --stop-timeout 30 \
  -p 127.0.0.1:3000:3000 --env-file rubidium.env \
  -v rubidium-data:/app/data ghcr.io/proj-elements/rubidium:1.2.0
```

## 用 Docker Compose 从源码构建

如果要运行自己修改过的代码，选这条路径。你需要 Git、Docker、Compose v2，以及有权使用的 HeroUI Pro 访问码；不需要从 GHCR 拉取 Rubidium 镜像。

```sh
git clone https://github.com/Proj-Elements/Rubidium.git
cd Rubidium
cp .env.example .env
chmod 600 .env
```

编辑 `.env`，把 `RUBIDIUM_SETUP_TOKEN` 设为 32–300 个字符的随机令牌。然后在 Bash 或 Zsh 中运行以下命令，按提示输入 HeroUI Pro 访问码（输入时不会显示）。访问码只在构建时使用。

```bash
printf 'HeroUI Pro 访问码：'
IFS= read -r -s HEROUI_KEY
printf '\n'
export HEROUI_KEY
docker compose up -d --build
unset HEROUI_KEY
```

## 发出第一条提醒

1. 在部署机器上打开 <http://localhost:3000>，输入环境文件中的**引导令牌**，设置访问密码和时区。如果已经预设了 `RUBIDIUM_PASSWORD`，直接用该密码登录。界面右上角可以切换简体中文、繁体中文或英语。
2. 打开「设置 → 通知渠道」，配置 Bark 或 Ntfy，先发一条测试通知，确认设备能收到。
3. 创建提醒，选好执行时间和通知渠道。到点后，可以在「投递记录」里查看发送结果。

两种部署方式默认都只开放本机端口。需要从公网访问时，请使用 HTTPS 反向代理。容器把数据保存在挂载到 `/app/data` 的卷里；升级时要复用原卷，具体步骤见[部署指南](docs/deployment.md)。

## 文档

- [环境配置](docs/configuration.md)：首次登录、数据目录和反向代理该怎么配。
- [部署指南](docs/deployment.md)：安装、升级、回滚和重置访问密码。
- [提醒与投递](docs/reminders-and-delivery.md)：重复次数怎么算，停机后会不会补发，`sent` 表示什么。
- [数据管理](docs/data-management.md)：什么时候用网页导出，什么时候需要备份整个实例。
- [API 与 MCP](docs/api-mcp.md)：创建凭据，查看接口、工具和调用示例。

## 许可

Rubidium 的源代码使用 [AGPL-3.0-only](LICENSE) 许可。依赖项各有其许可，见[第三方许可清单](THIRD_PARTY_NOTICES.md)。
