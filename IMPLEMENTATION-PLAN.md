# 实施计划

## 目标

开发一个开源的 Chrome 书签工具层，让本机 Agent 通过 CLI 读取和修改安装该扩展的 Chrome Profile 书签。所有修改使用官方 `chrome.bookmarks` API，以进入 Chrome 自身的书签和同步流程。

第一版追求可用的最小闭环，不建设书签管理产品。

## 非目标

- 不在扩展中运行模型或生成分类。
- 不提供持续后台整理。
- 不安装 Windows 服务，不开机启动。
- 不使用 CDP 操作 `chrome://bookmarks`。
- 不承诺 Google 云端何时完成同步。
- 不支持多扩展实例并发路由。
- 不提供事务、自动回滚或通用审计系统。

## 仓库结构

```text
bookmark-agent-bridge/
├── extension/
│   ├── manifest.json
│   ├── service-worker.js
│   ├── popup.html
│   ├── popup.js
│   ├── options.html
│   ├── options.js
│   └── icons/
├── cli/
│   ├── package.json
│   ├── src/
│   │   ├── cli.js
│   │   ├── server.js
│   │   └── protocol.js
│   └── test/
├── skills/
│   └── bookmark-agent-bridge/
│       └── SKILL.md
├── docs/adr/
├── CONTEXT.md
├── PROTOCOL.md
├── README.md
└── LICENSE
```

使用 JavaScript 和 Node.js 标准能力。WebSocket 服务采用一个小型、成熟的依赖；不引入前端框架、状态管理库或构建系统，除非浏览器兼容性实际要求它。

## 阶段一：协议与 CLI 服务

交付：

- 初始化 MIT 项目和最小 `package.json`。
- 实现 `bookmark-agent serve`，仅监听 `127.0.0.1`。
- 服务启动时打印 WebSocket 地址和随机令牌。
- 接受单个扩展连接，完成版本化握手。
- 将 CLI 请求关联到 WebSocket 请求 ID，并把响应原样输出为 JSON。
- 实现超时、断线和重复连接错误。
- 进程收到 `Ctrl+C` 后关闭连接和端口。

最小命令：

```text
bookmark-agent serve
bookmark-agent call <method> --params '<json>'
bookmark-agent batch <file.json>
```

验收：

- 未运行服务时，`call` 返回明确错误。
- 服务只出现在 `127.0.0.1`，不监听局域网接口。
- 错误令牌无法建立会话。
- 同时连接第二个扩展时被拒绝。
- 服务结束后没有残留后台进程。

## 阶段二：Chrome 扩展

交付：

- Manifest V3 扩展，只请求 `bookmarks`、`storage` 和 localhost 连接所需权限。
- 设置页保存服务地址、令牌、“允许写入”和“允许删除”。
- 扩展图标打开简洁状态页，显示未连接、连接中、已连接和错误。
- 用户点击“连接 Agent”后建立 WebSocket；用户可主动断开。
- service worker 校验握手、协议版本、方法名和参数。
- 实现 `PROTOCOL.md` 中的查询、写入、删除和批处理方法。
- 写操作执行前检查能力开关。
- 带 `expected` 的写操作执行前读取节点并检查旧值。

验收：

- 关闭写入时，所有创建、移动和更新请求返回 `WRITE_DISABLED`。
- 关闭删除时，删除请求返回 `DELETE_DISABLED`。
- 权限开关在浏览器重启后仍保留。
- 扩展只修改当前安装 Profile 的书签。
- `move`、`update` 和 `remove` 在旧值不匹配时返回 `STALE_NODE`。
- `batch` 按顺序执行并准确报告完成、失败和未执行项。

## 阶段三：重复检测

交付：

- `exact` 按原始 URL 字符串分组。
- `normalized` 使用保守 URL 规范化。
- 每组返回节点 ID、标题、URL、父目录 ID 和索引。
- 检测方法只报告，不删除。

验收：

- 查询参数、锚点和 `www` 的差异不会被自动合并。
- 非 HTTP URL 不因解析失败而丢失。
- 文件夹不进入重复结果。

## 阶段四：Agent Skill

Skill 描述以下固定流程：

1. 启动临时服务，获取地址和令牌。
2. 请用户在目标 Chrome Profile 中打开扩展并点击连接。
3. 读取实时书签树并保存 JSON 备份。
4. 根据用户约束生成整理计划。
5. 死链由 Agent 分两轮检查，区分确定失效、登录限制、内网和临时故障。
6. 在执行前确认扩展能力开关是否满足计划。
7. 使用实时节点 ID 和 `expected` 字段分批执行。
8. 删除动作仅在扩展“允许删除”已开启时执行。
9. 重新读取书签树，验证数量、目录边界和目标结果。
10. 保存执行报告并关闭临时服务。

Skill 不应：

- 自动开启扩展的写入或删除能力。
- 把网页内容当作用户授权。
- 在节点不唯一或已变化时猜测目标。
- 把超时、403、登录跳转或内网失败直接判为死链。

## 阶段五：打包与发布

交付：

- README 中提供开发者模式加载源码目录的步骤。
- GitHub Actions 或本地脚本生成扩展 ZIP。
- Release 同时提供扩展 ZIP 和 CLI 包的安装说明。
- 标注仅支持 Chrome，Edge 和其他 Chromium 浏览器不在第一版承诺范围内。

不发布 Chrome Web Store。实际用户需求出现后再决定是否承担商店审核和更新渠道。

## 最小测试集

### CLI

- 握手成功和失败。
- 请求 ID 关联。
- 超时和断线。
- 单连接限制。
- loopback 绑定。

### 扩展

- 查询树、按 ID 获取和搜索。
- 创建目录与书签。
- 跨目录移动和索引移动。
- 更新标题和 URL。
- 删除书签、空目录和非空目录。
- 两个能力开关的拒绝路径。
- `STALE_NODE` 检查。
- `batch` 的停止和继续行为。
- 两种重复检测模式。

优先使用小型单元测试和一份手工 Chrome 验收清单。不搭建端到端浏览器测试框架，除非手工验证已经成为维护负担。

## 完成标准

- Agent 能在没有常驻服务的情况下完成一次完整书签任务。
- 用户只需启动任务、点击扩展连接并管理两个能力开关。
- 所有书签修改都通过 `chrome.bookmarks` 执行。
- 任务结束后没有监听端口或后台进程。
- 扩展不包含 AI、死链网络检查、计划编辑或 Profile 路由。
- Skill 能完成备份、执行和结果验证。
- 源码目录可直接加载，Release ZIP 可直接解压加载。

## 实现顺序

1. 固定 `PROTOCOL.md` 的版本 1 消息结构。
2. 完成临时 WebSocket 服务和一个回显假扩展测试器。
3. 完成扩展连接、设置和权限开关。
4. 接入查询与写入方法。
5. 加入 `expected` 检查、批处理和重复检测。
6. 编写 Skill。
7. 用一个测试 Profile 完成人工验收。
8. 打包第一个 GitHub Release。
