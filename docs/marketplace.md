# 进入 DSH 插件市场

截至 2026-11-05，DeepSeek 没有一个人工审核、集中托管的“官方插件商店”。DSH 0.2.1 起内置的 **Plugins → Discover** 是一个可选的实验性索引读取器，默认不附带任何市场源；用户需要自己添加索引地址。生态里实际承担市场入口的是社区的 `dsh-market`，它的目录来自 `awesome-dsh-plugin`。

因此“进入官方市场”拆成三件事：

1. 仓库本身能通过 `dsh plugin add` 安装；
2. 进入 `awesome-dsh-plugin` 目录；
3. 用户通过 `dsh-market` 或 DSH Discover 的索引看到它。

## 已满足的条件

- `packages/voice/package.json` 声明了 `dsh.bundle.patch`，根目录有 `cordis.patch.yml`
- `dsh-plugin` topic 已加到 GitHub 仓库
- v0.1.1 Release 提供预构建 tarball
- 仓库有真实代码、许可证、README、截图和 CI
- 分类使用 `voice`

## 还需要等的条件

`awesome-dsh-plugin` 要求目标仓库创建满 1 天。本仓库创建于 **2026-11-05 15:38（Asia/Shanghai）**，最早可在 **2026-11-06 15:38** 之后提交 PR。

## 提交文件

目标仓库：`awesome-dsh-plugin/awesome-dsh-plugin`

新增一个文件：

`data/plugins/casperkwok__dsh-voice--packages-voice.yml`

```yaml
url: https://github.com/casperkwok/dsh-voice/tree/main/packages/voice
name: casperkwok/dsh-voice#voice
category: voice
description:
  en: Full-duplex voice for DeepSeek Harness with local streaming ASR, local or cloud TTS, barge-in and voice approval.
  zh: DeepSeek Harness 的全双工语音插件，包含本地流式识别、本地或云端语音合成、开口打断与语音审批。
icon: https://raw.githubusercontent.com/casperkwok/dsh-voice/main/assets/icon-180.png
tarball: https://github.com/casperkwok/dsh-voice/releases/download/v0.1.1/dsh-voice-voice-0.1.1.tgz
```

不要手工改 README；两个 README 由 `data/plugins/*.yml` 生成。一个 PR 只加这一条，CI 会检查 `dsh.bundle`、仓库年龄、YAML 格式和站点构建。

## 通过后

- `awesome-dsh-plugin` 的站点和 `dsh-market` 目录会自动刷新，通常一天内可见；
- DSH 0.2.1+ 的 Discover 可以添加 `https://cdn.jsdelivr.net/npm/dsh-plugin-catalog/index.json` 后搜到；
- 不需要向 DeepSeek 提交另一份申请。

## 参考

- 目录仓库：https://github.com/awesome-dsh-plugin/awesome-dsh-plugin
- 投稿规范：https://github.com/awesome-dsh-plugin/awesome-dsh-plugin/blob/main/contributing.md
- 市场应用：https://github.com/dsh-market/dsh-market
- DSH 官方 Discover 说明：https://github.com/deepseek-ai/deepseek-harness/blob/master/.agents/notes/implemented/feature/2026-10-02-plugin-market-discover.md
