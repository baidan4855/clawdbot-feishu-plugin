/**
 * file: src/feishu/inbound.ts
 * desc: 飞书入站消息处理
 */

import type { MoltbotConfig, ReplyPayload } from "clawdbot/plugin-sdk";
import { getFeishuRuntime } from "../runtime.js";
import {
  normalizeFeishuAllowFrom,
  resolveFeishuAccount,
  resolveFeishuAllowFrom,
  resolveFeishuGroupPolicy,
  resolveFeishuRequireMention,
  resolveFeishuReplyToMode,
  resolveFeishuBaseUrl,
  type ResolvedFeishuAccount,
} from "./config.js";
import { FeishuClient } from "./client.js";
import { sendFeishuText, sendFeishuMedia } from "./outbound.js";
import { getState, type FeishuLogger } from "./state.js";
import { FEISHU_CHANNEL_ID } from "./schema.js";

const createClient = (account: ResolvedFeishuAccount, cfg: MoltbotConfig) => {
  if (!account.appId || !account.appSecret) {
    throw new Error("Feishu appId/appSecret missing");
  }
  return new FeishuClient({
    appId: account.appId,
    appSecret: account.appSecret,
    baseUrl: resolveFeishuBaseUrl({ cfg, accountId: account.accountId }),
  });
};

const normalizeSenderId = (raw?: string | null) => (raw ?? "").trim();

const hasAllowEntry = (allowFrom: string[], senderId: string) => {
  if (!senderId) return false;
  const normalized = normalizeFeishuAllowFrom(allowFrom);
  if (normalized.includes("*")) return true;
  return normalized.includes(senderId.toLowerCase());
};

const parseTextContent = (raw: string | undefined) => {
  if (!raw) return "";
  try {
    const parsed = JSON.parse(raw) as { text?: string };
    return parsed.text ?? "";
  } catch {
    return raw;
  }
};

const shouldHandleGroup = (params: {
  account: ResolvedFeishuAccount;
  cfg: MoltbotConfig;
  chatId: string;
  wasMentioned: boolean;
}) => {
  const policy = resolveFeishuGroupPolicy({
    cfg: params.cfg,
    accountId: params.account.accountId,
  });
  if (policy === "allowlist" && !params.account.channels?.[params.chatId]) {
    return false;
  }
  const requireMention = resolveFeishuRequireMention({
    cfg: params.cfg,
    accountId: params.account.accountId,
    groupId: params.chatId,
  });
  if (requireMention && !params.wasMentioned) {
    return false;
  }
  return true;
};

const shouldAllowDm = (params: {
  account: ResolvedFeishuAccount;
  allowFrom: string[];
  senderId: string;
}) => {
  const dmConfig = params.account.dm;
  if (dmConfig?.enabled === false) return false;
  const allowFrom = params.allowFrom;
  if (allowFrom.length === 0) return (dmConfig?.policy ?? "pairing") === "open";
  return hasAllowEntry(allowFrom, params.senderId);
};

async function handlePairing({
  senderId,
  replyTarget,
  account,
  cfg,
}: {
  senderId: string;
  replyTarget: string;
  account: ResolvedFeishuAccount;
  cfg: MoltbotConfig;
}) {
  const runtime = getFeishuRuntime();
  const result = await runtime.channel.pairing.upsertPairingRequest({
    channel: FEISHU_CHANNEL_ID,
    id: senderId,
  });
  if (!result.code) return;
  const reply = runtime.channel.pairing.buildPairingReply({
    channel: FEISHU_CHANNEL_ID,
    idLine: `Feishu user: ${senderId}`,
    code: result.code,
  });
  await sendFeishuText({
    client: createClient(account, cfg),
    to: replyTarget,
    text: reply,
  });
}

export type InboundEventParams = {
  cfg: MoltbotConfig;
  accountId: string;
  event: Record<string, unknown>;
  log?: FeishuLogger;
};

export async function handleInboundEvent(params: InboundEventParams) {
  const runtime = getFeishuRuntime();
  const account = resolveFeishuAccount({ cfg: params.cfg, accountId: params.accountId });

  const eventPayload = ((params.event as { event?: unknown })?.event ?? params.event ?? {}) as {
    message?: {
      message_id?: string;
      chat_id?: string;
      chat_type?: string;
      message_type?: string;
      content?: string;
      mentions?: Array<{ name?: string; id?: { user_id?: string } }>;
    };
    sender?: {
      sender_type?: string;
      sender_id?: { user_id?: string; open_id?: string };
      sender_id_type?: string;
      tenant_key?: string;
    };
  };

  const message = eventPayload.message;
  if (!message?.message_id || !message.chat_id) {
    const eventType =
      (params.event as { header?: { event_type?: string } })?.header?.event_type ?? "unknown";
    params.log?.info?.(`feishu inbound ignored: missing message_id/chat_id (event=${eventType})`);
    return;
  }
  params.log?.info?.(
    `feishu inbound message received: id=${message.message_id} chat=${message.chat_id} type=${message.message_type ?? "unknown"}`,
  );

  const chatType = message.chat_type === "p2p" ? "direct" : "group";
  const senderId = normalizeSenderId(
    eventPayload.sender?.sender_id?.user_id ?? eventPayload.sender?.sender_id?.open_id,
  );
  if (!senderId) return;

  const replyTarget = chatType === "direct" ? `user:${senderId}` : `chat:${message.chat_id}`;
  const allowFromConfig = resolveFeishuAllowFrom({
    cfg: params.cfg,
    accountId: account.accountId,
  });
  const allowFromStore = await runtime.channel.pairing.readAllowFromStore(FEISHU_CHANNEL_ID);
  const allowFrom = [...allowFromConfig, ...allowFromStore];

  const wasMentioned = Boolean(message.mentions && message.mentions.length > 0);

  if (chatType === "group") {
    const allowed = shouldHandleGroup({
      account,
      cfg: params.cfg,
      chatId: message.chat_id,
      wasMentioned,
    });
    if (!allowed) return;
  }

  if (chatType === "direct") {
    const dmPolicy = account.dm?.policy ?? "pairing";
    const allowed = shouldAllowDm({
      account,
      allowFrom,
      senderId,
    });
    if (!allowed) {
      if (dmPolicy === "pairing") {
        await handlePairing({ senderId, replyTarget, account, cfg: params.cfg });
      }
      return;
    }
  }

  const route = runtime.channel.routing.resolveAgentRoute({
    cfg: params.cfg,
    channel: FEISHU_CHANNEL_ID,
    accountId: account.accountId,
    peer: {
      kind: chatType === "direct" ? "dm" : "group",
      id: chatType === "direct" ? senderId : message.chat_id,
    },
  });

  const textBody = message.message_type === "text" ? parseTextContent(message.content) : "";
  const body =
    textBody || `[Feishu ${message.message_type ?? "message"}] ${parseTextContent(message.content)}`;

  const ctxPayload = runtime.channel.reply.finalizeInboundContext({
    Body: body,
    RawBody: textBody || body,
    From: senderId,
    To: replyTarget,
    AccountId: account.accountId,
    Provider: FEISHU_CHANNEL_ID,
    Surface: FEISHU_CHANNEL_ID,
    ChatType: chatType,
    MessageSid: message.message_id,
    ReplyToId: message.message_id,
    WasMentioned: wasMentioned,
    SenderId: senderId,
    SenderName: eventPayload.sender?.sender_id?.user_id,
    Timestamp: Number((params.event.header as { create_time?: string })?.create_time) || undefined,
    SessionKey: route.sessionKey,
  });

  const storePath = runtime.channel.session.resolveStorePath(params.cfg.session?.store, {
    agentId: route.agentId,
  });

  await runtime.channel.session.recordInboundSession({
    storePath,
    sessionKey: route.sessionKey,
    ctx: ctxPayload,
    updateLastRoute: {
      sessionKey: route.mainSessionKey,
      channel: FEISHU_CHANNEL_ID,
      to: replyTarget,
      accountId: account.accountId,
      threadId: message.message_id,
    },
    onRecordError: (err) => {
      params.log?.error?.(`feishu session record failed: ${String(err)}`);
    },
  });

  const replyToMode = resolveFeishuReplyToMode({
    cfg: params.cfg,
    accountId: account.accountId,
  });

  const hasRepliedRef = { value: false };
  const { dispatcher, replyOptions, markDispatchIdle } =
    runtime.channel.reply.createReplyDispatcherWithTyping({
      deliver: async (payload: ReplyPayload) => {
        const replyToId =
          replyToMode === "off"
            ? undefined
            : replyToMode === "first" && hasRepliedRef.value
              ? undefined
              : message.message_id;
        if (payload.mediaUrl) {
          await sendFeishuMedia({
            client: createClient(account, params.cfg),
            to: replyTarget,
            text: payload.text,
            mediaUrl: payload.mediaUrl,
            replyToId,
          });
        } else if (payload.text) {
          await sendFeishuText({
            client: createClient(account, params.cfg),
            to: replyTarget,
            text: payload.text,
            replyToId,
          });
        }
        hasRepliedRef.value = true;
        const state = getState(account.accountId);
        state.lastOutboundAt = Date.now();
      },
      onError: (err) => {
        params.log?.error?.(`feishu reply failed: ${String(err)}`);
      },
    });

  try {
    const result = await runtime.channel.reply.dispatchReplyFromConfig({
      ctx: ctxPayload,
      cfg: params.cfg,
      dispatcher,
      replyOptions: {
        ...replyOptions,
        hasRepliedRef,
      },
    });
    markDispatchIdle();
    return result;
  } finally {
    const state = getState(account.accountId);
    state.lastInboundAt = Date.now();
  }
}

/** 导出 createClient 供其他模块使用 */
export { createClient };
