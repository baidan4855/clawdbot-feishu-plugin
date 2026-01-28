import crypto from "node:crypto";

type FeishuCallbackEnvelope = {
  encrypt?: string;
  type?: string;
  challenge?: string;
  token?: string;
  schema?: string;
  event?: Record<string, unknown>;
  header?: {
    token?: string;
    event_type?: string;
    event_id?: string;
    create_time?: string;
    app_id?: string;
    tenant_key?: string;
  };
};

export type FeishuCallbackResult =
  | {
      kind: "challenge";
      challenge: string;
    }
  | {
      kind: "event";
      event: FeishuCallbackEnvelope;
    };

type FeishuSignatureHeaders = {
  signature?: string;
  timestamp?: string;
  nonce?: string;
};

type FeishuEventVerification = {
  verificationToken?: string;
  encryptKey?: string;
  appSecret?: string;
};

class AESCipher {
  private readonly key: Buffer;

  constructor(key: string) {
    const hash = crypto.createHash("sha256");
    hash.update(key);
    this.key = hash.digest();
  }

  decrypt(encrypt: string): string {
    const encryptBuffer = Buffer.from(encrypt, "base64");
    const decipher = crypto.createDecipheriv(
      "aes-256-cbc",
      this.key,
      encryptBuffer.subarray(0, 16),
    );
    let decrypted = decipher.update(encryptBuffer.subarray(16).toString("hex"), "hex", "utf8");
    decrypted += decipher.final("utf8");
    return decrypted;
  }
}

const normalizeType = (value?: string) => value?.trim().toLowerCase() ?? "";

const sha256Hex = (value: string) =>
  crypto.createHash("sha256").update(value, "utf8").digest("hex");

const parseJson = (raw: string) => JSON.parse(raw) as FeishuCallbackEnvelope;

const extractToken = (payload: FeishuCallbackEnvelope) =>
  payload.header?.token ?? payload.token;

export function parseFeishuCallback(params: {
  rawBody: string;
  headers: FeishuSignatureHeaders;
  verification: FeishuEventVerification;
}): FeishuCallbackResult {
  const { rawBody, headers, verification } = params;
  if (!rawBody) {
    throw new Error("Feishu callback body is empty");
  }

  if (headers.signature) {
    const appSecret = verification.appSecret?.trim();
    if (!appSecret) {
      throw new Error("Feishu callback signature provided but appSecret missing");
    }
    const timestamp = headers.timestamp?.trim() ?? "";
    const nonce = headers.nonce?.trim() ?? "";
    const expected = sha256Hex(`${timestamp}${nonce}${rawBody}${appSecret}`);
    if (expected !== headers.signature) {
      throw new Error("Feishu callback signature mismatch");
    }
  }

  let payload = parseJson(rawBody);

  if (payload.encrypt) {
    const encryptKey = verification.encryptKey?.trim();
    if (!encryptKey) {
      throw new Error("Feishu callback encrypt payload but encryptKey missing");
    }
    const cipher = new AESCipher(encryptKey);
    const decrypted = cipher.decrypt(payload.encrypt);
    payload = parseJson(decrypted);
  }

  const verificationToken = verification.verificationToken?.trim();
  if (verificationToken) {
    const token = extractToken(payload);
    if (token !== verificationToken) {
      throw new Error("Feishu callback verification token mismatch");
    }
  }

  const type = normalizeType(payload.type);
  if (type === "challenge" || type === "url_verification") {
    const challenge = String(payload.challenge ?? "");
    if (!challenge) {
      throw new Error("Feishu callback challenge missing");
    }
    return { kind: "challenge", challenge };
  }

  return { kind: "event", event: payload };
}
