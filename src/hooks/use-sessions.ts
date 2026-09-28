import { useEffect } from "react"
import { useOpenCode, useStore } from "./provider"
import type { Session, SessionID, SessionStatus } from "../types"

export function useConnected(): boolean {
  return useStore((state) => state.connected)
}

export function useSessions(): Session[] {
  return useStore((state) => state.sessions)
}

export function useSession(id: SessionID | undefined): Session | undefined {
  const sessions = useStore((state) => state.sessions)
  if (!id) return undefined
  return sessions.find((s) => s.id === id)
}

export function useSessionStatus(id: SessionID | undefined): SessionStatus | undefined {
  const status = useStore((state) => state.status)
  if (!id) return undefined
  return status[id]
}

export function useSessionBusy(id: SessionID | undefined): boolean {
  const status = useSessionStatus(id)
  return status ? status.type !== "idle" : false
}
