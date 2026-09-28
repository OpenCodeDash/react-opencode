export type SessionID = string
export type MessageID = string
export type PartID = string
export type ProviderID = string
export type ProjectID = string
export type EventID = string

export interface TimeRange {
  created: number
  updated: number
  compacting?: number
  archived?: number
}

export interface SnapshotFileDiff {
  file: string
  additions: number
  deletions: number
  patch?: string
}

export interface TokenUsage {
  input: number
  output: number
  reasoning: number
  cache: {
    read: number
    write: number
  }
}

export interface SessionModelRef {
  id: string
  providerID: string
  variant?: string
}

export interface Session {
  id: SessionID
  slug?: string
  projectID: ProjectID
  workspaceID?: string
  directory: string
  path?: string
  parentID?: SessionID
  title?: string
  agent?: string
  model?: SessionModelRef
  version?: string
  cost?: number
  tokens?: Partial<TokenUsage>
  share?: { url: string }
  summary?: {
    additions: number
    deletions: number
    files: number
    diffs?: SnapshotFileDiff[]
  }
  metadata?: Record<string, unknown>
  time: TimeRange
  revert?: {
    messageID: MessageID
    partID: PartID
    snapshot?: string
    time: number
  }
}

export type MessageRole = "user" | "assistant"

export interface BaseMessage {
  id: MessageID
  sessionID: SessionID
  role: MessageRole
  time: { created: number; completed?: number }
  metadata?: Record<string, unknown>
}

export interface UserMessage extends BaseMessage {
  role: "user"
  model?: SessionModelRef
}

export interface AssistantMessage extends BaseMessage {
  role: "assistant"
  cost?: number
  tokens?: Partial<TokenUsage>
  error?: MessageError
  model?: SessionModelRef
}

export interface MessageError {
  name?: string
  data?: { message: string }
}

export type Message = UserMessage | AssistantMessage

export type PartType =
  | "text"
  | "subtask"
  | "reasoning"
  | "file"
  | "tool"
  | "step-start"
  | "step-finish"
  | "snapshot"
  | "patch"
  | "agent"
  | "retry"
  | "compaction"

export interface BasePart {
  id: PartID
  messageID: MessageID
  sessionID: SessionID
}

export interface TextPart extends BasePart {
  type: "text"
  text: string
  synthetic?: boolean
}

export interface ReasoningPart extends BasePart {
  type: "reasoning"
  text: string
  time: { start: number; end?: number }
}

export interface FilePart extends BasePart {
  type: "file"
  url: string
  mime?: string
  filename?: string
}

export interface SubtaskPart extends BasePart {
  type: "subtask"
  description: string
}

export type ToolState =
  | { status: "pending"; input?: Record<string, unknown>; time: { start: number } }
  | {
      status: "running"
      input: Record<string, unknown>
      time: { start: number }
      title?: string
      metadata?: Record<string, unknown>
    }
  | {
      status: "completed"
      input: Record<string, unknown>
      output: string
      title: string
      metadata: Record<string, unknown>
      time: { start: number; end: number }
    }
  | {
      status: "error"
      input: Record<string, unknown>
      error: string
      time: { start: number; end: number }
    }

export interface ToolPart extends BasePart {
  type: "tool"
  tool: string
  callID: string
  state: ToolState
}

export interface StepStartPart extends BasePart {
  type: "step-start"
}

export interface StepFinishPart extends BasePart {
  type: "step-finish"
  reason?: string
  cost?: number
  tokens?: Partial<TokenUsage>
  snapshot?: string
}

export interface SnapshotPart extends BasePart {
  type: "snapshot"
  snapshot: string
}

export interface PatchPart extends BasePart {
  type: "patch"
  add: string[]
  del: string[]
}

export interface AgentPart extends BasePart {
  type: "agent"
  name: string
  subtask?: boolean
}

export interface RetryPart extends BasePart {
  type: "retry"
  error: MessageError
}

export interface CompactionPart extends BasePart {
  type: "compaction"
  summaryID?: MessageID
}

export type Part =
  | TextPart
  | ReasoningPart
  | FilePart
  | SubtaskPart
  | ToolPart
  | StepStartPart
  | StepFinishPart
  | SnapshotPart
  | PatchPart
  | AgentPart
  | RetryPart
  | CompactionPart

export type PartInput =
  | { type: "text"; text: string; synthetic?: boolean }
  | { type: "file"; url: string; mime?: string; filename?: string }
  | { type: "agent"; name: string }
  | { type: "subtask"; description: string }

export interface Todo {
  content: string
  status: "pending" | "in_progress" | "completed" | "cancelled"
  priority: "high" | "medium" | "low"
}

export type PermissionResponse = "once" | "always" | "reject"

export interface PermissionRequest {
  id: string
  sessionID: SessionID
  permission: string
  patterns: string[]
  metadata: Record<string, unknown>
  always: string[]
  tool: { messageID: MessageID; callID: string }
  time: { created: number }
}

export interface QuestionOption {
  label: string
  description?: string
}

export interface QuestionRequest {
  id: string
  sessionID: SessionID
  questions: Array<{
    question: string
    header: string
    options: QuestionOption[]
    multiple?: boolean
    custom?: boolean
  }>
  time: { created: number }
}

export type SessionStatusType = "idle" | "busy" | "retry" | "error"

export interface SessionStatus {
  type: SessionStatusType
  message?: string
}

export interface Model {
  id: string
  name: string
  description?: string
  limit?: { context?: number; output?: number }
  cost?: {
    input: number
    output: number
    cache_read?: number
    cache_write?: number
    image?: number
    request?: number
  }
  options?: Record<string, unknown>
}

export interface ProviderInfo {
  id: ProviderID
  name: string
  source: "env" | "config" | "custom" | "api"
  env: string[]
  options?: Record<string, unknown>
  models: Record<string, Model>
}

export interface AgentInfo {
  name: string
  description?: string
  model?: string
  mode: "primary" | "subagent" | "all"
  options?: Record<string, unknown>
}

export interface CommandInfo {
  name: string
  description?: string
  agent?: string
  model?: string
}

export interface FileStatusEntry {
  file: string
  type: "added" | "deleted" | "modified" | "renamed"
  additions: number
  deletions: number
}

export interface VcsInfo {
  branch?: string
  head?: string
  name?: string
}

export interface VcsFileStatus {
  file: string
  status: string
  additions?: number
  deletions?: number
}

export interface LspServer {
  name: string
  root?: string
  status: string
}

export interface McpServerStatus {
  name: string
  status: "connected" | "disabled" | "failed" | "pending" | "needs-auth"
  error?: string
  tools?: string[]
}

export interface Project {
  id: ProjectID
  name?: string
  worktree: string
  vcs?: string
  time?: { created?: number; updated?: number }
}

export interface FileEntry {
  name: string
  path: string
  type: "file" | "directory"
}

export interface PromptInput {
  parts: PartInput[]
  messageID?: MessageID
  model?: { providerID: string; modelID: string }
  agent?: string
  system?: string
  variant?: string
  noReply?: boolean
  tools?: Record<string, boolean>
  format?: { type: "text" | "json_schema"; schema?: Record<string, unknown>; model?: string }
}

export interface CreateSessionInput {
  title?: string
  agent?: string
  model?: { providerID: string; modelID: string }
  parentID?: SessionID
  metadata?: Record<string, unknown>
}

// ---------- Events ----------

export interface EventEnvelope {
  id: EventID
  type: string
  properties: Record<string, unknown>
}

export interface GlobalEventEnvelope {
  directory: string
  project: string
  payload: EventEnvelope
}

export type EventProperties<T extends string> = Extract<
  EventEnvelope,
  { type: T }
>["properties"] &
  Record<string, unknown>

export interface SessionCreatedProps {
  sessionID: SessionID
  info: Session
}
export interface SessionUpdatedProps {
  sessionID: SessionID
  info: Session
}
export interface SessionDeletedProps {
  sessionID: SessionID
  info: Session
}
export interface SessionStatusProps {
  sessionID: SessionID
  status: SessionStatus
}
export interface SessionErrorProps {
  sessionID: SessionID
  error?: MessageError
}
export interface MessageUpdatedProps {
  sessionID: SessionID
  info: Message
}
export interface MessageRemovedProps {
  sessionID: SessionID
  messageID: MessageID
}
export interface MessagePartUpdatedProps {
  sessionID: SessionID
  part: Part
}
export interface MessagePartRemovedProps {
  sessionID: SessionID
  messageID: MessageID
  partID: PartID
}
export interface PermissionAskedProps {
  id: string
  sessionID: SessionID
  permission: string
  patterns: string[]
  metadata: Record<string, unknown>
  always: string[]
  tool: { messageID: MessageID; callID: string }
}
export interface PermissionRepliedProps {
  sessionID: SessionID
  requestID: string
  response: PermissionResponse
}
export interface QuestionAskedProps {
  id: string
  sessionID: SessionID
  questions: QuestionRequest["questions"]
}
export interface QuestionRepliedProps {
  sessionID: SessionID
  requestID: string
  answers: string[][]
}
export interface QuestionRejectedProps {
  sessionID: SessionID
  requestID: string
}
export interface TodoUpdatedProps {
  sessionID: SessionID
  todos: Todo[]
}
export interface FileStatusUpdatedProps {
  file: string
  type: FileStatusEntry["type"]
}
export interface LspUpdatedProps {
  servers: LspServer[]
}
export interface VcsBranchUpdatedProps {
  branch: string
}

export type KnownEventMap = {
  "session.created": SessionCreatedProps
  "session.updated": SessionUpdatedProps
  "session.deleted": SessionDeletedProps
  "session.status": SessionStatusProps
  "session.error": SessionErrorProps
  "session.idle": { sessionID: SessionID }
  "session.compacted": { sessionID: SessionID }
  "message.updated": MessageUpdatedProps
  "message.removed": MessageRemovedProps
  "message.part.updated": MessagePartUpdatedProps
  "message.part.removed": MessagePartRemovedProps
  "permission.asked": PermissionAskedProps
  "permission.replied": PermissionRepliedProps
  "question.asked": QuestionAskedProps
  "question.replied": QuestionRepliedProps
  "question.rejected": QuestionRejectedProps
  "todo.updated": TodoUpdatedProps
  "file.edited": { file: string }
  "lsp.updated": LspUpdatedProps
  "vcs.branch.updated": VcsBranchUpdatedProps
}

export type KnownEventType = keyof KnownEventMap
