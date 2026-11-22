# 部署

生产部署推荐使用 GHCR 预构建镜像；也可以从源码使用 Docker Compose 构建。

## GHCR 镜像

克隆项目并准备环境文件：

```sh
git clone https://github.com/Proj-Elements/Rubidium.git
cd Rubidium
cp .env.example .env
chmod 600 .env
```

编辑 `.env`，至少设置随机的 `RUBIDIUM_SETUP_TOKEN`（32 个字符以上）。随后拉取并启动固定版本镜像：

```sh
docker compose -f docker-compose.ghcr.yml pull
docker compose -f docker-compose.ghcr.yml up -d
docker compose -f docker-compose.ghcr.yml ps
```

浏览器访问 `http://localhost:3000`，输入引导令牌创建访问密码。镜像默认固定到 `1.0.3`；选择其他发布版本时，在 `.env` 中设置：

```dotenv
RUBIDIUM_IMAGE=ghcr.io/proj-elements/rubidium:1.0.3
```

生产环境应固定明确版本或镜像摘要，不要依赖可变的 `latest` 标签。公开镜像不需要 GHCR 登录，也不需要 HeroUI Pro 构建凭据。

默认只绑定 `127.0.0.1:3000`。经 HTTPS 反向代理提供访问时，可将 `RUBIDIUM_BIND_ADDR` 设为 `0.0.0.0`，并在[环境配置](configuration.md)中配置可信代理。不要直接把未受保护的 HTTP 服务暴露到公网。

## 从源码构建

`docker-compose.yml` 会在本机从源码构建。构建前需将有效的 HeroUI Pro 访问码设置为当前终端的 `HEROUI_KEY`；Compose 使用 BuildKit secret 注入，不会将该值放入运行容器或镜像层。

HeroUI Pro 组件使用独立商业许可；源码构建者需另行具备使用权限。该凭据只用于构建依赖，不需要放入运行环境。

```sh
read -r -s -p "HeroUI Pro access key: " HEROUI_KEY
printf '\n'
export HEROUI_KEY
docker compose up -d --build
unset HEROUI_KEY
```

## 更新与数据卷

GHCR 镜像更新：

```sh
docker compose -f docker-compose.ghcr.yml pull
docker compose -f docker-compose.ghcr.yml up -d
```

Compose 使用 `barker-data` 命名卷保存数据库、访问凭据和设置。升级已有部署时，应继续使用原 Compose 项目名和卷；若原部署通过 `-p` 指定了项目名，后续命令也必须使用相同值。首次启动前确认 Compose 实际挂载的是预期数据卷。

从旧容器迁移时可先移除容器本身，再使用同一命名卷启动新容器；不要删除数据卷。升级前建议先按[数据管理](data-management.md)创建独立备份。回滚到旧版本前，先停止新服务；如果新版本已迁移数据库，需将备份恢复到新的数据目录后再启动旧版本。

## 重置访问密码

在运行中的容器内执行交互式重置命令。新密码无回显；任务、队列和设置保留，现有会话与 API 凭据会撤销。

```sh
docker compose -f docker-compose.ghcr.yml exec -it rubidium node /app/scripts/password-reset.mjs
```

如果部署使用源码 Compose，将命令中的 `-f docker-compose.ghcr.yml` 去掉。
