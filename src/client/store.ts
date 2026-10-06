import type {
  AgentInfo,
  CommandInfo,
  EventEnvelope,
  FileStatusEntry,
  KnownEventMap,
  LspServer,
  McpServerStatus,
  Message,
  MessageID,
  Part,
  PartID,
  PermissionRequest,
  ProviderInfo,
  QuestionRequest,
  Session,
  SessionID,
  SessionStatus,
  SessionStatusType,
  Todo,
  VcsFileStatus,
} from "../types"

export interface VcsState {
  branch: string | null
  files: VcsFileStatus[]
}

export interface StoreState {
  connected: boolean
  sessions: Session[]
  messages: Record<SessionID, Message[]>
  parts: Record<MessageID, Part[]>
  todos: Record<SessionID, Todo[]>
  permissions: PermissionRequest[]
  questions: QuestionRequest[]
  status: Record<SessionID, SessionStatus>
  fileStatus: Record<string, FileStatusEntry>
  lsp: LspServer[]
  mcp: Record<string, McpServerStatus>
  vcs: VcsState
  agents: AgentInfo[]
  commands: CommandInfo[]
  providers: ProviderInfo[]
  config: unknown
  version: number
}

export type StoreListener = () => void

export function createInitialStoreState(): StoreState {
  return {
    connected: false,
    sessions: [],
    messages: {},
    parts: {},
    todos: {},
    permissions: [],
    questions: [],
    status: {},
    fileStatus: {},
    lsp: [],
    mcp: {},
    vcs: { branch: null, files: [] },
    agents: [],
    commands: [],
    providers: [],
    config: null,
    version: 0,
  }
}

function compareSessions(a: Session, b: Session): number {
  return b.time.updated - a.time.updated
}

export class Store {
  state: StoreState

  private listeners = new Set<StoreListener>()
  private sessionIndex = new Map<SessionID, Session>()
  private messageIndex = new Map<SessionID, Map<MessageID, Message>>()
  private partIndex = new Map<MessageID, Map<PartID, Part>>()
  private todoIndex = new Map<SessionID, Todo[]>()
  private permissionIndex = new Map<string, PermissionRequest>()
  private questionIndex = new Map<string, QuestionRequest>()
  private statusIndex = new Map<SessionID, SessionStatus>()
  private fileStatusIndex = new Map<string, FileStatusEntry>()
  private lspList: LspServer[] | null = null
  private mcpMap: Record<string, McpServerStatus> | null = null
  private vcsBranch: string | null = null
  private vcsFiles: VcsFileStatus[] | null = null
  private agentsList: AgentInfo[] | null = null
  private commandsList: CommandInfo[] | null = null
  private providersList: ProviderInfo[] | null = null
  private configValue: unknown = null

  constructor(initial?: StoreState) {
    this.state = initial ?? createInitialStoreState()
  }

  subscribe = (listener: StoreListener): (() => void) => {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  getSnapshot = (): StoreState => this.state

  private emit(): void {
    for (const listener of this.listeners) listener()
  }

  private commit(patch: Partial<StoreState>): void {
    this.state = { ...this.state, ...patch, version: this.state.version + 1 }
    this.emit()
  }

  setConnected(connected: boolean): void {
    if (this.state.connected === connected) return
    this.commit({ connected })
  }

  private rebuildSessions(): Session[] {
    return [...this.sessionIndex.values()].sort(compareSessions)
  }

  upsertSession(session: Session): void {
    this.sessionIndex.set(session.id, session)
    this.commit({ sessions: this.rebuildSessions() })
  }

  removeSession(id: SessionID): void {
    if (!this.sessionIndex.delete(id)) return
    const previous = this.state.messages[id] ?? []
    const messages = { ...this.state.messages }
    const todos = { ...this.state.todos }
    const status = { ...this.state.status }
    delete messages[id]
    delete todos[id]
    delete status[id]
    this.messageIndex.delete(id)
    this.todoIndex.delete(id)
    this.statusIndex.delete(id)
    const parts: Record<MessageID, Part[]> = { ...this.state.parts }
    for (const message of previous) {
      delete parts[message.id]
      this.partIndex.delete(message.id)
    }
    this.commit({
      sessions: this.rebuildSessions(),
      messages,
      parts,
      todos,
      status,
    })
  }

  setSessions(sessions: Session[]): void {
    for (const session of sessions) this.sessionIndex.set(session.id, session)
    this.commit({ sessions: this.rebuildSessions() })
  }

  private rebuildMessages(sessionID: SessionID): Message[] {
    const map = this.messageIndex.get(sessionID)
    if (!map) return []
    return [...map.values()].sort((a, b) => a.time.created - b.time.created)
  }

  upsertMessage(message: Message): void {
    let map = this.messageIndex.get(message.sessionID)
    if (!map) {
      map = new Map()
      this.messageIndex.set(message.sessionID, map)
    }
    map.set(message.id, message)
    this.commit({
      messages: { ...this.state.messages, [message.sessionID]: this.rebuildMessages(message.sessionID) },
    })
  }

  removeMessage(sessionID: SessionID, messageID: MessageID): void {
    const map = this.messageIndex.get(sessionID)
    if (!map || !map.delete(messageID)) return
    const parts = { ...this.state.parts }
    delete parts[messageID]
    this.partIndex.delete(messageID)
    this.commit({
      messages: { ...this.state.messages, [sessionID]: this.rebuildMessages(sessionID) },
      parts,
    })
  }

  setMessages(sessionID: SessionID, entries: Array<{ info: Message; parts: Part[] }>): void {
    let map = this.messageIndex.get(sessionID)
    if (!map) {
      map = new Map()
      this.messageIndex.set(sessionID, map)
    }
    for (const entry of entries) {
      map.set(entry.info.id, entry.info)
      const partMap = new Map<PartID, Part>()
      for (const part of entry.parts) partMap.set(part.id, part)
      this.partIndex.set(entry.info.id, partMap)
    }
    const parts: Record<MessageID, Part[]> = { ...this.state.parts }
    for (const entry of entries) {
      parts[entry.info.id] = [...this.partIndex.get(entry.info.id)!.values()]
    }
    this.commit({
      messages: { ...this.state.messages, [sessionID]: this.rebuildMessages(sessionID) },
      parts,
    })
  }

  private rebuildParts(messageID: MessageID): Part[] {
    const map = this.partIndex.get(messageID)
    if (!map) return []
    return [...map.values()]
  }

  upsertPart(part: Part): void {
    let map = this.partIndex.get(part.messageID)
    if (!map) {
      map = new Map()
      this.partIndex.set(part.messageID, map)
    }
    map.set(part.id, part)
    this.commit({
      parts: { ...this.state.parts, [part.messageID]: this.rebuildParts(part.messageID) },
    })
  }

  removePart(messageID: MessageID, partID: PartID): void {
    const map = this.partIndex.get(messageID)
    if (!map || !map.delete(partID)) return
    this.commit({
      parts: { ...this.state.parts, [messageID]: this.rebuildParts(messageID) },
    })
  }

  /**
   * Append a streamed delta to a field of an existing part. The server sends
   * streamed text/reasoning as `message.part.delta` events (the full part only
   * arrives once at creation and once at completion), so without this the part
   * would appear empty until the response finished. Unknown parts/fields are
   * ignored; the eventual `message.part.updated` carries the full content.
   */
  appendPartDelta(messageID: MessageID, partID: PartID, field: string, delta: string): void {
    const map = this.partIndex.get(messageID)
    if (!map) return
    const part = map.get(partID)
    if (!part) return
    const current = (part as unknown as Record<string, unknown>)[field]
    if (typeof current !== "string") return
    map.set(partID, { ...part, [field]: current + delta } as Part)
    this.commit({
      parts: { ...this.state.parts, [messageID]: this.rebuildParts(messageID) },
    })
  }

  setTodos(sessionID: SessionID, todos: Todo[]): void {
    this.todoIndex.set(sessionID, todos)
    this.commit({ todos: { ...this.state.todos, [sessionID]: todos } })
  }

  setPermissions(permissions: PermissionRequest[]): void {
    this.permissionIndex = new Map(permissions.map((p) => [p.id, p]))
    this.commit({ permissions: [...this.permissionIndex.values()] })
  }

  upsertPermission(request: PermissionRequest): void {
    this.permissionIndex.set(request.id, request)
    this.commit({ permissions: [...this.permissionIndex.values()] })
  }

  removePermission(id: string): void {
    if (!this.permissionIndex.delete(id)) return
    this.commit({ permissions: [...this.permissionIndex.values()] })
  }

  setQuestions(questions: QuestionRequest[]): void {
    this.questionIndex = new Map(questions.map((q) => [q.id, q]))
    this.commit({ questions: [...this.questionIndex.values()] })
  }

  upsertQuestion(request: QuestionRequest): void {
    this.questionIndex.set(request.id, request)
    this.commit({ questions: [...this.questionIndex.values()] })
  }

  removeQuestion(id: string): void {
    if (!this.questionIndex.delete(id)) return
    this.commit({ questions: [...this.questionIndex.values()] })
  }

  setStatus(sessionID: SessionID, status: SessionStatus): void {
    this.statusIndex.set(sessionID, status)
    this.commit({ status: { ...this.state.status, [sessionID]: status } })
  }

  clearStatus(sessionID: SessionID): void {
    if (!this.statusIndex.has(sessionID)) return
    const status = { ...this.state.status }
    delete status[sessionID]
    this.commit({ status })
  }

  setFileStatus(files: FileStatusEntry[]): void {
    this.fileStatusIndex = new Map(files.map((f) => [f.file, f]))
    this.commit({ fileStatus: Object.fromEntries(this.fileStatusIndex) })
  }

  setLsp(servers: LspServer[]): void {
    this.lspList = servers
    this.commit({ lsp: servers })
  }

  setMcp(mcp: Record<string, McpServerStatus>): void {
    this.mcpMap = mcp
    this.commit({ mcp })
  }

  setVcs(branch: string | null, files: VcsFileStatus[]): void {
    this.vcsBranch = branch
    this.vcsFiles = files
    this.commit({ vcs: { branch, files } })
  }

  setVcsBranch(branch: string): void {
    if (this.vcsBranch === branch) return
    this.vcsBranch = branch
    this.commit({ vcs: { branch, files: this.vcsFiles ?? [] } })
  }

  setAgents(agents: AgentInfo[]): void {
    this.agentsList = agents
    this.commit({ agents: agents })
  }

  setCommands(commands: CommandInfo[]): void {
    this.commandsList = commands
    this.commit({ commands: commands })
  }

  setProviders(providers: ProviderInfo[]): void {
    this.providersList = providers
    this.commit({ providers: providers })
  }

  setConfig(config: unknown): void {
    this.configValue = config
    this.commit({ config })
  }

  apply(event: EventEnvelope): void {
    const props = event.properties as Record<string, unknown>
    switch (event.type) {
      case "session.created":
      case "session.updated":
        this.upsertSession(props.info as Session)
        return
      case "session.deleted":
        this.removeSession(props.sessionID as SessionID)
        return
      case "session.status":
        this.setStatus(props.sessionID as SessionID, props.status as SessionStatus)
        return
      case "session.idle":
        this.clearStatus(props.sessionID as SessionID)
        return
      case "session.error":
        this.setStatus(props.sessionID as SessionID, {
          type: "error",
          message: (props.error as { data?: { message?: string } } | undefined)?.data?.message,
        } satisfies SessionStatus)
        return
      case "message.updated":
        this.upsertMessage(props.info as Message)
        return
      case "message.removed":
        this.removeMessage(props.sessionID as SessionID, props.messageID as MessageID)
        return
      case "message.part.updated":
        this.upsertPart(props.part as Part)
        return
      case "message.part.delta":
        this.appendPartDelta(
          props.messageID as MessageID,
          props.partID as PartID,
          props.field as string,
          props.delta as string,
        )
        return
      case "message.part.removed":
        this.removePart(props.messageID as MessageID, props.partID as PartID)
        return
      case "permission.asked":
        this.upsertPermission(props as unknown as PermissionRequest)
        return
      case "permission.replied":
        this.removePermission(props.requestID as string)
        return
      case "question.asked":
        this.upsertQuestion({
          id: props.id as string,
          sessionID: props.sessionID as SessionID,
          questions: props.questions as QuestionRequest["questions"],
          time: { created: Date.now() },
        })
        return
      case "question.replied":
      case "question.rejected":
        this.removeQuestion(props.requestID as string)
        return
      case "todo.updated":
        this.setTodos(props.sessionID as SessionID, props.todos as Todo[])
        return
      case "lsp.updated":
        this.setLsp(props.servers as LspServer[])
        return
      case "vcs.branch.updated":
        this.setVcsBranch(props.branch as string)
        return
      case "file.edited":
        return
      default:
        return
    }
  }
}

export function statusTypeOf(status: SessionStatus | undefined): SessionStatusType | null {
  return status?.type ?? null
}

export type { KnownEventMap }
