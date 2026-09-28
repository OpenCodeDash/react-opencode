import { useEffect, useState } from "react"
import {
  useConnected,
  useMessageParts,
  useMessages,
  useOpenCode,
  usePermissions,
  useSessionBusy,
  useSessionStatus,
  useSessions,
  type Message,
} from "react-opencode"

function MessageView({ message }: { message: Message }) {
  const parts = useMessageParts(message.id)
  const text = parts
    .filter((p) => p.type === "text")
    .map((p) => (p as { text: string }).text)
    .join("")
  const tools = parts.filter((p) => p.type === "tool")
  return (
    <div className={`msg ${message.role}`} data-testid="message">
      <div className="role">{message.role}</div>
      {text && <span data-testid="message-text">{text}</span>}
      {tools.map((t) => (
        <div key={(t as { id: string }).id} data-testid="tool">
          {(t as { tool: string }).tool}:{(t as { state: { status: string } }).state.status}
        </div>
      ))}
    </div>
  )
}

function Chat() {
  const client = useOpenCode()
  const connected = useConnected()
  const sessions = useSessions()
  const [activeId, setActiveId] = useState<string | undefined>()
  const [input, setInput] = useState("")
  const [version, setVersion] = useState("")
  const messages = useMessages(activeId)
  const status = useSessionStatus(activeId)
  const busy = useSessionBusy(activeId)
  const permissions = usePermissions()

  useEffect(() => {
    client
      .health()
      .then((h) => setVersion(h.version))
      .catch((e) => {
        console.log("HEALTH ERR", e)
        setVersion("unreachable")
      })
  }, [client])

  useEffect(() => {
    if (!activeId && sessions.length > 0) setActiveId(sessions[0]!.id)
    if (activeId && !sessions.some((s) => s.id === activeId)) {
      setActiveId(sessions[0]?.id)
    }
  }, [sessions, activeId])

  async function send() {
    if (!activeId || !input.trim()) return
    const text = input
    setInput("")
    await client.prompt(activeId, { parts: [{ type: "text", text }] })
  }

  return (
    <div id="app">
      <div className="row">
        <span className={connected ? "badge on" : "badge off"} id="status">
          {connected ? "connected" : "disconnected"}
        </span>
        <span id="version">v{version}</span>
        <span style={{ flex: 1 }} />
        <button id="new-session" onClick={() => client.createSession({ title: "Created via e2e" })}>
          New session
        </button>
      </div>

      <ul id="sessions">
        {sessions.map((s) => (
          <li key={s.id} className={s.id === activeId ? "active" : ""} onClick={() => setActiveId(s.id)}>
            <span data-testid="session-title">{s.title ?? s.id}</span>
            <button
              aria-label="delete"
              onClick={(e) => {
                e.stopPropagation()
                void client.deleteSession(s.id)
              }}
            >
              ✕
            </button>
          </li>
        ))}
      </ul>

      <div id="messages">
        {messages.map((m) => (
          <MessageView key={m.id} message={m} />
        ))}
      </div>

      {permissions.map((p) => (
        <div className="permission" key={p.id}>
          <span>
            allow {p.permission} for {p.patterns.join(", ") || "*"}?
          </span>
          <button id={`permission-${p.id}`} onClick={() => client.replyPermission(p.id, "once")}>
            Allow once
          </button>
        </div>
      ))}

      {busy && <div id="busy">working… (status: {status?.type})</div>}

      <div className="row">
        <input
          id="input"
          value={input}
          placeholder="send a prompt…"
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") void send()
          }}
        />
        <button id="send" onClick={() => void send()}>
          Send
        </button>
      </div>
    </div>
  )
}

export { Chat }
