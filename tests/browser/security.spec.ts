import { expect, test } from "@playwright/test";

test("API credentials can remain valid indefinitely and display the selected expiry", async ({ page }) => {
  await page.setViewportSize({ width: 844, height: 390 });
  await page.goto("/");
  await expect(page).toHaveTitle(/Rubidium/);
  await page.getByLabel("访问密码").fill("browser-regression-password");
  await page.getByRole("button", { name: "进入工作空间" }).click();
  await expect(page.getByRole("heading", { name: "提醒概览" })).toBeVisible();

  await page.goto("/settings");
  await page.getByRole("tab", { name: "访问安全", exact: true }).click();
  const apiHeading = page.getByRole("heading", { name: "API 凭据", exact: true });
  const sessionsHeading = page.getByRole("heading", { name: "有效会话", exact: true });
  await expect(apiHeading).toBeVisible();
  await expect(sessionsHeading).toBeVisible();
  const apiCard = page.locator(".card").filter({ has: apiHeading });
  const sessionsCard = page.locator(".card").filter({ has: sessionsHeading });
  await expect(apiCard).toHaveCount(1);
  await expect(sessionsCard).toHaveCount(1);
  await expect(page.getByRole("list", { name: "有效会话" })).toBeVisible();
  await page.screenshot({ path: test.info().outputPath("security-sections-landscape.png"), fullPage: true, animations: "disabled" });

  await page.setViewportSize({ width: 1440, height: 900 });
  const apiBounds = await apiCard.boundingBox();
  const sessionsBounds = await sessionsCard.boundingBox();
  expect(apiBounds).not.toBeNull();
  expect(sessionsBounds).not.toBeNull();
  expect(apiBounds!.x).not.toBe(sessionsBounds!.x);
  await page.screenshot({ path: test.info().outputPath("security-sections-wide.png"), fullPage: true, animations: "disabled" });

  await page.setViewportSize({ width: 844, height: 390 });
  await page.getByRole("button", { name: "创建 API 凭据", exact: true }).click();
  const credentialName = `永久有效的 API 凭据-${test.info().project.name}`;
  await page.getByLabel("凭据名称").fill(credentialName);
  const days = page.getByRole("textbox", { name: "有效天数", exact: true });
  await days.fill("0");

  const info = page.getByRole("button", { name: "有效天数说明", exact: true });
  const infoBounds = await info.boundingBox();
  expect(infoBounds?.width).toBeGreaterThanOrEqual(44);
  expect(infoBounds?.height).toBeGreaterThanOrEqual(44);
  await info.hover();
  await expect(page.getByText("0 表示永不过期；1–365 表示有效天数。", { exact: true })).toBeVisible();
  await page.screenshot({ path: test.info().outputPath("permanent-credential-tooltip.png"), animations: "disabled" });

  await page.getByRole("button", { name: "创建凭据", exact: true }).click();
  const credential = page.getByRole("list", { name: "API 凭据" }).getByRole("listitem").filter({ hasText: credentialName });
  await expect(credential).toContainText("永不过期");
  const token = await page.getByLabel("新 API 凭据").inputValue();
  expect(token.length).toBeGreaterThan(20);
  const status = await page.evaluate(async (value) => (await fetch("/api/tasks", { headers: { Authorization: `Bearer ${value}` } })).status, token);
  expect(status).toBe(200);
  await page.screenshot({ path: test.info().outputPath("permanent-credential-landscape.png"), fullPage: true, animations: "disabled" });
});
