import { spawnSync } from "node:child_process";

if (!process.env.HEROUI_KEY) {
  console.error("请在当前环境设置 HEROUI_KEY，再运行 pnpm ui:setup。");
  process.exit(1);
}

// CI mode suppresses the installer's Vercel configuration, which otherwise
// embeds the access key in a generated file. Keep credentials in the environment.
const result = spawnSync("pnpm", ["exec", "heroui-setup", "--auto"], {
  stdio: "inherit",
  env: { ...process.env, CI: "1" },
});
if (result.error) console.error(result.error.message);
process.exit(result.status ?? 1);
