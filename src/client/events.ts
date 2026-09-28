import type { EventEnvelope } from "../types"

export interface EventStreamOptions {
  url: string
  fetchImpl?: typeof fetch
  onEvent: (event: EventEnvelope) => void
  onConnected?: () => void
  onDisconnected?: () => void
  reconnect?: boolean
  minBackoffMs?: number
  maxBackoffMs?: number
  signal?: AbortSignal
}

export function parseSseChunk(buffer: string): { events: string[]; rest: string } {
  const events: string[] = []
  let rest = buffer
  let idx: number
  while ((idx = rest.indexOf("\n\n")) !== -1) {
    const frame = rest.slice(0, idx)
    rest = rest.slice(idx + 2)
    const dataLines = frame
      .split("\n")
      .filter((line) => line.startsWith("data:"))
      .map((line) => line.slice(5).replace(/^ /, ""))
    if (dataLines.length > 0) events.push(dataLines.join("\n"))
  }
  return { events, rest }
}

function parseEvent(raw: string): EventEnvelope | null {
  try {
    const parsed = JSON.parse(raw) as EventEnvelope
    if (parsed && typeof parsed.type === "string") return parsed
    return null
  } catch {
    return null
  }
}

function delay(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    const timer = setTimeout(done, ms)
    const onAbort = () => {
      clearTimeout(timer)
      done()
    }
    function done() {
      signal?.removeEventListener("abort", onAbort)
      resolve()
    }
    signal?.addEventListener("abort", onAbort, { once: true })
  })
}

export class EventStream {
  private options: EventStreamOptions
  private abortController: AbortController | null = null
  private stopped = true
  private backoffMs: number

  constructor(options: EventStreamOptions) {
    this.options = options
    this.backoffMs = options.minBackoffMs ?? 500
  }

  get connected(): boolean {
    return !this.stopped
  }

  async start(): Promise<void> {
    this.stopped = false
    while (!this.stopped) {
      const controller = new AbortController()
      this.abortController = controller
      const signal = this.combinedSignal(controller)
      let connected = false
      try {
        await this.consume(signal, () => {
          if (!connected) {
            connected = true
            this.options.onConnected?.()
            this.backoffMs = this.options.minBackoffMs ?? 500
          }
        })
      } catch {
        // connection failed or dropped; fall through to reconnect
      } finally {
        if (connected) this.options.onDisconnected?.()
        this.abortController = null
      }
      if (this.stopped) break
      if (!this.options.reconnect) break
      await delay(this.backoffMs, this.options.signal)
      this.backoffMs = Math.min(this.backoffMs * 2, this.options.maxBackoffMs ?? 30_000)
    }
  }

  stop(): void {
    this.stopped = true
    this.abortController?.abort()
  }

  private combinedSignal(controller: AbortController): AbortSignal {
    const external = this.options.signal
    if (!external) return controller.signal
    if (external.aborted) return external
    const combined = new AbortController()
    const onAbort = () => combined.abort()
    external.addEventListener("abort", onAbort, { once: true })
    controller.signal.addEventListener("abort", () => external.removeEventListener("abort", onAbort), {
      once: true,
    })
    return combined.signal
  }

  private async consume(signal: AbortSignal, onOpen: () => void): Promise<void> {
    const fetchImpl = this.options.fetchImpl ?? fetch
    const response = await fetchImpl(this.options.url, {
      headers: { Accept: "text/event-stream" },
      signal,
    })
    if (!response.ok || !response.body) {
      throw new Error(`event stream failed: ${response.status}`)
    }
    onOpen()
    const reader = response.body.getReader()
    const decoder = new TextDecoder()
    let buffer = ""
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      buffer += decoder.decode(value, { stream: true })
      const { events, rest } = parseSseChunk(buffer)
      buffer = rest
      for (const raw of events) {
        const event = parseEvent(raw)
        if (event) this.options.onEvent(event)
      }
    }
    throw new Error("event stream closed")
  }
}
