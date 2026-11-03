# ADR-02 · 流式 ASR 使用 sherpa-onnx-node

- 状态：已接受
- 日期：2026-11-03

## 背景

真全双工要求播放期持续识别，用户开口后 300 毫秒内停止播放，首 partial 不超过 500 毫秒。

## 决策

在真全双工需求下，面对「播放期持续识别、低延迟、本地处理」的关注点，我们选择 `sherpa-onnx-node 2.0.1` 的流式 zipformer2，而非 DSH 内置的录音后 SenseVoice 或云端 ASR，为了首 partial ≤ 500 毫秒与本地隐私，代价是原生模块的三平台打包与模型体积。

## 后果

- ASR 模型文件进入模型缓存，首次使用前下载并校验。
- Windows/Linux 打包需要验证原生模块。
- DSH 内置 `ctx.speechToText` 只作为按住说话的后备。
