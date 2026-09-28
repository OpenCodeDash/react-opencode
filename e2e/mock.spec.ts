import { test, expect, type Page } from "@playwright/test"
import { startMockOpencode, type MockOpencode } from "./mock-server"

let mock: MockOpencode

test.beforeAll(async () => {
  mock = await startMockOpencode()
})

test.afterAll(async () => {
  await mock.close()
})

test.beforeEach(async ({ page }) => {
  await page.addInitScript(
    (url) => {
      ;(window as unknown as Record<string, string>).__OPENCODE_URL__ = url
    },
    mock.url,
  )
  await page.goto("/")
})

test.describe("mock server: full reactive cycle in a real browser", () => {
  test("connects over SSE and shows the server version", async ({ page }) => {
    await expect(page.locator("#status")).toHaveText("connected", { timeout: 10_000 })
    await expect(page.locator("#version")).toHaveText("vmock-1.0", { timeout: 10_000 })
  })

  test("lists sessions hydrated from REST", async ({ page }) => {
    await expect(page.locator("#status")).toHaveText("connected", { timeout: 10_000 })
    await expect(page.locator("#sessions [data-testid=session-title]")).toHaveText(
      ["Demo"],
      { timeout: 10_000 },
    )
  })

  test("prompt → streaming text → permission prompt → reply → idle", async ({ page }) => {
    await expect(page.locator("#status")).toHaveText("connected", { timeout: 10_000 })
    await expect(page.locator("#sessions [data-testid=session-title]")).toHaveText("Demo")

    await page.locator("#input").fill("hi")
    await page.locator("#send").click()

    // user message appears immediately
    await expect(page.locator("#messages .msg.user")).toContainText("hi")

    // busy indicator appears while the mock works
    await expect(page.locator("#busy")).toBeVisible({ timeout: 5_000 })

    // assistant text streams in: partial, then complete
    await expect(page.locator("#messages .msg.assistant [data-testid=message-text]")).toHaveText(
      /Hello from the opencode mock server!/,
      { timeout: 10_000 },
    )

    // permission request arrives live over SSE
    const permission = page.locator("#permission-per_mock_1")
    await expect(permission).toBeVisible({ timeout: 10_000 })

    // replying clears the prompt and the session goes idle
    await permission.click()
    await expect(permission).toBeHidden()
    await expect(page.locator("#busy")).toBeHidden({ timeout: 5_000 })
  })

  test("session created over REST appears live via session.created event", async ({ page }) => {
    await expect(page.locator("#status")).toHaveText("connected", { timeout: 10_000 })
    await page.locator("#new-session").click()
    await expect(page.locator("#sessions [data-testid=session-title]").filter({ hasText: "Created via e2e" })).toBeVisible({
      timeout: 10_000,
    })
    const titles = page.locator("#sessions [data-testid=session-title]")
    await expect(titles).toHaveCount(2)
  })

  test("deleting a session removes it live via session.deleted event", async ({ page }) => {
    await expect(page.locator("#status")).toHaveText("connected", { timeout: 10_000 })
    const demo = page.locator("#sessions li").filter({ hasText: "Demo" })
    await expect(demo).toBeVisible()
    const before = await page.locator("#sessions li").count()
    await demo.locator("button[aria-label=delete]").click()
    await expect(page.locator("#sessions li").filter({ hasText: "Demo" })).toHaveCount(0, {
      timeout: 10_000,
    })
    expect(await page.locator("#sessions li").count()).toBe(before - 1)
  })

  test("the client actually called the opencode REST endpoints", async () => {
    // after the tests above, the mock must have served a real opencode API surface
    const paths = mock.requests.map((r) => `${r.method} ${r.path}`)
    expect(paths).toContain("GET /global/health")
    expect(paths).toContain("GET /session")
    expect(paths).toContain("POST /session/ses_mock_1/message")
    expect(paths).toContain("POST /permission/per_mock_1/reply")
    expect(paths).toContain("DELETE /session/ses_mock_1")
  })
})
