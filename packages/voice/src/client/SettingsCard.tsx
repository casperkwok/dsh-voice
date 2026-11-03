import { useEffect, useState, type ReactElement } from 'react'
import type { VoiceSettings } from '../shared/settings.ts'

interface SettingsResponse {
  settings: VoiceSettings
  settingsPath: string
  effectiveProvider?: string
  ready?: boolean
}

const labelStyle = { display: 'block', fontSize: 12, marginBottom: 5, opacity: 0.72 }
const inputStyle = {
  width: '100%',
  boxSizing: 'border-box' as const,
  height: 32,
  padding: '0 9px',
  borderRadius: 7,
  border: '1px solid rgba(255,255,255,.14)',
  background: 'rgba(255,255,255,.04)',
  color: 'inherit',
  fontSize: 13,
}

export function SettingsCard(): ReactElement {
  const [settings, setSettings] = useState<VoiceSettings | null>(null)
  const [path, setPath] = useState('')
  const [status, setStatus] = useState('')
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    fetch('/voice/settings')
      .then((res) => res.json())
      .then((data: SettingsResponse) => {
        setSettings(data.settings)
        setPath(data.settingsPath)
      })
      .catch(() => setStatus('读取设置失败'))
  }, [])

  if (!settings) {
    return <div style={{ fontSize: 13, opacity: 0.7 }}>{status || '读取设置…'}</div>
  }

  const update = <K extends keyof VoiceSettings>(key: K, value: VoiceSettings[K]): void => {
    setSettings({ ...settings, [key]: value })
    setStatus('')
  }

  const save = async (): Promise<void> => {
    setSaving(true)
    setStatus('')
    try {
      const res = await fetch('/voice/settings', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(settings),
      })
      const data = await res.json()
      if (!res.ok || !data.ok) throw new Error(data.error ?? '保存失败')
      setStatus('已保存。重启 dsh web 后生效。')
    } catch (err) {
      setStatus(err instanceof Error ? err.message : '保存失败')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div style={{ display: 'grid', gap: 12, fontSize: 13 }}>
      <div>
        <label style={labelStyle}>模型目录（留空自动查找）</label>
        <input
          style={inputStyle}
          value={settings.modelsDir}
          placeholder="~/.cache/dsh-voice/models"
          onChange={(e) => update('modelsDir', e.target.value)}
        />
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
        <div>
          <label style={labelStyle}>TTS</label>
          <select
            style={inputStyle}
            value={settings.ttsProvider}
            onChange={(e) => update('ttsProvider', e.target.value as VoiceSettings['ttsProvider'])}
          >
            <option value="auto">自动</option>
            <option value="matcha">Matcha</option>
            <option value="kokoro">Kokoro</option>
            <option value="vits">VITS</option>
          </select>
        </div>
        <div>
          <label style={labelStyle}>Kokoro 音色</label>
          <input
            style={inputStyle}
            type="number"
            min={45}
            max={52}
            value={settings.ttsSid}
            onChange={(e) => update('ttsSid', Number(e.target.value))}
          />
        </div>
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
        <div>
          <label style={labelStyle}>TTS 线程</label>
          <input
            style={inputStyle}
            type="number"
            min={1}
            max={8}
            value={settings.ttsThreads}
            onChange={(e) => update('ttsThreads', Number(e.target.value))}
          />
        </div>
        <div>
          <label style={labelStyle}>静音判停（毫秒）</label>
          <input
            style={inputStyle}
            type="number"
            min={200}
            max={2000}
            step={50}
            value={settings.silenceMs}
            onChange={(e) => update('silenceMs', Number(e.target.value))}
          />
        </div>
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        <button
          type="button"
          onClick={() => void save()}
          disabled={saving}
          style={{
            height: 32,
            padding: '0 14px',
            borderRadius: 7,
            border: '1px solid rgba(110,231,183,.45)',
            background: 'rgba(110,231,183,.12)',
            color: '#6ee7b7',
            cursor: saving ? 'wait' : 'pointer',
            fontSize: 13,
          }}
        >
          {saving ? '保存中…' : '保存'}
        </button>
        <span style={{ fontSize: 12, opacity: 0.65 }}>{status}</span>
      </div>
      <div style={{ fontSize: 11, opacity: 0.45, wordBreak: 'break-all' }}>{path}</div>
    </div>
  )
}
