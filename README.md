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
- `serve` 会把本次地址和令牌写入本地会话文件，该文件只在其进程存活期间被信任。

## 要求

- Node.js 20 或更高版本
- Google Chrome
- 能够调用 CLI 的本机 Agent

## 安装 CLI

需要 Node.js 20 或更高版本。

```powershell
npm install
npm install --global ./cli
```

如果使用 GitHub Release 中的 `.tgz` 包：

```powershell
npm install --global .\bookmark-agent-bridge-0.1.0.tgz
```

启动一次性服务：

```powershell
bookmark-agent serve
```

命令会打印一行 JSON，包含服务地址和本次运行的随机令牌。服务只监听 `127.0.0.1`，按 `Ctrl+C` 即关闭。默认端口被占用时会自动改用其他端口，并在标准错误里说明实际端口；打印的那一行始终是真实地址。

## 加载 Chrome 扩展

1. 打开 `chrome://extensions`。
2. 开启“开发者模式”。
3. 点击“加载已解压的扩展程序”，选择本项目的 `extension` 目录。
4. 打开扩展设置，把 `serve` 打印的整行粘贴进“粘贴会话信息”，地址和令牌会自动填好。
5. 按任务需要开启“允许写入”或“允许删除”；默认均关闭。
6. 点击“连接 Agent”。

连接建立后扩展会在 Chrome 挂起后台进程时自动重连，不需要在任务期间反复点击。用户点“断开”后扩展记住这个状态，即使 Chrome 重新唤醒后台进程也不会自行连回去，直到再次点“连接 Agent”。

第一版只测试和承诺 Google Chrome。

## 调用

`serve` 运行时，`call` 和 `batch` 会自动使用本次会话的地址和令牌：

```powershell
bookmark-agent call bookmarks.getTree
bookmark-agent call bookmarks.search --params '{"query":"example"}'
bookmark-agent batch .\operations.json
```

`--token`、`--url` 和 `BOOKMARK_AGENT_TOKEN`、`BOOKMARK_AGENT_URL` 仍然可用，用于跳过会话文件或连接其他实例。`batch` 文件可以是操作数组，也可以是包含 `operations` 和 `stopOnError` 的参数对象。CLI 将扩展响应原样输出为 JSON。

会话文件位于 `%LOCALAPPDATA%\bookmark-agent-bridge\session.json`（macOS 和 Linux 为 `~/.local/share/bookmark-agent-bridge/session.json`），可用 `BOOKMARK_AGENT_SESSION` 覆盖。`serve` 退出时删除它；即使进程被强制结束，`call` 也会发现记录的进程已不存在并拒绝使用过期令牌。

## 测试

```powershell
npm test
```

自动测试不启动 Chrome。发布前按 [Chrome 人工验收清单](./docs/chrome-acceptance.md) 使用独立测试 Profile 验收。

## Agent Skill

`skills/bookmark-agent-bridge/SKILL.md` 定义了 Agent 的安全操作流程。将 `skills/bookmark-agent-bridge` 安装到你的 Agent Skill 目录即可；项目不会自动修改 Agent 配置。

## 开发

```powershell
git clone https://github.com/gomixo/bookmark-agent-bridge.git
npm install
npm test
```

## 打包

```powershell
.\scripts\package-extension.ps1
npm pack ./cli
```

扩展 ZIP 输出到 `dist/bookmark-agent-bridge-extension-0.1.0.zip`。ZIP 可解压后通过开发者模式加载；本项目不发布 Chrome Web Store。

## 文档

- [接口草案](./PROTOCOL.md)
- [领域术语](./CONTEXT.md)
- [ADR 0001：采用临时 localhost WebSocket 桥接](./docs/adr/0001-use-ephemeral-localhost-websocket.md)
- [ADR 0002：扩展只提供书签工具能力](./docs/adr/0002-keep-extension-as-agent-tool.md)
- [Chrome 人工验收清单](./docs/chrome-acceptance.md)

## 不做的事

- 不在扩展中运行模型或生成分类。
- 不提供持续后台整理。
- 不安装 Windows 服务，不开机启动。
- 不使用 CDP 操作 `chrome://bookmarks`。
- 不承诺 Google 云端何时完成同步。
- 不支持多扩展实例并发路由。
- 不提供事务、自动回滚或通用审计系统。
- 不做全树覆盖恢复、计划编辑器和历史记录。
- 不做 Profile 发现、广播和账号读取。
- 不发布 Chrome Web Store。

## Release 内容

Release 同时附带扩展 ZIP 和 `npm pack` 生成的 CLI 包。CLI 包可用 `npm install --global <package.tgz>` 安装；扩展 ZIP 解压后加载。Edge 和其他 Chromium 浏览器不在第一版支持承诺内。

## License

[MIT](./LICENSE)
