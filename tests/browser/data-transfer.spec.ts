import { expect, test } from "@playwright/test";
import { readFileSync } from "node:fs";

test("encrypted data export and confirmed import preserve data after a wrong password", async ({ page }) => {
  await page.setViewportSize({ width: 844, height: 390 });
  await page.goto("/");
  await page.getByLabel("访问密码").fill("browser-regression-password");
  await page.getByRole("button", { name: "进入工作空间" }).click();
  await page.request.post("/api/tasks", { data: {
    name: "加密备份中的提醒", startsAt: "2035-04-01T09:00:00+00:00", preset: "once", cron: "0 9 * * *", repeatCount: 1, endDate: null, timeZone: "UTC",
  } });

  await page.goto("/settings");
  await page.getByRole("tab", { name: "记录维护" }).click();
  await page.screenshot({ path: test.info().outputPath("data-transfer-initial-landscape.png"), animations: "disabled" });
  const exportEntry = page.getByRole("button", { name: "导出数据" });
  const importEntry = page.getByRole("button", { name: "导入数据" });
  await expect(exportEntry).toBeVisible();
  await expect(importEntry).toBeVisible();
  expect(await exportEntry.evaluate((button) => button.getBoundingClientRect().height)).toBeGreaterThanOrEqual(44);
  expect(await importEntry.evaluate((button) => button.getBoundingClientRect().height)).toBeGreaterThanOrEqual(44);
  await expect(page.getByLabel("加密密码")).toBeHidden();
  await expect(page.getByLabel("解密密码")).toBeHidden();
  await page.getByRole("button", { name: "导出数据" }).click();
  const exportDialog = page.getByRole("dialog", { name: "导出加密数据" });
  await expect(exportDialog).toBeVisible();
  await page.screenshot({ path: test.info().outputPath("data-transfer-export-dialog-landscape.png"), animations: "disabled" });
  await exportDialog.getByLabel("加密密码").fill("secure-export-password-2035");
  const downloadPromise = page.waitForEvent("download");
  await exportDialog.getByRole("button", { name: "导出加密文件" }).click();
  const download = await downloadPromise;
  const encryptedFile = readFileSync((await download.path())!);
  const envelope = JSON.parse(encryptedFile.toString("utf8")) as { format: string };
  expect(envelope.format).toBe("rubidium-encrypted-export");
  expect(encryptedFile.toString("utf8")).not.toContain("加密备份中的提醒");
  await expect(exportDialog.getByRole("status")).toContainText("加密数据文件已导出");
  await exportDialog.getByRole("button", { name: "取消" }).click();
  await page.screenshot({ path: test.info().outputPath("encrypted-data-settings-landscape.png"), fullPage: true, animations: "disabled" });

  await page.request.post("/api/tasks", { data: {
    name: "密码错误后保留", startsAt: "2035-05-01T09:00:00+00:00", preset: "once", cron: "0 9 * * *", repeatCount: 1, endDate: null, timeZone: "UTC",
  } });
  await page.getByRole("button", { name: "导入数据" }).click();
  let importDialog = page.getByRole("dialog", { name: "导入加密数据" });
  await expect(importDialog).toBeVisible();
  await importDialog.locator('input[type="file"][aria-label="加密数据文件"]').setInputFiles({ name: download.suggestedFilename(), mimeType: "application/vnd.rubidium.encrypted+json", buffer: encryptedFile });
  await expect(page.getByText(download.suggestedFilename(), { exact: true })).toBeVisible();
  const removeFile = page.getByRole("button", { name: "移除所选文件" });
  expect(await removeFile.evaluate((button) => button.getBoundingClientRect().height)).toBeGreaterThanOrEqual(44);
  await page.screenshot({ path: test.info().outputPath("encrypted-file-selected-landscape.png"), fullPage: true, animations: "disabled" });
  await page.screenshot({ path: test.info().outputPath("encrypted-file-viewport-landscape.png"), animations: "disabled" });
  await page.setViewportSize({ width: 568, height: 320 });
  await page.screenshot({ path: test.info().outputPath("encrypted-file-short-landscape.png"), animations: "disabled" });
  await expect(importDialog.getByLabel("解密密码")).toBeInViewport({ ratio: 1 });
  await expect(importDialog.getByRole("button", { name: "继续导入" })).toBeInViewport({ ratio: 1 });
  await page.setViewportSize({ width: 844, height: 390 });
  await importDialog.getByLabel("解密密码").fill("incorrect-export-password-2035");
  await importDialog.getByRole("button", { name: "继续导入" }).click();
  importDialog = page.getByRole("dialog", { name: "确认替换数据" });
  await expect(importDialog).toBeVisible();
  await page.screenshot({ path: test.info().outputPath("data-transfer-import-confirm-landscape.png"), animations: "disabled" });
  await importDialog.getByRole("button", { name: "导入并替换数据" }).click();
  await expect(page.getByRole("dialog", { name: "导入加密数据" }).getByRole("alert")).toContainText(/密码错误或导出文件损坏/);
  let tasks = await (await page.request.get("/api/tasks")).json();
  expect(tasks.tasks.map((task: { name: string }) => task.name)).toContain("密码错误后保留");

  importDialog = page.getByRole("dialog", { name: "导入加密数据" });
  await importDialog.getByLabel("解密密码").fill("secure-export-password-2035");
  await importDialog.getByRole("button", { name: "继续导入" }).click();
  importDialog = page.getByRole("dialog", { name: "确认替换数据" });
  await importDialog.getByRole("button", { name: "导入并替换数据" }).click();
  await expect(page).toHaveURL(/\/$/);
  await page.goto("/tasks");
  tasks = await (await page.request.get("/api/tasks")).json();
  expect(tasks.tasks.map((task: { name: string }) => task.name)).toContain("加密备份中的提醒");
  expect(tasks.tasks.map((task: { name: string }) => task.name)).not.toContain("密码错误后保留");
});
