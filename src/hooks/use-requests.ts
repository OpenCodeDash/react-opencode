import { useEffect } from "react"
import { useOpenCode, useStore } from "./provider"
import type { PermissionRequest, QuestionRequest, SessionID, Todo } from "../types"

export function useTodos(sessionID: SessionID | undefined): Todo[] {
  const client = useOpenCode()
  const todos = useStore((state) => (sessionID ? state.todos[sessionID] : undefined))
  useEffect(() => {
    if (sessionID && todos === undefined) {
      client.sessionTodos(sessionID).then((value) => client.store.setTodos(sessionID, value)).catch(() => undefined)
    }
  }, [client, sessionID, todos === undefined])
  return todos ?? []
}

export function usePermissions(): PermissionRequest[] {
  return useStore((state) => state.permissions)
}

export function useQuestions(): QuestionRequest[] {
  return useStore((state) => state.questions)
}
