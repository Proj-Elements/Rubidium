import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { parse } from "yaml";
import { parseVersion, platformTag, releasePlan, registryTags } from "../scripts/release-guard.mjs";

const sha = "a".repeat(40);

test("release plans refuse immutable tag reuse and parse strict SemVer", () => {
  assert.throws(() => parseVersion("01.2.3"), /Invalid SemVer/);
  assert.throws(() => parseVersion("1.2.3-01"), /Invalid SemVer/);
  assert.equal(parseVersion("1.2.3-rc.1+linux.20261112").build, "linux.20261112");
  assert.throws(() => releasePlan("owner/repo", "1.2.3+linux", sha, []), /build metadata/);
  assert.throws(() => releasePlan("owner/repo", "1.2.3", sha, ["1.2.3"]), /immutable/);
  assert.throws(() => releasePlan("owner/repo", "1.2.3", sha, [`sha-${sha}`]), /immutable/);
  assert.equal(platformTag("1.2.3-rc.1", sha, "amd64"), `sha-${sha}-1.2.3-rc.1-amd64`);
  assert.throws(() => platformTag("1.2.3", sha, "riscv64"), /platform release identity/);
});

test("older stable releases cannot move latest backward", () => {
  const plan = releasePlan("owner/repo", "1.2.3", sha, ["1.3.0", "1.2.4", "2.0.0"]);
  assert.equal(plan.channels.includes("latest"), false);
  assert.equal(plan.channels.includes("1.2"), false);
  assert.deepEqual(plan.channels, ["1.2.3", `sha-${sha}`]);
});

test("prereleases publish immutable tags without stable channels", () => {
  const plan = releasePlan("owner/repo", "2.0.0-alpha", sha, ["1.2.1"]);
  assert.deepEqual(plan.channels, ["2.0.0-alpha", `sha-${sha}`]);
  assert.equal(plan.image, "ghcr.io/owner/repo");
});

test("registry pagination follows only same-origin expected next links", async () => {
  const urls = [];
  const fetcher = async (input) => {
    urls.push(String(input));
    if (String(input).includes("/token")) return Response.json({ token: "read-token" });
    if (urls.length === 2) return Response.json({ tags: ["1.0.0"] }, { headers: { link: '<https://ghcr.io/v2/owner/repo/tags/list?n=100&last=1.0.0>; rel="next"' } });
    return Response.json({ tags: ["1.1.0"] });
  };
  assert.deepEqual(await registryTags("owner/repo", "user", "token", fetcher), ["1.0.0", "1.1.0"]);
  assert.equal(urls.length, 3);
  await assert.rejects(registryTags("owner/repo", "user", "token", async (input) => String(input).includes("/token")
    ? Response.json({ token: "read-token" })
    : Response.json({ tags: [] }, { headers: { link: '<https://evil.test/list>; rel="next"' } })), /Unexpected registry/);
});

test("release and CI workflow YAML parse with the expected publication gates", () => {
  const release = parse(readFileSync(".github/workflows/release.yml", "utf8"));
  const candidate = parse(readFileSync(".github/workflows/release-candidate.yml", "utf8"));
  const ci = parse(readFileSync(".github/workflows/ci.yml", "utf8"));
  assert.equal(release.jobs.image.if, "github.event_name == 'push' && github.ref_type == 'tag' && github.event.created && startsWith(github.ref, 'refs/tags/v')");
  assert.match(release.jobs.image.steps.find((step) => step.id === "publish").run, /sha-\$GITHUB_SHA-\$VERSION-\$architecture/);
  assert.match(release.jobs.verify.steps.find((step) => step.name === "Verify version syntax and package agreement").run, /git cat-file -t/);
  const versionCheck = release.jobs.verify.steps.find((step) => step.name === "Verify version syntax and package agreement").run;
  assert.ok(versionCheck.includes('git fetch --no-tags origin "refs/tags/$RELEASE_NAME:refs/verification/release-tag"'));
  assert.ok(versionCheck.includes("refs/verification/release-tag^{commit}"));
  assert.match(versionCheck, /git merge-base --is-ancestor "\$tag_commit" refs\/remotes\/origin\/main/);
  assert.equal(ci.concurrency["cancel-in-progress"], "${{ github.event_name == 'pull_request' }}");
  assert.deepEqual(candidate.permissions, { contents: "read" });
  assert.match(candidate.jobs.container.steps.find((step) => step.name === "Build and smoke each candidate platform").run, /for architecture in amd64 arm64/);
  assert.match(candidate.jobs.container.steps.find((step) => step.name === "Build and smoke each candidate platform").run, /container-smoke\.mjs/);
  assert.match(candidate.jobs.container.steps.find((step) => step.name === "Build and smoke each candidate platform").run, /--secret id=HEROUI_KEY,env=HEROUI_KEY/);
  assert.doesNotMatch(candidate.jobs.container.steps.find((step) => step.name === "Build and smoke each candidate platform").run, /docker (?:login|push)\b/);
  const steps = release.jobs.image.steps;
  assert.equal(JSON.parse(readFileSync("package.json", "utf8")).license, "AGPL-3.0-only");
  assert.match(steps.find((step) => step.name === "Build and smoke each candidate platform").run, /org\.opencontainers\.image\.licenses=AGPL-3\.0-only/);
  assert.match(steps.find((step) => step.id === "publish").run, /org\.opencontainers\.image\.licenses=AGPL-3\.0-only/);
  assert.match(readFileSync("Dockerfile", "utf8"), /\/app\/LICENSE \/app\/THIRD_PARTY_NOTICES\.md/);
  assert.equal(release.concurrency, undefined);
  assert.deepEqual(release.jobs.image.concurrency, { group: "release-publication", "cancel-in-progress": false });
  assert.ok(steps.findIndex((step) => step.name === "Promote tested digest to stable channels") > steps.findIndex((step) => step.name === "Pull and verify published digest on each platform"));
  assert.doesNotMatch(steps.find((step) => step.id === "publish").run, /JSON.parse\(process.env.CHANNELS\)/);
  for (const step of [steps.find((step) => step.id === "publish"), steps.find((step) => step.name === "Promote tested digest to stable channels")]) {
    assert.match(step.run, /--format '\{\{json \.Manifest\.Digest\}\}' \|\s+jq -er/);
  }
  assert.equal(ci.jobs.checks.steps.some((step) => step.name === "Check affected browser interactions"), true);
  for (const workflow of [ci, release, candidate]) {
    for (const job of Object.values(workflow.jobs)) {
      assert.ok(job["timeout-minutes"] > 0);
      for (const step of job.steps) {
        if (step.uses) assert.match(step.uses, /@[a-f0-9]{40}$/);
        if (step.run) {
          const syntax = spawnSync("bash", ["-n"], { input: step.run, encoding: "utf8" });
          assert.equal(syntax.status, 0, `${step.name ?? step.run}: ${syntax.stderr}`);
        }
        if (step.run === "pnpm test") assert.equal(step.if, "github.event_name == 'push' && github.ref_type == 'tag' && github.event.created");
      }
    }
  }
});

test("deployment guides pin the application version and separate image and source installs", () => {
  const version = JSON.parse(readFileSync("package.json", "utf8")).version;
  assert.doesNotThrow(() => parseVersion(version));
  for (const path of ["README.md", "docs/api-mcp.md", "docs/deployment.md"]) {
    assert.match(readFileSync(path, "utf8"), new RegExp(`rubidium:${version}|${version}`), path);
  }
  for (const path of ["README.md", "docs/deployment.md"]) {
    const content = readFileSync(path, "utf8");
    assert.match(content, new RegExp(`docker pull ghcr.io/proj-elements/rubidium:${version}`));
    assert.match(content, /docker run -d --name rubidium/);
    assert.match(content, /docker compose up -d --build/);
    assert.doesNotMatch(content, /docker-compose\.ghcr|RUBIDIUM_IMAGE|docker push/);
    for (const snippet of content.matchAll(/```sh\n([\s\S]*?)\n```/g)) {
      const syntax = spawnSync("bash", ["-n"], { input: snippet[1], encoding: "utf8" });
      assert.equal(syntax.status, 0, `${path}: ${syntax.stderr}`);
    }
  }
  const compose = parse(readFileSync("docker-compose.yml", "utf8"));
  assert.equal(compose.services.rubidium.build.context, ".");
  assert.equal(compose.services.rubidium.image, "rubidium:local");
  assert.equal(compose.services.rubidium.environment.RUBIDIUM_DATA_DIR, "${RUBIDIUM_DATA_DIR:-/app/data}");
  assert.deepEqual(compose.services.rubidium.volumes, ["rubidium-v2-data:/app/data"]);
  assert.deepEqual(Object.keys(compose.volumes), ["rubidium-v2-data"]);
  const environment = readFileSync(".env.example", "utf8");
  assert.match(environment, /^RUBIDIUM_DATA_DIR=$/m);
  assert.doesNotMatch(environment, /RUBIDIUM_IMAGE|docker-compose\.ghcr/);
});

test("third-party notices match pnpm production dependencies and preserve Pro licensing notes", () => {
  const check = spawnSync(process.execPath, ["scripts/generate-third-party-notices.mjs", "--check"], { encoding: "utf8" });
  assert.equal(check.status, 0, check.stderr || check.stdout);
  const notices = readFileSync("THIRD_PARTY_NOTICES.md", "utf8");
  assert.match(notices, /\| @heroui-pro\/react \| 1\.0\.0-beta\.11 \| Unknown \|/);
  assert.match(notices, /\| heroui-pro \| 1\.0\.0-beta\.14 \| UNLICENSED \|/);
  assert.match(notices, /separate HeroUI Pro commercial license/);
});
