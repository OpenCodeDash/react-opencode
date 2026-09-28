// @vitest-environment jsdom
import { act, renderHook } from "@testing-library/react"
import { describe, expect, it } from "vitest"
import { createElement, type ReactNode } from "react"
import {
  OpenCodeClient,
  OpenCodeProvider,
  useConnected,
  useFileStatus,
  useMcp,
  useMessageParts,
  useMessages,
  usePermissions,
  usePrompt,
  useQuestions,
  useSession,
  useSessionBusy,
  useSessionStatus,
  useSessions,
  useTodos,
} from "../src"
import { makeMessage, makeSession, makeTextPart, makeToolPart, partUpdatedEvent, messageUpdatedEvent, sessionEvent } from "./fixtures"

function wrapper(client: OpenCodeClient) {
  return ({ children }: { children: ReactNode }) =>
    createElement(OpenCodeProvider, { client }, children)
}

function makeTestClient() {
  const fetchImpl = (async () => new Response("{}", { status: 200 })) as typeof fetch
  return new OpenCodeClient({ url: "http://fake", fetchImpl, autoConnect: false })
}

describe("useSessions", () => {
  it("starts empty and updates live from events", () => {
    const client = makeTestClient()
    const { result } = renderHook(() => useSessions(), { wrapper: wrapper(client) })
    expect(result.current).toEqual([])

    const session = makeSession({ title: "live" })
    act(() => client.store.apply(sessionEvent("created", session)))
    expect(result.current).toHaveLength(1)
    expect(result.current[0]!.title).toBe("live")

    const renamed = { ...session, title: "live-2" }
    act(() => client.store.apply(sessionEvent("updated", renamed)))
    expect(result.current).toHaveLength(1)
    expect(result.current[0]!.title).toBe("live-2")
  })
})

describe("useSession / useSessionStatus", () => {
  it("tracks a single session and its status", () => {
    const client = makeTestClient()
    const session = makeSession({ id: "ses_hook" })
    client.store.apply(sessionEvent("created", session))

    const { result } = renderHook(
      () => ({
        session: useSession("ses_hook"),
        status: useSessionStatus("ses_hook"),
        busy: useSessionBusy("ses_hook"),
      }),
      { wrapper: wrapper(client) },
    )
    expect(result.current.session?.id).toBe("ses_hook")
    expect(result.current.busy).toBe(false)

    act(() => client.store.setStatus("ses_hook", { type: "busy" }))
    expect(result.current.busy).toBe(true)

    act(() => client.store.clearStatus("ses_hook"))
    expect(result.current.busy).toBe(false)
  })
})

describe("useMessages / useMessageParts", () => {
  it("loads messages on demand and streams parts", async () => {
    const client = makeTestClient()
    const session = makeSession({ id: "ses_msgs" })
    client.store.apply(sessionEvent("created", session))
    const message = makeMessage("ses_msgs", { id: "msg_hook", role: "assistant" })
    const part = makeTextPart("ses_msgs", message.id, "typing...")
    client.store.setMessages("ses_msgs", [{ info: message, parts: [part] }])

    const { result } = renderHook(() => useMessages("ses_msgs"), { wrapper: wrapper(client) })
    expect(result.current).toHaveLength(1)

    const partHook = renderHook(() => useMessageParts("msg_hook"), { wrapper: wrapper(client) })
    expect(partHook.result.current).toHaveLength(1)

    const streamed = { ...part, text: "typed!" }
    act(() => client.store.apply(partUpdatedEvent(streamed)))
    expect(partHook.result.current[0]).toMatchObject({ text: "typed!" })
  })

  it("returns empty array for unknown session without crashing", () => {
    const client = makeTestClient()
    const { result } = renderHook(() => useMessages(undefined), { wrapper: wrapper(client) })
    expect(result.current).toEqual([])
  })
})

describe("useTodos / usePermissions / useQuestions", () => {
  it("reflects live store updates", () => {
    const client = makeTestClient()
    const { result } = renderHook(
      () => ({
        todos: useTodos("ses_t"),
        permissions: usePermissions(),
        questions: useQuestions(),
      }),
      { wrapper: wrapper(client) },
    )
    expect(result.current.todos).toEqual([])

    act(() =>
      client.store.apply({
        id: "evt_t",
        type: "todo.updated",
        properties: { sessionID: "ses_t", todos: [{ content: "a", status: "pending", priority: "low" }] },
      }),
    )
    expect(result.current.todos).toHaveLength(1)

    act(() =>
      client.store.apply({
        id: "evt_p",
        type: "permission.asked",
        properties: {
          id: "per_h",
          sessionID: "ses_t",
          permission: "bash",
          patterns: [],
          metadata: {},
          always: [],
          tool: { messageID: "m", callID: "c" },
        },
      }),
    )
    expect(result.current.permissions).toHaveLength(1)

    act(() =>
      client.store.apply({
        id: "evt_q",
        type: "question.asked",
        properties: {
          id: "que_h",
          sessionID: "ses_t",
          questions: [{ question: "q?", header: "h", options: [{ label: "yes" }] }],
        },
      }),
    )
    expect(result.current.questions).toHaveLength(1)

    act(() =>
      client.store.apply({
        id: "evt_q2",
        type: "question.replied",
        properties: { sessionID: "ses_t", requestID: "que_h", answers: [["yes"]] },
      }),
    )
    expect(result.current.questions).toHaveLength(0)
  })
})

describe("usePrompt", () => {
  it("reports busy from session status and calls client.prompt", async () => {
    const client = makeTestClient()
    let promptCalls: unknown[] = []
    const origPrompt = client.prompt.bind(client)
    client.prompt = ((id: string, input: unknown) => {
      promptCalls.push({ id, input })
      return origPrompt(id, input as never)
    }) as typeof client.prompt
    const { result } = renderHook(() => usePrompt("ses_p"), { wrapper: wrapper(client) })
    expect(result.current.busy).toBe(false)

    act(() => client.store.setStatus("ses_p", { type: "busy" }))
    expect(result.current.busy).toBe(true)

    await act(async () => {
      await result.current.prompt({ parts: [{ type: "text", text: "hi" }] })
    })
    expect(promptCalls).toEqual([{ id: "ses_p", input: { parts: [{ type: "text", text: "hi" }] } }])
  })
})

describe("useConnected", () => {
  it("tracks connection state", () => {
    const client = makeTestClient()
    const { result } = renderHook(() => useConnected(), { wrapper: wrapper(client) })
    expect(result.current).toBe(false)
    act(() => client.store.setConnected(true))
    expect(result.current).toBe(true)
  })
})

describe("environment hooks: empty-result fetch", () => {
  it("useFileStatus fetches once even when the result is empty (no ref-loop)", async () => {
    const client = makeTestClient()
    let calls = 0
    client.fileStatus = (() => {
      calls++
      return Promise.resolve([])
    }) as typeof client.fileStatus

    const { result } = renderHook(() => useFileStatus(), { wrapper: wrapper(client) })

    // Settle: run the mount effect, resolve the promise, commit to the store,
    // re-render from the emitted version bump, and any effect re-runs.
    for (let i = 0; i < 4; i++) await act(async () => await Promise.resolve())

    expect(result.current).toEqual([])
    expect(calls).toBe(1)
  })

  it("useMcp fetches once even when the result is empty (no ref-loop)", async () => {
    const client = makeTestClient()
    let calls = 0
    client.mcpStatus = (() => {
      calls++
      return Promise.resolve({})
    }) as typeof client.mcpStatus

    const { result } = renderHook(() => useMcp(), { wrapper: wrapper(client) })

    for (let i = 0; i < 4; i++) await act(async () => await Promise.resolve())

    expect(result.current).toEqual({})
    expect(calls).toBe(1)
  })
})
