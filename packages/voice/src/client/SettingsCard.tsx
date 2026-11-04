import { useEffect, useRef, useState, type ReactElement } from 'react'
import type {
  CloudProfile,
  CloudTtsProvider,
  PublicCloudProfile,
  PublicVoiceSettings,
  VoiceSettings,
} from '../shared/settings.ts'

interface SettingsResponse {
  settings: PublicVoiceSettings
  settingsPath: string
  effectiveProvider?: string
  ready?: boolean
}

const CLOUD_PROVIDERS: {
  id: CloudTtsProvider
  name: string
  badge: string
  desc: string
}[] = [
  { id: 'volc', name: '火山引擎', badge: '火', desc: '双向流式 TTS' },
  { id: 'dashscope', name: '阿里百炼', badge: '阿', desc: 'Qwen3-TTS' },
  { id: 'minimax', name: 'MiniMax', badge: 'MM', desc: 'speech-02-hd / turbo' },
]

const LOCAL_PROVIDERS: { id: VoiceSettings['ttsProvider']; name: string; badge: string; desc: string }[] = [
  { id: 'kokoro', name: 'Kokoro', badge: 'K', desc: '24k · 音色自然' },
  { id: 'matcha', name: 'Matcha', badge: 'M', desc: '16k · 首声最快' },
  { id: 'vits', name: 'VITS', badge: 'V', desc: '16k · 兜底' },
]

const KOKORO_VOICES = [
  [45, '小北'],
  [46, '小妮'],
  [47, '小晓'],
  [48, '小艺'],
  [49, '云健'],
  [50, '云希'],
  [51, '云霞'],
  [52, '云扬'],
] as const

const MINIMAX_VOICES = [
  'female-shaonv',
  'female-yujie',
  'female-chengshu',
  'female-tianmei',
  'male-qn-qingse',
  'male-qn-jingying',
  'male-qn-badao',
  'presenter_female',
  'presenter_male',
]

const CSS = `
.dshv-field { display: grid; gap: 6px; }
.dshv-label { font-size: 11.5px; opacity: .62; letter-spacing: .02em; }
.dshv-input {
  width: 100%; box-sizing: border-box; height: 34px; padding: 0 10px;
  border-radius: 8px; border: 1px solid rgba(255,255,255,.12);
  background: rgba(255,255,255,.035); color: inherit; font-size: 13px;
  outline: none; transition: border-color .15s, background .15s;
}
.dshv-input:focus { border-color: rgba(96,165,250,.6); background: rgba(255,255,255,.055); }
.dshv-card {
  display: flex; align-items: center; gap: 9px; min-height: 48px; padding: 8px 10px;
  border-radius: 10px; border: 1px solid rgba(255,255,255,.09);
  background: rgba(255,255,255,.025); cursor: pointer; text-align: left;
  transition: border-color .15s, background .15s, transform .15s;
}
.dshv-card:hover { border-color: rgba(255,255,255,.18); background: rgba(255,255,255,.045); }
.dshv-card[data-selected='true'] { border-color: rgba(96,165,250,.65); background: rgba(59,130,246,.1); }
.dshv-card:disabled { opacity: .45; cursor: not-allowed; }
.dshv-card:active { transform: scale(.995); }
.dshv-badge {
  display: grid; place-items: center; width: 30px; height: 30px; flex: 0 0 auto;
  border-radius: 8px; background: rgba(255,255,255,.07); font-size: 12px; font-weight: 700;
}
.dshv-seg { display: inline-flex; padding: 3px; border-radius: 10px; background: rgba(255,255,255,.045); }
.dshv-seg button {
  height: 28px; padding: 0 13px; border: none; border-radius: 7px; background: transparent;
  color: inherit; opacity: .55; font-size: 12px; cursor: pointer;
}
.dshv-seg button[data-active='true'] { background: rgba(255,255,255,.1); opacity: 1; }
.dshv-primary {
  height: 34px; padding: 0 15px; border-radius: 8px; border: 1px solid rgba(110,231,183,.42);
  background: rgba(110,231,183,.12); color: #6ee7b7; font-size: 13px; cursor: pointer;
}
.dshv-secondary {
  height: 34px; padding: 0 14px; border-radius: 8px; border: 1px solid rgba(255,255,255,.12);
  background: transparent; color: inherit; font-size: 13px; cursor: pointer; opacity: .8;
}
.dshv-primary:disabled, .dshv-secondary:disabled { opacity: .45; cursor: default; }
.dshv-grid2 { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; }
`

export function SettingsCard(): ReactElement {
  const [form, setForm] = useState<PublicVoiceSettings | null>(null)
  const [keyInput, setKeyInput] = useState('')
  const [path, setPath] = useState('')
  const [status, setStatus] = useState('')
  const [saving, setSaving] = useState(false)
  const [testing, setTesting] = useState(false)
  const [tab, setTab] = useState<'local' | 'cloud'>('local')
  const [effective, setEffective] = useState('')
  const [ready, setReady] = useState(false)
  const audioRef = useRef<HTMLAudioElement | null>(null)

  const load = (): void => {
    fetch('/voice/settings')
      .then((res) => res.json())
      .then((data: SettingsResponse) => {
        setForm(data.settings)
        setPath(data.settingsPath)
        setEffective(data.effectiveProvider ?? '')
        setReady(Boolean(data.ready))
        setTab(data.settings.ttsMode === 'cloud' ? 'cloud' : 'local')
      })
      .catch(() => setStatus('读取设置失败'))
  }

  useEffect(load, [])

  if (!form) {
    return <div style={{ fontSize: 13, opacity: 0.7 }}>{status || '读取设置…'}</div>
  }

  const update = <K extends keyof PublicVoiceSettings>(
    key: K,
    value: PublicVoiceSettings[K],
  ): void => {
    setForm({ ...form, [key]: value })
    setStatus('')
  }

  const profile = form.cloudProfiles[form.cloudProvider]
  const updateProfile = <K extends keyof PublicCloudProfile>(key: K, value: PublicCloudProfile[K]): void => {
    setForm({
      ...form,
      cloudProfiles: {
        ...form.cloudProfiles,
        [form.cloudProvider]: { ...profile, [key]: value },
      },
    })
    setStatus('')
  }

  const save = async (): Promise<boolean> => {
    setSaving(true)
    setStatus('')
    try {
      const body = {
        ...form,
        cloudProfiles: {
          ...form.cloudProfiles,
          [form.cloudProvider]: { ...profile, apiKey: keyInput },
        },
      }
      const res = await fetch('/voice/settings', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      })
      const data = await res.json()
      if (!res.ok || !data.ok) throw new Error(data.error ?? '保存失败')
      setForm(data.settings)
      setKeyInput('')
      setPath(data.settingsPath)
      setEffective(data.effectiveProvider ?? effective)
      setReady(Boolean(data.ready))
      setStatus('已保存并生效')
      return true
    } catch (err) {
      setStatus(err instanceof Error ? err.message : '保存失败')
      return false
    } finally {
      setSaving(false)
    }
  }

  const test = async (): Promise<void> => {
    setTesting(true)
    setStatus('')
    try {
      if (!(await save())) return
      const res = await fetch('/voice/preview', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ text: '你好，我是语音助手。今天天气不错。' }),
      })
      const data = await res.json()
      if (!res.ok || !data.ok) throw new Error(data.error ?? '试听失败')
      audioRef.current?.pause()
      const audio = new Audio(`data:audio/wav;base64,${data.audio}`)
      audioRef.current = audio
      await audio.play()
      setStatus('试听已播放')
    } catch (err) {
      setStatus(err instanceof Error ? err.message : '试听失败')
    } finally {
      setTesting(false)
    }
  }

  const local = tab === 'local'
  const cloud = CLOUD_PROVIDERS.find((p) => p.id === form.cloudProvider) ?? CLOUD_PROVIDERS[0]!

  return (
    <div style={{ display: 'grid', gap: 14, fontSize: 13 }}>
      <style>{CSS}</style>

      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10 }}>
        <div className="dshv-seg">
          <button type="button" data-active={local} onClick={() => setTab('local')}>本地模型</button>
          <button type="button" data-active={!local} onClick={() => setTab('cloud')}>云端模型</button>
        </div>
        <span style={{ fontSize: 11, opacity: 0.5 }}>
          {ready ? `当前：${effective}` : '模型未就绪'}
        </span>
      </div>

      {local ? (
        <>
          <div className="dshv-field">
            <span className="dshv-label">本地引擎</span>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 8 }}>
              {LOCAL_PROVIDERS.map((p) => (
                <button
                  key={p.id}
                  type="button"
                  className="dshv-card"
                  data-selected={form.ttsProvider === p.id}
                  onClick={() => update('ttsProvider', p.id)}
                >
                  <span className="dshv-badge">{p.badge}</span>
                  <span>
                    <span style={{ display: 'block', fontSize: 12.5 }}>{p.name}</span>
                    <span style={{ display: 'block', fontSize: 10.5, opacity: 0.45, marginTop: 2 }}>{p.desc}</span>
                  </span>
                </button>
              ))}
            </div>
          </div>

          <div className="dshv-grid2">
            <div className="dshv-field">
              <span className="dshv-label">音色</span>
              {form.ttsProvider === 'kokoro' ? (
                <select className="dshv-input" value={form.ttsSid} onChange={(e) => update('ttsSid', Number(e.target.value))}>
                  {KOKORO_VOICES.map(([id, name]) => (
                    <option key={id} value={id}>{name}（{id}）</option>
                  ))}
                </select>
              ) : (
                <input className="dshv-input" value="单音色模型" disabled />
              )}
            </div>
            <div className="dshv-field">
              <span className="dshv-label">语速 {form.ttsSpeed.toFixed(1)}×</span>
              <input type="range" min={0.5} max={2} step={0.1} value={form.ttsSpeed} onChange={(e) => update('ttsSpeed', Number(e.target.value))} />
            </div>
          </div>

          <div className="dshv-field">
            <span className="dshv-label">模型目录（留空自动查找）</span>
            <input className="dshv-input" value={form.modelsDir} placeholder="~/.cache/dsh-voice/models" onChange={(e) => update('modelsDir', e.target.value)} />
          </div>
        </>
      ) : (
        <>
          <div className="dshv-field">
            <span className="dshv-label">云端 Provider</span>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 8 }}>
              {CLOUD_PROVIDERS.map((p) => (
                <button
                  key={p.id}
                  type="button"
                  className="dshv-card"
                  data-selected={form.cloudProvider === p.id}
                  onClick={() => {
                    update('cloudProvider', p.id)
                    setKeyInput('')
                  }}
                >
                  <span className="dshv-badge">{p.badge}</span>
                  <span>
                    <span style={{ display: 'block', fontSize: 12.5 }}>{p.name}</span>
                    <span style={{ display: 'block', fontSize: 10.5, opacity: 0.45, marginTop: 2 }}>{p.desc}</span>
                  </span>
                </button>
              ))}
            </div>
          </div>

          <div className="dshv-field">
            <span className="dshv-label">
              API Key {profile.hasApiKey ? `（已保存 ${profile.apiKeyMasked}）` : ''}
            </span>
            <input
              className="dshv-input"
              type="password"
              autoComplete="off"
              value={keyInput}
              placeholder={profile.hasApiKey ? '留空表示保持现有 Key' : '粘贴 API Key'}
              onChange={(e) => setKeyInput(e.target.value)}
            />
          </div>

          {form.cloudProvider === 'volc' ? (
            <>
              <div className="dshv-grid2">
                <div className="dshv-field">
                  <span className="dshv-label">Resource ID</span>
                  <input className="dshv-input" value={profile.resourceId} placeholder="seed-tts-2.0" onChange={(e) => updateProfile('resourceId', e.target.value)} />
                </div>
                <div className="dshv-field">
                  <span className="dshv-label">语速 {profile.speed.toFixed(1)}×</span>
                  <input type="range" min={0.5} max={2} step={0.1} value={profile.speed} onChange={(e) => updateProfile('speed', Number(e.target.value))} />
                </div>
              </div>
              <div className="dshv-field">
                <span className="dshv-label">音色</span>
                <input className="dshv-input" value={profile.voice} placeholder="zh_female_xiaohe_uranus_bigtts" onChange={(e) => updateProfile('voice', e.target.value)} />
              </div>
            </>
          ) : form.cloudProvider === 'dashscope' ? (
            <>
              <div className="dshv-grid2">
                <div className="dshv-field">
                  <span className="dshv-label">Endpoint</span>
                  <input className="dshv-input" value={profile.endpoint} onChange={(e) => updateProfile('endpoint', e.target.value)} />
                </div>
                <div className="dshv-field">
                  <span className="dshv-label">模型</span>
                  <select className="dshv-input" value={profile.model} onChange={(e) => updateProfile('model', e.target.value)}>
                    <option value="qwen3-tts-flash">qwen3-tts-flash</option>
                    <option value="qwen3-tts-plus">qwen3-tts-plus</option>
                  </select>
                </div>
              </div>
              <div className="dshv-field">
                <span className="dshv-label">音色</span>
                <input className="dshv-input" value={profile.voice} placeholder="Cherry" onChange={(e) => updateProfile('voice', e.target.value)} />
              </div>
            </>
          ) : (
            <>
              <div className="dshv-grid2">
                <div className="dshv-field">
                  <span className="dshv-label">Endpoint</span>
                  <input className="dshv-input" value={profile.endpoint} onChange={(e) => updateProfile('endpoint', e.target.value)} />
                </div>
                <div className="dshv-field">
                  <span className="dshv-label">Group ID</span>
                  <input className="dshv-input" value={profile.groupId} onChange={(e) => updateProfile('groupId', e.target.value)} />
                </div>
              </div>

              <div className="dshv-grid2">
                <div className="dshv-field">
                  <span className="dshv-label">模型</span>
                  <select className="dshv-input" value={profile.model} onChange={(e) => updateProfile('model', e.target.value)}>
                    <option value="speech-02-hd">speech-02-hd</option>
                    <option value="speech-02-turbo">speech-02-turbo</option>
                    <option value="speech-01-hd">speech-01-hd</option>
                    <option value="speech-01-turbo">speech-01-turbo</option>
                  </select>
                </div>
                <div className="dshv-field">
                  <span className="dshv-label">语速 {profile.speed.toFixed(1)}×</span>
                  <input type="range" min={0.5} max={2} step={0.1} value={profile.speed} onChange={(e) => updateProfile('speed', Number(e.target.value))} />
                </div>
              </div>

              <div className="dshv-field">
                <span className="dshv-label">音色</span>
                <input className="dshv-input" list="dshv-minimax-voices" value={profile.voice} onChange={(e) => updateProfile('voice', e.target.value)} />
                <datalist id="dshv-minimax-voices">
                  {MINIMAX_VOICES.map((voice) => <option key={voice} value={voice} />)}
                </datalist>
              </div>
            </>
          )}

          <div style={{ fontSize: 11, opacity: 0.45, lineHeight: 1.5 }}>
            {cloud.name} · {cloud.desc}。Key 只保存在本机，设置页不会回传明文。
          </div>
        </>
      )}

      <div className="dshv-field">
        <span className="dshv-label">静音判停 {form.silenceMs}ms</span>
        <input type="range" min={400} max={1600} step={50} value={form.silenceMs} onChange={(e) => update('silenceMs', Number(e.target.value))} />
      </div>

      <div style={{ display: 'flex', alignItems: 'center', gap: 9, flexWrap: 'wrap' }}>
        <button type="button" className="dshv-primary" onClick={() => void save()} disabled={saving}>
          {saving ? '保存中…' : '保存'}
        </button>
        <button type="button" className="dshv-secondary" onClick={() => void test()} disabled={testing || saving}>
          {testing ? '试听中…' : '试听'}
        </button>
        <span style={{ fontSize: 12, opacity: 0.62 }}>{status}</span>
      </div>

      <div style={{ fontSize: 10.5, opacity: 0.35, wordBreak: 'break-all' }}>{path}</div>
    </div>
  )
}
