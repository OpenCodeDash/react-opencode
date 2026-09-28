# react-opencode — Plan

Reactive React library for the opencode server: live-updating hooks + imperative actions.

## Research findings (opencode server v1.18.31, live at :4096)

- OpenAPI spec served at `GET /doc` (162 paths, 472 schemas). Two API generations:
  - **v1** — root paths (`/session`, `/config`, ...). This is what the web app uses. **Target of this lib.**
  - **v2** — `/api/*` paths. Not targeted.
- SSE streams:
  - `GET /event` → `data: {Event}` where `Event = {id: "evt_...", type: "session.created", properties: {...}}`
  - `GET /global/event` → `data: {directory, project, payload: Event}` (multi-instance)
- Key entities: `Session`, `Message` (User|Assistant), `Part` (union of 12: text, reasoning, tool, step-start/finish, snapshot, patch, file, agent, retry, subtask, compaction), `Todo`, `PermissionRequest`, `QuestionRequest`, `ProviderInfo`, `Model`, `AgentInfo`, `CommandInfo`, `VcsInfo`, `LspServer`, `McpServerStatus`, `Project`, `FileEntry`.
- Prompt: `POST /session/{id}/message` body `{parts: PartInput[], model?, agent?, system?, variant?, noReply?, tools?}` → returns `{info: AssistantMessage, parts: Part[]}`.
- Health: `GET /global/health` → `{"healthy":true,"version":"..."}`.

## Structure

```
src/
├── index.ts            # public exports
├── types.ts            # core types (entities + event props map)
├── client/
│   ├── client.ts       # OpenCodeClient: baseUrl, REST request<T>()
│   ├── events.ts       # SSE stream: reconnect + backoff + re-hydrate on reconnect
│   ├── store.ts        # external store; event-sourced collections, subscribe/get
│   └── actions.ts      # session/prompt/permission/question/vcs/config actions
└── hooks/
    ├── provider.tsx    # <OpenCodeProvider> + useOpenCode()
    └── use-*.ts        # one hook per collection via useSyncExternalStore
```

Design: one client owns REST + one SSE connection + in-memory event-sourced store.
Hooks = `useSyncExternalStore` + per-collection selector → live updates, no re-render storms.
On SSE reconnect: re-hydrate affected collections from REST (list sessions, then messages for active ones).

## Feature list (complete frontend)

| # | Feature | Priority | Status |
|---|---------|----------|--------|
| 1 | SSE connection + reconnect/backoff + rehydrate | P0 | todo |
| 2 | Session list (live) + create/select/delete/rename | P0 | todo |
| 3 | Session detail: cost, tokens, model, agent, status | P0 | todo |
| 4 | Messages per session, live streaming | P0 | todo |
| 5 | Parts: text-delta streaming, reasoning, tool progress, steps, patch, file, agent, compaction | P0 | todo |
| 6 | Send prompt (text, model/agent, tools) | P0 | todo |
| 7 | Abort session | P0 | todo |
| 8 | Permission requests: list + reply (once/always/deny) | P0 | todo |
| 9 | Questions: list + reply/reject | P0 | todo |
| 10 | Todos per session (live) | P0 | todo |
| 11 | Session busy/idle/error status | P0 | todo |
| 12 | Providers/models + switch model/agent per session | P1 | todo |
| 13 | File status (edited files) | P1 | todo |
| 14 | VCS: branch/status/diff; session diff; revert/unrevert | P1 | todo |
| 15 | Config get/update; provider auth | P1 | todo |
| 16 | Commands (slash) list + execute | P1 | todo |
| 17 | Shell command in session | P1 | todo |
| 18 | Session fork / share / unshare | P1 | todo |
| 19 | Agents list | P1 | todo |
| 20 | File browser (list/read) | P2 | todo |
| 21 | MCP status | P2 | todo |
| 22 | LSP status | P2 | todo |
| 23 | Projects list/current | P2 | todo |
| 24 | Session summarize/compact | P2 | todo |

## Testing plan

1. **Unit** — store reducers (event apply, upsert, remove, ordering), SSE frame parsing, client error handling (mocked fetch).
2. **Hook tests** — `renderHook` with a fake/injected client emitting synthetic events; assert live state transitions and selector stability.
3. **Integration** — in-process mock opencode server (Node http + SSE) implementing a subset of v1 API; full connect → hydrate → stream events → prompt cycle.
4. **Build** — `tsup` ESM/CJS/dts + `tsc --noEmit`.
5. **E2E (Playwright + Vite + real Chromium)** — demo app in `e2e/app` imports the built `dist/index.js`; two suites:
   - `e2e/mock.spec.ts` — scripted mock opencode (SSE + REST): connect/version, REST hydration, full prompt → streaming → permission reply cycle, live session create/delete over SSE, REST endpoint audit.
   - `e2e/live.spec.ts` — real opencode server at `http://localhost:4096`: version display, real session create + delete through the UI.

Commands: `npm test` (vitest run), `npm run typecheck`, `npm run build`, `npm run test:e2e` (build + playwright).
E2E runs in the NixOS flake dev shell (`nix develop`): provides node + a fully-linked NixOS chromium via `$CHROMIUM_PATH` (playwright.config.ts picks it up; falls back to playwright-managed browsers elsewhere).

## Progress log

- [x] API research (OpenAPI + live SSE probes)
- [x] Plan written
- [x] Scaffold: package.json, tsconfig, npm install (react 19, vitest 3, tsup 8, @testing-library/react 16, jsdom)
- [x] src/types.ts
- [x] src/client/store.ts (event-sourced store, stable slice refs)
- [x] src/client/events.ts (SSE parse + reconnect/backoff + abort)
- [x] src/client/client.ts (REST + hydration + all actions)
- [x] src/hooks/* (provider, sessions, messages, requests, prompt, environment)
- [x] src/index.ts (29 exports)
- [x] Tests: 42 passing (store unit, SSE unit, client unit, hooks, integration vs real http mock server)
- [x] Build: tsup ESM+CJS+d.ts; dist import smoke test OK
- [x] Live smoke test vs real opencode server v1.18.31 (health + SSE connect OK)
- [x] README.md
- [x] E2E scaffolding: flake.nix (node + nix chromium), vite demo app (imports dist), scripted mock opencode (CORS, SSE, prompt flow), playwright.config (webServer + CHROMIUM_PATH)
- [x] E2E green: 8/8 (6 mock + 2 live vs real opencode)
- [x] Bug found by e2e: `this.fetchImpl(...)` in client.request() passed the client as `this` to the native browser `fetch` → `Illegal invocation` (Node's fetch has no such check, so unit tests passed). Fixed by calling through a local binding.
- [x] Mock bug: SSE clients were unregistered on `req.on("close")` (fires when the request finishes, i.e. immediately) → `res.on("close")`.

### Feature status

P0 (1–11): all done. P1 (12–19): done. P2 (20–24): done (file browser, MCP, LSP, projects, summarize).
