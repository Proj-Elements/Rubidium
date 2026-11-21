import { expect, test } from "@playwright/test";

const pages = [
  ["/", "工作概览 - Rubidium"],
  ["/tasks", "所有提醒 - Rubidium"],
  ["/deliveries", "投递记录 - Rubidium"],
  ["/settings", "推送设置 - Rubidium"],
] as const;

test("each workspace route has a descriptive branded browser title", async ({ page }) => {
  for (const [path, title] of pages) {
    await page.goto(path);
    await expect(page).toHaveTitle(title);
  }
});
