# Chrome 人工验收清单

使用不含真实书签的独立 Chrome 测试 Profile。先运行 `npm test`，再执行本清单。

## 连接

- [ ] `bookmark-agent serve` 打印 `ws://127.0.0.1:<port>` 和随机令牌。
- [ ] 正确地址和令牌可以连接，错误令牌显示错误。
- [ ] 设置页显示连接状态；“连接 Agent”先保存当前表单再连接，“断开”后显示未连接。
- [ ] 第二个扩展实例被拒绝。
- [ ] `Ctrl+C` 后端口释放，任务管理器中没有残留 Node 进程。

## 查询与能力边界

- [ ] `getTree`、`get`、`search` 和 `getRecent` 返回当前测试 Profile 的书签。
- [ ] 关闭“允许写入”后，创建、移动、更新和删除均返回 `WRITE_DISABLED`。
- [ ] 开启写入但关闭删除后，删除返回 `DELETE_DISABLED`。
- [ ] 重启 Chrome 后两个开关保持原值。

## 修改

- [ ] 创建文件夹和书签；跨目录移动并改变索引；更新标题和 URL。
- [ ] 删除书签、空目录；普通 `remove` 拒绝非空目录，`removeTree` 可删除非空目录。
- [ ] `move`、`update`、`remove` 的 `expected` 不匹配时返回 `STALE_NODE`。
- [ ] 所有变化仅出现在安装扩展的测试 Profile，并由 Chrome 原生书签界面可见。

## 批处理与重复检测

- [ ] `stopOnError: true` 准确标记完成、失败和未执行项。
- [ ] `stopOnError: false` 在单项失败后继续。
- [ ] `exact` 只合并原始 URL 完全相同的书签。
- [ ] `normalized` 仅忽略主机名大小写、默认端口和根路径 `/`；查询参数、锚点和 `www` 差异保持分开。
- [ ] 文件夹和无法解析的非 HTTP URL 不会丢失或误入错误分组。
