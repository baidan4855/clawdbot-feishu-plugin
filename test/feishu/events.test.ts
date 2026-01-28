import crypto from "node:crypto";
import assert from "node:assert/strict";
import test from "node:test";

import { parseFeishuCallback } from "../../src/feishu/events.js";

const encryptPayload = (encryptKey: string, raw: string) => {
  const key = crypto.createHash("sha256").update(encryptKey).digest();
  const iv = crypto.randomBytes(16);
  const cipher = crypto.createCipheriv("aes-256-cbc", key, iv);
  const encrypted = Buffer.concat([cipher.update(raw, "utf8"), cipher.final()]);
  return Buffer.concat([iv, encrypted]).toString("base64");
};

const signPayload = (timestamp: string, nonce: string, body: string, appSecret: string) =>
  crypto.createHash("sha256").update(`${timestamp}${nonce}${body}${appSecret}`, "utf8").digest("hex");

test("parseFeishuCallback handles challenge", () => {
  const body = JSON.stringify({
    type: "url_verification",
    challenge: "challenge-token",
    token: "verify-token",
  });
  const signature = signPayload("1", "2", body, "app-secret");
  const result = parseFeishuCallback({
    rawBody: body,
    headers: { signature, timestamp: "1", nonce: "2" },
    verification: { verificationToken: "verify-token", appSecret: "app-secret" },
  });
  assert.equal(result.kind, "challenge");
  assert.equal(result.challenge, "challenge-token");
});

test("parseFeishuCallback decrypts payload", () => {
  const inner = JSON.stringify({
    event: { message: { message_id: "mid", chat_id: "cid" } },
    header: { token: "verify-token" },
  });
  const encrypt = encryptPayload("encrypt-key", inner);
  const outer = JSON.stringify({ encrypt });
  const result = parseFeishuCallback({
    rawBody: outer,
    headers: {},
    verification: { verificationToken: "verify-token", encryptKey: "encrypt-key" },
  });
  assert.equal(result.kind, "event");
  assert.equal(
    (result.event.event as { message?: { message_id?: string } }).message?.message_id,
    "mid",
  );
});

test("parseFeishuCallback rejects bad signature", () => {
  const body = JSON.stringify({ type: "url_verification", challenge: "x" });
  assert.throws(() =>
    parseFeishuCallback({
      rawBody: body,
      headers: { signature: "bad", timestamp: "1", nonce: "2" },
      verification: { appSecret: "app-secret" },
    }),
  );
});
