# ADR-01 · 采用 Cordis 插件与 Host/Client 分层

- 状态：已接受
- 日期：2026-11-03

## 背景

语音能力要进入 DSH 会话、输入框和设置页，复用 DSH 的 Agent 循环、会话、设置和 Slot。

## 决策

在 DSH 插件生态下，面对「语音能力进入 DSH 会话和界面」的关注点，我们选择 Cordis 插件 + Host/Client 两个 aggregate，而非独立桌面应用或纯浏览器插件，为了复用 DSH 的 Agent 循环、会话、设置与 Slot，代价是受 DSH 0.2.x API 变化约束。

## 后果

- Host 代码集中在 `src/host/`，Client 代码集中在 `src/client/`。
- DSH 调用集中在 `src/host/dsh/` 适配层。
- DSH 升版时只改适配层和 manifest 的 `engines.dsh`。
