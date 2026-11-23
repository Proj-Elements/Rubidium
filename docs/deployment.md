# 部署

以下是两种独立方式：直接运行固定版本的 GHCR 镜像，或克隆源码后使用 Docker Compose 在本机构建。预构建镜像无需源码和 HeroUI Pro 构建凭据。

## 用 GHCR 镜像

安装 Docker，在任意部署目录创建仅自己可读的环境文件：

```sh
umask 077
printf 'RUBIDIUM_SETUP_TOKEN=%s\n' "$(openssl rand -hex 32)" > rubidium.env
```

`RUBIDIUM_SETUP_TOKEN` 用于首次初始化，需为 32–300 个字符。也可以在环境文件里预设 8–300 个字符的 `RUBIDIUM_PASSWORD`，直接用该密码登录。不要把实际密码或 Token 写进命令行参数。

当前 GHCR 包需要认证。准备有该包访问权限及 `read:packages` 权限的 GitHub Token，在 `docker login` 提示中输入，然后直接拉取并运行镜像，无需克隆项目：

```sh
docker login ghcr.io --username YOUR_GITHUB_USERNAME
docker pull ghcr.io/proj-elements/rubidium:1.1.3
docker run -d --name rubidium --init --restart unless-stopped --stop-timeout 30 \
  -p 127.0.0.1:3000:3000 --env-file rubidium.env \
  -v rubidium-data:/app/data ghcr.io/proj-elements/rubidium:1.1.3
docker ps --filter name=rubidium
```

浏览器访问 `http://localhost:3000`，输入环境文件里的引导令牌，创建访问密码并选择时区。上面的镜像固定为 `1.1.3`；也可使用 `ghcr.io/proj-elements/rubidium@sha256:<发布摘要>`，不要依赖会变的 `latest` 标签。

容器内的数据目录默认是 `/app/data`，运行配置写在 `rubidium.env`。改变宿主机端口时修改 `-p` 参数，例如 `127.0.0.1:13000:3000`。默认仅监听本机；需要对外提供访问时，在前面配置 HTTPS 反向代理，并按[环境配置](configuration.md)设置可信代理。不要把无防护的 HTTP 服务直接暴露到公网。

## 从源码构建

安装 Docker 和 Compose v2，克隆仓库并准备环境文件：

```sh
git clone https://github.com/Proj-Elements/Rubidium.git
cd Rubidium
cp .env.example .env
chmod 600 .env
```

编辑 `.env`，设置 `RUBIDIUM_SETUP_TOKEN` 或 `RUBIDIUM_PASSWORD`。`RUBIDIUM_DATA_DIR` 留空时，Compose 使用持久卷挂载的 `/app/data`；`RUBIDIUM_BIND_ADDR` 和 `RUBIDIUM_PORT` 仅控制宿主机监听。

`docker-compose.yml` 从源码构建本地镜像，不拉取 GHCR 上的 Rubidium 镜像。把有效的 HeroUI Pro 访问码设进当前终端的 `HEROUI_KEY`；Compose 通过 BuildKit secret 注入，不传给运行容器，也不留在镜像层里。

HeroUI Pro 组件是独立的商业许可；从源码构建的人需要自己具备使用权限。这个凭据只在构建依赖时用得到，不需要放进运行环境。

```sh
printf 'HeroUI Pro 访问码：'
IFS= read -r -s HEROUI_KEY
printf '\n'
export HEROUI_KEY
docker compose up -d --build
unset HEROUI_KEY
docker compose ps
```

## 更新与数据卷

更新镜像部署：先按[数据管理](data-management.md)备份，再拉取目标版本、仅替换容器，并挂载原来的卷。以下示例适用于本页首次部署使用的 `rubidium-data` 卷；已有实例务必换成其实际卷名。

```sh
docker pull ghcr.io/proj-elements/rubidium:1.1.3
docker stop rubidium
docker rm rubidium
docker run -d --name rubidium --init --restart unless-stopped --stop-timeout 30 \
  -p 127.0.0.1:3000:3000 --env-file rubidium.env \
  -v rubidium-data:/app/data ghcr.io/proj-elements/rubidium:1.1.3
```

更新源码部署：拉取代码，再按源码构建步骤提供 `HEROUI_KEY` 并执行 `docker compose up -d --build`。源码 Compose 保留历史的 `barker-data` 卷标识，实际卷名包含 Compose 项目名前缀。升级时保持原项目名；若原来用了 `-p`，后续命令也使用同一个值。

无论采用哪种方式，都先检查现有挂载，不能把更换部署方式当作新建空卷：

```sh
docker inspect rubidium --format '{{range .Mounts}}{{println .Name "->" .Destination}}{{end}}'
```

只删除旧容器，不删除数据卷，也不执行 `docker compose down -v`。如果新版本已迁移数据库，要回滚时先停止新服务，把升级前备份恢复到新目录，再用旧镜像启动；不要让两个实例同时使用同一 SQLite 数据目录。

## 重置访问密码

在运行中的容器里执行交互式重置命令。新密码输入时不回显；提醒、队列和设置都会保留，但现有会话和 API 凭据会被撤销。

```sh
docker exec -it rubidium node /app/scripts/password-reset.mjs
```

以上命令同时适用于镜像和源码 Compose 部署；若修改过容器名称，将 `rubidium` 换成实际名称。
