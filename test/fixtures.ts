import type { EventEnvelope, Message, Part, Session, ToolPart } from "../src/types"

let counter = 0
const next = () => `t${++counter}`

export function makeSession(overrides: Partial<Session> = {}): Session {
  return {
    id: `ses_${next()}`,
    projectID: "prj_test",
    directory: "/tmp",
    title: "Test session",
    time: { created: Date.now(), updated: Date.now() },
    ...overrides,
  }
}

export function makeMessage(sessionID: string, overrides: Partial<Message> = {}): Message {
  return {
    id: `msg_${next()}`,
    sessionID,
    role: "user",
    time: { created: Date.now() },
    ...overrides,
  } as Message
}

export function makeTextPart(
  sessionID: string,
  messageID: string,
  text: string,
  overrides: Partial<Part> = {},
): Part {
  return {
    id: `prt_${next()}`,
    messageID,
    sessionID,
    type: "text",
    text,
    ...overrides,
  } as Part
}

export function makeToolPart(sessionID: string, messageID: string, overrides: Partial<ToolPart> = {}): ToolPart {
  return {
    id: `prt_${next()}`,
    messageID,
    sessionID,
    type: "tool",
    tool: "bash",
    callID: `call_${next()}`,
    state: { status: "running", input: { command: "ls" }, time: { start: Date.now() } },
    ...overrides,
  } as ToolPart
}

export function makeEvent(type: string, properties: Record<string, unknown>): EventEnvelope {
  return { id: `evt_${next()}`, type, properties }
}

export function sessionEvent(
  type: "created" | "updated" | "deleted",
  session: Session,
): EventEnvelope {
  return makeEvent(`session.${type}`, { sessionID: session.id, info: session })
}

export function messageUpdatedEvent(sessionID: string, message: Message): EventEnvelope {
  return makeEvent("message.updated", { sessionID, info: message })
}

export function messageRemovedEvent(sessionID: string, messageID: string): EventEnvelope {
  return makeEvent("message.removed", { sessionID, messageID })
}

export function partUpdatedEvent(part: Part): EventEnvelope {
  return makeEvent("message.part.updated", { sessionID: part.sessionID, part })
}

export function partDeltaEvent(part: Part, field: string, delta: string): EventEnvelope {
  return makeEvent("message.part.delta", {
    sessionID: part.sessionID,
    messageID: part.messageID,
    partID: part.id,
    field,
    delta,
  })
}

export function partRemovedEvent(part: Part): EventEnvelope {
  return makeEvent("message.part.removed", {
    sessionID: part.sessionID,
    messageID: part.messageID,
    partID: part.id,
  })
}
