# Phase 0 音频闭环验证

不接 DSH，只验证浏览器麦克风 → 流式 ASR → 本地 TTS → 浏览器播放 → 打断这条处理过程。

## 准备

模型放在仓库根目录 `.models/`：

```
.models/
├── sherpa-onnx-streaming-zipformer-bilingual-zh-en-2023-02-20/
├── sherpa-onnx-vits-zh-ll/
└── silero_vad.onnx
```

安装依赖：

```bash
pnpm install
pnpm rebuild esbuild
```

## 启动

```bash
node spikes/phase0/server.mjs
```

打开 `http://127.0.0.1:7799/`，点「开始」，允许麦克风。页面显示实时转写、最终文本、TTS 首块和「说完到首声」。

## 自动测试

```bash
node spikes/phase0/ws-smoke.mjs          # WebSocket 灌音频，验证 ASR/TTS/打断
python3 spikes/phase0/browser-smoke.py   # Chrome 假麦克风，验证整条浏览器路径
python3 spikes/phase0/browser-barge.py   # 假麦克风在 TTS 播放中开口，验证打断停止
python3 spikes/phase0/browser-bench.py 10  # 10 次感知延迟与 TTS 首帧
node spikes/phase0/bench-tts.mjs 4       # TTS 单测，参数为线程数
```

浏览器测试使用本机 Chrome，不依赖 Playwright 自带的 Chromium。假麦克风素材由 `test-input.wav` 生成：

- `test-input-long.wav`：1 秒静音 + 一句测试语音 + 20 秒静音。
- `test-input-barge.wav`：1 秒静音 + 第一句 + 3 秒静音 + 第二句 + 20 秒静音。第二句在 8.88 秒开始，用于测打断。

## 当前结论

2026-11-03 在 macOS + Chrome + 假麦克风上，TTS 首帧 90 分位 202ms，感知延迟 90 分位 828ms，打断停止 90 分位 250ms。假麦克风没有真实回声，AEC 与误打断率未验证；三平台设备矩阵仍待测。数字细节见 `docs/qa/latency.md`。
