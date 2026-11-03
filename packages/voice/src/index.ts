/**
 * dsh-voice host entry.
 *
 * The real implementation lands after the PRD and tech spec. Keep this file as
 * the single host entry point so the package manifest and cordis.patch.yml stay
 * stable while modules are added under src/host/.
 */
import type { Context } from '@deepseek-ai/cordis'

export const name = 'dsh-voice'

export function apply(_ctx: Context): void {
  // TODO: register per-session voice controller, ASR/VAD/EOU/TTS, settings,
  // commands, approval bridge, and the /voice HTTP/SSE surface.
}
