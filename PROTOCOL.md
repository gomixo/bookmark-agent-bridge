# 接口草案

## 传输

- WebSocket 地址默认使用 `ws://127.0.0.1:17373`。
- 服务只能绑定 loopback。
- CLI 启动服务时生成随机令牌。用户将令牌填入扩展设置页。
- 用户点击“连接 Agent”后，扩展建立 WebSocket 连接并发送握手。
- 第一版只允许一个扩展连接。第二个连接到达时，服务返回 `CLIENT_ALREADY_CONNECTED`。
- 消息使用 UTF-8 JSON。每个请求都有 `id`，响应回传相同 `id`。
- 端口、消息大小限制、超时和令牌存储方式可以在实现时调整，不属于公开协议承诺。

## 握手

```json
{
  "type": "hello",
  "protocolVersion": 1,
  "token": "random-session-token",
  "extensionVersion": "0.1.0",
  "capabilities": {
    "write": true,
    "delete": false
  }
}
```

成功响应会回显扩展在握手时声明的能力状态：

```json
{
  "type": "hello.ok",
  "protocolVersion": 1,
  "capabilities": {
    "write": true,
    "delete": false
  }
}
```

## 请求与响应

```json
{
  "id": "req-1",
  "method": "bookmarks.getTree",
  "params": {},
  "token": "random-session-token"
}
```

CLI 请求连接必须携带本次服务打印的令牌。服务验证后只把 `id`、`method` 和 `params` 转发给扩展。带网页 `Origin` 的连接会被拒绝；Origin 检查是令牌认证之外的附加防护。

```json
{
  "id": "req-1",
  "ok": true,
  "result": {}
}
```

错误响应：

```json
{
  "id": "req-1",
  "ok": false,
  "error": {
    "code": "WRITE_DISABLED",
    "message": "Write operations are disabled in the extension."
  }
}
```

## 方法

### 查询

- `bookmarks.getTree()`
- `bookmarks.get(id)`
- `bookmarks.search({ query?, title?, url? })`
- `bookmarks.getRecent({ limit })`
- `bookmarks.findDuplicates({ mode })`

`findDuplicates.mode` 为 `exact` 或 `normalized`。`normalized` 只规范域名大小写、默认端口和根路径末尾斜杠，不删除查询参数、锚点或 `www`。

### 写入

以下方法要求“允许写入”：

- `bookmarks.create({ parentId, title, url?, index? })`
- `bookmarks.move({ id, parentId?, index?, expected? })`
- `bookmarks.update({ id, title?, url?, expected? })`

以下方法同时要求“允许写入”和“允许删除”：

- `bookmarks.remove({ id, expected? })`
- `bookmarks.removeTree({ id, expected? })`

`expected` 可包含执行前读取到的 `title`、`url` 和 `parentId`。扩展在修改前比较这些字段；不一致时返回 `STALE_NODE`。

### 批处理

```json
{
  "id": "req-2",
  "method": "bookmarks.batch",
  "params": {
    "stopOnError": true,
    "operations": [
      {
        "op": "move",
        "args": {
          "id": "123",
          "parentId": "456",
          "expected": {
            "url": "https://example.com/",
            "parentId": "1"
          }
        }
      }
    ]
  }
}
```

批处理逐项返回 `ok`、`result` 或 `error`。它不回滚已经完成的操作。`stopOnError` 默认为 `true`。

## 错误码

- `UNAUTHORIZED`：握手令牌无效。
- `WRITE_DISABLED`：写入开关关闭。
- `DELETE_DISABLED`：删除开关关闭。
- `CLIENT_ALREADY_CONNECTED`：已有扩展实例连接。
- `NOT_FOUND`：节点不存在。
- `STALE_NODE`：节点属性与 `expected` 不一致。
- `INVALID_REQUEST`：方法或参数无效。
- `CHROME_API_ERROR`：`chrome.bookmarks` 返回错误。
- `EXTENSION_NOT_CONNECTED`：服务在运行，但扩展尚未连接。
- `EXTENSION_DISCONNECTED`：请求处理中扩展断开。
- `TIMEOUT`：扩展未在服务超时前响应。
- `SERVER_SHUTDOWN`：请求处理中服务关闭。

## 明确不提供

- AI 分类和整理建议。
- 死链网络请求。
- 计划编辑器、预览器和历史记录。
- 全树覆盖恢复。
- MCP Server。
- CDP 或 `chrome.debugger` 接口。
- Profile 发现、广播和账号读取。
