import { useEffect } from "react"
import { useOpenCode, useStore } from "./provider"
import type { Message, MessageID, Part, SessionID } from "../types"

export function useMessages(sessionID: SessionID | undefined): Message[] {
  const client = useOpenCode()
  const messages = useStore((state) => (sessionID ? state.messages[sessionID] : undefined))
  useEffect(() => {
    if (sessionID && messages === undefined) {
      void client.loadMessages(sessionID)
    }
  }, [client, sessionID, messages === undefined])
  return messages ?? []
}

export function useMessageParts(messageID: MessageID | undefined): Part[] {
  const parts = useStore((state) => (messageID ? state.parts[messageID] : undefined))
  return parts ?? []
}
