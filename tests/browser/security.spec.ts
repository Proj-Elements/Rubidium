import { expect, test } from "@playwright/test";

test("password changes require a matching confirmation", async ({ page }) => {
  await page.setViewportSize({ width: 844, height: 390 });
  await page.goto("/");
  await page.getByLabel("访问密码").fill("browser-regression-password");
  await page.getByRole("button", { name: "进入工作空间" }).click();
  await page.goto("/settings");
  await page.getByRole("tab", { name: "访问安全", exact: true }).click();

  await page.getByLabel("当前访问密码").fill("browser-regression-password");
  await page.getByLabel("新访问密码", { exact: true }).fill("confirmed-password-2030");
  const confirmation = page.getByLabel("确认新访问密码");
  await confirmation.fill("different-password-2030");
  await expect(page.getByText("两次输入的新访问密码不一致")).toBeVisible();
  await expect(page.getByRole("button", { name: "修改访问密码" })).toBeDisabled();
  await page.screenshot({ path: test.info().outputPath("password-confirmation-mismatch-landscape.png"), fullPage: true, animations: "disabled" });

  await confirmation.fill("confirmed-password-2030");
  await expect(page.getByText("两次输入的新访问密码不一致")).toHaveCount(0);
  await expect(page.getByRole("button", { name: "修改访问密码" })).toBeEnabled();
  await page.setViewportSize({ width: 568, height: 320 });
  await confirmation.scrollIntoViewIfNeeded();
  expect(await confirmation.evaluate((input) => input.getBoundingClientRect().height)).toBeGreaterThanOrEqual(44);
  await page.screenshot({ path: test.info().outputPath("password-confirmation-short-landscape.png"), animations: "disabled" });
});

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

test("sessions stay bounded and recover from last-page revocations in landscape", async ({ page }) => {
  await page.setViewportSize({ width: 568, height: 320 });
  await page.goto("/");
  await page.getByLabel("访问密码").fill("browser-regression-password");
  await page.getByRole("button", { name: "进入工作空间" }).click();

  const currentSessionId = await page.evaluate(async () => {
    const readState = async () => fetch("/api/security?page=1").then((response) => response.json()) as Promise<{
      sessions: Array<{ id: string }>;
      sessionPagination: { total: number };
    }>;
    let state = await readState();
    const currentId = state.sessions[0]?.id;
    if (!currentId) throw new Error("The current browser session was not returned");
    while (state.sessionPagination.total > 1) {
      const candidate = state.sessions.find((item) => item.id !== currentId);
      if (!candidate) throw new Error("Could not find a non-current session to revoke");
      const response = await fetch("/api/security", {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ action: "revoke", id: candidate.id, kind: "session" }),
      });
      if (!response.ok) throw new Error(`Could not clear prior sessions: ${response.status}`);
      state = await readState();
    }
    return currentId;
  });
  expect(currentSessionId).toBeTruthy();

  for (let index = 0; index < 11; index += 1) {
    const status = await page.evaluate(async () => fetch("/api/session", {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ password: "browser-regression-password" }),
    }).then((response) => response.status));
    expect(status).toBe(200);
  }

  await page.goto("/settings");
  await page.getByRole("tab", { name: "访问安全", exact: true }).click();
  await expect(page.getByRole("list", { name: "有效会话" }).getByRole("listitem")).toHaveCount(10);
  await expect(page.getByText("1–10 / 12 条", { exact: true })).toBeVisible();
  const next = page.getByRole("button", { name: "下一页", exact: true });
  expect((await next.boundingBox())?.height).toBeGreaterThanOrEqual(44);
  await next.click();
  await expect(page.getByText("11–12 / 12 条", { exact: true })).toBeVisible();
  await expect(page.getByRole("list", { name: "有效会话" }).getByRole("listitem")).toHaveCount(2);
  await page.screenshot({ path: test.info().outputPath("security-sessions-page-two-short-landscape.png"), fullPage: true, animations: "disabled" });

  for (let index = 0; index < 2; index += 1) {
    await page.getByRole("button", { name: "撤销会话", exact: true }).first().click();
    await expect(page.getByRole("alertdialog", { name: /撤销「会话/ })).toBeVisible();
    await page.getByRole("button", { name: "确认撤销", exact: true }).click();
    if (index === 0) await expect(page.getByText("11–11 / 11 条", { exact: true })).toBeVisible();
  }

  await expect(page.getByText("1–10 / 10 条", { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "上一页", exact: true })).toHaveCount(0);
  await page.screenshot({ path: test.info().outputPath("security-sessions-after-last-revoke-short-landscape.png"), fullPage: true, animations: "disabled" });
  await page.setViewportSize({ width: 844, height: 390 });
  await page.screenshot({ path: test.info().outputPath("security-sessions-landscape.png"), fullPage: true, animations: "disabled" });
});
