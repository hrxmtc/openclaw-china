import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

type WecomAppManifest = {
  skills?: string[];
};

type WecomAppPackageJson = {
  files?: string[];
};

const packageRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const manifestPath = join(packageRoot, "openclaw.plugin.json");
const packageJsonPath = join(packageRoot, "package.json");

function readJsonFile<T>(filePath: string): T {
  return JSON.parse(readFileSync(filePath, "utf8")) as T;
}

describe("wecom-app plugin skill packaging", () => {
  it("declares plugin-local skill directories in the OpenClaw manifest", () => {
    const manifest = readJsonFile<WecomAppManifest>(manifestPath);

    expect(manifest.skills).toEqual(["./skills"]);
    for (const relativePath of manifest.skills ?? []) {
      expect(existsSync(join(packageRoot, relativePath))).toBe(true);
    }
    expect(existsSync(join(packageRoot, "skills", "wecom-app-ops", "SKILL.md"))).toBe(true);
    expect(existsSync(join(packageRoot, "skills", "wecom-app-doc", "SKILL.md"))).toBe(true);
  });

  it("includes plugin-local skills in the published package", () => {
    const packageJson = readJsonFile<WecomAppPackageJson>(packageJsonPath);

    expect(packageJson.files).toContain("skills");
  });
});
