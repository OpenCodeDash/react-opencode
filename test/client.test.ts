import { describe, expect, it, vi } from "vitest"
import { OpenCodeClient, OpenCodeError } from "../src/client/client"
import type { Session } from "../src/types"

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  })
}

function restMock(handler: (method: string, url: string, body?: unknown) => Response) {
  return vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input)
    const method = init?.method ?? "GET"
    const body = init?.body ? JSON.parse(String(init.body)) : undefined
    return handler(method, url, body)
  }) as unknown as typeof fetch
}

const session: Session = {
  id: "ses_1",
  projectID: "prj_1",
  directory: "/tmp",
  time: { created: 1, updated: 2 },
}

describe("OpenCodeClient.request", () => {
  it("throws OpenCodeError with status and body on failure", async () => {
    const client = new OpenCodeClient({
      url: "http://x",
      fetchImpl: restMock(() => jsonResponse(404, { error: { name: "NotFound", data: { message: "nope" } } })),
      autoConnect: false,
    })
    await expect(client.getSession("ses_missing")).rejects.toMatchObject({
      name: "OpenCodeError",
      status: 404,
    })
    try {
      await client.getSession("ses_missing")
    } catch (err) {
      expect(err).toBeInstanceOf(OpenCodeError)
      expect((err as OpenCodeError).body).toMatchObject({ error: { name: "NotFound" } })
    }
  })

  it("sends JSON body on POST", async () => {
    let capturedBody: unknown
    const fetchImpl = restMock((method, _url, body) => {
      if (method === "POST") capturedBody = body
      return jsonResponse(200, session)
    })
    const client = new OpenCodeClient({ url: "http://x", fetchImpl, autoConnect: false })
    await client.createSession({ title: "hi" })
    expect(capturedBody).toEqual({ title: "hi" })
  })

  it("posts prompt parts to the message endpoint", async () => {
    let captured: { url?: string; body?: unknown; method?: string } = {}
    const fetchImpl = restMock((method, url, body) => {
      captured = { method, url, body }
      return jsonResponse(200, { info: { ...session, id: "msg_1" }, parts: [] })
    })
    const client = new OpenCodeClient({ url: "http://x", fetchImpl, autoConnect: false })
    await client.prompt("ses_1", { parts: [{ type: "text", text: "hello" }] })
    expect(captured.method).toBe("POST")
    expect(captured.url).toBe("http://x/session/ses_1/message")
    expect(captured.body).toEqual({ parts: [{ type: "text", text: "hello" }] })
  })

  it("replies to permissions with the reply field", async () => {
    let capturedBody: unknown
    const fetchImpl = restMock((method, url, body) => {
      if (method === "POST" && url.includes("/permission/")) capturedBody = body
      return jsonResponse(200, null)
    })
    const client = new OpenCodeClient({ url: "http://x", fetchImpl, autoConnect: false })
    await client.replyPermission("per_1", "always")
    expect(capturedBody).toEqual({ reply: "always" })
  })
})

describe("OpenCodeClient hydration", () => {
  it("fetches sessions, status, permissions and questions on connect", async () => {
    const urls: string[] = []
    const fetchImpl = restMock((method, url) => {
      urls.push(url)
      if (url.endsWith("/event")) {
        return new Response(
          new ReadableStream({
            start(c) {
              c.enqueue(new TextEncoder().encode('data: {"id":"e1","type":"session.created","properties":{"sessionID":"ses_1","info":{"id":"ses_1","projectID":"p","directory":"/tmp","time":{"created":1,"updated":2}}}}\n\n'))
              c.close()
            },
          }),
          { status: 200, headers: { "Content-Type": "text/event-stream" } },
        )
      }
      if (url.endsWith("/session")) return jsonResponse(200, [session])
      if (url.endsWith("/session/status")) return jsonResponse(200, { ses_1: { type: "busy" } })
      if (url.endsWith("/permission")) return jsonResponse(200, [])
      if (url.endsWith("/question")) return jsonResponse(200, [])
      return jsonResponse(404, {})
    })
    const client = new OpenCodeClient({
      url: "http://x",
      fetchImpl,
      autoConnect: false,
      minBackoffMs: 5,
      maxBackoffMs: 20,
      reconnect: false,
    })
    client.connect()
    await vi.waitFor(() => expect(client.store.state.sessions).toHaveLength(1), { timeout: 3000 })
    expect(client.store.state.status["ses_1"]?.type).toBe("busy")
    expect(urls.some((u) => u.endsWith("/global/event"))).toBe(true)
    expect(urls.some((u) => u.endsWith("/session"))).toBe(true)
    expect(urls.some((u) => u.endsWith("/session/status"))).toBe(true)
    client.disconnect()
  })

  it("dedupes concurrent loadMessages calls", async () => {
    let calls = 0
    let release: () => void
    const gate = new Promise<void>((r) => (release = r))
    const fetchImpl = restMock(async (method, url) => {
      if (url.endsWith("/event")) {
        return new Response(null, { status: 200, headers: { "Content-Type": "text/event-stream" } })
      }
      if (url.includes("/message") && method === "GET") {
        calls += 1
        await gate
        return jsonResponse(200, [])
      }
      return jsonResponse(200, method === "GET" && url.endsWith("/session") ? [] : null)
    })
    const client = new OpenCodeClient({ url: "http://x", fetchImpl, autoConnect: false })
    const a = client.loadMessages("ses_1")
    const b = client.loadMessages("ses_1")
    await new Promise((r) => setTimeout(r, 10))
    release!()
    await Promise.all([a, b])
    expect(calls).toBe(1)
  })

  it("rehydrates loaded sessions after reconnect", async () => {
    let sseCalls = 0
    let messageCalls = 0
    const streams: ReadableStream[] = []
    function eventStream(): ReadableStream {
      return new ReadableStream({
        start(c) {
          if (sseCalls === 1) {
            c.enqueue(new TextEncoder().encode('data: {"id":"e1","type":"session.created","properties":{"sessionID":"ses_r","info":{"id":"ses_r","projectID":"p","directory":"/tmp","time":{"created":1,"updated":2}}}}\n\n'))
          }
          c.close()
        },
      })
    }
    const fetchImpl = restMock(async (method, url) => {
      if (url.endsWith("/event")) {
        sseCalls += 1
        return new Response(eventStream(), { status: 200, headers: { "Content-Type": "text/event-stream" } })
      }
      if (url.includes("/message") && method === "GET") {
        messageCalls += 1
        return jsonResponse(200, [{ info: { id: "msg_r", sessionID: "ses_r", role: "user", time: { created: 1 } }, parts: [] }])
      }
      if (url.endsWith("/session")) return jsonResponse(200, sseCalls >= 1 ? [session] : [])
      return jsonResponse(200, null)
    })
    const client = new OpenCodeClient({
      url: "http://x",
      fetchImpl,
      autoConnect: false,
      minBackoffMs: 10,
      maxBackoffMs: 40,
      reconnect: true,
    })
    client.connect()
    await vi.waitFor(() => expect(client.store.state.sessions.some((s) => s.id === "ses_r")).toBe(true), {
      timeout: 3000,
    })
    await client.loadMessages("ses_r")
    expect(messageCalls).toBe(1)

    // wait for the stream to close and the client to reconnect + rehydrate
    await vi.waitFor(() => expect(messageCalls).toBeGreaterThanOrEqual(2), { timeout: 5000 })
    client.disconnect()
  })
})
