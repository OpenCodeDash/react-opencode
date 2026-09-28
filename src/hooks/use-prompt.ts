import { useCallback } from "react"
import { useOpenCode } from "./provider"
import { useSessionBusy } from "./use-sessions"
import type { Message, Part, PromptInput, SessionID } from "../types"

export interface UsePromptResult {
  busy: boolean
  prompt: (input: PromptInput) => Promise<{ info: Message; parts: Part[] }>
  abort: () => Promise<void>
}

export function usePrompt(sessionID: SessionID | undefined): UsePromptResult {
  const client = useOpenCode()
  const busy = useSessionBusy(sessionID)

  const prompt = useCallback(
    (input: PromptInput) => {
      if (!sessionID) throw new Error("usePrompt: no session id")
      return client.prompt(sessionID, input)
    },
    [client, sessionID],
  )

  const abort = useCallback(async () => {
    if (!sessionID) return
    await client.abortSession(sessionID)
  }, [client, sessionID])

  return { busy, prompt, abort }
}
