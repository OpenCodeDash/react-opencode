import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http"
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest"
import { OpenCodeClient } from "../src/client/client"
import type { Session } from "../src/types"

interface MockServer {
  server: Server
  port: number
  url: string
  clients: ServerResponse[]
  sendEvent: (event: unknown) => void
  close: () => Promise<void>
}

const sessionA: Session = {
  id: "ses_int_a",
  projectID: "prj_int",
  directory: "/tmp",
  title: "Integration A",
  time: { created: 1, updated: 2 },
}

async function startMockServer(): Promise<MockServer> {
  const clients: ServerResponse[] = []
  const server = createServer((req, res) => {
    const url = new URL(req.url ?? "/", "http://localhost")
    const send = (status: number, body: unknown) => {
      res.writeHead(status, { "Content-Type": "application/json" })
      res.end(JSON.stringify(body))
    }

    if (req.method === "GET" && url.pathname === "/global/event") {
      res.writeHead(200, {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        Connection: "keep-alive",
      })
      res.write(
        'data: {"directory":"/tmp","project":"global","payload":{"id":"evt_boot","type":"server.connected","properties":{}}}\n\n',
      )
      clients.push(res)
      req.on("close", () => {
        const i = clients.indexOf(res)
        if (i >= 0) clients.splice(i, 1)
      })
      return
    }

    if (req.method === "GET" && url.pathname === "/global/health") return send(200, { healthy: true, version: "test" })
    if (req.method === "GET" && url.pathname === "/session") return send(200, [sessionA])
    if (req.method === "GET" && url.pathname === "/session/status") return send(200, { [sessionA.id]: { type: "idle" } })
    if (req.method === "GET" && url.pathname === "/permission") return send(200, [])
    if (req.method === "GET" && url.pathname === "/question") return send(200, [])
    if (req.method === "GET" && url.pathname === `/session/${sessionA.id}/message`)
      return send(200, [
        {
          info: {
            id: "msg_int_1",
            sessionID: sessionA.id,
            role: "user",
            time: { created: 1 },
          },
          parts: [{ id: "prt_int_1", messageID: "msg_int_1", sessionID: sessionA.id, type: "text", text: "hello" }],
        },
      ])
    if (req.method === "POST" && url.pathname === `/session/${sessionA.id}/message`) {
      return send(200, {
        info: { id: "msg_int_2", sessionID: sessionA.id, role: "assistant", time: { created: 2 } },
        parts: [],
      })
    }
    if (req.method === "POST" && url.pathname === "/session") {
      const chunks: Buffer[] = []
      req.on("data", (c) => chunks.push(c))
      req.on("end", () => {
        const body = JSON.parse(Buffer.concat(chunks).toString() || "{}")
        return send(200, { ...sessionA, id: "ses_int_created", title: body.title ?? "created" })
      })
      return
    }
    send(404, { error: { name: "NotFound", data: { message: url.pathname } } })
  })

  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve))
  const address = server.address()
  if (address === null || typeof address === "string") throw new Error("no port")
  const port = address.port

  return {
    server,
    port,
    url: `http://127.0.0.1:${port}`,
    clients,
    sendEvent: (event) => {
      for (const client of clients) {
        client.write(
          `data: ${JSON.stringify({ directory: "/tmp", project: "global", payload: event })}\n\n`,
        )
      }
    },
    close: () =>
      new Promise<void>((resolve) => {
        for (const client of clients) client.end()
        server.close(() => resolve())
      }),
  }
}

describe("integration: real HTTP + SSE", () => {
  let mock: MockServer

  beforeAll(async () => {
    mock = await startMockServer()
  })

  afterAll(async () => {
    await mock.close()
  })

  it("connects, hydrates from REST, and applies live SSE events", async () => {
    const client = new OpenCodeClient({
      url: mock.url,
      autoConnect: false,
      minBackoffMs: 50,
      maxBackoffMs: 200,
      reconnect: false,
    })
    client.connect()

    await vi.waitFor(() => expect(client.store.state.connected).toBe(true), { timeout: 5000 })
    await vi.waitFor(
      () => expect(client.store.state.sessions.map((s) => s.id)).toContain("ses_int_a"),
      { timeout: 5000 },
    )
    await vi.waitFor(() => expect(client.store.state.status[sessionA.id]?.type).toBe("idle"), {
      timeout: 5000,
    })

    // live events over SSE
    mock.sendEvent({
      id: "evt_live_1",
      type: "session.status",
      properties: { sessionID: sessionA.id, status: { type: "busy" } },
    })
    await vi.waitFor(() => expect(client.store.state.status[sessionA.id]?.type).toBe("busy"))

    mock.sendEvent({
      id: "evt_live_2",
      type: "message.updated",
      properties: {
        sessionID: sessionA.id,
        info: { id: "msg_int_live", sessionID: sessionA.id, role: "assistant", time: { created: 3 } },
      },
    })
    await vi.waitFor(() =>
      expect(client.store.state.messages[sessionA.id]?.some((m) => m.id === "msg_int_live")).toBe(true),
    )

    // lazy message load over REST
    await client.loadMessages(sessionA.id)
    expect(client.store.state.messages[sessionA.id]?.some((m) => m.id === "msg_int_1")).toBe(true)
    expect(client.store.state.parts["msg_int_1"]?.[0]).toMatchObject({ text: "hello" })

    // actions over REST
    const created = await client.createSession({ title: "from test" })
    expect(created.id).toBe("ses_int_created")
    const reply = await client.prompt(sessionA.id, { parts: [{ type: "text", text: "ping" }] })
    expect(reply.info.id).toBe("msg_int_2")

    const health = await client.health()
    expect(health).toEqual({ healthy: true, version: "test" })

    client.disconnect()
    await vi.waitFor(() => expect(client.connected).toBe(false))
  }, 15000)
})
