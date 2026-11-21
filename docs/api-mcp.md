# Rubidium API 与 MCP

本文对应 Rubidium `1.x` 当前实现。HTTP API 使用 JSON；MCP 使用官方 `@modelcontextprotocol/sdk` 的无状态 Streamable HTTP。默认服务地址为 `http://localhost:3000`，部署时替换为自己的 HTTPS 地址。

## 鉴权与通用约定

- 普通数据 API 接受 `Authorization: Bearer <API_TOKEN>` 或登录后的 `barker_session` Cookie。API token 在「设置 → 访问安全」创建；`read` 只允许 `GET`/`HEAD`，`write` 允许读写。永久 token 的有效天数填 `0`，须手动撤销。
- `/api/security` 和 `/api/audit` 仅接受有效浏览器会话 Cookie，不接受 Bearer token；会话通过 `/api/session` 创建。
- MCP 只接受 Bearer API token，不接受 Cookie。只读 token 可发现工具并执行只读工具；写工具需要 `write` token。
- JSON API 成功响应为具体路由定义的 JSON 对象。已知输入、业务冲突和资源错误返回 `{ "error": "..." }`；非预期故障返回脱敏的 500。受 `apiRoute` 包装的响应含 `x-request-id`。
- JSON 请求体最大 64 KiB。`POST`、`PUT`、`PATCH` 变更必须使用 `Content-Type: application/json`，并通过同源检查；`DELETE` 同样拒绝跨站来源。
- 修订号冲突返回 `409`；缺少或无效修订号返回 `428`。不要自动重放有副作用的请求，除非该请求使用幂等键。

### 会话

| 方法与路径 | 鉴权 | 输入 | 成功结果与常见错误 |
| --- | --- | --- | --- |
| `GET /api/session` | 无 | 无 | `{ authenticated, initialized, setupEnabled, setupTokenRequired }`。用于判断当前 Cookie、初始化状态及部署端是否开放初始化；不返回引导令牌。 |
| `POST /api/session` | 初始化或密码登录；JSON、同源 | `{ password, mode?, timeZone?, setupToken? }`。`mode` 为 `setup` 或 `login`；省略时按登录处理。初始化 `timeZone` 为可选 IANA 时区。未设置 `BARKER_PASSWORD` 的全新实例需配置 32–300 字符的 `BARKER_SETUP_TOKEN` 并提交 `setupToken`，或由部署者显式设置 `BARKER_ALLOW_SETUP=1` 开放无令牌初始化。 | `{ authenticated: true }` 并设置 HttpOnly Cookie。错误：`400` 输入无效，`401` 密码错误，`403` 初始化未开放或引导令牌无效，`409` 初始化已完成/并发冲突，`428` 尚未初始化，`429` 登录限流（带 `retry-after`）。 |
| `DELETE /api/session` | 同源；无效 Cookie 也可调用 | 无 | `{ authenticated: false }`，清除 Cookie 并撤销当前会话。 |

`BARKER_SETUP_TOKEN` 在设置时始终优先于 `BARKER_ALLOW_SETUP`，并且仅在首次密码初始化时校验；初始化成功后不参与常规登录。

### 健康状态与概览

| 方法与路径 | 鉴权 | 输入 | 成功结果与常见错误 |
| --- | --- | --- | --- |
| `GET /api/health` | 无 | 无 | `{ status: "ok" }`。认证存储未就绪、SQLite 不可写或调度器不健康时为 `503 { status: "unavailable" }`。 |
| `GET /api/overview` | 普通数据 API | 无 | 概览任务、未来排期、时区、Bark endpoint、是否已配置 Device Key、队列摘要、统计、近期记录和服务端时间；不返回 Device Key。错误：`401`。 |
| `GET /api/upcoming` | 普通数据 API | `date?`、`after?`、`task?`。`date` 必须位于未来七天；游标 `after` 与 `task` 必须同时提供。 | `{ items, total, next }`；每页最多 50 个排期。错误：`400` 日期/游标无效，`503` 预测负载超时。 |

### 提醒任务

任务创建与更新共用以下字段。`name` 必填，最多 80 字；`description` 可选，最多 2000 字；`startsAt` 为带时区偏移的 ISO 时间；`preset` 为 `once`、`daily`、`weekdays`、`weekly`、`monthly`、`custom`；`cron` 是标准五段表达式；`timeZone` 是 IANA 时区；`repeatCount` 与 `endDate` 只能择一；`deviceId` 默认为 `default`。其余可选字段为 `maxLatenessMinutes`、`notification`、`skipDates`、`includeDates`。精确限制以 `lib/contracts.ts` 和 `lib/validation.ts` 为准。

| 方法与路径 | 鉴权 | 输入 | 成功结果与常见错误 |
| --- | --- | --- | --- |
| `GET /api/tasks` | 普通数据 API | 可选 `page`、`pageSize`、`status`、`q`。提供任一分页/筛选参数时启用分页；`pageSize` 最大 50，搜索最多 200 字。状态：`active`、`paused`、`completed`、`archived`。 | 无筛选时 `{ tasks }`；分页时 `{ tasks, total, page, pageSize }`。未指定状态时默认排除已归档任务。错误：`400` 分页、状态或搜索无效。 |
| `POST /api/tasks` | 写权限 | 任务字段；可选请求头 `Idempotency-Key`（16–128 个字母、数字、`_`、`-`）。 | `201 { task }`。重复幂等键和相同内容返回同一任务；相同键用于不同内容返回 `409`。字段/Cron/设备/排期无效返回 `400`。 |
| `PATCH /api/tasks` | 写权限 | `{ status: "active" | "paused" | "archived", items: [{ id, revision }] }`；每批 1–50 项。 | `{ results: [{ id, success, error? }] }`。整体参数无效返回 `400`；条目状态冲突在对应结果中报告。 |
| `PUT /api/tasks/{id}` | 写权限 | 完整任务字段及必填 `revision`。 | `{ task }`。`400` 校验失败，`404` 不存在，`409` 版本冲突、任务已结束或恢复积压尚未追平。 |
| `PATCH /api/tasks/{id}` | 写权限 | `{ status: "active" | "paused", revision }`。 | `{ task }`。不支持归档；归档请使用 DELETE 或批量 PATCH。错误：`400` 状态无效，`404` 不存在，`409` 状态/版本冲突。 |
| `DELETE /api/tasks/{id}` | 写权限 | 请求头 `If-Match: <revision>`；可选查询 `permanent=1`。 | 默认 `{ archived: true }`；`permanent=1` 返回 `{ deleted: true }`，仅允许永久删除已归档任务。错误：`404` 不存在，`428` 缺少修订号，`409` 状态冲突或仍有发送中的记录。 |
| `POST /api/tasks/preview` | 写权限 | 完整任务字段；编辑预览可额外提供 `taskId`。 | `{ dates: [ISO 时间, ...] }`。错误：`400` 输入或排期无效，`404` `taskId` 不存在。 |

创建任务示例（cron 必须与预设和开始时间一致）：

```bash
curl -sS https://rubidium.example/api/tasks \
  -H "Authorization: Bearer ${RUBIDIUM_API_TOKEN}" \
  -H 'Content-Type: application/json' \
  -H 'Idempotency-Key: reminder-create-20261121-001' \
  --data '{"name":"喝水","description":"","startsAt":"2030-11-05T09:00:00+08:00","preset":"weekdays","cron":"0 9 * * 1-5","repeatCount":10,"timeZone":"Asia/Shanghai"}'
```

当前没有 `GET /api/tasks/{id}` 单条查询路由；可使用 `GET /api/tasks?q=...` 搜索。MCP 提供 `get_task`。

### 投递记录

| 方法与路径 | 鉴权 | 输入 | 成功结果与常见错误 |
| --- | --- | --- | --- |
| `GET /api/deliveries` | 普通数据 API | `page`、`pageSize`（最多 50）、`status`（`pending`、`sending`、`sent`、`retrying`、`cancelled`、`expired`）、`q`（最多 200 字）。 | `{ deliveries, total, page, pageSize }`。错误：`400` 参数无效。 |
| `PATCH /api/deliveries` | 写权限 | `{ action: "cancel" | "retry", ids: [id, ...] }`；每批 1–50 项。 | `{ results: [{ id, success }] }`。错误：`400` 参数无效。 |
| `DELETE /api/deliveries` | 写权限 | `{ before: ISO 时间, all?: boolean, compact?: boolean }`；只能清理至少七天前已结束的记录。 | `{ removed }`。`all` 表示分批清理；`compact` 同时执行 SQLite VACUUM。错误：`400` 截止时间过近或无效。 |
| `PATCH /api/deliveries/{id}` | 写权限 | `{ title, body, updatedAt }`；标题与正文总计最多 3000 UTF-8 字节。 | `{ saved: true }`。错误：`400` 输入无效，`409` 记录状态或版本已变化。 |
| `GET /api/deliveries/{id}/attempts` | 普通数据 API | 无 | `{ attempts }`，最多 100 条尝试；存储错误文本会脱敏。 |
| `POST /api/deliveries/{id}/retry` | 写权限 | `{}` | `{ queued: true }`。错误：`404` 记录不存在，`409` 已送达、发送中、已取消或过期。 |
| `POST /api/deliveries/{id}/cancel` | 写权限 | `{}` | `{ cancelled: true }`。错误：`404` 记录不存在，`409` 不再等待发送。 |

### 设置与设备

| 方法与路径 | 鉴权 | 输入 | 成功结果与常见错误 |
| --- | --- | --- | --- |
| `GET /api/settings` | 普通数据 API | 无 | `{ settings, revision, deviceKeyConfigured, dataDir }`。返回绝对数据目录但不返回 Device Key。 |
| `PUT /api/settings` | 写权限 | `displayTimeZone`、`endpoint`、`deviceKey`、`title`、`sound`、`group`、`icon`、必填 `revision`；另有 `clearDeviceKey?: boolean`。Endpoint 支持不含用户信息、查询串或锚点的 HTTP(S) URL。 | `{ saved: true, revision }`。空白 `deviceKey` 保留已有密钥；显式清除用 `clearDeviceKey: true`。错误：`400` 输入无效，`409` 修订冲突，`428` 缺少修订号。 |
| `POST /api/settings/test` | 写权限 | `{}` | `{ delivered: true }`。会真实发送一条测试 Bark 通知；错误：`400` 尚未配置 Device Key，`502` 上游失败（错误内容会脱敏）。 |
| `GET /api/devices` | 普通数据 API | 无 | `{ devices }`；兼容旧版 Bark 设备契约，只返回密钥配置状态，不返回密钥。 |
| `POST /api/devices` | 写权限 | `{ name, endpoint, deviceKey, id?, revision? }`。创建不传 `id`；更新必须传 `id` 和 `revision`，可留空 `deviceKey` 以保留现有密钥。 | `{ device }`。错误：`400` 输入/密钥无效，`404` ID 不存在，`409` 数量上限或设备冲突，`428` 更新缺少修订号。 |
| `DELETE /api/devices?id={id}` | 写权限 | 查询 `id`，请求头 `If-Match: <revision>`。 | `{ deleted: true }`。不能删除默认设备；错误：`404` 不存在，`409` 仍被任务/队列引用，`428` 缺少修订号。 |
| `GET /api/channels` | 普通数据 API | 无 | `{ channels }`；包含默认 Bark 与所有 Bark/Ntfy 渠道，仅返回 `credentialConfigured`，不返回凭据原文。 |
| `POST /api/channels` | 写权限 | `{ name, type, endpoint, topic?, credential? }`；`type` 为 `bark` 或 `ntfy`，Bark 需 Device Key；Ntfy 需符合规则的 `topic`，token 可选。 | `201 { channel }`，仅返回凭据是否已配置。创建额外渠道。错误：`400` 字段无效，`409` 达到额外渠道上限。 |
| `PUT /api/channels` | 写权限 | 完整渠道字段及 `id`、必填 `revision`；空 `credential` 保留同类型的现有凭据，`clearCredential: true` 显式清除凭据且不能同时填写新凭据。用 `id: "default"` 更新默认 Bark 的地址/凭据。 | `{ channel }`；凭据永不回显。错误：`400` 输入无效，`404` ID 不存在，`409` 修订冲突，`428` 缺少修订号。 |
| `DELETE /api/channels?id={id}` | 写权限 | 查询 `id`，请求头 `If-Match: <revision>`。 | `{ deleted: true }`。默认渠道不可删除；被任务或待投递队列引用时返回 `409`，修订冲突 `409`，缺少修订号 `428`。 |
| `POST /api/channels/{id}/test` | 写权限 | `{}` | `{ delivered: true }`；向存储的渠道配置真实发送测试通知，不创建投递历史。Bark 未配置 Device Key 时 `400`，上游失败 `502`，渠道不存在 `404`。 |

### 安全与审计

| 方法与路径 | 鉴权 | 输入 | 成功结果与常见错误 |
| --- | --- | --- | --- |
| `GET /api/security` | 浏览器会话 Cookie | 无 | `{ sessions, tokens }`，不返回 token 原文。 |
| `POST /api/security` | 浏览器会话 Cookie、同源 | 三种动作：`{ action: "password", current, next }`；`{ action: "token", name, scope: "read" | "write", days: 0..365 }`；`{ action: "revoke", id, kind: "session" | "token" }`。 | 改密 `{ saved: true }` 并续发会话；创建凭据 `{ token }`（原文只返回一次）；撤销 `{ revoked: true }`。错误：`400` 输入无效，`401` 无浏览器会话，`403` 当前密码错误，`429` 登录限流。 |
| `GET /api/audit` | 浏览器会话 Cookie | 无 | `{ events }`，最近最多 100 条。 |

## MCP Streamable HTTP

服务地址为 `POST /api/mcp`。每个 HTTP 请求独立处理，不创建 MCP 会话；请求体限制 64 KiB。客户端需要提供 `Authorization: Bearer <API_TOKEN>`、`Content-Type: application/json` 和 `Accept: application/json, text/event-stream`。不支持 SSE 长连接；`GET` 与 `DELETE` 返回 `405`。SDK 1.32.2 支持协议版本 `2025-11-25`、`2025-06-18`、`2025-03-26`、`2024-11-05` 和 `2024-10-07`；以客户端 `initialize` 协商结果为准。

可使用任意兼容 Streamable HTTP 的 MCP 客户端配置远程端点并通过客户端密钥管理注入 Bearer token；不要把真实 token 提交到配置文件、日志或源码中。命令行验证工具列表示例：

```bash
curl -sS https://rubidium.example/api/mcp \
  -H "Authorization: Bearer ${RUBIDIUM_API_TOKEN}" \
  -H 'Content-Type: application/json' \
  -H 'Accept: application/json, text/event-stream' \
  -H 'MCP-Protocol-Version: 2025-03-26' \
  --data '{"jsonrpc":"2.0","id":1,"method":"tools/list","params":{}}'
```

每个工具结果以 JSON 文本 `content` 返回，并附 `structuredContent`。业务错误设置 `isError: true`，结构为 `{ status, error }`；401 表示凭据失效，403 表示只读凭据调用写工具，400/404/409/428 等沿用对应 HTTP API 的业务语义。无效 JSON-RPC、协议版本、媒体类型和过大请求由 MCP SDK 按协议返回 JSON-RPC/HTTP 错误。

| 工具 | 权限 | 输入 | 输出/行为 |
| --- | --- | --- | --- |
| `list_tasks` | read | `{ page?, pageSize?, status?, q? }` | 分页提醒结果。 |
| `get_task` | read | `{ id }` | `{ task }`；任务不存在为 404。 |
| `create_task` | write | 任务创建字段及可选 `idempotencyKey` | `{ task }`；内部复用 `POST /api/tasks` 的校验与幂等语义。 |
| `update_task` | write | `{ id, ...完整任务字段, revision }` | `{ task }`；内部复用任务 PUT 的版本检查。 |
| `set_task_status` | write | `{ id, status: "active" | "paused", revision }` | `{ task }`；内部复用状态更新 API。 |
| `archive_task` | write | `{ id, revision }` | `{ archived: true }`；永久删除不暴露为 MCP 工具。 |
| `list_deliveries` | read | `{ page?, pageSize?, status?, q? }` | 分页投递记录。 |
| `get_delivery_attempts` | read | `{ id }` | 最近最多 100 次尝试。 |
| `retry_delivery` | write | `{ id }` | `{ queued: true }`；不满足重试状态时返回冲突。 |
| `cancel_delivery` | write | `{ id }` | `{ cancelled: true }`；仅取消仍等待的投递。 |
| `get_overview` | read | 无 | 概览统计；不包含 Device Key。 |
| `list_upcoming` | read | `{ date?, after?, task? }` | 未来七天排期；游标参数必须成对提供。 |
| `list_channels` | read | 无 | 列出通知渠道及凭据配置状态，不返回凭据。 |
| `create_channel` | write | `{ name, type, endpoint, topic?, credential? }` | 新增 Bark/Ntfy 渠道；沿用 HTTP API 校验，响应仅含凭据配置状态。 |
| `update_channel` | write | `{ id, name, type, endpoint, topic?, credential?, clearCredential?, revision }` | 完整更新渠道并检查 revision；空凭据保留旧值，显式标记可清除凭据。 |
| `delete_channel` | write | `{ id, revision }` | 删除未被引用的渠道；默认 Bark 不可删除。 |
| `test_channel` | write | `{ id }` | 真实发送测试通知，不创建投递历史。 |

MCP 的写工具直接调用现有 API handler，不绕过 API token scope、schema 校验、同源保护、修订号和业务冲突检查。读取单条任务因 HTTP API 当前没有单条 GET 路由，由 MCP 检查相同 Bearer 读权限后调用脱敏数据库查询。设备密钥、访问密码、Cookie、API token 原文、加密备份口令和安全审计记录都不通过 MCP 暴露。

工具调用示例：

```json
{
  "jsonrpc": "2.0",
  "id": 2,
  "method": "tools/call",
  "params": { "name": "list_tasks", "arguments": { "page": 1, "pageSize": 12 } }
}
```

加密导入/导出目前仅通过网页工作流提供，没有对应 HTTP API 或 MCP 工具。渠道工具复用对应 HTTP handler 的权限、输入校验和修订保护；MCP 不回传任何渠道凭据。

## 版本兼容

当前 HTTP 路由不带 `/v1` 前缀；Rubidium `1.x` 将其视为当前稳定契约。小版本只做向后兼容的扩展，可能新增可选字段、工具或状态枚举。客户端应忽略未知 JSON 字段并容忍未知枚举值。删除字段、改变既有字段语义或移除路由属于不兼容变更，必须进入新的主版本并同步更新此文档；协议协商则遵循 MCP SDK 声明的版本集合。部署版本可从 `/api/health` 检查存活，实际 API 字段与工具清单以对应发布源码和 `/api/mcp` 的 `tools/list` 为准。
