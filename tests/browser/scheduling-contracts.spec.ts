import { expect, test, type Page } from "@playwright/test";

async function login(page: Page) {
  await page.goto("/");
  await page.getByLabel("访问密码").fill("browser-regression-password");
  await page.getByRole("button", { name: "进入工作空间" }).click();
  await expect(page.getByRole("heading", { name: "提醒概览" })).toBeVisible();
}

test("editing and duplicating a reminder preserve its notification icon", async ({ page }) => {
  await login(page);
  const name = `Preserve icon ${test.info().project.name}`;
  const updatedName = `${name} updated`;
  const created = await page.request.post("/api/tasks", { data: {
    name, description: "Original", startsAt: "2030-11-04T09:30:00+08:00", timeZone: "Asia/Shanghai",
    preset: "weekly", cron: "30 9 * * 1", repeatCount: 4,
    notification: { sound: "alarm", group: "Original group", icon: "https://example.test/reminder.png" },
  } });
  expect(created.status()).toBe(201);
  const { task } = await created.json();
  await page.goto("/tasks");
  await page.getByRole("button", { name: `编辑 ${name}`, exact: true }).click();
  await page.getByLabel("提醒名称", { exact: true }).fill(updatedName);
  await page.getByRole("button", { name: "保存修改", exact: true }).click();
  await expect(page.getByRole("heading", { name: "编辑提醒", exact: true })).toBeHidden();
  const listing = await page.request.get("/api/tasks").then((response) => response.json());
  expect(listing.tasks.find((item: { id: string }) => item.id === task.id).notification).toEqual(task.notification);

  await page.getByRole("button", { name: `更多操作 ${updatedName}`, exact: true }).click();
  await page.getByRole("menuitem", { name: "复制为新提醒", exact: true }).click();
  await page.getByRole("dialog", { name: "复制为新提醒", exact: true }).getByRole("button", { name: "新建提醒", exact: true }).click();
  await expect(page.getByRole("heading", { name: "复制为新提醒", exact: true })).toBeHidden();
  const duplicated = await page.request.get("/api/tasks").then((response) => response.json());
  expect(duplicated.tasks.find((item: { name: string }) => item.name === `${updatedName}（副本）`).notification).toEqual(task.notification);
  await page.getByRole("button", { name: `编辑 ${updatedName}`, exact: true }).click();
  await page.getByRole("button", { name: "时区、节假日与通知策略", exact: true }).click();
  await page.getByLabel("任务通知分组", { exact: true }).fill("");
  await page.getByLabel("任务提示音", { exact: true }).fill("");
  await page.getByRole("button", { name: "保存修改", exact: true }).click();
  await expect(page.getByRole("heading", { name: "编辑提醒", exact: true })).toBeHidden();
  const cleared = await page.request.get("/api/tasks").then((response) => response.json());
  expect(cleared.tasks.find((item: { id: string }) => item.id === task.id).notification).toEqual({ icon: task.notification.icon });
});

test("an unchanged start in the second DST overlap keeps its saved instant and preview", async ({ page }) => {
  await login(page);
  const name = `Second overlap ${test.info().project.name}`;
  const created = await page.request.post("/api/tasks", { data: {
    name, startsAt: "2030-11-03T06:30:00.000Z", timeZone: "America/New_York",
    preset: "once", cron: "30 1 * * *", repeatCount: 1,
  } });
  expect(created.status()).toBe(201);
  const { task } = await created.json();
  await page.goto("/tasks");
  const previewRequest = page.waitForRequest((request) => request.url().endsWith("/api/tasks/preview") && request.method() === "POST");
  await page.getByRole("button", { name: `编辑 ${name}`, exact: true }).click();
  expect((await previewRequest).postDataJSON().startsAt).toBe(task.startsAt);
  await page.getByLabel("提醒名称", { exact: true }).fill(`${name} saved`);
  await page.screenshot({ path: test.info().outputPath("overlap-editor.png"), animations: "disabled" });
  await page.getByRole("button", { name: "保存修改", exact: true }).click();
  await expect(page.getByRole("heading", { name: "编辑提醒", exact: true })).toBeHidden();
  const listing = await page.request.get("/api/tasks").then((response) => response.json());
  expect(listing.tasks.find((item: { id: string }) => item.id === task.id).startsAt).toBe(task.startsAt);
});
