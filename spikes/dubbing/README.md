# 配音工作台 Phase 0 Spike

验证“台本 → 多角色音频”是否值得做成 DSH 工作台。

不接 DSH、不走云端、不依赖 ffmpeg。用本地 Kokoro 跑通最小流程：

```
解析角色 → 分配音色 → 逐句合成 → 混音 + 分轨 + SRT + 报告
```

## 运行

```bash
node spikes/dubbing/spike.mjs
node spikes/dubbing/spike.mjs --script spikes/dubbing/scripts/short-drama.txt
```

模型从 `DSH_VOICE_MODELS` 或仓库 `.models/kokoro-multi-lang-v1_1` 读取。

产物在 `spikes/dubbing/out/<script>/`：

- `mix.wav`：整段混音
- `tracks/<角色>.wav`：每个角色一条分轨
- `captions.srt`：按段落时间生成的字幕
- `report.json`：每句耗时、字符数、时长、RTF

`spikes/dubbing/out/` 已加入 `.gitignore`，不提交音频。

## 第一次结果（2026-11-06，macOS，本地 Kokoro fp32）

| 台本 | 段落 | 音频时长 | 合成耗时 | RTF |
|---|---:|---:|---:|---:|
| short-drama | 10 | 28.1s | 9.5s | 0.34 |
| voiceover | 10 | 47.1s | 19.6s | 0.42 |
| course | 11 | 52.1s | 20.7s | 0.40 |

结论：

- 本地多角色合成速度够用，约 2.5–3 倍实时
- 角色切换、分轨、SRT 的流程成立
- 单句重生成应该是产品核心，不应该整篇重跑
- `p90` 被 Kokoro 词表跳过，说明发音词典是刚需
- Kokoro 没有情绪控制，情绪只能通过语速/标点/音色近似；真正情绪要换 provider 或模型

## 下一步

1. 用 3 个真实台本替换样例，记录“从台本到可交付”的人工总时间
2. 和剪映/现有配音工具对比，确认是否有 30% 以上时间节省
3. 加入发音词典，验证 `p90`、人名、品牌名能稳定读对
4. 再决定是否进入 MVP 的 DSH 插件 UI
