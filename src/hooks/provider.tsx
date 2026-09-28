import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useSyncExternalStore,
  type ReactNode,
} from "react"
import { OpenCodeClient, type OpenCodeClientOptions } from "../client/client"
import type { StoreState } from "../client/store"

interface OpenCodeContextValue {
  client: OpenCodeClient
}

const OpenCodeContext = createContext<OpenCodeContextValue | null>(null)

export interface OpenCodeProviderProps extends OpenCodeClientOptions {
  client?: OpenCodeClient
  children: ReactNode
  connect?: boolean
}

export function OpenCodeProvider(props: OpenCodeProviderProps) {
  const { client: provided, children, connect = true, ...options } = props
  const created = useRef<OpenCodeClient | null>(null)
  if (!provided && !created.current) created.current = new OpenCodeClient(options)
  const client = provided ?? created.current!

  useEffect(() => {
    if (!provided && connect) client.connect()
    return () => {
      if (!provided && connect) client.disconnect()
    }
  }, [client, connect, provided])

  return <OpenCodeContext.Provider value={{ client }}>{children}</OpenCodeContext.Provider>
}

export function useOpenCode(): OpenCodeClient {
  const ctx = useContext(OpenCodeContext)
  if (!ctx) throw new Error("useOpenCode must be used within <OpenCodeProvider>")
  return ctx.client
}

export function useStore<T>(selector: (state: StoreState) => T): T {
  const client = useOpenCode()
  const store = client.store
  return useSyncExternalStore(
    store.subscribe,
    () => selector(store.state),
    () => selector(store.state),
  )
}

export function useClientActions() {
  const client = useOpenCode()
  return useMemo(
    () => ({
      health: () => client.health(),
      createSession: (input?: Parameters<OpenCodeClient["createSession"]>[0]) => client.createSession(input),
      renameSession: (id: string, title: string) => client.renameSession(id, title),
      deleteSession: (id: string) => client.deleteSession(id),
      forkSession: (id: string, input?: { messageID?: string }) => client.forkSession(id, input),
      shareSession: (id: string) => client.shareSession(id),
      unshareSession: (id: string) => client.unshareSession(id),
      abortSession: (id: string) => client.abortSession(id),
      prompt: (id: string, input: Parameters<OpenCodeClient["prompt"]>[1]) => client.prompt(id, input),
      command: (id: string, input: Parameters<OpenCodeClient["command"]>[1]) => client.command(id, input),
      shell: (id: string, input: Parameters<OpenCodeClient["shell"]>[1]) => client.shell(id, input),
      replyPermission: (requestID: string, reply: "once" | "always" | "reject", message?: string) =>
        client.replyPermission(requestID, reply, message),
      replyQuestion: (requestID: string, answers: string[][]) => client.replyQuestion(requestID, answers),
      rejectQuestion: (requestID: string) => client.rejectQuestion(requestID),
      loadMessages: (id: string) => client.loadMessages(id),
      summarizeSession: (id: string) => client.summarizeSession(id),
    }),
    [client],
  )
}
