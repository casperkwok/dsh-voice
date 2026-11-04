# @dsh-voice/voice

DeepSeek Harness 的通用全双工语音插件。Host 侧运行本地流式 ASR、Silero VAD、Matcha / Kokoro 本地 TTS；Client 侧提供输入框麦克风按钮、状态条、实时字幕和 WebAudio 播放队列。

## 安装

```bash
dsh plugin --profile web add /path/to/dsh-voice/packages/voice
```

把模型放到以下任一位置：

- `DSH_VOICE_MODELS` 指向的目录
- `~/.cache/dsh-voice/models`
- 仓库根目录 `.models`（开发态）

也可以从仓库根目录下载：

```bash
node scripts/install-models.mjs                 # ASR + VAD + Matcha
node scripts/install-models.mjs --with-kokoro   # 追加 Kokoro 英文回退
```

需要的目录：

```
models/
├── sherpa-onnx-streaming-zipformer-bilingual-zh-en-2023-02-20/
├── matcha-icefall-zh-en/
├── kokoro-int8-multi-lang-v1_1/          # 可选，英文段回退
├── sherpa-onnx-vits-zh-ll/               # 可选，最后兜底
└── silero_vad.onnx
```

## 使用

重启 `dsh web`，在任意会话的输入框右侧点「语音」。第一次进入会请求麦克风权限。用户说完后，最终文本通过 `agent.followup` 或 `agent.steer` 进入当前 DSH 会话；助手回复从 `agent/assistant-stream` 按句朗读。播放中开口会触发打断，客户端停止播放并保留最近 3 秒音频回灌 ASR。

## 环境变量

| 变量 | 默认 | 说明 |
|---|---|---|
| `DSH_VOICE_MODELS` | `~/.cache/dsh-voice/models` | 模型目录 |
| `DSH_VOICE_TTS_SID` | `47` | Kokoro 音色，45–48 女声，49–52 男声 |
| `DSH_VOICE_TTS_THREADS` | `4` | TTS 推理线程数 |
| `DSH_VOICE_SILENCE_MS` | `900` | VAD 端点静音阈值；以连接词/逗号结尾会再等 450ms |

## 当前范围

v0.1 垂直切片：麦克风、流式识别、发送/插话、按句朗读、打断、字幕。设置卡、模型自动下载、命令词、审批桥和跨平台打包尚未实现。
