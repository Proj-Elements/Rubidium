# Rubidium API 与 MCP

本文对应 Rubidium `2.0.0-alpha`。HTTP API 收发 JSON；MCP 用的是官方 `@modelcontextprotocol/sdk` 的无状态 Streamable HTTP。默认服务地址是 `http://localhost:3000`，实际部署时换成你自己的 HTTPS 地址。

## 鉴权与通用约定

在「设置 → 访问安全」创建 API 凭据，使用凭据输入框右侧的复制按钮保存。原文只显示一次，关闭提示或刷新页面后无法再次查看；请勿公开凭据。

- 普通数据 API 既接受 `Authorization: Bearer <API_TOKEN>`，也接受登录后的 `rubidium_session` Cookie。API token 在「设置 → 访问安全」里创建；`read` 权限只能发 `GET`/`HEAD`，`write` 权限可读可写。永久 token 的有效天数填 `0`，之后只能手动撤销。
- `/api/security` 和 `/api/audit` 只认有效的浏览器会话 Cookie，不接受 Bearer token。会话通过 `/api/session` 创建。
- MCP 只接受 Bearer API token，不接受 Cookie。只读 token 可以发现工具、执行只读工具；写工具需要 `write` token。
- JSON API 成功时返回该路由定义的 JSON 对象。输入有误、业务冲突和资源不存在统一返回 `{ "error": "..." }`；预期之外的故障返回脱敏的 500。经过 `apiRoute` 包装的响应会带上 `x-request-id`。
- JSON 请求体最大 64 KiB。`POST`、`PUT`、`PATCH` 这类变更必须带 `Content-Type: application/json`，并通过同源检查；`DELETE` 同样会拒绝跨站来源。
- 修订号对不上返回 `409`，缺修订号或修订号无效返回 `428`。除非请求本身用了幂等键，否则不要自动重放有副作用的请求。

## HTTP API

### 会话

| 方法与路径 | 鉴权 | 输入 | 成功结果与常见错误 |
| --- | --- | --- | --- |
| `GET /api/session` | 无 | 无 | `{ authenticated, initialized, setupEnabled, setupTokenRequired }`。用来判断当前 Cookie、初始化状态，以及部署端是否开放初始化；不会返回引导令牌。 |
| `POST /api/session` | 初始化或密码登录；JSON、同源 | `{ password, mode?, timeZone?, setupToken? }`。`mode` 取 `setup` 或 `login`，省略时按登录处理。初始化时 `timeZone` 是可选 IANA 时区。没设 `RUBIDIUM_PASSWORD` 的全新实例，需要配好 32–300 字符的 `RUBIDIUM_SETUP_TOKEN` 并提交 `setupToken`；或者由部署者显式设 `RUBIDIUM_ALLOW_SETUP=1`，开放无令牌初始化。 | `{ authenticated: true }`，同时设置 HttpOnly Cookie。错误：`400` 输入无效，`401` 密码错误，`403` 初始化未开放或引导令牌无效，`409` 初始化已完成或并发冲突，`428` 尚未初始化，`429` 登录被限流（带 `retry-after`）。 |
| `DELETE /api/session` | 同源；Cookie 无效也能调用 | 无 | `{ authenticated: false }`，清除 Cookie 并撤销当前会话。 |

`RUBIDIUM_SETUP_TOKEN` 一旦设置，就始终优先于 `RUBIDIUM_ALLOW_SETUP`，而且只在首次密码初始化时校验；初始化成功之后，它就不再参与常规登录。

### 健康状态与概览

| 方法与路径 | 鉴权 | 输入 | 成功结果与常见错误 |
| --- | --- | --- | --- |
| `GET /api/health` | 无 | 无 | `{ status: "ok" }`。认证存储没就绪、SQLite 不可写或调度器不健康时，返回 `503 { status: "unavailable" }`。 |
| `GET /api/overview` | 普通数据 API | 无 | 概要信息：提醒、未来排期、时区、Bark endpoint、是否已配 Device Key、队列摘要、统计、近期记录和服务端时间；不含 Device Key。错误：`401`。 |
| `GET /api/upcoming` | 普通数据 API | `date?`、`after?`、`task?`。`date` 必须落在未来七天内；游标 `after` 和 `task` 必须成对提供。 | `{ items, total, next }`，每页最多 50 条排期。错误：`400` 日期或游标无效，`503` 预测负载超时。 |

### 提醒任务

创建和更新任务共用下面这组字段：`name` 必填，最多 80 字；`description` 可选，最多 2000 字；`startsAt` 是带时区偏移的 ISO 时间；`preset` 取 `once`、`daily`、`weekdays`、`weekly`、`monthly`、`custom`；`cron` 是标准五段表达式；`timeZone` 是 IANA 时区；`repeatCount` 和 `endDate` 只能二选一；`deviceId` 默认 `default`。其余可选字段是 `maxLatenessMinutes`、`notification`、`skipDates`、`includeDates`。精确的限制以 `lib/contracts.ts` 和 `lib/validation.ts` 为准。

| 方法与路径 | 鉴权 | 输入 | 成功结果与常见错误 |
| --- | --- | --- | --- |
| `GET /api/tasks` | 普通数据 API | 可选 `page`、`pageSize`、`status`、`q`。只要带了任一分页或筛选参数就启用分页；`pageSize` 最大 50，搜索词最多 200 字。状态取 `active`、`paused`、`completed`、`archived`。 | 不带筛选时返回 `{ tasks }`；分页时返回 `{ tasks, total, page, pageSize }`。不指定状态时默认排除已归档任务。错误：`400` 分页、状态或搜索参数无效。 |
| `POST /api/tasks` | 写权限 | 任务字段；可选请求头 `Idempotency-Key`（16–128 个字母、数字、`_`、`-`）。 | `201 { task }`。幂等键重复且内容相同时返回同一个任务；同一个键配不同内容返回 `409`。字段、Cron、设备或排期无效返回 `400`。 |
| `PATCH /api/tasks` | 写权限 | `{ status: "active" | "paused" | "archived", items: [{ id, revision }] }`；每批 1–50 项。 | `{ results: [{ id, success, error? }] }`。整体参数无效返回 `400`；单条的状态冲突在对应结果里报告。 |
| `DELETE /api/tasks` | 写权限 | `{ items: [{ id, revision }] }`；每批 1–50 项，ID 不得重复。 | 对每项执行永久删除并返回 `{ results: [{ id, success, error? }] }`；仅已归档且 revision 匹配的任务可删除，单项冲突在结果中报告。 |
| `PUT /api/tasks/{id}` | 写权限 | 完整任务字段，外加必填的 `revision`。 | `{ task }`。`400` 校验失败，`404` 不存在，`409` 版本冲突、任务已结束或恢复积压还没追平。 |
| `PATCH /api/tasks/{id}` | 写权限 | `{ status: "active" | "paused", revision }`。 | `{ task }`。这里不支持归档；要归档请用 DELETE 或批量 PATCH。错误：`400` 状态无效，`404` 不存在，`409` 状态或版本冲突。 |
| `DELETE /api/tasks/{id}` | 写权限 | 请求头 `If-Match: <revision>`；可选查询参数 `permanent=1`。 | 默认返回 `{ archived: true }`；带 `permanent=1` 返回 `{ deleted: true }`，但只允许永久删除已归档的任务。错误：`404` 不存在，`428` 缺少修订号，`409` 状态冲突或仍有发送中的记录。 |
| `POST /api/tasks/preview` | 写权限 | 完整任务字段；编辑预览时可以额外传 `taskId`。 | `{ dates: [ISO 时间, ...] }`。错误：`400` 输入或排期无效，`404` `taskId` 不存在。 |

创建任务的例子（cron 必须和预设、开始时间对得上）：

```bash
curl -sS https://rubidium.example/api/tasks \
  -H "Authorization: Bearer ${RUBIDIUM_API_TOKEN}" \
  -H 'Content-Type: application/json' \
  -H 'Idempotency-Key: reminder-create-20261121-001' \
  --data '{"name":"喝水","description":"","startsAt":"2030-11-05T09:00:00+08:00","preset":"weekdays","cron":"0 9 * * 1-5","repeatCount":10,"timeZone":"Asia/Shanghai"}'
```

目前没有 `GET /api/tasks/{id}` 这种单条查询路由；要取单条，可以用 `GET /api/tasks?q=...` 搜。MCP 那边提供了 `get_task`。

### 投递记录

| 方法与路径 | 鉴权 | 输入 | 成功结果与常见错误 |
| --- | --- | --- | --- |
| `GET /api/deliveries` | 普通数据 API | `page`、`pageSize`（最多 50）、`status`（`pending`、`sending`、`sent`、`retrying`、`cancelled`、`expired`）、`q`（最多 200 字）。 | `{ deliveries, total, page, pageSize }`。错误：`400` 参数无效。 |
| `PATCH /api/deliveries` | 写权限 | `{ action: "cancel" | "retry", ids: [id, ...] }`；每批 1–50 项。 | `{ results: [{ id, success }] }`。错误：`400` 参数无效。 |
| `DELETE /api/deliveries` | 写权限 | `{ before: ISO 时间, all?: boolean, compact?: boolean }`；只能清理至少七天前就已结束的记录。 | `{ removed }`。每个事务最多删 100 条；`all` 会逐批清理，批次之间让出事件循环。只清 `sent`、`cancelled`、`expired` 这三种状态，不改任务的累计计数；待投递（包括重试）和发送中的记录不会动。`compact` 会显式请求 SQLite 执行 `VACUUM`，可能比较慢，不要用在自动保留清理里。错误：`400` 截止时间太近或无效。 |
| `PATCH /api/deliveries/{id}` | 写权限 | `{ title, body, updatedAt }`；标题加正文最多 3000 个 UTF-8 字节。 | `{ saved: true }`。错误：`400` 输入无效，`409` 记录状态或版本已经变了。 |
| `GET /api/deliveries/{id}/attempts` | 普通数据 API | 无 | `{ attempts }`，最多 100 条；存储的错误文本会脱敏。 |
| `POST /api/deliveries/{id}/retry` | 写权限 | `{}` | `{ queued: true }`。错误：`404` 记录不存在，`409` 已送达、正在发送、已取消或已过期。 |
| `POST /api/deliveries/{id}/cancel` | 写权限 | `{}` | `{ cancelled: true }`。错误：`404` 记录不存在，`409` 这条已经不在等待发送了。 |

### 偏好设置与通知渠道

| 方法与路径 | 鉴权 | 输入 | 成功结果与常见错误 |
| --- | --- | --- | --- |
| `GET /api/settings` | 普通数据 API | 无 | `{ settings, revision, dataDir }`。仅含偏好，不含渠道地址或凭据。 |
| `PUT /api/settings` | 写权限 | `displayTimeZone`、`historyRetentionDays`（整数 `0–36500`，`0` 表示关闭自动清理）、`title`、`sound`、`group`、`icon`，外加必填的 `revision`。旧版 `endpoint`、`deviceKey`、`clearDeviceKey` 字段返回 `400`。 | `{ saved: true, revision }`。保留策略只会删超期的已结束记录，每批最多 100 条；待投递、重试中和发送中的记录不受影响。偏好修订号与各渠道修订号相互独立。错误：`400` 输入无效，`409` 修订冲突，`428` 缺少修订号。 |
| `GET /api/channels` | 普通数据 API | 无 | `{ channels }`。包含可编辑类型和名称的默认 Bark/Ntfy 渠道，以及所有额外渠道；只返回 `credentialConfigured`，不返回凭据原文。 |
| `POST /api/channels` | 写权限 | `{ name, type, endpoint, topic?, credential? }`；`type` 取 `bark` 或 `ntfy`。Bark 需要 Device Key；Ntfy 需要符合规则的 `topic`，token 可选。 | `201 { channel }`，只告诉你凭据配没配。用来新增额外渠道。错误：`400` 字段无效，`409` 额外渠道数量到顶了。 |
| `PUT /api/channels` | 写权限 | 完整渠道字段，外加 `id` 和必填的 `revision`。`credential` 留空表示保留同类型的现有凭据；`clearCredential: true` 表示显式清除，这时不能再填新凭据。用 `id: "default"` 可以改默认渠道的名称、Bark/Ntfy 类型和配置；切到 Bark 时要提供 Device Key。 | `{ channel }`，凭据永远不回显。错误：`400` 输入无效，`404` ID 不存在，`409` 修订冲突，`428` 缺少修订号。 |
| `DELETE /api/channels?id={id}` | 写权限 | 查询参数 `id`，请求头 `If-Match: <revision>`。 | `{ deleted: true }`。默认通知渠道不能删；被任务或待投递队列引用时返回 `409`，修订冲突也是 `409`，缺修订号是 `428`。 |
| `POST /api/channels/{id}/test` | 写权限 | `{}` | `{ delivered: true }`。用存好的渠道配置真发一条测试通知，不会写投递历史。Bark 没配 Device Key 时返回 `400`，上游失败返回 `502`，渠道不存在返回 `404`。 |

### 安全与审计

| 方法与路径 | 鉴权 | 输入 | 成功结果与常见错误 |
| --- | --- | --- | --- |
| `GET /api/security?page=1` | 浏览器会话 Cookie | 可选正整数 `page`，默认 `1`，最大 `1000000`；每页固定 10 条。 | `{ sessions, sessionPagination: { page, pageSize, total }, tokens }`，不返回 token 原文。有效浏览器会话最多保留最近 100 个；读取时会顺手删掉过期会话，页码超过末页就返回末页。 |
| `POST /api/security` | 浏览器会话 Cookie、同源 | 三种动作：`{ action: "password", current, next }`；`{ action: "token", name, scope: "read" | "write", days: 0..365 }`；`{ action: "revoke", id, kind: "session" | "token" }`。 | 改密返回 `{ saved: true }` 并续发会话；创建凭据返回 `{ token }`（原文只给这一次）；撤销返回 `{ revoked: true }`。错误：`400` 输入无效，`401` 没有浏览器会话，`403` 当前密码不对，`429` 登录被限流。 |
| `GET /api/audit` | 浏览器会话 Cookie | 无 | `{ events }`，最近最多 100 条。 |

## MCP Streamable HTTP

服务地址是 `POST /api/mcp`。每个 HTTP 请求都独立处理，不创建 MCP 会话；请求体上限 64 KiB。客户端要带上 `Authorization: Bearer <API_TOKEN>`、`Content-Type: application/json` 和 `Accept: application/json, text/event-stream`。不支持 SSE 长连接，所以 `GET` 和 `DELETE` 都返回 `405`。SDK 1.32.2 支持协议版本 `2025-11-25`、`2025-06-18`、`2025-03-26`、`2024-11-05` 和 `2024-10-07`，具体以客户端 `initialize` 协商出来的结果为准。

任何兼容 Streamable HTTP 的 MCP 客户端都能配这个远程端点，Bearer token 交给客户端的密钥管理去注入；别把真实 token 写进配置文件、日志或源码里。用命令行验证工具列表的话，可以这样：

```bash
curl -sS https://rubidium.example/api/mcp \
  -H "Authorization: Bearer ${RUBIDIUM_API_TOKEN}" \
  -H 'Content-Type: application/json' \
  -H 'Accept: application/json, text/event-stream' \
  -H 'MCP-Protocol-Version: 2025-03-26' \
  --data '{"jsonrpc":"2.0","id":1,"method":"tools/list","params":{}}'
```

每个工具的结果都以 JSON 文本放在 `content` 里，另外附带 `structuredContent`。业务出错时 `isError` 为 `true`，结构是 `{ status, error }`；401 表示凭据失效，403 表示拿只读凭据调了写工具，400/404/409/428 这些沿用对应 HTTP API 的业务语义。无效的 JSON-RPC、协议版本、媒体类型和过大的请求，都由 MCP SDK 按协议返回 JSON-RPC 或 HTTP 错误。

| 工具 | 权限 | 输入 | 输出/行为 |
| --- | --- | --- | --- |
| `list_tasks` | read | `{ page?, pageSize?, status?, q? }` | 分页返回提醒。 |
| `get_task` | read | `{ id }` | `{ task }`；任务不存在返回 404。 |
| `create_task` | write | 任务创建字段，外加可选的 `idempotencyKey` | `{ task }`；内部复用 `POST /api/tasks` 的校验和幂等语义。 |
| `update_task` | write | `{ id, ...完整任务字段, revision }` | `{ task }`；内部复用任务 PUT 的版本检查。 |
| `set_task_status` | write | `{ id, status: "active" | "paused", revision }` | `{ task }`；内部复用状态更新 API。 |
| `archive_task` | write | `{ id, revision }` | `{ archived: true }`；永久删除没有对应的 MCP 工具。 |
| `list_deliveries` | read | `{ page?, pageSize?, status?, q? }` | 分页返回投递记录。 |
| `get_delivery_attempts` | read | `{ id }` | 最近最多 100 次尝试。 |
| `retry_delivery` | write | `{ id }` | `{ queued: true }`；状态不满足重试条件时返回冲突。 |
| `cancel_delivery` | write | `{ id }` | `{ cancelled: true }`；只取消还在等待的投递。 |
| `get_overview` | read | 无 | 概览统计；不含 Device Key。 |
| `list_upcoming` | read | `{ date?, after?, task? }` | 未来七天的排期；游标参数必须成对提供。 |
| `list_channels` | read | 无 | 列出通知渠道和凭据配置状态，不返回凭据。 |
| `create_channel` | write | `{ name, type, endpoint, topic?, credential? }` | 新增 Bark/Ntfy 渠道；沿用 HTTP API 的校验，响应里只有凭据配置状态。 |
| `update_channel` | write | `{ id, name, type, endpoint, topic?, credential?, clearCredential?, revision }` | 完整更新渠道并检查 revision；凭据留空就保留旧值，显式标记可以清除凭据。 |
| `delete_channel` | write | `{ id, revision }` | 删除没被引用的渠道；默认通知渠道不能删。 |
| `test_channel` | write | `{ id }` | 真发一条测试通知，不写投递历史。 |

MCP 的写工具直接调用现有的 API handler，不会绕过 API token scope、schema 校验、同源保护、修订号和业务冲突检查。读取单条任务之所以走数据库，是因为 HTTP API 目前没有单条 GET 路由；MCP 会先检查同样的 Bearer 读权限，再执行脱敏查询。设备密钥、访问密码、Cookie、API token 原文、加密备份口令和安全审计记录，都不会通过 MCP 暴露。

工具调用的例子：

```json
{
  "jsonrpc": "2.0",
  "id": 2,
  "method": "tools/call",
  "params": { "name": "list_tasks", "arguments": { "page": 1, "pageSize": 12 } }
}
```

加密导入导出通过仅接受浏览器会话的 `/api/data/export` 和 `/api/data/import` 提供；API token 和 MCP 均不能调用。导出为 version 2 / schema 6，拒绝 v1 文件。渠道工具复用对应 HTTP handler 的权限、输入校验和修订保护；MCP 不会回传任何渠道凭据。

## 版本兼容

当前 HTTP 路由不带版本前缀。`2.0.0-alpha` 明确移除 v1 兼容：`/api/devices` 和 `/api/settings/test` 返回 `404`，旧 `barker_session` Cookie 无效；渠道统一使用 `/api/channels` 与 `/api/channels/{id}/test`。任务的 `deviceId` 仍表示通知渠道 ID。alpha 期间契约可能继续调整；客户端应按所用发布版本对接，协议协商遵循 MCP SDK 声明的版本集合。服务存活检查使用 `/api/health`，实际工具列表以 `/api/mcp` 的 `tools/list` 为准。详见 [v2 发布说明](v2.0.0-alpha.md)。
