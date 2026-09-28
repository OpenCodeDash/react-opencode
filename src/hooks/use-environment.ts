import { useEffect, useRef } from "react"
import { useOpenCode, useStore } from "./provider"
import type { AgentInfo, CommandInfo, FileStatusEntry, LspServer, McpServerStatus, ProviderInfo, VcsFileStatus, VcsInfo } from "../types"

export function useProviders(): ProviderInfo[] {
  const client = useOpenCode()
  const providers = useStore((state) => state.providers)
  useEffect(() => {
    if (providers.length === 0) {
      client.listProviders().then((r) => client.store.setProviders(r.providers)).catch(() => undefined)
    }
  }, [client, providers.length])
  return providers
}

export function useAgents(): AgentInfo[] {
  const client = useOpenCode()
  const agents = useStore((state) => state.agents)
  useEffect(() => {
    if (agents.length === 0) {
      client.listAgents().then((value) => client.store.setAgents(value)).catch(() => undefined)
    }
  }, [client, agents.length])
  return agents
}

export function useCommands(): CommandInfo[] {
  const client = useOpenCode()
  const commands = useStore((state) => state.commands)
  useEffect(() => {
    if (commands.length === 0) {
      client.listCommands().then((value) => client.store.setCommands(value)).catch(() => undefined)
    }
  }, [client, commands.length])
  return commands
}

export function useFileStatus(): FileStatusEntry[] {
  const client = useOpenCode()
  const fileStatus = useStore((state) => state.fileStatus)
  useEffect(() => {
    if (Object.keys(fileStatus).length === 0) {
      client.fileStatus().then((value) => client.store.setFileStatus(value)).catch(() => undefined)
    }
  }, [client, Object.keys(fileStatus).length])
  return Object.values(fileStatus)
}

export function useLsp(): LspServer[] {
  const client = useOpenCode()
  const lsp = useStore((state) => state.lsp)
  useEffect(() => {
    if (lsp.length === 0) {
      client.lspStatus().then((value) => client.store.setLsp(value)).catch(() => undefined)
    }
  }, [client, lsp.length])
  return lsp
}

export function useMcp(): Record<string, McpServerStatus> {
  const client = useOpenCode()
  const mcp = useStore((state) => state.mcp)
  useEffect(() => {
    if (Object.keys(mcp).length === 0) {
      client.mcpStatus().then((value) => client.store.setMcp(value)).catch(() => undefined)
    }
  }, [client, Object.keys(mcp).length])
  return mcp
}

export function useVcs(): { branch: string | null; files: VcsFileStatus[] } {
  const client = useOpenCode()
  const vcs = useStore((state) => state.vcs)
  const loaded = useRef(false)
  useEffect(() => {
    if (loaded.current) return
    loaded.current = true
    client
      .vcs()
      .then((info: VcsInfo) => client.store.setVcsBranch(info.branch ?? ""))
      .catch(() => undefined)
    client
      .vcsStatus()
      .then((files) => client.store.setVcs(client.store.state.vcs.branch, files))
      .catch(() => undefined)
  }, [client])
  return vcs
}
