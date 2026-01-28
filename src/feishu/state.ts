/**
 * file: src/feishu/state.ts
 * desc: 飞书渠道的运行时状态管理
 */

import type { MoltbotConfig } from "clawdbot/plugin-sdk";
import { resolveFeishuAccount, resolveFeishuEventMode, resolveFeishuBaseUrl } from "./config.js";
import { FeishuWsClient } from "./ws-client.js";

export type FeishuRuntimeState = {
  running: boolean;
  lastStartAt: number | null;
  lastStopAt: number | null;
  lastError: string | null;
  lastInboundAt: number | null;
  lastOutboundAt: number | null;
};

export type FeishuLogger = {
  info?: (message: string) => void;
  error?: (message: string) => void;
  warn?: (message: string) => void;
  debug?: (message: string) => void;
};

const runtimeState = new Map<string, FeishuRuntimeState>();
const wsClients = new Map<string, FeishuWsClient>();

export const getState = (accountId: string): FeishuRuntimeState => {
  const existing = runtimeState.get(accountId);
  if (existing) return existing;
  const next: FeishuRuntimeState = {
    running: false,
    lastStartAt: null,
    lastStopAt: null,
    lastError: null,
    lastInboundAt: null,
    lastOutboundAt: null,
  };
  runtimeState.set(accountId, next);
  return next;
};

export const getWsClient = (accountId: string): FeishuWsClient | undefined => {
  return wsClients.get(accountId);
};

export const setWsClient = (accountId: string, client: FeishuWsClient): void => {
  wsClients.set(accountId, client);
};

export const deleteWsClient = (accountId: string): boolean => {
  const client = wsClients.get(accountId);
  if (client) {
    client.stop();
    wsClients.delete(accountId);
    return true;
  }
  return false;
};

export const hasWsClient = (accountId: string): boolean => {
  return wsClients.has(accountId);
};

export type StartWsClientParams = {
  cfg: MoltbotConfig;
  accountId: string;
  logger?: FeishuLogger;
  onEvent: (payload: Record<string, unknown>) => Promise<void>;
};

export const startWsClient = async (params: StartWsClientParams): Promise<boolean> => {
  const account = resolveFeishuAccount({ cfg: params.cfg, accountId: params.accountId });
  const mode = resolveFeishuEventMode({
    cfg: params.cfg,
    accountId: params.accountId,
  });

  if (mode !== "ws") return false;
  if (!account.enabled) return false;
  if (!account.appId || !account.appSecret) {
    params.logger?.error?.(`[feishu] [${account.accountId}] appId/appSecret missing`);
    return false;
  }

  if (wsClients.has(account.accountId)) {
    return true;
  }

  const baseUrl =
    resolveFeishuBaseUrl({ cfg: params.cfg, accountId: account.accountId }) ??
    "https://open.feishu.cn/open-apis";

  const wsClient = new FeishuWsClient({
    appId: account.appId,
    appSecret: account.appSecret,
    baseUrl,
    logger: params.logger,
  });

  wsClients.set(account.accountId, wsClient);
  params.logger?.info?.(`[feishu] [${account.accountId}] starting ws client`);

  await wsClient.start(async (payload) => {
    if (!payload || typeof payload !== "object") return;
    await params.onEvent(payload as Record<string, unknown>);
  });

  const state = getState(account.accountId);
  state.running = true;
  state.lastStartAt = Date.now();
  state.lastError = null;

  return true;
};
