import { expect, test } from "@playwright/test";

test("the floating page scrollbar overlays content and remains keyboard accessible", async ({ page }) => {
  await page.setViewportSize({ width: 844, height: 390 });
  await page.goto("/");
  await page.getByLabel("访问密码").fill("browser-regression-password");
  await page.getByRole("button", { name: "进入工作空间" }).click();

  const scrollbar = page.getByRole("scrollbar", { name: "页面滚动位置" });
  await expect(scrollbar).toBeVisible();
  expect(await page.evaluate(() => getComputedStyle(document.documentElement).scrollbarWidth)).toBe("none");
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.evaluate(() => {
    const button = document.createElement("button");
    button.id = "edge-click-target";
    button.textContent = "边缘操作";
    button.style.cssText = "position:fixed;inset-inline-end:0;top:50%;transform:translateY(-50%);inline-size:48px;block-size:44px;z-index:44";
    button.addEventListener("click", () => { button.dataset.clicked = "true"; });
    document.body.append(button);
  });
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.waitForTimeout(1000);
  await expect(scrollbar).toHaveCSS("opacity", "0");
  await expect(scrollbar).toHaveCSS("pointer-events", "none");
  await page.mouse.click(839, 195);
  await expect(page.locator("#edge-click-target")).toHaveAttribute("data-clicked", "true");
  await page.locator("#edge-click-target").evaluate((button) => button.remove());

  await page.evaluate(() => window.scrollTo(0, 400));
  await expect.poll(async () => Number(await scrollbar.getAttribute("aria-valuenow"))).toBeGreaterThan(0);
  await expect(scrollbar).toHaveCSS("pointer-events", "auto");
  await page.screenshot({ path: test.info().outputPath("floating-scrollbar-landscape.png"), fullPage: true, animations: "disabled" });
  const track = await scrollbar.boundingBox();
  expect(track).not.toBeNull();
  await scrollbar.click({ position: { x: track!.width / 2, y: track!.height * 0.8 } });
  await expect.poll(() => page.evaluate(() => window.scrollY)).toBeGreaterThan(400);

  await scrollbar.focus();
  await scrollbar.press("End");
  await expect.poll(() => page.evaluate(() => window.scrollY)).toBeGreaterThan(0);
  await scrollbar.press("Home");
  await expect.poll(() => page.evaluate(() => window.scrollY)).toBe(0);
});
