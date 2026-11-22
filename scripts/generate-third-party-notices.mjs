import { spawnSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

const result = spawnSync("pnpm", ["licenses", "list", "--prod", "--json"], { encoding: "utf8", maxBuffer: 16 * 1024 * 1024 });
if (result.error || result.status !== 0) {
  throw new Error(result.error?.message || result.stderr.trim() || "Could not read the production dependency license inventory");
}

const groups = JSON.parse(result.stdout);
if (!groups || typeof groups !== "object" || Array.isArray(groups)) throw new Error("Unexpected pnpm license inventory format");

const packages = Object.entries(groups).flatMap(([groupLicense, entries]) => {
  if (!Array.isArray(entries)) throw new Error(`Unexpected package list for license group ${groupLicense}`);
  return entries.map((entry) => ({
    name: String(entry.name),
    versions: Array.isArray(entry.versions) ? entry.versions.map(String).join(", ") : String(entry.version ?? "unknown"),
    license: String(entry.license ?? groupLicense),
  }));
});

const compare = (left, right) => left < right ? -1 : left > right ? 1 : 0;
packages.sort((left, right) => compare(left.name, right.name) || compare(left.versions, right.versions) || compare(left.license, right.license));
const cell = (value) => value.replaceAll("|", "\\|").replaceAll("\n", " ");
const lines = [
  "# Third-Party Notices",
  "",
  "Rubidium application source is licensed under the GNU Affero General Public License version 3 only. This inventory lists the production dependency graph reported by `pnpm licenses list --prod --json`; package-level copyright and license terms remain independent and must be preserved when redistributing those packages.",
  "",
  "Regenerate this inventory with `pnpm licenses:notice` after dependency changes. The license column reflects package metadata as reported by pnpm and is not legal advice.",
  "",
  "## Separate Licenses",
  "",
  "- `@heroui-pro/react` is governed by the separate HeroUI Pro commercial license, not Rubidium's AGPL. pnpm reports its license metadata as `Unknown`; the package declares `SEE LICENSE IN LICENSE`, so review its supplied license and HeroUI Pro terms.",
  "- `heroui-pro` is a build-time setup CLI reported as `UNLICENSED`. It is required by the HeroUI Pro installation chain but is not present in the verified `.next/standalone` output copied into the runtime image.",
  "- `@fontsource-variable/manrope` is licensed under OFL-1.1. Its font binaries remain subject to that license and must not be redistributed separately from their required notices.",
  "",
  "## Production Dependency Inventory",
  "",
  "| Package | Version | Reported license |",
  "| --- | --- | --- |",
  ...packages.map((entry) => `| ${cell(entry.name)} | ${cell(entry.versions)} | ${cell(entry.license)} |`),
  "",
  "This notice is not a substitute for upstream license texts or legal advice. The authoritative terms are those distributed by each package publisher.",
  "",
];
const content = lines.join("\n");
const path = resolve("THIRD_PARTY_NOTICES.md");

if (process.argv.includes("--check")) {
  if (readFileSync(path, "utf8") !== content) {
    console.error("THIRD_PARTY_NOTICES.md is stale; run pnpm licenses:notice.");
    process.exit(1);
  }
  console.log(`Third-party notices match ${packages.length} production dependency entries.`);
} else {
  writeFileSync(path, content);
  console.log(`Wrote ${packages.length} production dependency entries to THIRD_PARTY_NOTICES.md.`);
}
