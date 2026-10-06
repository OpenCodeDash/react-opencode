import { describe, expect, it } from "vitest"
import { Store, createInitialStoreState } from "../src/client/store"
import {
  makeEvent,
  makeMessage,
  makeSession,
  makeTextPart,
  makeToolPart,
  messageRemovedEvent,
  messageUpdatedEvent,
  partDeltaEvent,
  partRemovedEvent,
  partUpdatedEvent,
  sessionEvent,
} from "./fixtures"

describe("Store", () => {
  it("starts empty and disconnected", () => {
    const store = new Store(createInitialStoreState())
    expect(store.state.sessions).toEqual([])
    expect(store.state.connected).toBe(false)
  })

  it("notifies listeners on change", () => {
    const store = new Store()
    let calls = 0
    store.subscribe(() => calls++)
    store.upsertSession(makeSession())
    expect(calls).toBe(1)
    expect(store.state.version).toBe(1)
  })

  it("applies session.created and session.updated", () => {
    const store = new Store()
    const session = makeSession({ title: "before" })
    store.apply(sessionEvent("created", session))
    expect(store.state.sessions).toHaveLength(1)

    const updated = { ...session, title: "after" }
    store.apply(sessionEvent("updated", updated))
    expect(store.state.sessions).toHaveLength(1)
    expect(store.state.sessions[0]!.title).toBe("after")
  })

  it("sorts sessions by updated desc", () => {
    const store = new Store()
    const a = makeSession({ id: "ses_a", time: { created: 1, updated: 100 } })
    const b = makeSession({ id: "ses_b", time: { created: 2, updated: 200 } })
    store.apply(sessionEvent("created", a))
    store.apply(sessionEvent("created", b))
    expect(store.state.sessions.map((s) => s.id)).toEqual(["ses_b", "ses_a"])
  })

  it("session.deleted removes session, its messages and parts", () => {
    const store = new Store()
    const session = makeSession({ id: "ses_del" })
    const message = makeMessage(session.id)
    const part = makeTextPart(session.id, message.id, "hello")
    store.apply(sessionEvent("created", session))
    store.apply(messageUpdatedEvent(session.id, message))
    store.apply(partUpdatedEvent(part))

    store.apply(sessionEvent("deleted", session))
    expect(store.state.sessions).toHaveLength(0)
    expect(store.state.messages[session.id]).toBeUndefined()
    expect(store.state.parts[message.id]).toBeUndefined()
  })

  it("applies message.updated keeping time order", () => {
    const store = new Store()
    const sessionID = "ses_msg"
    const m2 = makeMessage(sessionID, { id: "msg_2", time: { created: 200 } })
    const m1 = makeMessage(sessionID, { id: "msg_1", time: { created: 100 } })
    store.apply(messageUpdatedEvent(sessionID, m2))
    store.apply(messageUpdatedEvent(sessionID, m1))
    expect(store.state.messages[sessionID]!.map((m) => m.id)).toEqual(["msg_1", "msg_2"])
  })

  it("message.removed deletes the message and its parts", () => {
    const store = new Store()
    const sessionID = "ses_rm"
    const message = makeMessage(sessionID, { id: "msg_rm" })
    const part = makeTextPart(sessionID, message.id, "x")
    store.apply(messageUpdatedEvent(sessionID, message))
    store.apply(partUpdatedEvent(part))

    store.apply(messageRemovedEvent(sessionID, message.id))
    expect(store.state.messages[sessionID]!).toHaveLength(0)
    expect(store.state.parts[message.id]).toBeUndefined()
  })

  it("applies message.part.updated streaming deltas in place", () => {
    const store = new Store()
    const sessionID = "ses_stream"
    const message = makeMessage(sessionID, { id: "msg_stream", role: "assistant" })
    const part = makeTextPart(sessionID, message.id, "Hel")
    store.apply(messageUpdatedEvent(sessionID, message))
    store.apply(partUpdatedEvent(part))
    expect(store.state.parts[message.id]![0]!.text).toBe("Hel")

    const streamed = { ...part, text: "Hello" }
    store.apply(partUpdatedEvent(streamed))
    expect(store.state.parts[message.id]!).toHaveLength(1)
    expect(store.state.parts[message.id]![0]!.text).toBe("Hello")
  })

  it("appends message.part.delta deltas to an existing part", () => {
    const store = new Store()
    const sessionID = "ses_delta"
    const message = makeMessage(sessionID, { id: "msg_delta", role: "assistant" })
    const part = makeTextPart(sessionID, message.id, "")
    store.apply(messageUpdatedEvent(sessionID, message))
    store.apply(partUpdatedEvent(part))
    expect(store.state.parts[message.id]![0]!.text).toBe("")

    store.apply(partDeltaEvent(part, "text", "Hel"))
    store.apply(partDeltaEvent(part, "text", "lo"))
    expect(store.state.parts[message.id]![0]!.text).toBe("Hello")

    // The final full update replaces the part, so accumulated deltas are not doubled.
    store.apply(partUpdatedEvent({ ...part, text: "Hello" }))
    expect(store.state.parts[message.id]!).toHaveLength(1)
    expect(store.state.parts[message.id]![0]!.text).toBe("Hello")
  })

  it("ignores message.part.delta for unknown parts or non-string fields", () => {
    const store = new Store()
    const sessionID = "ses_delta_orphan"
    const message = makeMessage(sessionID, { id: "msg_delta_orphan", role: "assistant" })
    const part = makeTextPart(sessionID, message.id, "")

    // Delta before the part exists is dropped.
    store.apply(partDeltaEvent(part, "text", "orphan"))
    expect(store.state.parts[message.id]).toBeUndefined()

    store.apply(messageUpdatedEvent(sessionID, message))
    store.apply(partUpdatedEvent(part))
    const version = store.state.version
    store.apply(partDeltaEvent(part, "state", "nope"))
    expect(store.state.version).toBe(version)
    expect(store.state.parts[message.id]![0]!.text).toBe("")
  })

  it("rejects a non-string message.part.delta without corrupting the part", () => {
    const store = new Store()
    const sessionID = "ses_delta_bad"
    const message = makeMessage(sessionID, { id: "msg_delta_bad", role: "assistant" })
    const part = makeTextPart(sessionID, message.id, "Hi")
    store.apply(messageUpdatedEvent(sessionID, message))
    store.apply(partUpdatedEvent(part))

    const malformed = (delta: unknown) =>
      makeEvent("message.part.delta", {
        sessionID,
        messageID: message.id,
        partID: part.id,
        field: "text",
        delta,
      })
    store.apply(malformed(undefined))
    store.apply(malformed({ text: "x" }))
    expect(store.state.parts[message.id]![0]!.text).toBe("Hi")
  })

  it("applies message.part.removed", () => {
    const store = new Store()
    const sessionID = "ses_prm"
    const message = makeMessage(sessionID)
    const part = makeTextPart(sessionID, message.id, "gone")
    store.apply(messageUpdatedEvent(sessionID, message))
    store.apply(partUpdatedEvent(part))
    store.apply(partRemovedEvent(part))
    expect(store.state.parts[message.id]!).toHaveLength(0)
  })

  it("tracks tool part state transitions", () => {
    const store = new Store()
    const sessionID = "ses_tool"
    const message = makeMessage(sessionID, { id: "msg_tool", role: "assistant" })
    const running = makeToolPart(sessionID, message.id, { state: { status: "running", input: { command: "ls" }, time: { start: 1 } } })
    store.apply(messageUpdatedEvent(sessionID, message))
    store.apply(partUpdatedEvent(running))
    expect((store.state.parts[message.id]![0] as { state: { status: string } }).state.status).toBe("running")

    const completed: ToolPart = {
      ...running,
      state: {
        status: "completed",
        input: { command: "ls" },
        output: "file.txt",
        title: "ls",
        metadata: {},
        time: { start: 1, end: 2 },
      },
    }
    store.apply(partUpdatedEvent(completed))
    expect(store.state.parts[message.id]!).toHaveLength(1)
    expect((store.state.parts[message.id]![0] as { state: { status: string } }).state.status).toBe("completed")
  })

  it("applies todo.updated", () => {
    const store = new Store()
    store.apply(
      makeEvent("todo.updated", {
        sessionID: "ses_todo",
        todos: [{ content: "task", status: "in_progress", priority: "high" }],
      }),
    )
    expect(store.state.todos["ses_todo"]).toHaveLength(1)
  })

  it("applies permission.asked and permission.replied", () => {
    const store = new Store()
    store.apply(
      makeEvent("permission.asked", {
        id: "per_1",
        sessionID: "ses_per",
        permission: "bash",
        patterns: ["ls"],
        metadata: {},
        always: ["*"],
        tool: { messageID: "msg_1", callID: "call_1" },
      }),
    )
    expect(store.state.permissions).toHaveLength(1)

    store.apply(makeEvent("permission.replied", { sessionID: "ses_per", requestID: "per_1", response: "once" }))
    expect(store.state.permissions).toHaveLength(0)
  })

  it("applies question.asked and question.rejected", () => {
    const store = new Store()
    store.apply(
      makeEvent("question.asked", {
        id: "que_1",
        sessionID: "ses_que",
        questions: [{ question: "Q?", header: "q", options: [{ label: "a" }] }],
      }),
    )
    expect(store.state.questions).toHaveLength(1)

    store.apply(makeEvent("question.rejected", { sessionID: "ses_que", requestID: "que_1" }))
    expect(store.state.questions).toHaveLength(0)
  })

  it("applies session.status and session.idle", () => {
    const store = new Store()
    store.apply(makeEvent("session.status", { sessionID: "ses_st", status: { type: "busy" } }))
    expect(store.state.status["ses_st"]?.type).toBe("busy")
    store.apply(makeEvent("session.idle", { sessionID: "ses_st" }))
    expect(store.state.status["ses_st"]).toBeUndefined()
  })

  it("applies vcs.branch.updated", () => {
    const store = new Store()
    store.apply(makeEvent("vcs.branch.updated", { branch: "main" }))
    expect(store.state.vcs.branch).toBe("main")
  })

  it("ignores unknown events without crashing", () => {
    const store = new Store()
    const before = store.state.version
    store.apply(makeEvent("unknown.event", {}))
    expect(store.state.version).toBe(before)
  })

  it("setMessages replaces a session's message history", () => {
    const store = new Store()
    const sessionID = "ses_hist"
    const m1 = makeMessage(sessionID, { id: "msg_h1", time: { created: 1 } })
    const m2 = makeMessage(sessionID, { id: "msg_h2", time: { created: 2 } })
    store.setMessages(sessionID, [
      { info: m1, parts: [makeTextPart(sessionID, m1.id, "a")] },
      { info: m2, parts: [] },
    ])
    expect(store.state.messages[sessionID]!.map((m) => m.id)).toEqual(["msg_h1", "msg_h2"])
    expect(store.state.parts["msg_h1"]).toHaveLength(1)
    expect(store.state.parts["msg_h2"]).toHaveLength(0)
  })

  it("keeps stable references for unchanged slices", () => {
    const store = new Store()
    const s1 = makeSession({ id: "ses_s1" })
    store.apply(sessionEvent("created", s1))
    const sessionsBefore = store.state.sessions
    const messagesBefore = store.state.messages

    store.apply(makeEvent("todo.updated", { sessionID: "ses_x", todos: [] }))
    expect(store.state.sessions).toBe(sessionsBefore)
    expect(store.state.messages).toBe(messagesBefore)
  })
})
