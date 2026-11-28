import { expect, test } from "@playwright/test";

test("unsaved history retention changes protect navigation and remain editable", async ({ page }) => {
  await page.goto("/");
  await page.getByLabel("访问密码").fill("browser-regression-password");
  await page.getByRole("button", { name: "进入工作空间" }).click();
  await expect(page.getByRole("heading", { name: "提醒概览" })).toBeVisible();
  const before = await page.request.get("/api/settings").then((response) => response.json());
  const draft = String(before.settings.historyRetentionDays === 47 ? 48 : 47);
  await page.goto("/settings");
  await page.getByRole("tab", { name: "记录维护", exact: true }).click();
  const retention = page.getByRole("textbox", { name: /自动保留天数/ });
  await retention.fill(draft);
  await retention.press("Tab");
  await page.getByRole("treegrid", { name: "主导航" }).getByRole("row", { name: "投递记录", exact: true }).click();
  const confirmation = page.getByRole("alertdialog", { name: "放弃尚未保存的修改？", exact: true });
  await expect(confirmation).toBeVisible();
  await page.screenshot({ path: test.info().outputPath("retention-unsaved.png"), animations: "disabled" });
  await confirmation.getByRole("button", { name: "继续编辑", exact: true }).click();
  await expect(page).toHaveURL(/\/settings$/);
  await expect(retention).toHaveValue(draft);
  await page.getByRole("treegrid", { name: "主导航" }).getByRole("row", { name: "投递记录", exact: true }).click();
  await confirmation.getByRole("button", { name: "离开页面", exact: true }).click();
  await expect(page).toHaveURL(/\/deliveries$/);
  const settings = await page.request.get("/api/settings").then((response) => response.json());
  expect(settings.settings.historyRetentionDays).toBe(before.settings.historyRetentionDays);
});
