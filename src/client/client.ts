import { EventStream, type EventStreamOptions } from "./events"
import { Store, createInitialStoreState, type StoreState } from "./store"
import type {
  AgentInfo,
  CommandInfo,
  CreateSessionInput,
  FileEntry,
  FileStatusEntry,
  LspServer,
  McpServerStatus,
  Message,
  MessageID,
  Part,
  PermissionRequest,
  PermissionResponse,
  Project,
  PromptInput,
  ProviderInfo,
  QuestionRequest,
  Session,
  SessionID,
  SessionStatus,
  Todo,
  VcsFileStatus,
  VcsInfo,
} from "../types"

export class OpenCodeError extends Error {
  status: number
  body: unknown

  constructor(status: number, message: string, body: unknown) {
    super(message)
    this.name = "OpenCodeError"
    this.status = status
    this.body = body
  }
}

export interface OpenCodeClientOptions {
  url?: string
  fetchImpl?: typeof fetch
  headers?: Record<string, string>
  autoConnect?: boolean
  eventPath?: string
  reconnect?: boolean
  minBackoffMs?: number
  maxBackoffMs?: number
  store?: Store
}

interface LoadedSession {
  sessionID: SessionID
}

export class OpenCodeClient {
  readonly url: string
  readonly store: Store
  private fetchImpl: typeof fetch
  private headers: Record<string, string>
  private stream: EventStream | null = null
  private loadedMessages = new Set<SessionID>()
  private loadQueue = new Map<SessionID, Promise<void>>()
  private options: OpenCodeClientOptions

  constructor(options: OpenCodeClientOptions = {}) {
    this.url = (options.url ?? "http://localhost:4096").replace(/\/$/, "")
    this.fetchImpl = options.fetchImpl ?? fetch
    this.headers = { "Content-Type": "application/json", ...options.headers }
    this.options = options
    this.store = options.store ?? new Store(createInitialStoreState())
    if (options.autoConnect) void this.connect()
  }

  get connected(): boolean {
    return this.store.state.connected
  }

  private async request<T>(method: string, path: string, body?: unknown): Promise<T> {
    // call through a local binding: a bare `this.fetchImpl(...)` would pass the
    // client as `this`, which the native browser `fetch` rejects (Illegal invocation)
    const doFetch = this.fetchImpl
    const response = await doFetch(`${this.url}${path}`, {
      method,
      headers: this.headers,
      body: body === undefined ? undefined : JSON.stringify(body),
    })
    const text = await response.text()
    const data: unknown = text.length > 0 ? JSON.parse(text) : null
    if (!response.ok) {
      const message =
        data && typeof data === "object" && "error" in data && data.error
          ? JSON.stringify(data.error)
          : `request failed: ${response.status} ${response.statusText}`
      throw new OpenCodeError(response.status, message, data)
    }
    return data as T
  }

  private get<T>(path: string): Promise<T> {
    return this.request<T>("GET", path)
  }

  private post<T>(path: string, body?: unknown): Promise<T> {
    return this.request<T>("POST", path, body ?? {})
  }

  private patch<T>(path: string, body?: unknown): Promise<T> {
    return this.request<T>("PATCH", path, body ?? {})
  }

  private del<T>(path: string): Promise<T> {
    return this.request<T>("DELETE", path)
  }

  // ---------- Connection ----------

  async connect(): Promise<void> {
    if (this.stream) return
    const opts: EventStreamOptions = {
      // `/event` is scoped to the server's default instance (its cwd) and emits
      // nothing for sessions in other directories; `/global/event` carries every
      // instance's events (each GlobalEvent's `payload` is unwrapped by EventStream).
      url: `${this.url}${this.options.eventPath ?? "/global/event"}`,
      fetchImpl: this.fetchImpl,
      onEvent: (event) => this.store.apply(event),
      onConnected: () => {
        this.store.setConnected(true)
        void this.hydrate()
      },
      onDisconnected: () => this.store.setConnected(false),
      reconnect: this.options.reconnect ?? true,
      minBackoffMs: this.options.minBackoffMs,
      maxBackoffMs: this.options.maxBackoffMs,
    }
    this.stream = new EventStream(opts)
    void this.stream.start()
  }

  disconnect(): void {
    this.stream?.stop()
    this.stream = null
    this.store.setConnected(false)
  }

  private async hydrate(): Promise<void> {
    try {
      // The session list is global, but /session/status, /permission and
      // /question are instance-scoped: without a ?directory= param they only
      // cover the server's default instance. Hydrate every instance that has
      // sessions (plus the default one) and merge the results.
      const sessions = (await this.get<Session[]>("/session").catch(() => [] as Session[])) ?? []
      this.store.setSessions(sessions)
      const directories = new Set<string>()
      for (const session of sessions) if (session.directory) directories.add(session.directory)
      const scopes: string[] = ["", ...[...directories].map((dir) => `?directory=${encodeURIComponent(dir)}`)]
      const status: Record<SessionID, SessionStatus> = {}
      const permissions = new Map<string, PermissionRequest>()
      const questions = new Map<string, QuestionRequest>()
      for (const scope of scopes) {
        const [scopeStatus, scopePermissions, scopeQuestions] = await Promise.all([
          this.get<Record<SessionID, SessionStatus>>(`/session/status${scope}`).catch(() => ({})),
          this.get<PermissionRequest[]>(`/permission${scope}`).catch(() => [] as PermissionRequest[]),
          this.get<QuestionRequest[]>(`/question${scope}`).catch(() => [] as QuestionRequest[]),
        ])
        for (const [id, value] of Object.entries(scopeStatus ?? {})) status[id] = value
        for (const permission of scopePermissions ?? []) permissions.set(permission.id, permission)
        for (const question of scopeQuestions ?? []) questions.set(question.id, question)
      }
      for (const [id, value] of Object.entries(status)) this.store.setStatus(id, value)
      this.store.setPermissions([...permissions.values()])
      this.store.setQuestions([...questions.values()])
      for (const id of this.loadedMessages) {
        await this.loadMessages(id).catch(() => undefined)
      }
    } catch {
      // hydration is best-effort; events will keep the store current
    }
  }

  // ---------- Sessions ----------

  health() {
    return this.get<{ healthy: boolean; version: string }>("/global/health")
  }

  listSessions() {
    return this.get<Session[]>("/session")
  }

  createSession(input: CreateSessionInput = {}): Promise<Session> {
    // The server does not emit a session.created event for this call, so keep
    // the store in sync optimistically (idempotent if an event also arrives).
    return this.post<Session>("/session", input).then((session) => {
      this.store.upsertSession(session)
      return session
    })
  }

  getSession(id: SessionID) {
    return this.get<Session>(`/session/${id}`)
  }

  updateSession(id: SessionID, input: { title?: string; metadata?: Record<string, unknown>; time?: { archived?: number } }) {
    // No session.updated event is emitted for this call; sync the store.
    return this.patch<Session>(`/session/${id}`, input).then((session) => {
      this.store.upsertSession(session)
      return session
    })
  }

  renameSession(id: SessionID, title: string) {
    return this.updateSession(id, { title })
  }

  deleteSession(id: SessionID) {
    // No session.deleted event is emitted for this call; sync the store.
    return this.del<void>(`/session/${id}`).then(() => {
      this.store.removeSession(id)
    })
  }

  forkSession(id: SessionID, input: { messageID?: MessageID } = {}): Promise<Session> {
    return this.post<Session>(`/session/${id}/fork`, input)
  }

  shareSession(id: SessionID) {
    return this.post<Session>(`/session/${id}/share`)
  }

  unshareSession(id: SessionID) {
    return this.del<Session>(`/session/${id}/share`)
  }

  summarizeSession(id: SessionID) {
    return this.post<void>(`/session/${id}/summarize`)
  }

  abortSession(id: SessionID) {
    return this.post<void>(`/session/${id}/abort`)
  }

  revertSession(id: SessionID) {
    return this.post<Session>(`/session/${id}/revert`)
  }

  unrevertSession(id: SessionID) {
    return this.post<Session>(`/session/${id}/unrevert`)
  }

  sessionTodos(id: SessionID) {
    return this.get<Todo[]>(`/session/${id}/todo`)
  }

  sessionDiff(id: SessionID) {
    return this.get<unknown>(`/session/${id}/diff`)
  }

  sessionChildren(id: SessionID) {
    return this.get<Session[]>(`/session/${id}/children`)
  }

  // ---------- Messages ----------

  listMessages(id: SessionID): Promise<Array<{ info: Message; parts: Part[] }>> {
    return this.get(`/session/${id}/message`)
  }

  async loadMessages(id: SessionID): Promise<void> {
    const pending = this.loadQueue.get(id)
    if (pending) return pending
    const task = (async () => {
      const entries = await this.listMessages(id)
      this.store.setMessages(id, entries)
      this.loadedMessages.add(id)
    })()
    this.loadQueue.set(id, task)
    try {
      await task
    } finally {
      this.loadQueue.delete(id)
    }
    return task
  }

  unloadMessages(id: SessionID): void {
    this.loadedMessages.delete(id)
  }

  getMessage(id: SessionID, messageID: MessageID) {
    return this.get<unknown>(`/session/${id}/message/${messageID}`)
  }

  deleteMessage(id: SessionID, messageID: MessageID) {
    return this.del<void>(`/session/${id}/message/${messageID}`)
  }

  prompt(id: SessionID, input: PromptInput): Promise<{ info: Message; parts: Part[] }> {
    return this.post<{ info: Message; parts: Part[] }>(`/session/${id}/message`, input)
  }

  promptAsync(id: SessionID, input: PromptInput) {
    return this.post<unknown>(`/session/${id}/prompt_async`, input)
  }

  command(id: SessionID, input: { command: string; arguments: string; agent?: string; model?: string; parts?: unknown[] }) {
    return this.post<unknown>(`/session/${id}/command`, input)
  }

  shell(id: SessionID, input: { agent: string; command: string; model?: { providerID: string; modelID: string } }) {
    return this.post<unknown>(`/session/${id}/shell`, input)
  }

  // ---------- Permissions & questions ----------

  // Permission and question state lives in the instance (working directory)
  // of the session that raised it. Routes without a session id in the URL —
  // like /question/:id/reply — fall back to the server's default instance
  // unless the client pins one, so resolve the directory from the store.
  private instancePath(path: string, sessionID: SessionID | undefined): string {
    const directory = sessionID ? this.store.state.sessions.find((s) => s.id === sessionID)?.directory : undefined
    if (!directory) return path
    return `${path}?directory=${encodeURIComponent(directory)}`
  }

  listPermissions() {
    return this.get<PermissionRequest[]>("/permission")
  }

  replyPermission(requestID: string, reply: PermissionResponse, message?: string) {
    const sessionID = this.store.state.permissions.find((p) => p.id === requestID)?.sessionID
    return this.post<void>(this.instancePath(`/permission/${requestID}/reply`, sessionID), {
      reply,
      ...(message ? { message } : {}),
    })
  }

  listQuestions() {
    return this.get<QuestionRequest[]>("/question")
  }

  replyQuestion(requestID: string, answers: string[][]) {
    const sessionID = this.store.state.questions.find((q) => q.id === requestID)?.sessionID
    return this.post<void>(this.instancePath(`/question/${requestID}/reply`, sessionID), { answers })
  }

  rejectQuestion(requestID: string) {
    const sessionID = this.store.state.questions.find((q) => q.id === requestID)?.sessionID
    return this.post<void>(this.instancePath(`/question/${requestID}/reject`, sessionID))
  }

  // ---------- Catalogue ----------

  listProviders(): Promise<{ providers: ProviderInfo[]; default: Record<string, string> }> {
    return this.get("/config/providers")
  }

  listAgents() {
    return this.get<AgentInfo[]>("/agent")
  }

  listCommands() {
    return this.get<CommandInfo[]>("/command")
  }

  getConfig() {
    return this.get<Record<string, unknown>>("/config")
  }

  updateConfig(patch: Record<string, unknown>) {
    return this.patch<Record<string, unknown>>("/config", patch)
  }

  // ---------- Environment ----------

  path() {
    return this.get<{ cwd: string; root: string }>("/path")
  }

  vcs() {
    return this.get<VcsInfo>("/vcs")
  }

  vcsStatus() {
    return this.get<VcsFileStatus[]>("/vcs/status")
  }

  vcsDiff() {
    return this.get<unknown>("/vcs/diff")
  }

  fileStatus(): Promise<FileStatusEntry[]> {
    return this.get("/file/status")
  }

  listFiles(path: string, type?: "dir" | "file") {
    const params = new URLSearchParams({ path, ...(type ? { type } : {}) })
    return this.get<FileEntry[]>(`/file?${params}`)
  }

  readFile(path: string, limit?: number) {
    const params = new URLSearchParams({ path, ...(limit ? { limit: String(limit) } : {}) })
    return this.get<unknown>(`/file/content?${params}`)
  }

  lspStatus() {
    return this.get<LspServer[]>("/lsp")
  }

  mcpStatus() {
    return this.get<Record<string, McpServerStatus>>("/mcp")
  }

  listProjects() {
    return this.get<Project[]>("/project")
  }

  currentProject() {
    return this.get<Project>("/project/current")
  }
}

export function createClient(options: OpenCodeClientOptions = {}): OpenCodeClient {
  return new OpenCodeClient(options)
}

export type { StoreState }
