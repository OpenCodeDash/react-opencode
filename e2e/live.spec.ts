import { test, expect } from "@playwright/test"

const LIVE_URL = process.env.OPENCODE_URL ?? "http://localhost:4096"

async function liveServerReachable(): Promise<boolean> {
  try {
    const res = await fetch(`${LIVE_URL}/global/health`, { signal: AbortSignal.timeout(3000) })
    return res.ok
  } catch {
    return false
  }
}

test.beforeAll(async () => {
  test.skip(!(await liveServerReachable()), `no live opencode server at ${LIVE_URL}`)
})

test.describe("live server: real opencode end-to-end", () => {
  test("shows the real server version and connects", async ({ page }) => {
    const health = await (await fetch(`${LIVE_URL}/global/health`)).json()
    await page.goto("/")
    await expect(page.locator("#status")).toHaveText("connected", { timeout: 10_000 })
    await expect(page.locator("#version")).toHaveText(`v${health.version}`, { timeout: 10_000 })
  })

  test("creates and deletes a real session through the UI", async ({ page }) => {
    await page.goto("/")
    await expect(page.locator("#status")).toHaveText("connected", { timeout: 10_000 })

    await page.locator("#new-session").click()
    const created = page
      .locator("#sessions [data-testid=session-title]")
      .filter({ hasText: "Created via e2e" })
    await expect(created).toBeVisible({ timeout: 15_000 })

    const row = page.locator("#sessions li").filter({ hasText: "Created via e2e" })
    await row.locator("button[aria-label=delete]").click()
    await expect(created).toHaveCount(0, { timeout: 15_000 })
  })
})
