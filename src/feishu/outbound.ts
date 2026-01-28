import { FeishuClient } from "./client.js";

export type FeishuTarget = {
  raw: string;
  receiveId: string;
  receiveIdType: "user_id" | "chat_id" | "open_id";
};

export type FeishuSendResult = {
  messageId?: string;
  chatId?: string;
};

export type FeishuReplyPayload = {
  text?: string;
  mediaUrl?: string;
};

type MediaKey =
  | { kind: "image"; key: string }
  | { kind: "file"; key: string }
  | { kind: "audio"; key: string };

const parseMediaKey = (mediaUrl?: string): MediaKey | null => {
  if (!mediaUrl) return null;
  const normalized = mediaUrl.trim();
  if (normalized.startsWith("feishu:image_key:")) {
    return { kind: "image", key: normalized.replace("feishu:image_key:", "") };
  }
  if (normalized.startsWith("feishu:file_key:")) {
    return { kind: "file", key: normalized.replace("feishu:file_key:", "") };
  }
  if (normalized.startsWith("feishu:audio_key:")) {
    return { kind: "audio", key: normalized.replace("feishu:audio_key:", "") };
  }
  return null;
};

const createContent = (text: string) => JSON.stringify({ text });

/**
 * 根据 ID 前缀自动识别类型
 * - ou_ 开头 → open_id
 * - on_ 开头 → open_id
 * - oc_ 开头 → chat_id (open chat id)
 * - 其他 → 保持传入的类型
 */
const inferIdType = (id: string, defaultType: "user_id" | "chat_id" | "open_id") => {
  if (id.startsWith("ou_") || id.startsWith("on_")) {
    return "open_id" as const;
  }
  if (id.startsWith("oc_")) {
    return "chat_id" as const;
  }
  return defaultType;
};

export function normalizeFeishuTarget(raw: string): FeishuTarget {
  const trimmed = raw.trim();
  if (trimmed.startsWith("user:")) {
    const receiveId = trimmed.replace("user:", "");
    return { raw, receiveId, receiveIdType: inferIdType(receiveId, "user_id") };
  }
  if (trimmed.startsWith("chat:")) {
    const receiveId = trimmed.replace("chat:", "");
    return { raw, receiveId, receiveIdType: inferIdType(receiveId, "chat_id") };
  }
  if (trimmed.startsWith("open:")) {
    return { raw, receiveId: trimmed.replace("open:", ""), receiveIdType: "open_id" };
  }
  return { raw, receiveId: trimmed, receiveIdType: inferIdType(trimmed, "chat_id") };
}

export async function sendFeishuText(params: {
  client: FeishuClient;
  to: string;
  text: string;
  replyToId?: string;
}): Promise<FeishuSendResult> {
  const target = normalizeFeishuTarget(params.to);
  if (params.replyToId) {
    const response = await params.client.request<{ message_id?: string }>({
      method: "POST",
      path: `/im/v1/messages/${params.replyToId}/reply`,
      body: {
        msg_type: "text",
        content: createContent(params.text),
      },
    });
    return { messageId: response.data?.message_id };
  }
  const response = await params.client.request<{ message_id?: string; chat_id?: string }>({
    method: "POST",
    path: "/im/v1/messages",
    query: {
      receive_id_type: target.receiveIdType,
    },
    body: {
      receive_id: target.receiveId,
      msg_type: "text",
      content: createContent(params.text),
    },
  });
  return {
    messageId: response.data?.message_id,
    chatId: response.data?.chat_id,
  };
}

export async function sendFeishuMedia(params: {
  client: FeishuClient;
  to: string;
  text?: string;
  mediaUrl: string;
  replyToId?: string;
}): Promise<FeishuSendResult> {
  const target = normalizeFeishuTarget(params.to);
  const mediaKey = parseMediaKey(params.mediaUrl);
  if (!mediaKey) {
    const fallback = params.text
      ? `${params.text}\n${params.mediaUrl}`
      : `Media: ${params.mediaUrl}`;
    return await sendFeishuText({
      client: params.client,
      to: params.to,
      text: fallback,
      replyToId: params.replyToId,
    });
  }

  const body = {
    msg_type: mediaKey.kind,
    content: JSON.stringify({ [`${mediaKey.kind}_key`]: mediaKey.key }),
  };

  if (params.replyToId) {
    const response = await params.client.request<{ message_id?: string }>({
      method: "POST",
      path: `/im/v1/messages/${params.replyToId}/reply`,
      body,
    });
    return { messageId: response.data?.message_id };
  }

  const response = await params.client.request<{ message_id?: string; chat_id?: string }>({
    method: "POST",
    path: "/im/v1/messages",
    query: {
      receive_id_type: target.receiveIdType,
    },
    body: {
      receive_id: target.receiveId,
      ...body,
    },
  });
  return {
    messageId: response.data?.message_id,
    chatId: response.data?.chat_id,
  };
}

export async function editFeishuMessage(params: {
  client: FeishuClient;
  messageId: string;
  text: string;
}) {
  return await params.client.request({
    method: "PATCH",
    path: `/im/v1/messages/${params.messageId}`,
    body: {
      msg_type: "text",
      content: createContent(params.text),
    },
  });
}

export async function deleteFeishuMessage(params: { client: FeishuClient; messageId: string }) {
  return await params.client.request({
    method: "DELETE",
    path: `/im/v1/messages/${params.messageId}`,
  });
}

export async function readFeishuMessages(params: {
  client: FeishuClient;
  chatId: string;
  limit?: number;
  before?: string;
  after?: string;
}) {
  return await params.client.request({
    method: "GET",
    path: "/im/v1/messages",
    query: {
      container_id_type: "chat",
      container_id: params.chatId,
      page_size: params.limit,
      page_token: params.after ?? params.before,
    },
  });
}

export async function reactFeishuMessage(params: {
  client: FeishuClient;
  messageId: string;
  emoji: string;
  remove?: boolean;
}) {
  if (params.remove) {
    return await params.client.request({
      method: "DELETE",
      path: `/im/v1/messages/${params.messageId}/reactions`,
      query: {
        reaction_type: "emoji",
        emoji_type: params.emoji,
      },
    });
  }
  return await params.client.request({
    method: "POST",
    path: `/im/v1/messages/${params.messageId}/reactions`,
    body: {
      reaction_type: "emoji",
      emoji_type: params.emoji,
    },
  });
}

export async function pinFeishuMessage(params: {
  client: FeishuClient;
  messageId: string;
  chatId: string;
  remove?: boolean;
}) {
  if (params.remove) {
    return await params.client.request({
      method: "DELETE",
      path: `/im/v1/pins/${params.messageId}`,
    });
  }
  return await params.client.request({
    method: "POST",
    path: "/im/v1/pins",
    body: {
      message_id: params.messageId,
      chat_id: params.chatId,
    },
  });
}

export async function fetchFeishuMember(params: {
  client: FeishuClient;
  userId: string;
}) {
  return await params.client.request({
    method: "GET",
    path: `/contact/v3/users/${params.userId}`,
    query: {
      user_id_type: "user_id",
    },
  });
}
