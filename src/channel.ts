/**
 * file: src/channel.ts
 * desc: 飞书渠道插件主入口
 */

import type {
  ChannelMessageActionName,
  ChannelPlugin,
  MoltbotConfig,
  MoltbotPluginApi,
} from "clawdbot/plugin-sdk";
import {
  createActionGate,
  formatPairingApproveHint,
  normalizePluginHttpPath,
} from "clawdbot/plugin-sdk";

import {
  listFeishuAccountIds,
  resolveDefaultFeishuAccountId,
  resolveFeishuAccount,
  resolveFeishuAllowFrom,
  resolveFeishuEventMode,
  resolveFeishuRequireMention,
  resolveFeishuReplyToMode,
} from "./feishu/config.js";
import {
  deleteFeishuMessage,
  editFeishuMessage,
  fetchFeishuMember,
  normalizeFeishuTarget,
  pinFeishuMessage,
  reactFeishuMessage,
  readFeishuMessages,
  sendFeishuMedia,
  sendFeishuText,
} from "./feishu/outbound.js";
import { parseFeishuCallback } from "./feishu/events.js";
import { FEISHU_CHANNEL_ID, FEISHU_HTTP_PATH, feishuMeta, feishuConfigSchema } from "./feishu/schema.js";
import {
  getState,
  getWsClient,
  deleteWsClient,
  startWsClient,
  type FeishuLogger,
} from "./feishu/state.js";
import { handleInboundEvent, createClient } from "./feishu/inbound.js";

// ============================================================================
// HTTP Route
// ============================================================================

export function registerFeishuHttpRoute(api: MoltbotPluginApi) {
  // Register a route for each account
  const accountIds = listFeishuAccountIds(api.config);

  for (const accountId of accountIds) {
    const accountPath = `${FEISHU_HTTP_PATH}/${accountId}`;
    const routePath = normalizePluginHttpPath(api.id, accountPath);

    api.registerHttpRoute({
      path: routePath,
      handler: async (req, res) => {
        if (req.method !== "POST") {
          res.statusCode = 405;
          res.end("method not allowed");
          return;
        }
        const chunks: Buffer[] = [];
        req.on("data", (chunk) => chunks.push(chunk));
        req.on("end", async () => {
          const rawBody = Buffer.concat(chunks).toString("utf8");
          try {
            const signature = req.headers["x-lark-signature"];
            const timestamp = req.headers["x-lark-request-timestamp"];
            const nonce = req.headers["x-lark-request-nonce"];

            const account = resolveFeishuAccount({ cfg: api.config, accountId });
            const parsed = parseFeishuCallback({
              rawBody,
              headers: {
                signature: Array.isArray(signature) ? signature[0] : signature,
                timestamp: Array.isArray(timestamp) ? timestamp[0] : timestamp,
                nonce: Array.isArray(nonce) ? nonce[0] : nonce,
              },
              verification: {
                verificationToken: account.verificationToken,
                encryptKey: account.encryptKey,
                appSecret: account.appSecret,
              },
            });

            if (parsed.kind === "challenge") {
              res.statusCode = 200;
              res.setHeader("Content-Type", "application/json; charset=utf-8");
              res.end(JSON.stringify({ challenge: parsed.challenge }));
              return;
            }

            await handleInboundEvent({
              cfg: api.config,
              accountId,
              event: parsed.event,
              log: api.logger,
            });
            res.statusCode = 200;
            res.setHeader("Content-Type", "application/json; charset=utf-8");
            res.end(JSON.stringify({ code: 0, msg: "success" }));
          } catch (err) {
            api.logger?.error?.(`feishu callback error for account ${accountId}: ${String(err)}`);
            res.statusCode = 500;
            res.setHeader("Content-Type", "application/json; charset=utf-8");
            res.end(JSON.stringify({ code: 500, msg: "error" }));
          }
        });
      },
    });

    api.logger?.info?.(`[feishu] registered HTTP callback route for account: ${accountId} at ${routePath}`);
  }

  // Also register the default route for backward compatibility (maps to default account)
  const defaultRoutePath = normalizePluginHttpPath(api.id, FEISHU_HTTP_PATH);
  api.registerHttpRoute({
    path: defaultRoutePath,
    handler: async (req, res) => {
      if (req.method !== "POST") {
        res.statusCode = 405;
        res.end("method not allowed");
        return;
      }
      const chunks: Buffer[] = [];
      req.on("data", (chunk) => chunks.push(chunk));
      req.on("end", async () => {
        const rawBody = Buffer.concat(chunks).toString("utf8");
        try {
          const signature = req.headers["x-lark-signature"];
          const timestamp = req.headers["x-lark-request-timestamp"];
          const nonce = req.headers["x-lark-request-nonce"];

          const accountId = resolveDefaultFeishuAccountId(api.config);
          const account = resolveFeishuAccount({ cfg: api.config, accountId });
          const parsed = parseFeishuCallback({
            rawBody,
            headers: {
              signature: Array.isArray(signature) ? signature[0] : signature,
              timestamp: Array.isArray(timestamp) ? timestamp[0] : timestamp,
              nonce: Array.isArray(nonce) ? nonce[0] : nonce,
            },
            verification: {
              verificationToken: account.verificationToken,
              encryptKey: account.encryptKey,
              appSecret: account.appSecret,
            },
          });

          if (parsed.kind === "challenge") {
            res.statusCode = 200;
            res.setHeader("Content-Type", "application/json; charset=utf-8");
            res.end(JSON.stringify({ challenge: parsed.challenge }));
            return;
          }

          await handleInboundEvent({
            cfg: api.config,
            accountId,
            event: parsed.event,
            log: api.logger,
          });
          res.statusCode = 200;
          res.setHeader("Content-Type", "application/json; charset=utf-8");
          res.end(JSON.stringify({ code: 0, msg: "success" }));
        } catch (err) {
          api.logger?.error?.(`feishu callback error: ${String(err)}`);
          res.statusCode = 500;
          res.setHeader("Content-Type", "application/json; charset=utf-8");
          res.end(JSON.stringify({ code: 500, msg: "error" }));
        }
      });
    },
  });
}

// ============================================================================
// Auto Start WebSocket
// ============================================================================

export async function autoStartFeishuWs(api: MoltbotPluginApi) {
  const accountIds = listFeishuAccountIds(api.config);
  for (const accountId of accountIds) {
    await startWsClient({
      cfg: api.config,
      accountId,
      logger: api.logger,
      onEvent: async (payload) => {
        await handleInboundEvent({
          cfg: api.config,
          accountId,
          event: payload,
          log: api.logger,
        });
      },
    });
  }
}

// ============================================================================
// Channel Plugin Definition
// ============================================================================

export const feishuPlugin: ChannelPlugin = {
  id: FEISHU_CHANNEL_ID,
  meta: feishuMeta,
  capabilities: {
    chatTypes: ["direct", "group", "thread"],
    reactions: true,
    threads: true,
    media: true,
    nativeCommands: true,
  },
  reload: { configPrefixes: ["channels.feishu"] },
  configSchema: feishuConfigSchema,

  config: {
    listAccountIds: (cfg) => listFeishuAccountIds(cfg),
    resolveAccount: (cfg, accountId) => resolveFeishuAccount({ cfg, accountId }),
    defaultAccountId: (cfg) => resolveDefaultFeishuAccountId(cfg),
    setAccountEnabled: ({ cfg, accountId, enabled }) => {
      const next = { ...cfg, channels: { ...cfg.channels } };
      const root = { ...(next.channels?.feishu ?? {}) };
      if (accountId === "default") {
        root.enabled = enabled;
      } else {
        root.accounts = { ...(root.accounts ?? {}) };
        root.accounts[accountId] = { ...(root.accounts[accountId] ?? {}), enabled };
      }
      next.channels = { ...next.channels, feishu: root };
      return next;
    },
    deleteAccount: ({ cfg, accountId }) => {
      const next = { ...cfg, channels: { ...cfg.channels } };
      const root = { ...(next.channels?.feishu ?? {}) };
      if (accountId === "default") {
        delete root.appId;
        delete root.appSecret;
        delete root.verificationToken;
        delete root.encryptKey;
      } else if (root.accounts) {
        root.accounts = { ...root.accounts };
        delete root.accounts[accountId];
      }
      next.channels = { ...next.channels, feishu: root };
      return next;
    },
    isConfigured: (account) => Boolean(account.appId && account.appSecret),
    describeAccount: (account) => ({
      accountId: account.accountId,
      name: account.name,
      enabled: account.enabled,
      configured: Boolean(account.appId && account.appSecret),
    }),
    resolveAllowFrom: ({ cfg, accountId }) =>
      resolveFeishuAllowFrom({ cfg, accountId }).map((entry) => String(entry)),
    formatAllowFrom: ({ allowFrom }) =>
      allowFrom
        .map((entry) => String(entry).trim())
        .filter(Boolean)
        .map((entry) => entry.toLowerCase()),
  },

  security: {
    resolveDmPolicy: ({ cfg, accountId, account }) => {
      const allowFromPath = `channels.feishu.${accountId === "default" ? "dm" : `accounts.${accountId}.dm`}.`;
      return {
        policy: account.dm?.policy ?? "pairing",
        allowFrom: account.dm?.allowFrom ?? [],
        allowFromPath,
        approveHint: formatPairingApproveHint("feishu"),
        normalizeEntry: (raw) => raw.replace(/^(feishu|user):/i, ""),
      };
    },
  },

  groups: {
    resolveRequireMention: ({ cfg, accountId, groupId }) =>
      resolveFeishuRequireMention({ cfg, accountId, groupId }),
  },

  threading: {
    resolveReplyToMode: ({ cfg, accountId }) => resolveFeishuReplyToMode({ cfg, accountId }),
  },

  messaging: {
    normalizeTarget: (raw) => {
      const target = normalizeFeishuTarget(raw);
      if (target.receiveIdType === "user_id") return `user:${target.receiveId}`;
      if (target.receiveIdType === "open_id") return `open:${target.receiveId}`;
      return `chat:${target.receiveId}`;
    },
    targetResolver: {
      looksLikeId: (raw) => Boolean(raw && raw.trim().length > 4),
      hint: "user:<id> or chat:<id>",
    },
  },

  actions: {
    listActions: ({ cfg }) => {
      const account = resolveFeishuAccount({ cfg });
      const gate = createActionGate((account.actions ?? {}) as Record<string, boolean>);
      const actions = new Set<ChannelMessageActionName>(["send"]);
      if (gate("reactions", true)) {
        actions.add("react");
        actions.add("reactions");
      }
      if (gate("messages", true)) {
        actions.add("read");
        actions.add("edit");
        actions.add("delete");
      }
      if (gate("pins", true)) {
        actions.add("pin");
        actions.add("unpin");
        actions.add("list-pins");
      }
      if (gate("memberInfo", true)) actions.add("member-info");
      return Array.from(actions);
    },
    extractToolSend: ({ args }) => {
      const action = typeof args.action === "string" ? args.action.trim() : "";
      if (action !== "sendMessage") return null;
      const to = typeof args.to === "string" ? args.to : undefined;
      if (!to) return null;
      const accountId = typeof args.accountId === "string" ? args.accountId.trim() : undefined;
      return { to, accountId };
    },
    handleAction: async ({ action, params, cfg, accountId }) => {
      const account = resolveFeishuAccount({ cfg, accountId });
      const client = createClient(account, cfg);

      if (action === "send") {
        const to = String(params.to ?? "").trim();
        const content = String(params.message ?? "");
        const mediaUrl = typeof params.media === "string" ? params.media : undefined;
        if (mediaUrl) {
          return await sendFeishuMedia({ client, to, text: content, mediaUrl });
        }
        return await sendFeishuText({ client, to, text: content });
      }

      if (action === "react") {
        const messageId = String(params.messageId ?? "");
        const emoji = String(params.emoji ?? "");
        const remove = typeof params.remove === "boolean" ? params.remove : undefined;
        return await reactFeishuMessage({ client, messageId, emoji, remove });
      }

      if (action === "reactions") {
        return { ok: false, error: "Feishu reactions list is not supported" };
      }

      if (action === "read") {
        const chatId = String(params.channelId ?? params.to ?? "");
        const limit = typeof params.limit === "number" ? params.limit : undefined;
        return await readFeishuMessages({ client, chatId, limit });
      }

      if (action === "edit") {
        const messageId = String(params.messageId ?? "");
        const content = String(params.message ?? "");
        return await editFeishuMessage({ client, messageId, text: content });
      }

      if (action === "delete") {
        const messageId = String(params.messageId ?? "");
        return await deleteFeishuMessage({ client, messageId });
      }

      if (action === "pin" || action === "unpin") {
        const messageId = String(params.messageId ?? "");
        const chatId = String(params.channelId ?? params.to ?? "");
        return await pinFeishuMessage({ client, messageId, chatId, remove: action === "unpin" });
      }

      if (action === "list-pins") {
        return { ok: false, error: "Feishu list pins is not supported" };
      }

      if (action === "member-info") {
        const userId = String(params.userId ?? "");
        return await fetchFeishuMember({ client, userId });
      }

      throw new Error(`Action ${action} is not supported for provider feishu.`);
    },
  },

  outbound: {
    deliveryMode: "direct",
    chunker: null,
    textChunkLimit: 4000,
    sendText: async ({ to, text, accountId, replyToId, cfg }) => {
      const account = resolveFeishuAccount({ cfg, accountId });
      const client = createClient(account, cfg);
      const result = await sendFeishuText({
        client,
        to,
        text,
        replyToId: replyToId ?? undefined,
      });
      const state = getState(account.accountId);
      state.lastOutboundAt = Date.now();
      return { channel: FEISHU_CHANNEL_ID, ...result };
    },
    sendMedia: async ({ to, text, mediaUrl, accountId, replyToId, cfg }) => {
      const account = resolveFeishuAccount({ cfg, accountId });
      const client = createClient(account, cfg);
      const result = await sendFeishuMedia({
        client,
        to,
        text,
        mediaUrl: mediaUrl ?? "",
        replyToId: replyToId ?? undefined,
      });
      const state = getState(account.accountId);
      state.lastOutboundAt = Date.now();
      return { channel: FEISHU_CHANNEL_ID, ...result };
    },
  },

  status: {
    defaultRuntime: {
      accountId: "default",
      running: false,
      lastStartAt: null,
      lastStopAt: null,
      lastError: null,
    },
    buildChannelSummary: ({ snapshot }) => ({
      configured: snapshot.configured ?? false,
      running: snapshot.running ?? false,
      lastStartAt: snapshot.lastStartAt ?? null,
      lastStopAt: snapshot.lastStopAt ?? null,
      lastError: snapshot.lastError ?? null,
      lastInboundAt: snapshot.lastInboundAt ?? null,
      lastOutboundAt: snapshot.lastOutboundAt ?? null,
    }),
    buildAccountSnapshot: ({ account }) => {
      const state = getState(account.accountId);
      const wsClient = getWsClient(account.accountId);
      return {
        accountId: account.accountId,
        name: account.name,
        enabled: account.enabled,
        configured: Boolean(account.appId && account.appSecret),
        running: state.running,
        connected: wsClient?.isConnected ?? false,
        lastStartAt: state.lastStartAt,
        lastStopAt: state.lastStopAt,
        lastError: state.lastError,
        lastInboundAt: state.lastInboundAt,
        lastOutboundAt: state.lastOutboundAt,
      };
    },
  },

  gateway: {
    startAccount: async (ctx) => {
      const state = getState(ctx.account.accountId);
      state.running = true;
      state.lastStartAt = Date.now();
      state.lastError = null;

      const mode = resolveFeishuEventMode({
        cfg: ctx.cfg,
        accountId: ctx.account.accountId,
      });

      if (mode === "ws") {
        const started = await startWsClient({
          cfg: ctx.cfg,
          accountId: ctx.account.accountId,
          logger: ctx.logger as FeishuLogger,
          onEvent: async (payload) => {
            await handleInboundEvent({
              cfg: ctx.cfg,
              accountId: ctx.account.accountId,
              event: payload,
              log: ctx.logger,
            });
          },
        });
        if (!started) {
          throw new Error("Feishu ws client failed to start");
        }
      } else {
        deleteWsClient(ctx.account.accountId);
      }

      ctx.setStatus({
        accountId: ctx.account.accountId,
        running: true,
        lastStartAt: state.lastStartAt,
        lastStopAt: state.lastStopAt,
        lastError: state.lastError,
      });
    },

    stopAccount: async (ctx) => {
      const state = getState(ctx.account.accountId);
      state.running = false;
      state.lastStopAt = Date.now();
      deleteWsClient(ctx.account.accountId);
      ctx.setStatus({
        accountId: ctx.account.accountId,
        running: false,
        lastStartAt: state.lastStartAt,
        lastStopAt: state.lastStopAt,
        lastError: state.lastError,
      });
    },
  },
};
