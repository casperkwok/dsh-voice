/**
 * Minimal runtime surface of the DSH packages the host imports. The real
 * packages are supplied by the DSH profile; esbuild externalizes them.
 */
declare module '@deepseek-ai/dsh-llm' {
  export interface UserMessage {
    readonly id: string
    readonly role: 'user'
    readonly content: readonly { type: 'text'; text: string }[]
    readonly source: { kind: 'user' }
  }

  export function createUserMessage(input: {
    content: readonly { type: 'text'; text: string }[]
    source: { kind: 'user' }
  }): UserMessage
}

declare module 'sherpa-onnx-node' {
  const value: any
  export = value
}

declare module 'ws' {
  import type { IncomingMessage } from 'node:http'
  import type { Duplex } from 'node:stream'

  export class WebSocket {
    static readonly OPEN: number
    readyState: number
    send(data: string | Buffer | ArrayBuffer): void
    close(): void
    on(event: 'message', listener: (data: Buffer, isBinary: boolean) => void): void
    on(event: 'close', listener: () => void): void
    on(event: 'error', listener: (err: Error) => void): void
  }

  export class WebSocketServer {
    clients: Set<WebSocket>
    constructor(options?: { noServer?: boolean; path?: string })
    handleUpgrade(
      request: IncomingMessage,
      socket: Duplex,
      head: Buffer,
      callback: (ws: WebSocket) => void,
    ): void
    emit(event: 'connection', ws: WebSocket, request: IncomingMessage): void
    close(): void
    on(event: 'connection', listener: (ws: WebSocket, request: IncomingMessage) => void): void
  }
}
