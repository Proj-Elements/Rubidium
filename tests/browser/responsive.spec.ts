import { expect, test, type Page } from "@playwright/test";

async function enter(page: Page) {
  await page.goto("/");
  await expect(page).toHaveTitle(/Rubidium/);
  await page.getByLabel("访问密码").fill("browser-regression-password");
  await page.getByRole("button", { name: "进入工作空间" }).click();
  await expect(page.getByRole("heading", { name: "提醒概览" })).toBeVisible();
}

async function contained(page: Page) {
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
}

test("editor aligns schedule fields and keeps ending controls usable at every width", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await enter(page);
  const name = `排期表单对齐检查-${test.info().project.name}`;
  const created = await page.request.post("/api/tasks", { data: {
    name, startsAt: "2035-01-01T09:00:00+08:00", preset: "daily", cron: "0 9 * * *", repeatCount: 7,
  } });
  expect(created.status()).toBe(201);
  await page.goto("/tasks");
  for (const width of [1440, 390, 320]) {
    await page.setViewportSize({ width, height: 1000 });
    await page.getByRole("button", { name: `编辑 ${name}`, exact: true }).click();
    const editor = page.getByRole("dialog", { name: "编辑提醒", exact: true });
    const start = editor.locator(".schedule-field").first();
    const recurrence = editor.getByRole("button", { name: /重复周期/ });
    await expect(start).toHaveCSS("height", "44px");
    await expect(recurrence).toHaveCSS("height", "44px");
    const sizes = await editor.locator(".workspace-field").evaluateAll((fields) => fields.flatMap((field) => {
      const label = field.querySelector(".label");
      const input = field.querySelector(".input, .textarea, .select__trigger, .number-field__input, .date-input-group__input");
      return label && input ? [{ label: getComputedStyle(label).fontSize, input: getComputedStyle(input).fontSize }] : [];
    }));
    expect(sizes.length).toBeGreaterThan(0);
    expect(sizes.every(({ label, input }) => label === "14px" && input === "14px")).toBe(true);
    const endMode = editor.getByRole("radiogroup", { name: "提醒结束方式" });
    const count = editor.locator(".number-field__group").first();
    if (width === 1440) expect(Math.abs((await endMode.boundingBox())!.y - (await count.boundingBox())!.y)).toBeLessThanOrEqual(2);
    await editor.getByRole("radio", { name: "按日期", exact: true }).click();
    await expect(editor.getByRole("button", { name: /^选择截止日期/ })).toBeVisible();
    await contained(page);
    await editor.getByRole("radio", { name: "持续重复", exact: true }).click();
    await expect(editor.getByText("持续排期，直到暂停或归档。", { exact: false })).toBeVisible();
    await editor.getByRole("radio", { name: "按次数", exact: true }).click();
    await expect(editor.getByLabel("重复次数", { exact: true })).toHaveValue("7");
    await page.screenshot({ path: test.info().outputPath(`editor-${width}.png`), animations: "disabled" });
    await editor.getByRole("button", { name: "关闭编辑器", exact: true }).click();
  }
});

for (const theme of ["light", "dark"] as const) {
  test(`${theme} records keep actions and status readable at phone tablet and desktop widths`, async ({ page }) => {
    test.setTimeout(90_000);
    await page.addInitScript((appearance) => localStorage.setItem("barker:appearance", appearance), theme);
    await enter(page);
    const name = `响应式检查-${theme}-${test.info().project.name}`;
    const created = await page.request.post("/api/tasks", { data: {
      name, description: "检查长内容在手机和平板上仍可阅读，状态标签和编辑操作完整显示。",
      startsAt: "2035-01-01T09:00:00+08:00", preset: "daily", cron: "0 9 * * *", repeatCount: 5,
    } });
    expect(created.status()).toBe(201);
    const stamp = "2035-01-01T01:00:00Z";
    const deliveries = [
      { id: "manual", taskName: "等待处理的提醒", status: "pending", manualOnly: true, deliveredAt: null },
      { id: "received", taskName: "已经接收的提醒", status: "sent", manualOnly: false, deliveredAt: stamp },
    ].map((item) => ({
      taskId: "visual", description: "用于验证窄屏长内容和完整状态。", occurrenceAt: stamp, attempts: 2,
      lastError: null, nextAttemptAt: stamp, createdAt: stamp, updatedAt: stamp, expiresAt: null, ...item,
    }));
    await page.route("**/api/deliveries?**", (route) => route.fulfill({ json: { deliveries, total: 2, page: 1, pageSize: 12 } }));
    await page.route("**/api/deliveries/received/attempts", (route) => route.fulfill({ json: { attempts: [] } }));

    for (const width of [320, 390, 768, 1024, 1440]) {
      await page.setViewportSize({ width, height: 1000 });
      await page.goto("/tasks");
      await expect(page.getByRole("button", { name: `编辑 ${name}`, exact: true })).toBeVisible();
      await contained(page);
      if (width >= 1440) {
        const selectAll = page.getByRole("grid", { name: "提醒列表" }).getByRole("checkbox").first();
        await selectAll.locator("xpath=ancestor::label[1]").click();
        await expect(selectAll).toBeChecked();
      } else {
        await page.getByText("选择本页提醒", { exact: true }).click();
        await expect(page.getByRole("checkbox", { name: "选择本页提醒" })).toBeChecked();
      }
      const bar = page.getByRole("toolbar", { name: "批量操作" });
      await expect(bar).toBeVisible();
      const box = await bar.boundingBox();
      expect(box!.x).toBeGreaterThanOrEqual(0);
      expect(box!.x + box!.width).toBeLessThanOrEqual(width + 1);
      await page.screenshot({ path: test.info().outputPath(`${theme}-${width}-tasks.png`), fullPage: true, animations: "disabled" });
      await page.getByRole("button", { name: "取消选择", exact: true }).click();
      await expect(bar).toBeHidden();

      await page.goto("/deliveries");
      await expect(page.getByText("等待人工处理", { exact: true }).filter({ visible: true })).toBeVisible();
      await expect(page.getByText("Bark 已接收", { exact: true }).filter({ visible: true })).toBeVisible();
      await contained(page);
      const chipHeights = await page.locator(".chip:visible").evaluateAll((chips) => chips.map((chip) => chip.getBoundingClientRect().height));
      expect(chipHeights.every((height) => height < 36)).toBe(true);
      await page.screenshot({ path: test.info().outputPath(`${theme}-${width}-deliveries.png`), fullPage: true, animations: "disabled" });
      const received = page.getByRole("row").filter({ hasText: "已经接收的提醒" });
      await received.getByRole("button", { name: /查看详情/ }).click();
      await expect(page.getByRole("dialog", { name: "投递详情" })).toBeVisible();
      await page.getByRole("button", { name: "关闭投递详情" }).click();
    }
  });
}

test("320px settings expose every category and audit identifiers remain accessible", async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 900 });
  await enter(page);
  await page.goto("/settings");
  const categories = page.getByRole("tablist", { name: "工作空间设置分类" });
  for (const name of ["连接配置", "更多设备", "访问安全", "记录维护"]) {
    const tab = categories.getByRole("tab", { name, exact: true });
    await expect(tab).toBeInViewport();
    await tab.click();
    await contained(page);
  }
  const audit = page.getByRole("list", { name: "操作审计" });
  await expect(audit).toBeVisible();
  expect((await audit.boundingBox())!.height).toBeLessThan(900);
  await audit.getByRole("button", { name: /查看审计详情/ }).first().click();
  await expect(page.getByRole("dialog", { name: "操作详情" })).toBeVisible();
  await expect(page.getByText("完整目标标识", { exact: true })).toBeVisible();
  await contained(page);
  await page.getByRole("button", { name: "关闭", exact: true }).click();
  await page.screenshot({ path: test.info().outputPath("320-settings-history.png"), fullPage: true, animations: "disabled" });
  await categories.getByRole("tab", { name: "连接配置", exact: true }).click();
  await page.getByLabel("API 服务地址").fill("https://api.day.app/");
  await categories.getByRole("tab", { name: "更多设备", exact: true }).click();
  await categories.getByRole("tab", { name: "连接配置", exact: true }).click();
  await expect(page.getByLabel("API 服务地址")).toHaveValue("https://api.day.app/");
});

test("touch layouts keep bulk actions reachable and hide selection on completed deliveries", async ({ browser }) => {
  test.setTimeout(120_000);
  const context = await browser.newContext({
    viewport: { width: 844, height: 390 },
    deviceScaleFactor: 2,
    hasTouch: true,
    isMobile: true,
  });
  const page = await context.newPage();
  await page.emulateMedia({ reducedMotion: "reduce" });
  const stamp = "2035-01-01T01:00:00Z";
  const deliveries = [
    { id: "pending-landscape", taskName: "等待中的提醒", status: "pending", manualOnly: true, deliveredAt: null },
    { id: "sent-landscape", taskName: "已经接收的提醒", status: "sent", manualOnly: false, deliveredAt: stamp },
    { id: "cancelled-landscape", taskName: "已经取消的提醒", status: "cancelled", manualOnly: false, deliveredAt: null },
  ].map((item) => ({
    taskId: "landscape", description: "用于核验横屏投递记录的选择状态。", occurrenceAt: stamp, attempts: 1,
    lastError: null, nextAttemptAt: stamp, createdAt: stamp, updatedAt: stamp, expiresAt: null, ...item,
  }));

  try {
    await enter(page);
    const taskName = `横屏批量操作检查-${test.info().project.name}`;
    expect((await page.request.post("/api/tasks", { data: {
      name: taskName, startsAt: "2035-01-01T09:00:00+08:00", preset: "daily", cron: "0 9 * * *", repeatCount: 5,
    } })).status()).toBe(201);
    await page.route("**/api/tasks?*", async (route) => {
      const response = await route.fetch();
      const payload = await response.json() as { tasks: Array<{ name: string }>; total: number };
      const tasks = payload.tasks.filter((task) => task.name === taskName);
      await route.fulfill({ response, json: { ...payload, tasks, total: tasks.length } });
    });

    for (const viewport of [
      { width: 844, height: 390 },
      { width: 667, height: 450 },
      { width: 568, height: 320 },
      { width: 390, height: 844 },
      { width: 320, height: 568 },
    ]) {
      await page.setViewportSize(viewport);
      await page.goto("/tasks");
      const selectTasks = page.getByRole("checkbox", { name: "选择本页提醒" });
      await selectTasks.locator("xpath=ancestor::label[1]").click();
      const bar = page.getByRole("toolbar", { name: "批量操作" });
      await expect(bar).toBeVisible();
      await expect(bar.getByRole("status")).toHaveText("已选 1 项");
      if (viewport.width === 844) {
        const transform = await page.locator('.action-bar[data-slot="action-bar"]').evaluate((element) => getComputedStyle(element).transform);
        expect(transform).toBe("none");
      }
      await page.screenshot({ path: test.info().outputPath(`task-actions-${viewport.width}x${viewport.height}.png`), animations: "disabled" });
      await expect(bar.getByRole("button", { name: "归档", exact: true })).toHaveClass(/button--danger-soft/);
      const bounds = await bar.boundingBox();
      expect(bounds!.x).toBeGreaterThanOrEqual(12);
      expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(viewport.width - 12);
      if (viewport.height <= 512 && viewport.width >= 416) {
        expect(bounds!.height).toBeLessThanOrEqual(64);
        expect(bounds!.width).toBeLessThanOrEqual(360);
      }
      const targets = await bar.locator("button").evaluateAll((buttons) => buttons.map((button) => {
        const { width, height } = button.getBoundingClientRect();
        return { width, height };
      }));
      expect.soft(targets.every(({ width, height }) => width >= 44 && height >= 44), JSON.stringify({ viewport, targets })).toBe(true);
      const paddings = await bar.locator(".action-bar__content button").evaluateAll((buttons) => buttons.map((button) => Number.parseFloat(getComputedStyle(button).paddingInlineStart)));
      expect.soft(paddings.every((padding) => padding <= 12), JSON.stringify({ viewport, paddings })).toBe(true);
      if (viewport.height <= 512 && viewport.width >= 416) {
        const prefixGap = await bar.evaluate((element) => {
          const prefix = element.querySelector(".action-bar__prefix span");
          const firstButton = element.querySelector(".action-bar__content button");
          if (!prefix || !firstButton) return Number.POSITIVE_INFINITY;
          const text = document.createRange();
          text.selectNodeContents(firstButton);
          return text.getBoundingClientRect().left - prefix.getBoundingClientRect().right;
        });
        expect.soft(prefixGap).toBeLessThanOrEqual(20);
        const suffixGap = await bar.evaluate((element) => {
          const actions = element.querySelectorAll(".action-bar__content button");
          const suffix = element.querySelector(".action-bar__suffix button");
          if (!actions.length || !suffix) return Number.POSITIVE_INFINITY;
          return suffix.getBoundingClientRect().left - actions[actions.length - 1]!.getBoundingClientRect().right;
        });
        expect.soft(suffixGap).toBeLessThanOrEqual(8);
      }
      const gaps = await bar.locator(".action-bar__content button").evaluateAll((buttons) => {
        const boxes = buttons.map((button) => button.getBoundingClientRect());
        return boxes.slice(1).map((box, index) => box.left - boxes[index]!.right);
      });
      expect.soft(gaps.every((gap) => gap <= 16)).toBe(true);
      await page.getByRole("button", { name: "取消选择", exact: true }).click();
      await expect(bar).toBeHidden();
    }

    await page.setViewportSize({ width: 844, height: 390 });
    await page.goto("/tasks");
    const selectTasks = page.getByRole("checkbox", { name: "选择本页提醒" });
    await selectTasks.locator("xpath=ancestor::label[1]").click();
    const busyBar = page.getByRole("toolbar", { name: "批量操作" });
    let releaseBulk!: () => void;
    const pendingBulk = new Promise<void>((resolve) => { releaseBulk = resolve; });
    await page.route("**/api/tasks", async (route) => {
      if (route.request().method() === "PATCH") {
        await pendingBulk;
        await route.fulfill({ json: { results: [{ success: true }] } });
      } else await route.continue();
    });
    await busyBar.getByRole("button", { name: "暂停", exact: true }).click();
    try {
      await expect(busyBar.getByRole("button", { name: "暂停", exact: true })).toBeDisabled();
      await expect(busyBar.getByRole("button", { name: "取消选择", exact: true })).toBeDisabled();
      const busyTargets = await busyBar.locator("button").evaluateAll((buttons) => buttons.map((button) => {
        const { width, height } = button.getBoundingClientRect();
        return { width, height };
      }));
      expect(busyTargets.every(({ width, height }) => width >= 44 && height >= 44)).toBe(true);
    } finally {
      releaseBulk();
    }
    await expect(busyBar).toBeHidden();

    await page.route("**/api/deliveries?**", (route) => route.fulfill({ json: { deliveries, total: 3, page: 1, pageSize: 12 } }));
    for (const viewport of [
      { width: 844, height: 390 },
      { width: 667, height: 450 },
      { width: 568, height: 320 },
      { width: 390, height: 844 },
      { width: 320, height: 568 },
      { width: 1440, height: 900 },
    ]) {
      await page.setViewportSize(viewport);
      await page.goto("/deliveries");
      await expect(page.getByText("等待中的提醒", { exact: true }).filter({ visible: true })).toBeVisible();
      const grid = page.locator(".data-grid:visible");
      const list = page.locator(".list-view:visible");
      const isGrid = await grid.count() > 0;
      const sent = isGrid
        ? page.getByRole("row").filter({ hasText: "已经接收的提醒" })
        : list.locator(".list-view__item").filter({ hasText: "已经接收的提醒" });
      const cancelled = isGrid
        ? page.getByRole("row").filter({ hasText: "已经取消的提醒" })
        : list.locator(".list-view__item").filter({ hasText: "已经取消的提醒" });

      await page.screenshot({ path: test.info().outputPath(`landscape-${viewport.width}x${viewport.height}-before.png`), fullPage: true, animations: "disabled" });
      expect(await page.evaluate(() => matchMedia("(pointer: coarse)").matches)).toBe(true);
      if (isGrid) {
        expect.soft(await sent.getByRole("checkbox").count()).toBe(0);
        expect.soft(await cancelled.getByRole("checkbox").count()).toBe(0);
      } else {
        await expect.soft(sent.locator(".list-view__selection-cell")).toBeHidden();
        await expect.soft(cancelled.locator(".list-view__selection-cell")).toBeHidden();
        expect.soft(await sent.getByRole("checkbox").count()).toBe(0);
        expect.soft(await cancelled.getByRole("checkbox").count()).toBe(0);
        const pendingTitle = await list.locator(".list-view__item").filter({ hasText: "等待中的提醒" }).locator(".list-view__title").boundingBox();
        const sentTitle = await sent.locator(".list-view__title").boundingBox();
        expect.soft(Math.abs(pendingTitle!.x - sentTitle!.x)).toBeLessThanOrEqual(1);
      }

      if (isGrid) await sent.locator("td").first().click();
      else await sent.locator(".list-view__title").click();
      await expect(page.getByRole("toolbar", { name: "批量操作" })).toBeHidden();

      const selectDeliveries = page.getByRole("checkbox", { name: "选择本页待投递消息" });
      await selectDeliveries.locator("xpath=ancestor::label[1]").click();
      const bar = page.getByRole("toolbar", { name: "批量操作" });
      await expect(bar).toBeVisible();
      await expect(bar.getByRole("status")).toHaveText("已选 1 项");
      const bounds = await bar.boundingBox();
      expect(bounds!.x).toBeGreaterThanOrEqual(12);
      expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(viewport.width - 12);
      if (viewport.height <= 320 && viewport.width >= 416) expect(bounds!.height).toBeLessThanOrEqual(64);
      const targets = await bar.locator("button").evaluateAll((buttons) => buttons.map((button) => {
        const { width, height } = button.getBoundingClientRect();
        return { width, height };
      }));
      expect.soft(targets.every(({ width, height }) => width >= 44 && height >= 44)).toBe(true);
      await page.screenshot({ path: test.info().outputPath(`landscape-${viewport.width}x${viewport.height}-selected.png`), fullPage: true, animations: "disabled" });
      await page.getByRole("button", { name: "取消选择", exact: true }).click();
      await expect(bar).toBeHidden();
    }
  } finally {
    await context.close();
  }
});
