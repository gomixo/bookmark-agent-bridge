# Bookmark Agent Bridge

Bookmark Agent Bridge 是一个面向本机 Agent 的 Chrome 书签工具层。扩展使用 `chrome.bookmarks` 读取和修改当前 Chrome Profile 的原生书签；临时 CLI 服务负责 Agent 与扩展之间的通信；配套 Skill 负责备份、分析、执行和验证流程。

项目不内置 AI 分类，不提供书签管理器，也不替 Agent 决定如何整理。

## 为什么需要这个项目

Agent 直接修改 Chrome 的书签文件会绕过 Chrome 的书签模型和 Google 同步机制。Chrome 运行或同步时可能覆盖这些修改、恢复旧书签或产生重复。

本项目通过扩展调用官方 `chrome.bookmarks` API，让移动、改名和删除操作由 Chrome 正常处理并进入账号同步流程。配套 Skill 还会在操作前备份并检查权限，在操作后验证结果。

## 安全边界

- 服务只监听 `127.0.0.1`，每次启动都生成新的随机令牌。
- 扩展默认禁止写入和删除，必须由用户分别开启。
- 服务由用户或 Agent 在任务期间临时启动，不安装后台服务或自动同步。
- 修改操作可携带 `expected` 旧值，书签已变化时拒绝执行。

## 要求

- Node.js 20 或更高版本
- Google Chrome
- 能够调用 CLI 的本机 Agent

## 安装 CLI

需要 Node.js 20 或更高版本。

```powershell
cd cli
npm install
npm install --global .
```

如果使用 GitHub Release 中的 `.tgz` 包：

```powershell
npm install --global .\bookmark-agent-bridge-0.1.0.tgz
```

启动一次性服务：

```powershell
bookmark-agent serve
```

命令会打印服务地址和本次运行的随机令牌。服务只监听 `127.0.0.1`，按 `Ctrl+C` 即关闭。

## 加载 Chrome 扩展

1. 打开 `chrome://extensions`。
2. 开启“开发者模式”。
3. 点击“加载已解压的扩展程序”，选择本项目的 `extension` 目录。
4. 打开扩展设置，填入 CLI 打印的服务地址和令牌。
5. 按任务需要开启“允许写入”或“允许删除”；默认均关闭。
6. 点击扩展图标，再点击“连接 Agent”。

第一版只测试和承诺 Google Chrome。

## 调用

```powershell
bookmark-agent call bookmarks.getTree --token '<serve 打印的令牌>'
bookmark-agent call bookmarks.search --token '<serve 打印的令牌>' --params '{"query":"example"}'
bookmark-agent batch .\operations.json --token '<serve 打印的令牌>'
```

每次 `call` 和 `batch` 都必须通过 `--token` 或环境变量 `BOOKMARK_AGENT_TOKEN` 携带 `serve` 打印的本次令牌。`batch` 文件可以是操作数组，也可以是包含 `operations` 和 `stopOnError` 的参数对象。CLI 将扩展响应原样输出为 JSON。

## 测试

```powershell
cd cli
npm test
```

自动测试不启动 Chrome。发布前按 [Chrome 人工验收清单](./docs/chrome-acceptance.md) 使用独立测试 Profile 验收。

## Agent Skill

`skills/bookmark-agent-bridge/SKILL.md` 定义了 Agent 的安全操作流程。将 `skills/bookmark-agent-bridge` 安装到你的 Agent Skill 目录即可；项目不会自动修改 Agent 配置。

## 开发

```powershell
git clone https://github.com/gomixo/bookmark-agent-bridge.git
cd bookmark-agent-bridge\cli
npm install
npm test
```

## 打包

```powershell
.\scripts\package-extension.ps1
npm pack .\cli
```

扩展 ZIP 输出到 `dist/bookmark-agent-bridge-extension-0.1.0.zip`。ZIP 可解压后通过开发者模式加载；本项目不发布 Chrome Web Store。

## 文档

- [实施计划](./IMPLEMENTATION-PLAN.md)
- [接口草案](./PROTOCOL.md)
- [领域术语](./CONTEXT.md)
- [ADR 0001：采用临时 localhost WebSocket 桥接](./docs/adr/0001-use-ephemeral-localhost-websocket.md)
- [ADR 0002：扩展只提供书签工具能力](./docs/adr/0002-keep-extension-as-agent-tool.md)
- [Chrome 人工验收清单](./docs/chrome-acceptance.md)

## 已确定范围

- 开源，MIT 许可证。
- 第一版只测试和承诺 Google Chrome。
- 开发者可加载源码目录，GitHub Release 提供可解压加载的 ZIP。
- Agent 操作期间临时启动本机 CLI 服务。平时没有常驻进程。
- 用户在任务开始时点击扩展图标连接 Agent。
- 扩展提供书签查询、创建、移动、更新、删除、重复检测和批处理。
- 扩展设置页提供“允许写入”和“允许删除”两个持久开关。
- Skill 负责备份、死链检查、整理策略、分批执行和结果验证。

## Release 内容

Release 同时附带扩展 ZIP 和 `npm pack` 生成的 CLI 包。CLI 包可用 `npm install --global <package.tgz>` 安装；扩展 ZIP 解压后加载。Edge 和其他 Chromium 浏览器不在第一版支持承诺内。

## License

[MIT](./LICENSE)
