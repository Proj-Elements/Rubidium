import { expect, test } from "@playwright/test";

test("language choice updates page content, metadata and persists across navigation", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "登录工作空间" })).toBeVisible();
  await page.getByLabel("访问密码").fill("browser-regression-password");
  await page.getByRole("button", { name: "进入工作空间" }).click();
  await expect(page.getByRole("heading", { name: "提醒概览" })).toBeVisible();

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
});
