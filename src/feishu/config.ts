import type { MoltbotConfig } from "clawdbot/plugin-sdk";

export type FeishuDmConfig = {
  enabled?: boolean;
  policy?: "open" | "pairing";
  allowFrom?: Array<string>;
};

export type FeishuGroupConfig = {
  requireMention?: boolean;
  toolPolicy?: string;
};

export type FeishuAccountConfig = {
  enabled?: boolean;
  name?: string;
  appId?: string;
  appSecret?: string;
  verificationToken?: string;
  encryptKey?: string;
  eventMode?: "http" | "ws";
  baseUrl?: string;
  dm?: FeishuDmConfig;
  groupPolicy?: "open" | "allowlist";
  requireMention?: boolean;
  replyToMode?: "off" | "first" | "all";
  mediaMaxMb?: number;
  actions?: Record<string, boolean>;
  channels?: Record<string, FeishuGroupConfig>;
};

export type ResolvedFeishuAccount = FeishuAccountConfig & {
  accountId: string;
  enabled: boolean;
  name?: string;
  config: FeishuAccountConfig;
};

type FeishuRootConfig = {
  enabled?: boolean;
  appId?: string;
  appSecret?: string;
  verificationToken?: string;
  encryptKey?: string;
  eventMode?: "http" | "ws";
  baseUrl?: string;
  dm?: FeishuDmConfig;
  groupPolicy?: "open" | "allowlist";
  requireMention?: boolean;
  replyToMode?: "off" | "first" | "all";
  mediaMaxMb?: number;
  actions?: Record<string, boolean>;
  channels?: Record<string, FeishuGroupConfig>;
  accounts?: Record<string, FeishuAccountConfig>;
};

const DEFAULT_ACCOUNT_ID = "default";

const normalizeAccountId = (raw?: string | null): string => {
  const normalized = raw?.trim();
  return normalized || DEFAULT_ACCOUNT_ID;
};

const readRootConfig = (cfg: MoltbotConfig): FeishuRootConfig =>
  (cfg.channels?.feishu ?? {}) as FeishuRootConfig;

const mergeConfig = (root: FeishuRootConfig, account: FeishuAccountConfig): FeishuAccountConfig => ({
  ...root,
  ...account,
  dm: {
    ...(root.dm ?? {}),
    ...(account.dm ?? {}),
  },
  channels: account.channels ?? root.channels,
});

export function listFeishuAccountIds(cfg: MoltbotConfig): string[] {
  const root = readRootConfig(cfg);
  const ids = Object.keys(root.accounts ?? {}).filter(Boolean);
  return ids.length > 0 ? ids : [DEFAULT_ACCOUNT_ID];
}

export function resolveDefaultFeishuAccountId(cfg: MoltbotConfig): string {
  const root = readRootConfig(cfg);
  if (root.accounts && Object.keys(root.accounts).length > 0) {
    return DEFAULT_ACCOUNT_ID;
  }
  return DEFAULT_ACCOUNT_ID;
}

export function resolveFeishuAccount(params: {
  cfg: MoltbotConfig;
  accountId?: string | null;
}): ResolvedFeishuAccount {
  const root = readRootConfig(params.cfg);
  const normalizedId = normalizeAccountId(params.accountId);
  const account = root.accounts?.[normalizedId] ?? {};
  const merged = mergeConfig(root, account);
  return {
    ...merged,
    accountId: normalizedId,
    enabled: merged.enabled ?? root.enabled ?? true,
    name: merged.name ?? root?.["name"],
    config: merged,
  };
}

export function resolveFeishuAllowFrom(params: {
  cfg: MoltbotConfig;
  accountId?: string | null;
}): string[] {
  const account = resolveFeishuAccount(params);
  return (account.dm?.allowFrom ?? []).map((entry) => String(entry));
}

export function normalizeFeishuAllowFrom(entries: Array<string>): string[] {
  return entries
    .map((entry) => String(entry).trim())
    .filter(Boolean)
    .map((entry) => entry.toLowerCase());
}

export function resolveFeishuGroupPolicy(params: {
  cfg: MoltbotConfig;
  accountId?: string | null;
}): "open" | "allowlist" {
  const account = resolveFeishuAccount(params);
  return account.groupPolicy ?? "open";
}

export function resolveFeishuEventMode(params: {
  cfg: MoltbotConfig;
  accountId?: string | null;
}): "http" | "ws" {
  const account = resolveFeishuAccount(params);
  return account.eventMode ?? "ws";
}

export function resolveFeishuRequireMention(params: {
  cfg: MoltbotConfig;
  accountId?: string | null;
  groupId?: string | null;
}): boolean {
  const account = resolveFeishuAccount(params);
  const groupConfig =
    (params.groupId && account.channels?.[params.groupId]) || account.channels?.["*"];
  if (typeof groupConfig?.requireMention === "boolean") {
    return groupConfig.requireMention;
  }
  if (typeof account.requireMention === "boolean") {
    return account.requireMention;
  }
  return false;
}

export function resolveFeishuReplyToMode(params: {
  cfg: MoltbotConfig;
  accountId?: string | null;
}): "off" | "first" | "all" {
  const account = resolveFeishuAccount(params);
  return account.replyToMode ?? "off";
}

export function resolveFeishuBaseUrl(params: {
  cfg: MoltbotConfig;
  accountId?: string | null;
}): string | undefined {
  const account = resolveFeishuAccount(params);
  return account.baseUrl?.trim() || undefined;
}
