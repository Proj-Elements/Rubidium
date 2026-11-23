import { expect, test, type Page } from "@playwright/test";

async function checkTaskFilter(page: Page, options: string[], locale: string) {
  await page.locator(".record-filter .select__trigger").click();
  await expect(page.getByRole("option")).toHaveText(options);
  await page.screenshot({ path: test.info().outputPath(`task-filter-${locale}.png`), animations: "disabled" });
  await page.getByRole("option", { name: options[0], exact: true }).click();
}

test("language choice updates page content, metadata and persists across navigation", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "登录工作空间" })).toBeVisible();
  await page.getByLabel("访问密码").fill("browser-regression-password");
  await page.getByRole("button", { name: "进入工作空间" }).click();
  await expect(page.getByRole("heading", { name: "提醒概览" })).toBeVisible();
  await page.goto("/tasks");
  await checkTaskFilter(page, ["全部记录", "进行中", "已暂停", "排期结束", "已归档"], "zh-CN");
  await page.goto("/");

  const languageButton = page.getByRole("button", { name: "选择语言" });
  await expect(languageButton.locator("svg")).toBeVisible();
  await expect(languageButton).not.toContainText("文A");
  await languageButton.click();
  await page.getByRole("menuitem", { name: "English", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Reminder overview" })).toBeVisible();
  await expect(page.locator("html")).toHaveAttribute("lang", "en-US");
  await expect(page).toHaveTitle("Overview - Rubidium");
  await expect(page.getByRole("button", { name: "Choose language" })).toBeVisible();

  await page.goto("/tasks");
  await expect(page.getByRole("heading", { name: "All reminders" })).toBeVisible();
  await expect(page).toHaveTitle("All reminders - Rubidium");
  await checkTaskFilter(page, ["All deliveries", "Active", "Paused", "Completed", "Archived"], "en");
  await page.goto("/deliveries");
  await expect(page.getByRole("heading", { name: "Delivery history", exact: true })).toBeVisible();
  await expect(page).toHaveTitle("Delivery history - Rubidium");
  await page.goto("/settings");
  await expect(page.getByRole("heading", { name: "Settings", exact: true })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Notification channels" })).toBeVisible();
  await expect(page).toHaveTitle("Settings - Rubidium");

  await page.getByRole("button", { name: "Choose language" }).click();
  await page.getByRole("menuitem", { name: "繁體中文", exact: true }).click();
  await expect(page.getByRole("heading", { name: "推送設置", exact: true })).toBeVisible();
  await expect(page.locator("html")).toHaveAttribute("lang", "zh-TW");
  await expect(page).toHaveTitle("推送設置 - Rubidium");
  await expect(page.getByRole("button", { name: "選擇語言" })).toBeVisible();

  await page.goto("/tasks");
  await expect(page.getByRole("heading", { name: "所有提醒", exact: true })).toBeVisible();
  await expect(page.locator("html")).toHaveAttribute("lang", "zh-TW");
  await expect(page).toHaveTitle("所有提醒 - Rubidium");
  await checkTaskFilter(page, ["全部記錄", "進行中", "已暫停", "排期結束", "已歸檔"], "zh-TW");
});
