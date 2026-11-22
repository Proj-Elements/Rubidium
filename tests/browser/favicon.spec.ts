import { expect, test } from "@playwright/test";

test("app icon serves a transparent blue outline bell as an SVG favicon", async ({ page }) => {
  await page.goto("/");
  const iconHref = await page.locator('link[rel="icon"]').first().getAttribute("href");
  expect(iconHref).toContain("icon.svg");

  const iconUrl = new URL(iconHref!, page.url()).href;
  const response = await page.request.get(iconUrl);
  expect(response.status()).toBe(200);
  expect(response.headers()["content-type"]).toContain("image/svg+xml");
  const svg = await response.text();
  expect(svg).not.toContain("<rect");
  expect(svg).toContain('fill="none"');
  expect(svg).toContain('stroke="#0878e1"');

  await page.setViewportSize({ width: 128, height: 128 });
  await page.evaluate((src) => {
    document.body.replaceChildren();
    const preview = document.createElement("img");
    preview.src = src;
    preview.alt = "Rubidium bell app icon";
    preview.style.width = "128px";
    preview.style.height = "128px";
    document.body.append(preview);
  }, iconUrl);
  await expect(page.getByRole("img", { name: "Rubidium bell app icon" })).toBeVisible();
  await page.screenshot({ path: test.info().outputPath("rubidium-favicon.png"), animations: "disabled" });
});
