import { expect, test } from "@playwright/test";

test("delivery status filter is framed, rounded, scrollable, and right-aligned", async ({ page }) => {
  await page.setViewportSize({ width: 844, height: 180 });
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
  const listbox = popover.locator(":scope > .list-box");
  await expect(popover).toBeVisible();
  expect(await popover.evaluate((element) => Number.parseFloat(getComputedStyle(element).borderTopLeftRadius))).toBeGreaterThan(8);
  await expect(listbox).toHaveCSS("overflow-y", "auto");
  const scrollBounds = await listbox.evaluate((element) => {
    const bounds = element.getBoundingClientRect();
    const outer = element.parentElement!.getBoundingClientRect();
    return { bottomInset: outer.bottom - bounds.bottom, clientHeight: element.clientHeight, rightInset: outer.right - bounds.right, scrollHeight: element.scrollHeight };
  });
  expect(scrollBounds.scrollHeight).toBeGreaterThan(scrollBounds.clientHeight);
  expect(scrollBounds.rightInset).toBeGreaterThanOrEqual(0);
  expect(scrollBounds.bottomInset).toBeGreaterThanOrEqual(0);
  await listbox.hover();
  await page.mouse.wheel(0, 120);
  await expect.poll(() => listbox.evaluate((element) => element.scrollTop)).toBeGreaterThan(0);
  await page.screenshot({ path: test.info().outputPath("delivery-filter-open-rounded.png"), animations: "disabled" });
  await page.getByRole("option", { name: "待投递", exact: true }).click();
  await expect(page.getByRole("button", { name: /待投递/ })).toBeVisible();
  await page.screenshot({ path: test.info().outputPath("delivery-filter-landscape.png"), fullPage: true, animations: "disabled" });
});
