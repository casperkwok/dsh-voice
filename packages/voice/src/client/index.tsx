import { VoiceButton } from './VoiceButton.tsx'
import { VoiceDock } from './VoiceDock.tsx'

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
}
