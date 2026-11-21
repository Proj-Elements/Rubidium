import { expect, test } from "@playwright/test";

test("appearance cycles through system, light, and dark while tracking OS changes", async ({ page }) => {
  await page.setViewportSize({ width: 844, height: 390 });
  await page.emulateMedia({ colorScheme: "dark" });
  await page.goto("/");
  await page.getByLabel("访问密码").fill("browser-regression-password");
  await page.getByRole("button", { name: "进入工作空间" }).click();

  const theme = page.getByRole("button", { name: /外观：/ });
  await expect(theme).toHaveAccessibleName("外观：跟随系统，切换为浅色");
  await expect.poll(() => page.evaluate(() => getComputedStyle(document.documentElement).colorScheme)).toBe("dark");
  await page.screenshot({ path: test.info().outputPath("system-dark-landscape.png"), animations: "disabled" });
  await theme.click();
  await expect(theme).toHaveAccessibleName("外观：浅色，切换为深色");
  await expect.poll(() => page.evaluate(() => localStorage.getItem("barker:appearance"))).toBe("light");
  await expect.poll(() => page.evaluate(() => getComputedStyle(document.documentElement).colorScheme)).toBe("light");
  await page.screenshot({ path: test.info().outputPath("explicit-light-landscape.png"), animations: "disabled" });
  await theme.click();
  await expect(theme).toHaveAccessibleName("外观：深色，切换为跟随系统");
  await theme.click();
  await expect(theme).toHaveAccessibleName("外观：跟随系统，切换为浅色");
  await page.reload();
  await expect(page.getByRole("button", { name: "外观：跟随系统，切换为浅色" })).toBeVisible();
  await page.emulateMedia({ colorScheme: "light" });
  await expect.poll(() => page.evaluate(() => getComputedStyle(document.documentElement).colorScheme)).toBe("light");
  await page.emulateMedia({ colorScheme: "dark" });
  await expect.poll(() => page.evaluate(() => getComputedStyle(document.documentElement).colorScheme)).toBe("dark");
});
