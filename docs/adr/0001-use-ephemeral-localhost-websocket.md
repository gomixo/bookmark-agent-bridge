# 采用临时 localhost WebSocket 桥接

扩展在用户点击连接后主动连接只监听 `127.0.0.1` 的临时 WebSocket 服务，Agent 通过 CLI 使用这条连接。该方案无需安装 Native Messaging Host 或保持 Windows 服务常驻，也比通过 CDP 操作内部页面稳定；代价是每次任务开始时需要用户点击一次扩展图标。

Native Messaging 可在以后需要无人值守或企业安装时重新评估。CDP 没有受支持的书签域，只用于开发测试，不作为产品接口。
