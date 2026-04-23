import { execSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const root = path.resolve(__dirname, "..");
const setupPath = path.join(root, "packages", "setup", "package.json");

function readJson(filePath) {
  return JSON.parse(readFileSync(filePath, "utf-8"));
}

function writeJson(filePath, data) {
  writeFileSync(filePath, JSON.stringify(data, null, 2) + "\n", "utf-8");
}

function parseVersion(version) {
  const match = version.match(/^(\d+)\.(\d+)\.(\d+)(?:([.-])([0-9]+))?$/);
  if (!match) {
    throw new Error(`Invalid version: ${version}`);
  }

  const [, majorRaw, minorRaw, patchRaw, separatorRaw, revisionRaw] = match;
  return {
    major: Number(majorRaw),
    minor: Number(minorRaw),
    patch: Number(patchRaw),
    revision: revisionRaw === undefined ? 0 : Number(revisionRaw),
    hasRevision: separatorRaw !== undefined,
  };
}

function compareVersions(a, b) {
  if (a.major !== b.major) return a.major - b.major;
  if (a.minor !== b.minor) return a.minor - b.minor;
  if (a.patch !== b.patch) return a.patch - b.patch;
  if (a.hasRevision !== b.hasRevision) {
    // Stable releases sort after prereleases with the same major.minor.patch.
    return a.hasRevision ? -1 : 1;
  }
  return a.revision - b.revision;
}

function bumpPatch(version) {
  const parsed = parseVersion(version);
  if (parsed.hasRevision) {
    return `${parsed.major}.${parsed.minor}.${parsed.patch}-${parsed.revision + 1}`;
  }
  return `${parsed.major}.${parsed.minor}.${parsed.patch + 1}`;
}

function getLatestPublishedVersion(pkgName) {
  try {
    const result = execSync(`npm view ${pkgName} versions --json`, {
      cwd: root,
      stdio: ["ignore", "pipe", "pipe"],
    })
      .toString()
      .trim();
    if (!result) return null;

    const parsed = JSON.parse(result);
    const versions = Array.isArray(parsed) ? parsed : typeof parsed === "string" ? [parsed] : [];
    if (versions.length === 0) return null;

    let latest = null;
    let latestParsed = null;
    for (const version of versions) {
      let current;
      try {
        current = parseVersion(version);
      } catch {
        continue;
      }
      if (!latestParsed || compareVersions(current, latestParsed) > 0) {
        latest = version;
        latestParsed = current;
      }
    }
    return latest;
  } catch (error) {
    const stderr = error?.stderr?.toString?.() ?? "";
    if (stderr.includes("E404") || stderr.includes("Not found")) {
      return null;
    }
    throw error;
  }
}

function normalizeVersionInput(version) {
  const normalized = version.startsWith("v") ? version.slice(1) : version;
  const legacyFourSegment = normalized.match(/^(\d+)\.(\d+)\.(\d+)\.(\d+)$/);
  if (!legacyFourSegment) {
    return normalized;
  }

  const [, majorRaw, minorRaw, patchRaw, revisionRaw] = legacyFourSegment;
  return `${Number(majorRaw)}.${Number(minorRaw)}.${Number(patchRaw)}-${Number(revisionRaw)}`;
}

function getNextVersion(pkgName, localVersion) {
  const latest = getLatestPublishedVersion(pkgName);
  if (!latest) {
    return bumpPatch(localVersion);
  }

  const latestParsed = parseVersion(latest);
  const localParsed = parseVersion(localVersion);
  const base = compareVersions(latestParsed, localParsed) >= 0 ? latest : localVersion;
  return bumpPatch(base);
}

function ensureVersionGreaterThanPublished(pkgName, version) {
  const latest = getLatestPublishedVersion(pkgName);
  if (!latest) {
    return;
  }

  if (compareVersions(parseVersion(version), parseVersion(latest)) <= 0) {
    throw new Error(`Requested version ${version} for ${pkgName} must be greater than npm version ${latest}.`);
  }
}

function parseArgs(args) {
  let version = null;
  let tag = "latest";

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === "--version" || arg === "-v") {
      const next = args[index + 1];
      if (!next) {
        throw new Error("Missing version after --version");
      }
      version = normalizeVersionInput(next);
      index += 1;
      continue;
    }

    if (arg === "--tag" || arg === "-t") {
      const next = args[index + 1];
      if (!next) {
        throw new Error("Missing tag after --tag");
      }
      if (next !== "latest" && next !== "next") {
        throw new Error(`Invalid tag: ${next}. Use "latest" or "next".`);
      }
      tag = next;
      index += 1;
      continue;
    }

    if (arg === "--help" || arg === "-h") {
      console.log(`
Usage:
  pnpm release:setup
  pnpm release:setup --version <x.y.z|x.y.z.w|x.y.z-w> [--tag <latest|next>]
`);
      process.exit(0);
    }

    throw new Error(`Unknown argument: ${arg}`);
  }

  return { version, tag };
}

function run(command, cwd = root) {
  execSync(command, { stdio: "inherit", cwd });
}

function publishSetupPackage(pkgDir, tag) {
  const pkg = readJson(path.join(pkgDir, "package.json"));
  const parsed = parseVersion(pkg.version);
  if (parsed.hasRevision && tag === "latest") {
    throw new Error(
      `Refusing to publish prerelease version ${pkg.version} of ${pkg.name} with tag "latest". ` +
        'Use "--tag next" or publish a stable x.y.z version.'
    );
  }

  run(`npm publish --access public --tag ${tag}`, pkgDir);
}

const originalSetup = readJson(setupPath);

try {
  const options = parseArgs(process.argv.slice(2));
  const pkg = readJson(setupPath);
  const nextVersion = options.version ?? getNextVersion(pkg.name, pkg.version);

  ensureVersionGreaterThanPublished(pkg.name, nextVersion);

  pkg.version = nextVersion;
  pkg.private = false;
  writeJson(setupPath, pkg);

  run("pnpm -F @openclaw-china/setup build");
  publishSetupPackage(path.join(root, "packages", "setup"), options.tag);
} finally {
  writeJson(setupPath, originalSetup);
}
