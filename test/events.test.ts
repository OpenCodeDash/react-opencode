import { describe, expect, it, vi } from "vitest"
import { EventStream, parseSseChunk } from "../src/client/events"
import type { EventEnvelope } from "../src/types"

function sseBody(frames: string[], options: { holdOpen?: boolean; signal?: AbortSignal } = {}) {
  return new ReadableStream({
    start(controller) {
      for (const frame of frames) controller.enqueue(new TextEncoder().encode(frame))
      if (!options.holdOpen) controller.close()
      options.signal?.addEventListener("abort", () => controller.error(new DOMException("aborted", "AbortError")))
    },
  })
}

function makeResponse(status: number, body?: ReadableStream): Response {
  return new Response(body ?? null, {
    status,
    headers: { "Content-Type": "text/event-stream" },
  })
}

describe("parseSseChunk", () => {
  it("parses complete frames", () => {
    const { events, rest } = parseSseChunk('data: {"a":1}\n\ndata: {"b":2}\n\n')
    expect(events).toEqual(['{"a":1}', '{"b":2}'])
    expect(rest).toBe("")
  })

  it("keeps incomplete frame as rest", () => {
    const { events, rest } = parseSseChunk('data: {"a":1}\n\ndata: {"par')
    expect(events).toEqual(['{"a":1}'])
    expect(rest).toBe('data: {"par')
  })

  it("ignores non-data lines and comments", () => {
    const { events } = parseSseChunk(": comment\nid: 5\ndata: {\"x\":true}\n\n")
    expect(events).toEqual(['{"x":true}'])
  })

  it("joins multi-line data", () => {
    const { events } = parseSseChunk("data: {\"a\":\ndata: 1}\n\n")
    expect(events).toEqual(['{"a":\n1}'])
  })
})

describe("EventStream", () => {
  it("emits events from the stream and marks connected", async () => {
    const seen: EventEnvelope[] = []
    const connections: number[] = []
    let open = true
    const fetchImpl = vi.fn(async (_url: string, init?: RequestInit) =>
      makeResponse(
        200,
        sseBody(['data: {"id":"e1","type":"x","properties":{}}\n\n'], {
          holdOpen: true,
          signal: init?.signal as AbortSignal,
        }),
      ),
    )
    const stream = new EventStream({
      url: "http://test/event",
      fetchImpl,
      onEvent: (e) => seen.push(e),
      onConnected: () => connections.push(1),
      reconnect: false,
    })
    const running = stream.start()
    await vi.waitFor(() => expect(seen).toHaveLength(1))
    expect(seen[0]!.type).toBe("x")
    expect(connections).toHaveLength(1)
    stream.stop()
    open = false
    await running
    expect(open).toBe(false)
  })

  it("reconnects with backoff after the stream closes", async () => {
    const seen: EventEnvelope[] = []
    let calls = 0
    const fetchImpl = vi.fn(async () => {
      calls += 1
      const n = calls
      return makeResponse(200, sseBody([`data: {"id":"e${n}","type":"tick","properties":{"n":${n}}}\n\n`]))
    })
    const stream = new EventStream({
      url: "http://test/event",
      fetchImpl,
      onEvent: (e) => seen.push(e),
      reconnect: true,
      minBackoffMs: 10,
      maxBackoffMs: 40,
    })
    const running = stream.start()
    await vi.waitFor(() => expect(seen.length).toBeGreaterThanOrEqual(3), { timeout: 3000 })
    stream.stop()
    await running
    expect(calls).toBeGreaterThanOrEqual(3)
    expect(seen.slice(0, 3).map((e) => e.properties.n)).toEqual([1, 2, 3])
  })

  it("stops without reconnecting when reconnect is false", async () => {
    let calls = 0
    const fetchImpl = vi.fn(async () => {
      calls += 1
      return makeResponse(200, sseBody(["data: {}\n\n"]))
    })
    const stream = new EventStream({
      url: "http://test/event",
      fetchImpl,
      onEvent: () => undefined,
      reconnect: false,
    })
    await stream.start()
    expect(calls).toBe(1)
  })

  it("aborts the in-flight fetch on stop", async () => {
    const seenAborts: boolean[] = []
    const fetchImpl = vi.fn(
      (_url: string, init?: RequestInit) =>
        new Promise<Response>((resolve, reject) => {
          const signal = init?.signal as AbortSignal
          signal?.addEventListener("abort", () => {
            seenAborts.push(true)
            reject(new DOMException("aborted", "AbortError"))
          })
        }),
    )
    const stream = new EventStream({
      url: "http://test/event",
      fetchImpl,
      onEvent: () => undefined,
      reconnect: true,
      minBackoffMs: 5,
    })
    const running = stream.start()
    await vi.waitFor(() => expect(fetchImpl).toHaveBeenCalled())
    stream.stop()
    await running
    expect(seenAborts).toHaveLength(1)
  })

  it("skips malformed frames", async () => {
    const seen: EventEnvelope[] = []
    const stream = new EventStream({
      url: "http://test/event",
      fetchImpl: async () =>
        makeResponse(
          200,
          sseBody(["data: not-json\n\ndata: {\"id\":\"ok\",\"type\":\"t\",\"properties\":{}}\n\n"]),
        ),
      onEvent: (e) => seen.push(e),
      reconnect: false,
    })
    await stream.start()
    expect(seen).toHaveLength(1)
    expect(seen[0]!.type).toBe("t")
  })
})
