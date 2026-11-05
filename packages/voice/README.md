# @dsh-voice/voice

DeepSeek Harness 的通用全双工语音插件。Host 侧运行本地流式 ASR、Silero VAD、Kokoro / Matcha / VITS 本地 TTS；Client 侧提供输入框麦克风按钮、语音光球、实时字幕、WebAudio 播放队列和语音审批。

**v0.1.1 · macOS 已实测 · Linux / Windows 未验收 · DSH 0.1.5 / 0.2.1 / 0.2.2 已跑通**

## 安装

### 从 npm（发布后）

```bash
dsh plugin --profile web add @dsh-voice/voice
```

### 从 GitHub Release（未发布 npm 时）

```bash
dsh plugin --profile web add https://github.com/casperkwok/dsh-voice/releases/download/v0.1.1/dsh-voice-voice-0.1.1.tgz
```

### 从本地源码

```bash
cd dsh-voice
pnpm install
pnpm build
dsh plugin --profile web add ./packages/voice
```

安装后重启 DSH web profile。`@dsh-voice/voice` 的 `dsh` 字段声明了 host/client 入口和 `cordis.patch.yml`，不需要手工改 profile 配置。

## 模型：第一次使用才下载

安装插件不会下载模型。第一次点麦克风、或在设置页点「试听 / 下载」时，Host 才检查模型目录并下载缺失文件，进度会显示在光球下方。

默认模型目录：

```
~/.cache/dsh-voice/models
```

查找顺序：

1. 设置里的「模型目录」
2. `DSH_VOICE_MODELS`
3. `~/.cache/dsh-voice/models`
4. 仓库根目录 `.models`（开发态）

大小约 0.5–0.8 GB，取决于本地 TTS：Kokoro fp32 约 370 MB，Matcha 约 125 MB，ASR 约 340 MB，VAD 约 0.6 MB。下载失败会保留 `.part`，重试从断点继续。

从源码安装时，可以手动预下载：

```bash
node scripts/install-models.mjs                 # ASR + VAD + Kokoro fp32
node scripts/install-models.mjs --with-matcha   # 追加 Matcha
node scripts/install-models.mjs --with-vits     # 追加 VITS
DSH_VOICE_MODEL_SOURCE=huggingface node scripts/install-models.mjs
```

默认从魔搭（ModelScope）下载，失败回退 Hugging Face / GitHub Releases。自动下载读取同一组环境变量，并在下载完成后校验 SHA256。

## 使用

重启后打开任意会话，点输入框右侧蓝色波形按钮，或按：

- macOS：`⌘⇧V`
- Windows / Linux：`Ctrl+Shift+V`

第一次使用会请求麦克风权限。说话停顿约 0.9 秒后定稿，文本通过 `agent.followup` 或 `agent.steer` 进入当前会话；助手回复从 `agent/assistant-stream` 按句朗读。播放中开口会触发打断，客户端停止播放并把最近 3 秒音频回灌 ASR。

## 设置

DSH → 设置 → 插件 → dsh-voice → 语音。

- **本地模型**：Kokoro / Matcha / VITS、音色、语速、线程、模型目录、试听、模型下载状态
- **云端模型**：火山引擎（双向流式）、阿里百炼（Qwen3-TTS）、MiniMax（speech-02），每家一份独立配置和 Key
- **静音判停**：200–2000ms，默认 900ms
- 保存后立即重建 TTS，不需要重启 DSH

API Key 只存在本机：

```
~/.dsh-voice/settings.json     # 0600
```

设置接口只返回掩码和 `hasApiKey`，不返回明文；提交空 Key 表示保留原 Key。

## 云端配置

| Provider | 必填字段 |
|---|---|
| 火山引擎 | API Key、Resource ID、音色 |
| 阿里百炼 | API Key、Endpoint、模型、音色 |
| MiniMax | API Key、Endpoint、Group ID、模型、音色 |

设置页的「试听」会用当前 provider 合成一句测试音频。云端 TTS 只发送要朗读的文本；ASR 仍在本地。

## 语音审批

DSH 触发 `approval/request` 时，如果当前有活跃语音会话：

- 光球下方显示「需要你授权：<工具名>」
- 朗读提示
- 说「允许 / 批准 / 可以」或「拒绝 / 不行 / 不要」
- 60 秒未回答按不可用失败关闭

监听使用 `{ prepend: true }`，优先于 DSH UI 弹窗；没有语音会话时交回原审批流程。

## 环境变量

| 变量 | 默认 | 说明 |
|---|---|---|
| `DSH_VOICE_MODELS` | `~/.cache/dsh-voice/models` | 模型目录 |
| `DSH_VOICE_SETTINGS` | `~/.dsh-voice/settings.json` | 设置文件路径 |
| `DSH_VOICE_TTS_SID` | `47` | Kokoro 音色，45–48 女声，49–52 男声 |
| `DSH_VOICE_TTS_THREADS` | `4` | TTS 推理线程数 |
| `DSH_VOICE_SILENCE_MS` | `900` | VAD 端点静音阈值 |
| `DSH_VOICE_MODEL_SOURCE` | `auto` | 默认优先魔搭；设为 `huggingface` 则优先 HF |
| `MODELSCOPE_ENDPOINT` | `https://modelscope.cn` | 魔搭镜像地址 |
| `HF_ENDPOINT` | `https://huggingface.co` | Hugging Face 回退地址 |
| `DSH_VOICE_DEBUG` | 空 | 设为 `1` 打印端点判断与文本；调试完关闭 |

## 隐私

- 无遥测、无远程日志。
- 本地 ASR/TTS 不把音频或文本发给第三方。
- 云端 TTS 只发送待朗读文本到选定 provider。
- API Key 不写入仓库、不返回明文、不写日志。
- 模型下载完成后按 SHA256 校验；已有文件不重复计算。
- 提交前跑 `pnpm check:secrets`，CI 也会跑。

## 当前范围

已实现：麦克风、流式识别、发送/插话、按句朗读、打断、字幕、本地/云端 TTS、设置页、试听、语音审批、模型按需下载。

未做：真实外放 AEC 设备矩阵、云端 ASR、命令词、移动端布局、npm 正式发布、跨平台签名。完整说明见仓库根目录 `README.md` 与 `docs/TECH-SPEC.md`。

## License

MIT。
