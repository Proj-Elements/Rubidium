import { expect, test } from "@playwright/test";

test("delivery status filter is framed, rounded, scrollable, and right-aligned", async ({ page }) => {
  await page.setViewportSize({ width: 844, height: 390 });
  await page.goto("/");
  await page.getByLabel("访问密码").fill("browser-regression-password");
  await page.getByRole("button", { name: "进入工作空间" }).click();
  await page.goto("/deliveries");

  const search = page.getByRole("searchbox", { name: "搜索记录" });
  const filter = page.getByRole("button", { name: /全部记录/ });
  await expect(search).toBeVisible();
  await expect(filter).toBeVisible();
  const [searchBox, filterBox] = await Promise.all([search.boundingBox(), filter.boundingBox()]);
  expect(searchBox).not.toBeNull();
  expect(filterBox).not.toBeNull();
  expect(filterBox!.x).toBeGreaterThan(searchBox!.x);
  expect(filterBox!.height).toBeGreaterThanOrEqual(44);
  expect(await filter.evaluate((element) => getComputedStyle(element).borderTopWidth)).toBe("1px");
  await page.screenshot({ path: test.info().outputPath("delivery-filter-before-open.png"), animations: "disabled" });
  await filter.click();
  const popover = page.locator(".select__popover:visible");
  await expect(popover).toBeVisible();
  expect(await popover.evaluate((element) => Number.parseFloat(getComputedStyle(element).borderTopLeftRadius))).toBeGreaterThan(8);
  await popover.evaluate((element) => { element.style.maxHeight = "7rem"; });
  await expect(popover).toHaveCSS("overflow-y", "auto");
  const scrollHeight = await popover.evaluate((element) => element.scrollHeight);
  const clientHeight = await popover.evaluate((element) => element.clientHeight);
  expect(scrollHeight).toBeGreaterThan(clientHeight);
  await popover.hover();
  await page.mouse.wheel(0, 120);
  await expect.poll(() => popover.evaluate((element) => element.scrollTop)).toBeGreaterThan(0);
  await page.screenshot({ path: test.info().outputPath("delivery-filter-open-rounded.png"), animations: "disabled" });
  await page.getByRole("option", { name: "待投递", exact: true }).click();
  await expect(page.getByRole("button", { name: /待投递/ })).toBeVisible();
  await page.screenshot({ path: test.info().outputPath("delivery-filter-landscape.png"), fullPage: true, animations: "disabled" });
});
