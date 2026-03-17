import { promises as fs } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";

import type { PluginConfig } from "./config.js";
import { resolveDefaultWecomAppAccountId } from "./config.js";
import type { ResolvedWecomAppAccount } from "./types.js";

type WecomAppRuntimeEnv = {
  log?: (message: string) => void;
  error?: (message: string) => void;
};

type PersistedDocConfig = {
  type: string;
  url: string;
};

type PersistedWecomAppAccountMcpConfig = {
  updatedAt?: string;
  mcpConfig?: {
    doc?: PersistedDocConfig;
    [key: string]: unknown;
  };
  [key: string]: unknown;
};

type PersistedWecomAppMcpFile = {
  updatedAt?: string;
  defaultAccountId?: string;
  mcpConfig?: {
    doc?: PersistedDocConfig;
    [key: string]: unknown;
  };
  accounts?: Record<string, PersistedWecomAppAccountMcpConfig>;
  [key: string]: unknown;
};

const DEFAULT_MCP_TYPE = "streamable-http";
const writeQueues = new Map<string, Promise<void>>();

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function resolveOpenClawStateDir(): string {
  const override = process.env.OPENCLAW_STATE_DIR?.trim() || process.env.CLAWDBOT_STATE_DIR?.trim();
  if (override) {
    if (override.startsWith("~")) {
      const home = homedir();
      const normalized = override === "~" ? home : path.join(home, override.slice(2));
      return path.resolve(normalized);
    }
    return path.resolve(override);
  }
  return path.join(homedir(), ".openclaw");
}

export function resolveWecomAppMcpConfigPath(): string {
  return path.join(resolveOpenClawStateDir(), "wecomAppConfig", "config.json");
}

function resolveConfiguredWecomAppDocMcp(account: ResolvedWecomAppAccount): PersistedDocConfig | null {
  const rawUrl = account.config.docs?.mcp?.url?.trim();
  if (!rawUrl) return null;
  return {
    type: account.config.docs?.mcp?.type?.trim() || DEFAULT_MCP_TYPE,
    url: rawUrl,
  };
}

async function readPersistedConfig(filePath: string): Promise<PersistedWecomAppMcpFile> {
  try {
    const raw = await fs.readFile(filePath, "utf8");
    const parsed = JSON.parse(raw) as unknown;
    return isRecord(parsed) ? (parsed as PersistedWecomAppMcpFile) : {};
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return {};
    }
    return {};
  }
}

async function writePersistedConfig(filePath: string, data: PersistedWecomAppMcpFile): Promise<void> {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  const tempPath = `${filePath}.${process.pid}.${Date.now()}.tmp`;
  await fs.writeFile(tempPath, `${JSON.stringify(data, null, 2)}\n`, "utf8");
  await fs.rename(tempPath, filePath);
}

async function serializeWrite(filePath: string, action: () => Promise<void>): Promise<void> {
  const previous = writeQueues.get(filePath) ?? Promise.resolve();
  const next = previous.catch(() => undefined).then(action);
  writeQueues.set(filePath, next);
  try {
    await next;
  } finally {
    if (writeQueues.get(filePath) === next) {
      writeQueues.delete(filePath);
    }
  }
}

export async function syncWecomAppDocMcpConfig(params: {
  cfg: PluginConfig;
  account: ResolvedWecomAppAccount;
  runtime?: WecomAppRuntimeEnv;
}): Promise<void> {
  const filePath = resolveWecomAppMcpConfigPath();
  const docConfig = resolveConfiguredWecomAppDocMcp(params.account);
  const defaultAccountId = resolveDefaultWecomAppAccountId(params.cfg);
  const updatedAt = new Date().toISOString();

  await serializeWrite(filePath, async () => {
    const current = await readPersistedConfig(filePath);
    const currentAccounts = isRecord(current.accounts)
      ? (current.accounts as Record<string, PersistedWecomAppAccountMcpConfig>)
      : {};
    const nextAccounts = { ...currentAccounts };
    const existingAccount = isRecord(nextAccounts[params.account.accountId])
      ? (nextAccounts[params.account.accountId] as PersistedWecomAppAccountMcpConfig)
      : {};
    const existingAccountMcpConfig = isRecord(existingAccount.mcpConfig)
      ? (existingAccount.mcpConfig as Record<string, unknown>)
      : {};

    if (docConfig) {
      nextAccounts[params.account.accountId] = {
        ...existingAccount,
        updatedAt,
        mcpConfig: {
          ...existingAccountMcpConfig,
          doc: docConfig,
        },
      };
    } else if (params.account.accountId in nextAccounts) {
      const updatedAccountMcpConfig = { ...existingAccountMcpConfig };
      delete updatedAccountMcpConfig.doc;
      if (Object.keys(updatedAccountMcpConfig).length > 0) {
        nextAccounts[params.account.accountId] = {
          ...existingAccount,
          updatedAt,
          mcpConfig: updatedAccountMcpConfig,
        };
      } else {
        delete nextAccounts[params.account.accountId];
      }
    }

    const orderedAccountIds = Object.keys(nextAccounts).sort((a, b) => a.localeCompare(b));
    const selectedTopLevelDoc =
      nextAccounts[defaultAccountId]?.mcpConfig?.doc ??
      orderedAccountIds
        .map((accountId) => nextAccounts[accountId]?.mcpConfig?.doc)
        .find((entry): entry is PersistedDocConfig => Boolean(entry?.url));

    current.updatedAt = updatedAt;
    current.defaultAccountId = defaultAccountId;
    current.accounts = nextAccounts;

    if (selectedTopLevelDoc) {
      current.mcpConfig = {
        ...(isRecord(current.mcpConfig) ? current.mcpConfig : {}),
        doc: selectedTopLevelDoc,
      };
    } else if (isRecord(current.mcpConfig)) {
      const nextMcpConfig = { ...(current.mcpConfig as Record<string, unknown>) };
      delete nextMcpConfig.doc;
      current.mcpConfig = nextMcpConfig;
    }

    await writePersistedConfig(filePath, current);
  });

  if (docConfig) {
    params.runtime?.log?.(
      `[wecom-app] doc MCP config saved for account ${params.account.accountId} at ${filePath}`
    );
  } else {
    params.runtime?.log?.(
      `[wecom-app] no doc MCP config found for account ${params.account.accountId}; state synced at ${filePath}`
    );
  }
}
