import { createServer, type Server, type ServerResponse } from "node:http"

const demoSession = {
  id: "ses_mock_1",
  projectID: "prj_mock",
  directory: "/tmp",
  title: "Demo",
  time: { created: 1, updated: 2 },
}

interface MockOpencode {
  url: string
  close: () => Promise<void>
  requests: Array<{ method: string; path: string }>
}

function later(fn: () => void, ms: number) {
  const t = setTimeout(fn, ms)
  return t
}

export async function startMockOpencode(): Promise<MockOpencode> {
  const clients: ServerResponse[] = []
  const timers: NodeJS.Timeout[] = []
  const requests: Array<{ method: string; path: string }> = []
  const createdSessions = new Map<string, unknown>([[demoSession.id, demoSession]])

  function sendEvent(event: unknown) {
    // The real server wraps every event on /global/event in a GlobalEvent, so
    // mirror that shape: the client unwraps `payload` before applying it.
    const frame = { directory: "/tmp", project: "prj_mock", payload: event }
    for (const c of clients) c.write(`data: ${JSON.stringify(frame)}\n\n`)
  }

  function scriptPrompt(sessionID: string, userText: string) {
    const userMsgID = "msg_mock_user"
    const userPartID = "prt_mock_user"
    const msgID = "msg_mock_100"
    const partID = "prt_mock_100"
    timers.push(
      later(() => {
        sendEvent({
          id: "evt_busy",
          type: "session.status",
          properties: { sessionID, status: { type: "busy" } },
        })
      }, 30),
    )
    timers.push(
      later(() => {
        sendEvent({
          id: "evt_user_msg",
          type: "message.updated",
          properties: {
            sessionID,
            info: { id: userMsgID, sessionID, role: "user", time: { created: Date.now() } },
          },
        })
      }, 60),
    )
    timers.push(
      later(() => {
        sendEvent({
          id: "evt_user_part",
          type: "message.part.updated",
          properties: {
            sessionID,
            part: { id: userPartID, messageID: userMsgID, sessionID, type: "text", text: userText },
          },
        })
      }, 80),
    )
    timers.push(
      later(() => {
        sendEvent({
          id: "evt_msg",
          type: "message.updated",
          properties: {
            sessionID,
            info: { id: msgID, sessionID, role: "assistant", time: { created: Date.now() } },
          },
        })
      }, 120),
    )
    timers.push(
      later(() => {
        sendEvent({
          id: "evt_part1",
          type: "message.part.updated",
          properties: {
            sessionID,
            part: { id: partID, messageID: msgID, sessionID, type: "text", text: "Hel" },
          },
        })
      }, 300),
    )
    timers.push(
      later(() => {
        sendEvent({
          id: "evt_part2",
          type: "message.part.updated",
          properties: {
            sessionID,
            part: {
              id: partID,
              messageID: msgID,
              sessionID,
              type: "text",
              text: "Hello from the opencode mock server!",
            },
          },
        })
      }, 600),
    )
    timers.push(
      later(() => {
        sendEvent({
          id: "evt_perm",
          type: "permission.asked",
          properties: {
            id: "per_mock_1",
            sessionID,
            permission: "bash",
            patterns: ["ls"],
            metadata: {},
            always: ["*"],
            tool: { messageID: msgID, callID: "call_1" },
          },
        })
      }, 900),
    )
  }

  const server: Server = createServer((req, res) => {
    const url = new URL(req.url ?? "/", "http://localhost")
    requests.push({ method: req.method ?? "GET", path: url.pathname })
    res.setHeader("Access-Control-Allow-Origin", "*")
    res.setHeader("Access-Control-Allow-Methods", "GET, POST, PUT, PATCH, DELETE, OPTIONS")
    res.setHeader("Access-Control-Allow-Headers", "content-type")
    if (req.method === "OPTIONS") {
      res.writeHead(204)
      res.end()
      return
    }
    const send = (status: number, body: unknown) => {
      res.writeHead(status, { "Content-Type": "application/json" })
      res.end(JSON.stringify(body))
    }
    let chunks: Buffer[] = []
    req.on("data", (c) => chunks.push(c))

    if (req.method === "GET" && url.pathname === "/global/event") {
      res.writeHead(200, { "Content-Type": "text/event-stream", "Cache-Control": "no-cache", "Access-Control-Allow-Origin": "*" })
      res.write(
        `data: ${JSON.stringify({ directory: "/tmp", project: "prj_mock", payload: { id: "evt_boot", type: "server.connected", properties: {} } })}\n\n`,
      )
      clients.push(res)
      res.on("close", () => {
        const i = clients.indexOf(res)
        if (i >= 0) clients.splice(i, 1)
      })
      return
    }

    if (req.method === "GET" && url.pathname === "/global/health") {
      return send(200, { healthy: true, version: "mock-1.0" })
    }
    if (req.method === "GET" && url.pathname === "/session") {
      return send(200, [...createdSessions.values()])
    }
    if (req.method === "GET" && url.pathname === "/session/status") return send(200, {})
    if (req.method === "GET" && url.pathname === "/permission") return send(200, [])
    if (req.method === "GET" && url.pathname === "/question") return send(200, [])
    if (req.method === "GET" && /\/session\/[^/]+\/message$/.test(url.pathname)) {
      return send(200, [])
    }

    if (req.method === "POST" && /\/session\/[^/]+\/message$/.test(url.pathname)) {
      req.on("end", () => {
        const sessionID = url.pathname.split("/")[2]!
        const body = JSON.parse(Buffer.concat(chunks).toString() || "{}")
        const userText = Array.isArray(body.parts)
          ? body.parts.find((p: { type?: string }) => p.type === "text")?.text ?? ""
          : ""
        scriptPrompt(sessionID, userText)
        send(200, {
          info: { id: "msg_mock_100", sessionID, role: "assistant", time: { created: Date.now() } },
          parts: [],
        })
      })
      return
    }

    if (req.method === "POST" && url.pathname === "/session") {
      req.on("end", () => {
        const body = JSON.parse(Buffer.concat(chunks).toString() || "{}")
        const id = `ses_mock_${createdSessions.size + 1}`
        const session = {
          id,
          projectID: "prj_mock",
          directory: "/tmp",
          title: body.title ?? "untitled",
          time: { created: Date.now(), updated: Date.now() },
        }
        createdSessions.set(id, session)
        sendEvent({
          id: `evt_created_${id}`,
          type: "session.created",
          properties: { sessionID: id, info: session },
        })
        send(200, session)
      })
      return
    }

    const deleteMatch = url.pathname.match(/^\/session\/([^/]+)$/)
    if (req.method === "DELETE" && deleteMatch) {
      const id = deleteMatch[1]!
      if (createdSessions.delete(id)) {
        sendEvent({
          id: `evt_deleted_${id}`,
          type: "session.deleted",
          properties: { sessionID: id, info: { id } },
        })
      }
      return send(200, null)
    }

    if (req.method === "POST" && /\/permission\/[^/]+\/reply$/.test(url.pathname)) {
      const id = url.pathname.split("/")[2]!
      const sessionID = "ses_mock_1"
      sendEvent({
        id: `evt_replied_${id}`,
        type: "permission.replied",
        properties: { sessionID, requestID: id, response: "once" },
      })
      sendEvent({
        id: `evt_idle_${id}`,
        type: "session.idle",
        properties: { sessionID },
      })
      return send(200, null)
    }

    send(404, { error: { name: "NotFound", data: { message: url.pathname } } })
  })

  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve))
  const address = server.address()
  if (address === null || typeof address === "string") throw new Error("no port")

  return {
    url: `http://127.0.0.1:${address.port}`,
    requests,
    close: () =>
      new Promise<void>((resolve) => {
        for (const t of timers) clearTimeout(t)
        for (const c of clients) c.end()
        server.close(() => resolve())
        server.closeAllConnections()
      }),
  }
}
