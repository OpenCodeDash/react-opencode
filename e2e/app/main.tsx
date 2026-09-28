import { createElement } from "react"
import { createRoot } from "react-dom/client"
import { Chat } from "./chat"
import { OpenCodeProvider } from "react-opencode"

const url = (window as unknown as { __OPENCODE_URL__?: string }).__OPENCODE_URL__ ?? "http://localhost:4096"

createRoot(document.getElementById("root")!).render(
  createElement(OpenCodeProvider, { url }, createElement(Chat)),
)
