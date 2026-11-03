# dsh-voice

General full-duplex voice plugin for **DeepSeek Harness (DSH)**.

- Streaming ASR (local, no cloud by default)
- Local TTS (CosyVoice / VITS / Kokoro)
- True barge-in: speak while the agent is speaking, not after it stops
- Target: end-to-end < 1.5s, command path < 800ms
- Cross-platform: macOS / Windows / Linux, headset + speaker

Status: **pre-PRD / pre-tech-spec**. Do not treat this as a working plugin yet.

## Docs

- [PRD](docs/PRD.md)
- [Tech spec](docs/TECH-SPEC.md)

## Layout

```
packages/voice/
├── src/index.ts        # host entry (Cordis plugin)
├── src/client.tsx      # client entry (React UI)
├── src/host/           # ASR / VAD / EOU / TTS / context / commands
├── src/client/         # mic button, voice dock, captions, settings
├── src/shared/         # host-client protocol types
├── cordis.patch.yml    # inserts the plugin into a DSH profile
└── package.json        # dsh.bundle.patch + dsh.client.inject
```
