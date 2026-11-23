# 部署

生产环境建议直接用 GHCR 上的预构建镜像；需要自己改代码的话，也可以从源码用 Docker Compose 构建。

## 用 GHCR 镜像

先克隆项目、准备环境文件：

```sh
git clone https://github.com/Proj-Elements/Rubidium.git
cd Rubidium
cp .env.example .env
chmod 600 .env
```

编辑 `.env`，至少设一个随机的 `RUBIDIUM_SETUP_TOKEN`（32 个字符以上）。当前 GHCR 上的包需要认证，请用有 `read:packages` 权限的 GitHub Token 登录；`docker login` 会提示输入，不要把它直接写在命令行参数里。然后拉取并启动固定版本的镜像：

```sh
docker login ghcr.io --username YOUR_GITHUB_USERNAME
docker compose -f docker-compose.ghcr.yml pull
docker compose -f docker-compose.ghcr.yml up -d
docker compose -f docker-compose.ghcr.yml ps
```

浏览器访问 `http://localhost:3000`，输入引导令牌，创建访问密码。镜像默认固定在 `1.1.1`；要换别的发布版本，在 `.env` 里设：

```dotenv
RUBIDIUM_IMAGE=ghcr.io/proj-elements/rubidium:1.1.1
```

生产环境应该固定到明确版本或镜像摘要，不要依赖会变的 `latest` 标签。用预构建镜像不需要 HeroUI Pro 的构建凭据。

默认只绑定 `127.0.0.1:3000`。如果要通过 HTTPS 反向代理对外提供访问，可以把 `RUBIDIUM_BIND_ADDR` 设成 `0.0.0.0`，再按[环境配置](configuration.md)把可信代理配好。别把没有防护的 HTTP 服务直接暴露到公网。

## 从源码构建

`docker-compose.yml` 会在本机从源码构建。构建前，先把有效的 HeroUI Pro 访问码设进当前终端的 `HEROUI_KEY`；Compose 通过 BuildKit secret 注入，这个值不会进入运行容器，也不会留在镜像层里。

HeroUI Pro 组件是独立的商业许可；从源码构建的人需要自己具备使用权限。这个凭据只在构建依赖时用得到，不需要放进运行环境。

```sh
read -r -s -p "HeroUI Pro access key: " HEROUI_KEY
printf '\n'
export HEROUI_KEY
docker compose up -d --build
unset HEROUI_KEY
```

## 更新与数据卷

更新 GHCR 镜像：

```sh
docker compose -f docker-compose.ghcr.yml pull
docker compose -f docker-compose.ghcr.yml up -d
```

Compose 用名为 `barker-data` 的命名卷保存数据库、访问凭据和设置。升级已有部署时，继续用原来的 Compose 项目名和卷；如果当初用 `-p` 指定过项目名，后面每条命令都得带上同样的值。首次启动前，先确认 Compose 实际挂载的是你预期的那个数据卷。

从旧容器迁移时，可以先删掉容器本身，再用同一个命名卷起新容器；但不要删数据卷。升级前建议先按[数据管理](data-management.md)做一份独立备份。要回滚到旧版本，先停掉新服务；如果新版本已经迁移过数据库，得先把备份恢复到新的数据目录，再启动旧版本。

## 重置访问密码

在运行中的容器里执行交互式重置命令。新密码输入时不回显；提醒、队列和设置都会保留，但现有会话和 API 凭据会被撤销。

```sh
docker compose -f docker-compose.ghcr.yml exec -it rubidium node /app/scripts/password-reset.mjs
```

如果部署用的是源码 Compose，把命令里的 `-f docker-compose.ghcr.yml` 去掉。
