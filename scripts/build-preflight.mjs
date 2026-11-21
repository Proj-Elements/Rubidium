import { checkLegacyData } from "./runtime-paths.mjs";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";

checkLegacyData();

try {
  for (const name of ["@heroui-pro/react", "@heroui-pro/react/css"]) {
    if (!existsSync(fileURLToPath(import.meta.resolve(name)))) throw new Error("Missing Pro artifact");
  }
} catch {
  throw new Error("HeroUI Pro 组件尚未下载。请设置 HEROUI_KEY 并运行 pnpm ui:setup；Docker 构建通过同名 BuildKit secret 提供访问码。");
}
