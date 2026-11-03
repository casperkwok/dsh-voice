# ADR-03 · 本地 TTS 使用 sherpa-onnx VITS/Kokoro

- 状态：已接受
- 日期：2026-11-03

## 背景

默认产品承诺音频不出本机，TTS 首帧不超过 300 毫秒。

## 决策

在本地隐私与低延迟需求下，面对「首帧 ≤ 300 毫秒、无需云端」的关注点，我们选择 `sherpa-onnx-node` 的 VITS/Kokoro，而非 Edge 云端或 CosyVoice Python 服务，为了一个原生运行时同时覆盖 ASR/VAD/TTS，代价是音色表现力上限较低；CosyVoice 作为后续可选 provider。

## 后果

- TTS 模型文件进入模型缓存。
- 音色、语速、情绪参数在一轮内锁定。
- 音色表现力不足时，通过 `TtsProvider` 接口接入 CosyVoice。
