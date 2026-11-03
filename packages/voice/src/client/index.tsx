import { VoiceButton } from './VoiceButton.tsx'
import { VoiceDock } from './VoiceDock.tsx'
import { SettingsCard } from './SettingsCard.tsx'

export const inject = ['slots']

export function apply(ctx: any): void {
  ctx.slots.inject('conversation.input.right', () =>
    ctx.slots.register(
      {
        name: 'conversation.input.right',
        id: 'dsh-voice',
        order: 120,
        inject: () => ({}),
      },
      VoiceButton,
    ),
  )

  ctx.slots.inject('conversation.input.dock', () =>
    ctx.slots.register(
      {
        name: 'conversation.input.dock',
        id: 'dsh-voice-status',
        order: 20,
        inject: () => ({}),
      },
      VoiceDock,
    ),
  )

  ctx.slots.inject('settings.plugin.item', () =>
    ctx.slots.register(
      { name: 'settings.plugin.item', id: 'dsh-voice', key: 'dsh-voice', order: 100, label: () => '语音' },
      SettingsCard,
    ),
  )

  ctx.slots.inject('settings.section', () =>
    ctx.slots.register(
      { name: 'settings.section', id: 'dsh-voice', order: 100, label: () => '语音' },
      SettingsCard,
    ),
  )
}
