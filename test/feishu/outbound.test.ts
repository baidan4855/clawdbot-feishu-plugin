import assert from "node:assert/strict";
import test from "node:test";

import { FeishuClient } from "../../src/feishu/client.js";
import { normalizeFeishuTarget, sendFeishuText } from "../../src/feishu/outbound.js";

type FetchCall = {
  url: string;
  init?: RequestInit;
};

const createFetchMock = () => {
  const calls: FetchCall[] = [];
  const fetchMock = async (url: string, init?: RequestInit) => {
    calls.push({ url, init });
    if (url.includes("/auth/v3/tenant_access_token/internal")) {
      return {
        ok: true,
        json: async () => ({ tenant_access_token: "token", expire: 3600 }),
      } as Response;
    }
    return {
      ok: true,
      text: async () =>
        JSON.stringify({
          code: 0,
          data: { message_id: "mid", chat_id: "cid" },
        }),
    } as Response;
  };
  return { fetchMock, calls };
};

test("normalizeFeishuTarget defaults to chat target", () => {
  const target = normalizeFeishuTarget("chat-id");
  assert.equal(target.receiveId, "chat-id");
  assert.equal(target.receiveIdType, "chat_id");
});

test("normalizeFeishuTarget auto-detects open_id from ou_ prefix", () => {
  const target = normalizeFeishuTarget("user:ou_1289382d711d925b18e0b4019bc170db");
  assert.equal(target.receiveId, "ou_1289382d711d925b18e0b4019bc170db");
  assert.equal(target.receiveIdType, "open_id");
});

test("normalizeFeishuTarget auto-detects chat_id from oc_ prefix", () => {
  const target = normalizeFeishuTarget("oc_abc123");
  assert.equal(target.receiveId, "oc_abc123");
  assert.equal(target.receiveIdType, "chat_id");
});

test("sendFeishuText posts to messages endpoint", async () => {
  const { fetchMock, calls } = createFetchMock();
  const originalFetch = globalThis.fetch;
  globalThis.fetch = fetchMock as typeof fetch;
  try {
    const client = new FeishuClient({
      appId: "app-id",
      appSecret: "app-secret",
    });
    await sendFeishuText({
      client,
      to: "user:uid",
      text: "hello",
    });
    assert.equal(calls.length, 2);
    const messageCall = calls[1];
    assert.ok(messageCall.url.includes("/im/v1/messages"));
    const body = JSON.parse(String(messageCall.init?.body));
    assert.equal(body.receive_id, "uid");
    assert.equal(body.msg_type, "text");
  } finally {
    globalThis.fetch = originalFetch;
  }
});
