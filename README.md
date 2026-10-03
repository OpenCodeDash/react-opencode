# react-opencode

Reactive React hooks and imperative actions for the [opencode](https://opencode.ai) server.

Connect once to a running opencode server (`opencode serve`, default `http://localhost:4096`) and get:

- **Live-updating hooks** — sessions, streaming messages, tool activity, todos, permission and question requests, session status, VCS/LSP/MCP state — all pushed over the server's SSE event stream into a reactive in-memory store.
- **Action functions** — create/rename/fork/delete sessions, send prompts, abort, reply to permissions and questions, run commands/shell, revert, share, and read config/VCS/file state.

No state library required: the store is a small external store consumed through `useSyncExternalStore`, so only the hooks whose slice changed re-render.

## How it works

```
┌────────────────┐   REST (actions, hydration)   ┌──────────────────┐
│  OpenCodeClient │ ─────────────────────────────▶ │  opencode server  │
│                 │ ◀───────────────────────────── │                  │
└───────┬────────┘  SSE /global/event (live)     └──────────────────┘
        │
        ▼
   Store (event-sourced collections)
        │
        ▼
   useSyncExternalStore → hooks (stable per-slice references)
```

- One client, one SSE connection to `/global/event`, so events from every server instance (directory) reach the store. Each frame is a wrapped `{ directory, project, payload }`; the client unwraps `payload` before applying it. (Set `eventPath: "/event"` to pin a single instance instead. `/event` without `?directory=` only covers the server's default instance and emits nothing for other projects.)
- On connect and on reconnect the store re-hydrates from REST (`/session`, `/session/status`, `/permission`, `/question`), and re-fetches messages for sessions you have already loaded. Because `/session/status`, `/permission` and `/question` are instance-scoped, hydration fans out to every directory present in the session list (plus the default instance) and merges the results.
- Message history is loaded lazily per session (when a `useMessages(sessionID)` hook mounts) to keep startup light.
- SSE reconnects with exponential backoff (500 ms → 30 s by default).

## Install

```sh
npm install react-opencode
```

Peer dependency: `react >= 18`.

## Quick start

```tsx
import {
  OpenCodeProvider,
  useSessions,
  useMessages,
  useMessageParts,
  usePrompt,
  usePermissions,
} from "react-opencode"

function App() {
  return (
    <OpenCodeProvider url="http://localhost:4096">
      <Chat />
    </OpenCodeProvider>
  )
}

function Chat() {
  const sessions = useSessions()
  const [activeId, setActiveId] = ...
  const messages = useMessages(activeId)
  const { busy, prompt, abort } = usePrompt(activeId)
  const permissions = usePermissions()

  return (
    <div>
      <select value={activeId} onChange={...}>
        {sessions.map((s) => <option key={s.id} value={s.id}>{s.title}</option>)}
      </select>
      {messages.map((m) => (
        <Message key={m.id} message={m} />
      ))}
      {permissions.map((p) => (
        <PermissionPrompt key={p.id} request={p} />
      ))}
      <input
        onKeyDown={async (e) => {
          if (e.key !== "Enter" || !e.currentTarget.value) return
          await prompt({ parts: [{ type: "text", text: e.currentTarget.value }] })
        }}
      />
      {busy && <button onClick={() => abort()}>Stop</button>}
    </div>
  )
}

function Message({ message }) {
  const parts = useMessageParts(message.id)
  return (
    <div>
      {parts.map((part) => {
        if (part.type === "text") return <p key={part.id}>{part.text}</p>
        if (part.type === "reasoning") return <i key={part.id}>{part.text}</i>
        if (part.type === "tool")
          return (
            <ToolCard key={part.id} tool={part.tool} state={part.state} />
          )
        return null
      })}
    </div>
  )
}
```

Text parts update in place as the model streams (`message.part.updated` events carry the full part), so a `<p>` re-renders with the new text — no delta bookkeeping needed.

## Provider

```tsx
<OpenCodeProvider url="http://localhost:4096">…</OpenCodeProvider>
```

| Prop | Default | Description |
|------|---------|-------------|
| `url` | `http://localhost:4096` | Server base URL |
| `client` | — | Use your own `OpenCodeClient` (skips create/disconnect on unmount) |
| `connect` | `true` | Connect SSE on mount, disconnect on unmount |
| `reconnect` | `true` | Auto-reconnect with backoff |
| `minBackoffMs` / `maxBackoffMs` | `500` / `30000` | Backoff bounds |
| `fetchImpl` | global `fetch` | Custom fetch (proxies, auth, tests) |
| `headers` | `{}` | Extra headers (e.g. auth) sent on every request |

`useOpenCode()` returns the client for direct access; `useClientActions()` returns a stable object of bound action methods.

## Hooks

### Sessions & status
| Hook | Returns |
|------|---------|
| `useConnected()` | `boolean` — SSE connection state |
| `useSessions()` | `Session[]` — all sessions, live, sorted by last update |
| `useSession(id)` | `Session \| undefined` |
| `useSessionStatus(id)` | `SessionStatus \| undefined` — `{type: "idle"\|"busy"\|"retry"\|"error"}` |
| `useSessionBusy(id)` | `boolean` — true while not idle |

### Messages (live streaming)
| Hook | Returns |
|------|---------|
| `useMessages(sessionID)` | `Message[]` — auto-loads history on first mount, then live-updates |
| `useMessageParts(messageID)` | `Part[]` — text / reasoning / tool / step / patch / file / agent / compaction parts |

### Requests & todos
| Hook | Returns |
|------|---------|
| `useTodos(sessionID)` | `Todo[]` — live todo list for the session |
| `usePermissions()` | `PermissionRequest[]` — pending permission prompts |
| `useQuestions()` | `QuestionRequest[]` — pending question prompts |

### Prompt
| Hook | Returns |
|------|---------|
| `usePrompt(sessionID)` | `{ busy, prompt(input), abort() }` |

`prompt(input)` takes `{ parts: PartInput[], model?, agent?, system?, variant?, tools?, noReply? }` where `PartInput` is `{type:"text",text}` / `{type:"file",url,mime?,filename?}` / `{type:"agent",name}` / `{type:"subtask",description}`.

### Catalogue & environment (fetched once, cached in store)
| Hook | Returns |
|------|---------|
| `useProviders()` | `ProviderInfo[]` — providers with nested models |
| `useAgents()` | `AgentInfo[]` |
| `useCommands()` | `CommandInfo[]` — slash commands |
| `useFileStatus()` | `FileStatusEntry[]` — files added/deleted/modified/renamed |
| `useLsp()` | `LspServer[]` |
| `useMcp()` | `Record<name, McpServerStatus>` |
| `useVcs()` | `{ branch, files }` — branch updates live via events |

## Actions

Everything on the client is also available as a stable object from `useClientActions()`, or directly via `useOpenCode()`:

```ts
client.health()                        // { healthy, version }
client.createSession({ title })        // → Session
client.renameSession(id, title)
client.deleteSession(id)
client.forkSession(id, { messageID? })
client.shareSession(id) / unshareSession(id)
client.summarizeSession(id)
client.abortSession(id)
client.revertSession(id) / unrevertSession(id)
client.sessionTodos(id) / sessionDiff(id) / sessionChildren(id)

client.prompt(id, input)               // → { info, parts }
client.promptAsync(id, input)
client.command(id, { command, arguments, agent? })
client.shell(id, { agent, command, model? })
client.loadMessages(id)                // lazy history load (deduped)
client.deleteMessage(id, messageID)

client.replyPermission(requestID, "once" | "always" | "reject", message?)
client.replyQuestion(requestID, answers /* string[][] */)
client.rejectQuestion(requestID)

client.listProviders() / listAgents() / listCommands()
client.getConfig() / updateConfig(patch)
client.vcs() / vcsStatus() / vcsDiff()
client.fileStatus() / listFiles(path) / readFile(path)
client.lspStatus() / mcpStatus()
client.listProjects() / currentProject()
```

Errors throw `OpenCodeError` with `.status` and `.body`.

## Building a complete frontend — feature coverage

What you can build with this lib, mapped to opencode server features:

- **Chat UI**: session list → messages → streaming text/reasoning → tool calls with live state (pending/running/completed/error) → stop button. *(P0, done)*
- **Approval UX**: permission prompts (bash/edit/…) with once/always/reject; interactive question prompts with options. *(P0, done)*
- **Task panel**: live todo list per session. *(P0, done)*
- **Model/agent picker**: `useProviders()` + `useAgents()`, pass `model`/`agent` per prompt. *(P1, done)*
- **Diff/file panel**: `useFileStatus()`, `client.sessionDiff(id)`, `client.vcsDiff()`, revert/unrevert. *(P1, done)*
- **Settings**: `useOpenCode().getConfig()` / `updateConfig()`. *(P1, done)*
- **Slash commands & shell**: `useCommands()` + `client.command()`, `client.shell()`. *(P1, done)*
- **Environment status**: LSP, MCP servers, VCS branch. *(P1/P2, done)*
- **Sessions**: fork, share/unshare, summarize/compact, children. *(P1/P2, done)*
- **File browser**: `client.listFiles(path)`, `client.readFile(path)`. *(P2, done)*

See `PLAN.md` for the full feature matrix, priorities, and testing plan.

## Development

```sh
npm install
npm test           # vitest: unit + hook + integration (real HTTP mock server)
npm run typecheck  # tsc --noEmit
npm run build      # tsup → dist (ESM + CJS + .d.ts)
npm run test:e2e   # build + Playwright (6 mock-server + 2 live-server browser tests)
```

On NixOS, run e2e inside the flake dev shell (`nix develop`) — it provides Node and a fully-linked chromium (`$CHROMIUM_PATH`), which `playwright.config.ts` uses automatically.

### Testing approach

| Layer | What's tested |
|-------|---------------|
| Unit | Store reducers: every event type, ordering, cascade deletes, stable references for unchanged slices |
| Unit | SSE framing parser + `EventStream`: reconnect/backoff, abort, malformed frames |
| Unit | Client: REST error mapping (`OpenCodeError`), request bodies, hydration, load dedupe, reconnect re-hydration |
| Hooks | `renderHook` against a real client whose store is fed synthetic events |
| Integration | Real `node:http` mock opencode server with live SSE; full connect → hydrate → stream → prompt cycle |
| E2E (mock) | Real Chromium (Playwright) driving the demo app against a scripted mock server: SSE connect/version, REST hydration, prompt → streaming text → permission reply, live session create/delete |
| E2E (live) | Same UI against a **real** opencode server (`:4096`): version display, create + delete a real session |

## API notes

- Targets the **v1 server API** (root paths: `/session`, `/global/event`, …) used by the opencode web app. The newer `/api/*` (v2) surface is not wrapped.
- The server exposes an OpenAPI spec at `GET /doc` — types in `src/types.ts` are hand-written against it for the entities a frontend needs.
- Events are envelope objects: `{ id: "evt_…", type, properties }`. The store knows the event types a frontend cares about and ignores the rest (new server events won't break the lib).
