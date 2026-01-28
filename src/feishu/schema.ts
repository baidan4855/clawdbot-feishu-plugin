/**
 * file: src/feishu/schema.ts
 * desc: 飞书渠道插件的元信息和配置 schema 定义
 *
 * HTTP 回调路径说明：
 * - 默认账户: /plugins/feishu/events
 * - 多账户模式: /plugins/feishu/events/{accountId}
 *   例如: /plugins/feishu/events/bot1, /plugins/feishu/events/bot2
 */

export const FEISHU_CHANNEL_ID = "feishu";
export const FEISHU_HTTP_PATH = "/events";

export const feishuMeta = {
  id: FEISHU_CHANNEL_ID,
  label: "Feishu",
  selectionLabel: "Feishu (Bot API)",
  detailLabel: "Feishu Bot",
  docsPath: "/channels/feishu",
  docsLabel: "feishu",
  blurb: "Feishu bot via WebSocket or event callback.",
  systemImage: "message",
};

export const feishuConfigSchema = {
  schema: {
    type: "object",
    additionalProperties: false,
    properties: {
      enabled: { type: "boolean" },
      appId: { type: "string" },
      appSecret: { type: "string" },
      verificationToken: { type: "string" },
      encryptKey: { type: "string" },
      eventMode: { type: "string", enum: ["ws", "http"] },
      baseUrl: { type: "string" },
      replyToMode: { type: "string", enum: ["off", "first", "all"] },
      groupPolicy: { type: "string", enum: ["open", "allowlist"] },
      requireMention: { type: "boolean" },
      mediaMaxMb: { type: "number" },
      dm: {
        type: "object",
        additionalProperties: false,
        properties: {
          enabled: { type: "boolean" },
          policy: { type: "string", enum: ["open", "pairing"] },
          allowFrom: { type: "array", items: { type: "string" } },
        },
      },
      actions: {
        type: "object",
        additionalProperties: { type: "boolean" },
      },
      channels: {
        type: "object",
        additionalProperties: {
          type: "object",
          additionalProperties: false,
          properties: {
            requireMention: { type: "boolean" },
            toolPolicy: { type: "string" },
          },
        },
      },
      accounts: {
        type: "object",
        additionalProperties: {
          type: "object",
          additionalProperties: false,
          properties: {
            enabled: { type: "boolean" },
            name: { type: "string" },
            appId: { type: "string" },
            appSecret: { type: "string" },
            verificationToken: { type: "string" },
            encryptKey: { type: "string" },
            eventMode: { type: "string", enum: ["ws", "http"] },
            baseUrl: { type: "string" },
            replyToMode: { type: "string", enum: ["off", "first", "all"] },
            groupPolicy: { type: "string", enum: ["open", "allowlist"] },
            requireMention: { type: "boolean" },
            mediaMaxMb: { type: "number" },
            dm: {
              type: "object",
              additionalProperties: false,
              properties: {
                enabled: { type: "boolean" },
                policy: { type: "string", enum: ["open", "pairing"] },
                allowFrom: { type: "array", items: { type: "string" } },
              },
            },
            actions: {
              type: "object",
              additionalProperties: { type: "boolean" },
            },
            channels: {
              type: "object",
              additionalProperties: {
                type: "object",
                additionalProperties: false,
                properties: {
                  requireMention: { type: "boolean" },
                  toolPolicy: { type: "string" },
                },
              },
            },
          },
        },
      },
    },
  },
  uiHints: {
    // 基础配置（优先显示）
    enabled: { label: "Enabled", order: 1 },
    appId: { label: "App ID", order: 2, description: "飞书应用的 App ID" },
    appSecret: {
      label: "App Secret",
      order: 3,
      sensitive: true,
      description: "飞书应用的 App Secret",
    },
    // 高级配置
    eventMode: {
      label: "Event Mode",
      order: 10,
      advanced: true,
      description: "事件订阅方式：ws (长连接) 或 http (回调)",
    },
    baseUrl: {
      label: "Base URL",
      order: 11,
      advanced: true,
      description: "API 地址，默认 https://open.feishu.cn/open-apis",
    },
    verificationToken: {
      label: "Verification Token",
      order: 12,
      sensitive: true,
      advanced: true,
      description: "HTTP 回调验证 Token",
    },
    encryptKey: {
      label: "Encrypt Key",
      order: 13,
      sensitive: true,
      advanced: true,
      description: "HTTP 回调加密密钥",
    },
    groupPolicy: {
      label: "Group Policy",
      order: 20,
      advanced: true,
      description: "群聊策略：open (开放) 或 allowlist (白名单)",
    },
    requireMention: {
      label: "Require Mention",
      order: 21,
      advanced: true,
      description: "群聊中是否需要 @机器人 才响应",
    },
    replyToMode: {
      label: "Reply To Mode",
      order: 22,
      advanced: true,
      description: "回复模式：off / first / all",
    },
    mediaMaxMb: {
      label: "Media Max MB",
      order: 23,
      advanced: true,
      description: "媒体文件最大大小（MB）",
    },
    dm: { label: "Direct Message", order: 30, advanced: true },
    actions: { label: "Actions", order: 40, advanced: true },
    channels: { label: "Channels", order: 50, advanced: true },
    accounts: { label: "Accounts", order: 60, advanced: true, description: "多账户配置" },
  },
};
