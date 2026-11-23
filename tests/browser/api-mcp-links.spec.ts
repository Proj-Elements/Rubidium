import { expect, test } from "@playwright/test";

test("API and MCP documentation links expose a copyable MCP endpoint", async ({ page }) => {
  await page.addInitScript(() => {
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: {
        writeText: async (value: string) => window.localStorage.setItem("browser-test-clipboard", value),
      },
    });
  });
  await page.setViewportSize({ width: 844, height: 390 });
  await page.goto("/");
  await page.getByLabel("访问密码").fill("browser-regression-password");
  await page.getByRole("button", { name: "进入工作空间" }).click();
  await page.goto("/settings");
  await page.getByRole("tab", { name: "访问安全", exact: true }).click();

  const apiDocs = page.getByRole("link", { name: "API 文档", exact: true });
  const mcpDocs = page.getByRole("link", { name: "MCP 文档", exact: true });
  await expect(apiDocs).toHaveAttribute("href", "https://github.com/Proj-Elements/Rubidium/blob/main/docs/api-mcp.md#http-api");
  await expect(mcpDocs).toHaveAttribute("href", "https://github.com/Proj-Elements/Rubidium/blob/main/docs/api-mcp.md#mcp-streamable-http");
  await expect(apiDocs.locator("svg")).toBeVisible();
  await expect(mcpDocs.locator("svg")).toBeVisible();
  expect(await apiDocs.evaluate((link) => link.firstElementChild?.tagName)).toBe("svg");
  expect(await mcpDocs.evaluate((link) => link.firstElementChild?.tagName)).toBe("svg");
  const [apiDocsBox, mcpDocsBox] = await Promise.all([apiDocs.boundingBox(), mcpDocs.boundingBox()]);
  expect(apiDocsBox).not.toBeNull();
  expect(mcpDocsBox).not.toBeNull();
  expect(mcpDocsBox!.x).toBeGreaterThan(apiDocsBox!.x + apiDocsBox!.width);
  expect(Math.abs(apiDocsBox!.y + apiDocsBox!.height / 2 - mcpDocsBox!.y - mcpDocsBox!.height / 2)).toBeLessThanOrEqual(1);

  const toggle = page.getByRole("button", { name: "MCP 地址", exact: true });
  const address = page.getByLabel("MCP 服务地址", { exact: true });
  await expect(address).toHaveCount(0);
  await toggle.click();
  await expect(toggle).toHaveAttribute("aria-expanded", "true");
  const expectedAddress = `${new URL(page.url()).origin}/api/mcp`;
  await expect(address).toHaveValue(expectedAddress);
  await page.getByRole("button", { name: "复制 MCP 地址", exact: true }).click();
  await expect(page.getByText("MCP 地址已复制。", { exact: true })).toBeVisible();
  expect(await page.evaluate(() => localStorage.getItem("browser-test-clipboard"))).toBe(expectedAddress);
});
