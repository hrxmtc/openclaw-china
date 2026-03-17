import os from "node:os";
import path from "node:path";
import { existsSync, promises as fs } from "node:fs";

import { afterEach, describe, expect, it } from "vitest";

import { wecomAppPlugin } from "./channel.js";
import type { PluginConfig } from "./config.js";

async function waitFor(condition: () => boolean, timeoutMs: number = 1_000): Promise<void> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (condition()) return;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error("Timed out waiting for condition");
}

describe("wecom-app doc MCP config sync", () => {
  afterEach(() => {
    delete process.env.OPENCLAW_STATE_DIR;
    delete process.env.CLAWDBOT_STATE_DIR;
  });

  it("writes configured doc MCP settings to the OpenClaw state dir when the gateway starts", async () => {
    const tempStateDir = await fs.mkdtemp(path.join(os.tmpdir(), "wecom-app-mcp-state-"));
    process.env.OPENCLAW_STATE_DIR = tempStateDir;

    const cfg: PluginConfig = {
      channels: {
        "wecom-app": {
          token: "token-1",
          encodingAESKey: "encoding-aes-key-1",
          docs: {
            mcp: {
              type: "streamable-http",
              url: "https://doc-mcp.example.test/mcp",
            },
          },
        },
      },
    };

    const controller = new AbortController();
    const gatewayPromise = wecomAppPlugin.gateway.startAccount({
      cfg,
      accountId: "default",
      abortSignal: controller.signal,
      log: {
        info: () => {},
        error: () => {},
      },
    });

    const configPath = path.join(tempStateDir, "wecomAppConfig", "config.json");
    await waitFor(() => existsSync(configPath));

    const saved = JSON.parse(await fs.readFile(configPath, "utf8")) as {
      defaultAccountId?: string;
      mcpConfig?: {
        doc?: {
          type?: string;
          url?: string;
        };
      };
      accounts?: Record<
        string,
        {
          mcpConfig?: {
            doc?: {
              type?: string;
              url?: string;
            };
          };
        }
      >;
    };

    expect(saved.defaultAccountId).toBe("default");
    expect(saved.mcpConfig?.doc).toEqual({
      type: "streamable-http",
      url: "https://doc-mcp.example.test/mcp",
    });
    expect(saved.accounts?.default?.mcpConfig?.doc).toEqual({
      type: "streamable-http",
      url: "https://doc-mcp.example.test/mcp",
    });

    controller.abort();
    await expect(gatewayPromise).resolves.toBeUndefined();
  });
});
