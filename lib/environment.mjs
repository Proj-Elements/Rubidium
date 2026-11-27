import { realpathSync } from "node:fs";
import { dirname, resolve, sep } from "node:path";

export function getEnvironmentVariable(name, environment = process.env) {
  return environment[`RUBIDIUM_${name}`] ?? environment[`BARKER_${name}`];
}

/** Resolve runtime data without creating it; reject build output and aliases into it. */
export function resolveRuntimeDataDirectory(directory = process.cwd(), configured = getEnvironmentVariable("DATA_DIR")) {
  const data = resolve(/* turbopackIgnore: true */ directory, configured || "data");
  const assertOutsideBuild = (path) => {
    if (path.split(sep).includes(".next")) throw new Error("RUBIDIUM_DATA_DIR must be outside .next; builds remove that directory");
  };
  assertOutsideBuild(data);
  let existing = data;
  while (true) {
    try {
      assertOutsideBuild(realpathSync(/* turbopackIgnore: true */ existing));
      return data;
    } catch (error) {
      if (error?.code !== "ENOENT") throw error;
      const parent = dirname(existing);
      if (parent === existing) throw error;
      existing = parent;
    }
  }
}
