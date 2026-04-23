#!/usr/bin/env node

import { spawnSync, type SpawnSyncOptionsWithStringEncoding, type SpawnSyncReturns } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const PLUGIN_PACKAGE_NAME = "@openclaw-china/channels";

type Options = {
  version: string;
  registry?: string;
};

type PackedFile = {
  filename: string;
};

function printUsage(): void {
  console.log(`OpenClaw China Setup

Usage:
  npx @openclaw-china/setup [--version <tag|semver>] [--registry <url>]

Options:
  --version   Plugin version or dist-tag to install. Default: latest
  --registry  Override the npm registry used by npm pack
  --help      Show this help message
`);
}

function parseArgs(argv: string[]): Options {
  const options: Options = {
    version: "latest",
    registry: process.env.OPENCLAW_CHINA_NPM_REGISTRY?.trim() || undefined,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];

    if (arg === "--help" || arg === "-h") {
      printUsage();
      process.exit(0);
    }

    if (arg === "--version") {
      const next = argv[index + 1];
      if (!next) {
        throw new Error("Missing value after --version");
      }
      options.version = next;
      index += 1;
      continue;
    }

    if (arg.startsWith("--version=")) {
      options.version = arg.slice("--version=".length);
      continue;
    }

    if (arg === "--registry") {
      const next = argv[index + 1];
      if (!next) {
        throw new Error("Missing value after --registry");
      }
      options.registry = next;
      index += 1;
      continue;
    }

    if (arg.startsWith("--registry=")) {
      options.registry = arg.slice("--registry=".length);
      continue;
    }

    throw new Error(`Unknown argument: ${arg}`);
  }

  return options;
}

function resolveCommand(command: "npm" | "openclaw"): string {
  return process.platform === "win32" ? `${command}.cmd` : command;
}

function formatCommand(command: string, args: readonly string[]): string {
  return [command, ...args].join(" ");
}

function quoteWindowsArg(value: string): string {
  if (value.length === 0) {
    return "\"\"";
  }

  if (!/[\s"&()<>^|]/.test(value)) {
    return value;
  }

  const escaped = value.replace(/(\\*)"/g, "$1$1\\\"").replace(/(\\+)$/g, "$1$1");
  return `"${escaped}"`;
}

function runCommand(
  command: string,
  args: string[],
  options: Omit<SpawnSyncOptionsWithStringEncoding, "encoding">
): SpawnSyncReturns<string> {
  if (process.platform === "win32") {
    const shellCommand = [command, ...args].map(quoteWindowsArg).join(" ");
    return spawnSync(process.env.ComSpec || "cmd.exe", ["/d", "/s", "/c", shellCommand], {
      ...options,
      encoding: "utf8",
      windowsVerbatimArguments: true,
    });
  }

  return spawnSync(command, args, {
    ...options,
    encoding: "utf8",
  });
}

function formatFailure(
  command: string,
  args: readonly string[],
  result: SpawnSyncReturns<string>
): Error {
  const stderr = result.stderr?.trim();
  const stdout = result.stdout?.trim();
  const details = stderr || stdout || result.error?.message || "Unknown error";
  return new Error(`Command failed: ${formatCommand(command, args)}\n${details}`);
}

function ensureOpenClawAvailable(): void {
  const command = resolveCommand("openclaw");
  const args = ["--version"];
  const result = runCommand(command, args, {
    stdio: "pipe",
  });

  if (result.error || result.status !== 0) {
    throw new Error(
      "openclaw CLI was not found. Install OpenClaw first and make sure `openclaw` is available in PATH."
    );
  }
}

function parsePackOutput(stdout: string): PackedFile {
  const parsed = JSON.parse(stdout) as unknown;
  if (!Array.isArray(parsed) || parsed.length === 0) {
    throw new Error("npm pack did not return archive metadata.");
  }

  const first = parsed[0];
  if (
    typeof first !== "object" ||
    first === null ||
    typeof (first as Record<string, unknown>).filename !== "string"
  ) {
    throw new Error("npm pack returned an unexpected payload.");
  }

  return {
    filename: (first as Record<string, string>).filename,
  };
}

function packPlugin(options: Options, tempDir: string): string {
  const command = resolveCommand("npm");
  const spec = `${PLUGIN_PACKAGE_NAME}@${options.version}`;
  const args = ["pack", spec, "--json", "--pack-destination", tempDir];

  if (options.registry) {
    args.push("--registry", options.registry);
  }

  console.log(`Downloading ${spec}${options.registry ? ` from ${options.registry}` : ""} ...`);
  const result = runCommand(command, args, {
    stdio: "pipe",
  });

  if (result.error || result.status !== 0) {
    throw formatFailure(command, args, result);
  }

  const packed = parsePackOutput(result.stdout);
  return join(tempDir, packed.filename);
}

function installPlugin(archivePath: string): void {
  const command = resolveCommand("openclaw");
  const args = ["plugins", "install", archivePath];

  console.log(`Installing ${archivePath} ...`);
  const result = runCommand(command, args, {
    stdio: "inherit",
  });

  if (result.error || result.status !== 0) {
    throw new Error(`Command failed: ${formatCommand(command, args)}`);
  }
}

function runChinaSetup(): void {
  const command = resolveCommand("openclaw");
  const args = ["china", "setup"];

  console.log("Launching interactive channel setup ...");
  const result = runCommand(command, args, {
    stdio: "inherit",
  });

  if (result.error || result.status !== 0) {
    throw new Error(
      `Plugin installation completed, but configuration did not finish: ${formatCommand(command, args)}`
    );
  }
}

function safeCleanup(tempDir: string): void {
  try {
    rmSync(tempDir, { recursive: true, force: true });
  } catch {
    // Cleanup failure should not block installation success.
  }
}

function main(): void {
  const options = parseArgs(process.argv.slice(2));
  ensureOpenClawAvailable();

  const tempDir = mkdtempSync(join(tmpdir(), "openclaw-china-setup-"));

  try {
    const archivePath = packPlugin(options, tempDir);
    installPlugin(archivePath);
    console.log("");
    runChinaSetup();

    console.log("");
    console.log("OpenClaw China Channels is installed and configured.");
    console.log(
      "The plugin archive was installed through OpenClaw, so the final files are managed in OpenClaw's normal plugin directory."
    );
  } finally {
    safeCleanup(tempDir);
  }
}

try {
  main();
} catch (error) {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`\n[openclaw-china/setup] ${message}`);
  process.exit(1);
}
