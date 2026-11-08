# ReliaTox

无中心服务器的点对点通信客户端前端。基于 Tox 协议，目标是在没有中心服务器的情况下实现接近中心化服务的传输可靠性。

当前阶段：**只完成了前端**，后端（toxcore 接入、SQLCipher 传输账本）尚未接入。界面上的按钮会记录对应的后端接口名，接上后端不需要改界面。

## 两个创新点

1. **断点续传**
   把好友公钥、32 字节 `resumeFileId`、传输方向、文件路径、已确认偏移、文件大小、SHA-256 中间态持久化到本地；重连后用同一个 file ID 重新发起，调用 `tox_file_seek` 到已确认偏移，而不是从 0 开始。验证只看两项：续传量一致、SHA-256 一致。

2. **自适应多文件并发调度**
   用消息「发送→回执」延迟作为 RTT 代理，叠加传输速率采样，动态调整并发路数（差网降到 2 路）、暂停低优先级任务、给大文件让路。提供速度优先 / 公平优先 / 省电优先三种策略。

## 运行

```bash
npm install
npm run dev
```

打开 http://127.0.0.1:5173/

## 目录

```
src/
  App.jsx               主框架、全局状态、演示流程编排
  data.js               演示数据（好友、会话、传输任务、哈希）
  icons.jsx             内联 SVG 图标
  index.css             全部样式
  lib/format.js         字节 / 哈希展示工具
  mock/backend.js       后端调用占位层（记录已点击的接口名）
  views/
    ChatView.jsx        会话与消息
    ContactsView.jsx    通讯录用 Tox ID 加人
    TransferView.jsx    传输账本、续传验证、调度策略
    MeetingView.jsx     点对点会议
    SettingsView.jsx    身份与后端调用记录
```

## 续传验证方式

1. 传到约一半时断开连接，记下已确认偏移 A。
2. 重新连接后确认续传，本地 `seek` 到 A 再发起。
3. 记录续传阶段实际发送量 B，核对 A + B 等于文件大小。
4. 接收端写临时文件，SHA-256 校验通过后才改成正式文件名。

## 待接入

- `tox_file_send` / `tox_file_seek` / `tox_file_control` 及本地文件 seek
- SQLCipher 传输账本（好友公钥、resumeFileId、偏移、哈希中间态）
- AI 传输方案（开传前排序、链路变化重排、续传批次排序）
