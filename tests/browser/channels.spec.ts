import { expect, test, type Page } from "@playwright/test";

async function login(page: Page) {
  await page.goto("/");
  await page.getByLabel("访问密码").fill("browser-regression-password");
  await page.getByRole("button", { name: "进入工作空间" }).click();
  await expect(page.getByRole("heading", { name: "提醒概览" })).toBeVisible();
}

async function noHorizontalOverflow(page: Page) {
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
}

test("Bark and Ntfy channels are manageable and selectable in touch landscape", async ({ page }) => {
  await page.setViewportSize({ width: 844, height: 390 });
  await login(page);

  const existing = await (await page.request.get("/api/channels")).json();
  for (const channel of existing.channels.filter((item: { isDefault: boolean }) => !item.isDefault)) {
    await page.request.delete(`/api/channels?id=${encodeURIComponent(channel.id)}`, { headers: { "if-match": String(channel.revision) } });
  }

  let testStatus = 200;
  await page.route("**/api/channels/**/test", async (route) => {
    await route.fulfill({
      status: testStatus,
      contentType: "application/json",
      body: JSON.stringify(testStatus === 200 ? { delivered: true } : { error: "Mock Ntfy refusal" }),
    });
  });

  await page.goto("/settings");
  await expect(page.getByRole("heading", { name: "通知渠道", exact: true })).toBeVisible();
  await expect(page.getByRole("tab", { name: "连接配置", exact: true })).toHaveCount(0);
  await expect(page.getByRole("tab", { name: "更多设备", exact: true })).toHaveCount(0);
  await expect(page.getByRole("heading", { name: "通知预览", exact: true })).toHaveCount(0);
  await noHorizontalOverflow(page);
  const initialDefault = existing.channels.find((item: { isDefault: boolean }) => item.isDefault);
  expect(initialDefault).toBeTruthy();
  const initialDefaultName = initialDefault.name as string;
  const defaultCard = () => page.getByRole("listitem").filter({ has: page.getByRole("button", { name: `编辑 ${initialDefaultName}`, exact: true }) });
  await expect(defaultCard()).toContainText("默认");
  await defaultCard().getByRole("button", { name: `编辑 ${initialDefaultName}`, exact: true }).click();
  let defaultDialog = page.getByRole("dialog", { name: "编辑通知渠道", exact: true });
  await defaultDialog.getByLabel("渠道名称", { exact: true }).fill("Primary Ntfy");
  await defaultDialog.locator(".select__trigger").click();
  await page.getByRole("option", { name: "Ntfy", exact: true }).click();
  await defaultDialog.getByLabel("服务地址", { exact: true }).fill("https://ntfy.default.example");
  await defaultDialog.getByLabel("Ntfy 主题", { exact: true }).fill("primary-alerts");
  await defaultDialog.getByRole("button", { name: "保存渠道", exact: true }).click();
  const defaultNtfyCard = page.getByRole("listitem").filter({ has: page.getByRole("button", { name: "编辑 Primary Ntfy", exact: true }) });
  await expect(defaultNtfyCard).toContainText("Ntfy");
  await expect(defaultNtfyCard.getByText("默认", { exact: true })).toBeVisible();
  await expect(defaultNtfyCard.getByRole("button", { name: "发送测试", exact: true })).toBeEnabled();
  await page.screenshot({ path: test.info().outputPath("default-ntfy-landscape-844x390.png"), animations: "disabled" });

  await defaultNtfyCard.getByRole("button", { name: "编辑 Primary Ntfy", exact: true }).click();
  defaultDialog = page.getByRole("dialog", { name: "编辑通知渠道", exact: true });
  await defaultDialog.getByLabel("渠道名称", { exact: true }).fill(initialDefaultName);
  await defaultDialog.locator(".select__trigger").click();
  await page.getByRole("option", { name: "Bark", exact: true }).click();
  await defaultDialog.getByLabel("服务地址", { exact: true }).fill(initialDefault.endpoint);
  await defaultDialog.getByLabel("Device Key", { exact: true }).fill("browser-default-bark-key");
  await defaultDialog.getByRole("button", { name: "保存渠道", exact: true }).click();
  const restoredSettings = await (await page.request.get("/api/settings")).json();
  const cleared = await page.request.put("/api/settings", { data: { ...restoredSettings.settings, revision: restoredSettings.revision, clearDeviceKey: true } });
  expect(cleared.status()).toBe(200);
  await page.reload();
  await expect(page.getByRole("heading", { name: "通知渠道", exact: true })).toBeVisible();
  await expect(page.getByRole("listitem").filter({ has: page.getByRole("button", { name: `编辑 ${initialDefaultName}`, exact: true }) })).toContainText("Bark");

  await page.screenshot({ path: test.info().outputPath("channels-landscape-844x390.png"), animations: "disabled" });

  await page.getByRole("button", { name: "添加渠道", exact: true }).click();
  let dialog = page.getByRole("dialog", { name: "添加渠道", exact: true });
  await expect(dialog).toBeVisible();
  const closeBounds = await dialog.getByRole("button", { name: "关闭渠道编辑", exact: true }).evaluate((button) => {
    const bounds = button.getBoundingClientRect();
    return { width: bounds.width, height: bounds.height };
  });
  expect(closeBounds.width).toBeGreaterThanOrEqual(44);
  expect(closeBounds.height).toBeGreaterThanOrEqual(44);
  await dialog.locator(".select__trigger").click();
  await page.getByRole("option", { name: "Ntfy", exact: true }).click();
  await dialog.getByLabel("渠道名称", { exact: true }).fill("QA Ntfy");
  await dialog.getByLabel("服务地址", { exact: true }).fill("https://ntfy.example");
  await dialog.getByLabel("Ntfy 主题", { exact: true }).fill("rubidium-qa");
  await dialog.getByLabel("访问令牌", { exact: true }).fill("browser-ntfy-token");
  for (const label of ["渠道名称", "服务地址", "Ntfy 主题", "访问令牌"]) {
    expect((await dialog.getByLabel(label, { exact: true }).boundingBox())!.height).toBeGreaterThanOrEqual(44);
  }
  expect((await dialog.getByRole("button", { name: "保存渠道", exact: true }).boundingBox())!.height).toBeGreaterThanOrEqual(44);
  await dialog.getByLabel("渠道名称", { exact: true }).scrollIntoViewIfNeeded();
  await page.screenshot({ path: test.info().outputPath("channel-create-844x390.png"), animations: "disabled" });
  await dialog.getByRole("button", { name: "保存渠道", exact: true }).click();

  const channel = page.getByRole("listitem").filter({ hasText: "QA Ntfy" });
  await expect(channel).toContainText("https://ntfy.example");
  await expect(channel).toContainText("rubidium-qa");
  await expect(channel.getByRole("button", { name: "发送测试", exact: true })).toBeEnabled();
  for (const button of [
    channel.getByRole("button", { name: "发送测试", exact: true }),
    channel.getByRole("button", { name: "编辑 QA Ntfy", exact: true }),
    channel.getByRole("button", { name: "删除 QA Ntfy", exact: true }),
  ]) expect((await button.boundingBox())!.height).toBeGreaterThanOrEqual(44);

  await channel.getByRole("button", { name: "发送测试", exact: true }).click();
  await expect(page.getByText("已向「QA Ntfy」发送测试通知。", { exact: true })).toBeVisible();
  testStatus = 502;
  await channel.getByRole("button", { name: "发送测试", exact: true }).click();
  await expect(page.getByText("Mock Ntfy refusal", { exact: true })).toBeVisible();

  await page.mouse.move(10, 350);
  await expect(page.getByText("Mock Ntfy refusal", { exact: true })).toBeHidden({ timeout: 8_000 });
  await page.setViewportSize({ width: 568, height: 320 });
  await channel.getByRole("button", { name: "编辑 QA Ntfy", exact: true }).click();
  dialog = page.getByRole("dialog", { name: "编辑通知渠道", exact: true });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByRole("heading", { name: "编辑通知渠道", exact: true })).toBeInViewport();
  await dialog.getByLabel("渠道名称", { exact: true }).fill("QA Ntfy Updated");
  await dialog.getByLabel("Ntfy 主题", { exact: true }).fill("rubidium-updated");
  for (const label of ["渠道名称", "服务地址", "Ntfy 主题", "访问令牌"]) {
    const field = dialog.getByLabel(label, { exact: true });
    await field.scrollIntoViewIfNeeded();
    await expect(field).toBeInViewport();
    expect((await field.boundingBox())!.height).toBeGreaterThanOrEqual(44);
  }
  await dialog.getByLabel("访问令牌", { exact: true }).scrollIntoViewIfNeeded();
  await page.screenshot({ path: test.info().outputPath("channel-edit-credentials-568x320.png"), animations: "disabled" });
  await dialog.getByRole("button", { name: "保存渠道", exact: true }).scrollIntoViewIfNeeded();
  await dialog.getByRole("button", { name: "保存渠道", exact: true }).click();
  const updated = page.getByRole("listitem").filter({ hasText: "QA Ntfy Updated" });
  await expect(updated).toContainText("rubidium-updated");
  await noHorizontalOverflow(page);

  await page.goto("/tasks");
  await page.getByRole("button", { name: "新建提醒", exact: true }).last().click();
  const editor = page.getByRole("dialog", { name: "新建提醒", exact: true });
  await expect(editor.getByLabel("通知渠道", { exact: true })).toBeVisible();
  await editor.getByLabel("通知渠道", { exact: true }).click();
  await page.getByRole("option", { name: "QA Ntfy Updated · Ntfy", exact: true }).click();
  await page.keyboard.press("Escape");
  await expect(editor.getByRole("button", { name: "QA Ntfy Updated · Ntfy 通知渠道", exact: true })).toBeVisible();
  await page.screenshot({ path: test.info().outputPath("task-channel-selection-568x320.png"), animations: "disabled" });
  await editor.getByRole("button", { name: "关闭编辑器", exact: true }).click();
  await page.getByRole("alertdialog").getByRole("button", { name: "放弃修改", exact: true }).click();

  await page.goto("/settings");
  const finalChannel = page.getByRole("listitem").filter({ hasText: "QA Ntfy Updated" });
  await finalChannel.getByRole("button", { name: "删除 QA Ntfy Updated", exact: true }).click();
  await expect(page.getByRole("alertdialog", { name: /删除渠道/ })).toBeVisible();
  await page.getByRole("alertdialog").getByRole("button", { name: "删除渠道", exact: true }).click();
  await expect(page.getByRole("listitem").filter({ hasText: "QA Ntfy Updated" })).toHaveCount(0);
  await noHorizontalOverflow(page);
});
