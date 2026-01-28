import { WsDataCache, type JsonValue } from "./ws-data-cache.js";
import { decodeFrame, encodeFrame, type WsFrame } from "./ws-proto.js";

declare const Buffer: {
  from: (input: string) => { toString: (encoding: "base64") => string };
};

type WsLogger = {
  info?: (message: string) => void;
  warn?: (message: string) => void;
  error?: (message: string) => void;
  debug?: (message: string) => void;
  trace?: (message: string) => void;
};

type WsClientConfig = {
  appId: string;
  appSecret: string;
  baseUrl: string;
  logger?: WsLogger;
  autoReconnect?: boolean;
};

type WsConnectConfig = {
  connectUrl: string;
  pingInterval: number;
  reconnectCount: number;
  reconnectInterval: number;
  reconnectNonce: number;
  deviceId: string;
  serviceId: string;
};

type WsEndpointResponse = {
  code?: number;
  msg?: string;
  data?: {
    URL?: string;
    ClientConfig?: {
      PingInterval?: number;
      ReconnectCount?: number;
      ReconnectInterval?: number;
      ReconnectNonce?: number;
    };
  };
};

const FRAME_TYPE_CONTROL = 0;
const FRAME_TYPE_DATA = 1;

const HEADER_TYPE = "type";
const HEADER_MESSAGE_ID = "message_id";
const HEADER_SUM = "sum";
const HEADER_SEQ = "seq";
const HEADER_TRACE_ID = "trace_id";
const HEADER_BIZ_RT = "biz_rt";

const MESSAGE_EVENT = "event";
const MESSAGE_PING = "ping";
const MESSAGE_PONG = "pong";

const STATUS_OK = 200;
const STATUS_ERROR = 500;

type WsMessageEvent = {
  data: unknown;
};

type WebSocketLike = {
  readyState: number;
  binaryType: string;
  send: (data: Uint8Array) => void;
  close: () => void;
  addEventListener: (
    type: "open" | "message" | "error" | "close",
    listener: (event: WsMessageEvent) => void,
  ) => void;
};

type WsEventHandler = (payload: JsonValue) => Promise<JsonValue | void> | JsonValue | void;

const getWebSocketCtor = (): new (url: string) => WebSocketLike => {
  if (typeof globalThis.WebSocket === "function") {
    return globalThis.WebSocket as unknown as new (url: string) => WebSocketLike;
  }
  throw new Error("WebSocket is not available in current runtime");
};

const normalizeBaseUrl = (value: string) => value.replace(/\/+$/, "");

const resolveWsBaseUrl = (value: string) => {
  const normalized = normalizeBaseUrl(value);
  if (normalized.endsWith("/open-apis")) {
    return normalized.slice(0, -"/open-apis".length);
  }
  return normalized;
};

const payloadToUint8 = (data: unknown): Uint8Array | null => {
  if (data instanceof ArrayBuffer) {
    return new Uint8Array(data);
  }
  if (data instanceof Uint8Array) {
    return data;
  }
  if (ArrayBuffer.isView(data)) {
    return new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
  }
  // Node.js Buffer is a Uint8Array subclass
  if (typeof data === "object" && data !== null && "buffer" in data) {
    const bufLike = data as { buffer: ArrayBuffer; byteOffset: number; byteLength: number };
    if (bufLike.buffer instanceof ArrayBuffer) {
      return new Uint8Array(bufLike.buffer, bufLike.byteOffset, bufLike.byteLength);
    }
  }
  return null;
};

export class FeishuWsClient {
  private readonly config: WsClientConfig;
  private readonly logger?: WsLogger;
  private readonly cache: WsDataCache;
  private wsConfig: WsConnectConfig | null = null;
  private readonly wsBaseUrl: string;
  private ws: WebSocketLike | null = null;
  private pingTimer: ReturnType<typeof setTimeout> | null = null;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private reconnectCount = 0;
  private stopped = false;
  private eventHandler: WsEventHandler | null = null;

  constructor(config: WsClientConfig) {
    this.config = {
      ...config,
      baseUrl: normalizeBaseUrl(config.baseUrl),
      autoReconnect: config.autoReconnect ?? true,
    };
    this.logger = config.logger;
    this.cache = new WsDataCache({ logger: config.logger });
    this.wsBaseUrl = resolveWsBaseUrl(this.config.baseUrl);
  }

  async start(handler: WsEventHandler) {
    this.eventHandler = handler;
    this.stopped = false;
    await this.reconnect(true);
  }

  stop() {
    this.stopped = true;
    if (this.pingTimer) clearTimeout(this.pingTimer);
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    this.ws?.close();
    this.ws = null;
  }

  get isConnected(): boolean {
    return this.ws !== null && this.ws.readyState === 1;
  }

  private async reconnect(isInitial: boolean) {
    if (this.stopped) return;
    if (isInitial) this.reconnectCount = 0;

    const connected = await this.pullConnectConfig().then((ok) => (ok ? this.connect() : false));
    if (connected) {
      this.logger?.info?.("[feishu-ws] connected");
      return;
    }

    if (!this.config.autoReconnect) return;
    const retryDelay = this.getReconnectDelay();
    this.logger?.warn?.(`[feishu-ws] reconnect in ${Math.round(retryDelay / 1000)}s`);
    this.reconnectTimer = setTimeout(() => {
      this.reconnect(false);
    }, retryDelay);
  }

  private getReconnectDelay() {
    const cfg = this.wsConfig;
    const base = cfg?.reconnectInterval ?? 120_000;
    const jitter = cfg?.reconnectNonce ?? 30_000;
    return base + Math.random() * jitter;
  }

  private async pullConnectConfig(): Promise<boolean> {
    const response = await fetch(`${this.wsBaseUrl}/callback/ws/endpoint`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json; charset=utf-8",
        locale: "zh",
      },
      body: JSON.stringify({
        AppID: this.config.appId,
        AppSecret: this.config.appSecret,
      }),
    });

    const raw = await response.text();
    let json: WsEndpointResponse = {};
    try {
      json = raw ? (JSON.parse(raw) as WsEndpointResponse) : {};
    } catch (err) {
      const preview = raw.slice(0, 200).replace(/\s+/g, " ").trim();
      this.logger?.error?.(
        `[feishu-ws] endpoint response invalid JSON: ${response.status} ${response.statusText} ${preview}`,
      );
      return false;
    }
    if (!response.ok || json.code !== 0 || !json.data?.URL) {
      const code = json.code ?? response.status;
      const msg = json.msg ?? response.statusText;
      this.logger?.error?.(`[feishu-ws] endpoint error: ${code} ${msg}`);
      return false;
    }

    const url = new URL(json.data.URL);
    const deviceId = url.searchParams.get("device_id") ?? "";
    const serviceId = url.searchParams.get("service_id") ?? "";
    const clientCfg = json.data.ClientConfig ?? {};

    this.wsConfig = {
      connectUrl: json.data.URL,
      deviceId,
      serviceId,
      pingInterval: (clientCfg.PingInterval ?? 120) * 1000,
      reconnectCount: clientCfg.ReconnectCount ?? -1,
      reconnectInterval: (clientCfg.ReconnectInterval ?? 120) * 1000,
      reconnectNonce: (clientCfg.ReconnectNonce ?? 30) * 1000,
    };
    return true;
  }

  private async connect(): Promise<boolean> {
    const connectUrl = this.wsConfig?.connectUrl;
    if (!connectUrl) return false;
    const WebSocketCtor = getWebSocketCtor();
    return new Promise((resolve) => {
      const ws = new WebSocketCtor(connectUrl);
      // 关键：设置 binaryType 为 arraybuffer，否则 Node.js 可能返回 Blob
      ws.binaryType = "arraybuffer";
      this.ws = ws;
      ws.addEventListener("open", () => {
        this.logger?.debug?.("[feishu-ws] open");
        this.reconnectCount = 0;
        this.startPing();
        this.bindMessages(ws);
        resolve(true);
      });
      ws.addEventListener("error", () => {
        this.logger?.error?.("[feishu-ws] connect failed");
        resolve(false);
      });
      ws.addEventListener("close", () => {
        this.logger?.warn?.("[feishu-ws] closed");
        this.cleanup();
        if (this.stopped) return;
        this.reconnectCount += 1;
        const limit = this.wsConfig?.reconnectCount ?? -1;
        if (limit >= 0 && this.reconnectCount > limit) {
          this.logger?.error?.("[feishu-ws] reconnect limit reached");
          return;
        }
        this.reconnect(false);
      });
    });
  }

  private bindMessages(ws: WebSocketLike) {
    ws.addEventListener("message", async (event) => {
      const dataType = event.data === null ? "null" : typeof event.data;
      const dataName =
        event.data && typeof event.data === "object"
          ? (event.data as { constructor?: { name?: string } }).constructor?.name ?? "object"
          : dataType;
      this.logger?.debug?.(`[feishu-ws] raw message: type=${dataName}`);

      const payload = payloadToUint8(event.data);
      if (!payload) {
        this.logger?.warn?.(`[feishu-ws] failed to convert message data to Uint8Array: ${dataName}`);
        return;
      }
      this.logger?.debug?.(`[feishu-ws] payload bytes=${payload.length}`);

      try {
        const frame = decodeFrame(payload);
        this.logger?.debug?.(
          `[feishu-ws] frame received: method=${frame.method} headers=${frame.headers?.length ?? 0}`,
        );
        if (frame.method === FRAME_TYPE_CONTROL) {
          await this.handleControlFrame(frame);
          return;
        }
        if (frame.method === FRAME_TYPE_DATA) {
          await this.handleEventFrame(frame);
        }
      } catch (err) {
        this.logger?.error?.(`[feishu-ws] decode error: ${String(err)}`);
      }
    });
  }

  private startPing() {
    const interval = this.wsConfig?.pingInterval ?? 120_000;
    const serviceId = Number(this.wsConfig?.serviceId ?? 0);
    const frame: WsFrame = {
      SeqID: 0n,
      LogID: 0n,
      service: serviceId,
      method: FRAME_TYPE_CONTROL,
      headers: [{ key: HEADER_TYPE, value: MESSAGE_PING }],
    };
    this.sendFrame(frame);
    this.pingTimer = setTimeout(() => this.startPing(), interval);
  }

  private async handleControlFrame(frame: WsFrame) {
    const type = frame.headers?.find((item) => item.key === HEADER_TYPE)?.value ?? "";
    if (type === MESSAGE_PING) return;
    if (type !== MESSAGE_PONG || !frame.payload) return;
    try {
      const payload = JSON.parse(new TextDecoder("utf-8").decode(frame.payload)) as {
        PingInterval?: number;
        ReconnectCount?: number;
        ReconnectInterval?: number;
        ReconnectNonce?: number;
      };
      if (!this.wsConfig) return;
      this.wsConfig = {
        ...this.wsConfig,
        pingInterval: (payload.PingInterval ?? this.wsConfig.pingInterval / 1000) * 1000,
        reconnectCount: payload.ReconnectCount ?? this.wsConfig.reconnectCount,
        reconnectInterval:
          (payload.ReconnectInterval ?? this.wsConfig.reconnectInterval / 1000) * 1000,
        reconnectNonce:
          (payload.ReconnectNonce ?? this.wsConfig.reconnectNonce / 1000) * 1000,
      };
      this.logger?.debug?.("[feishu-ws] pong config updated");
    } catch {
      this.logger?.warn?.("[feishu-ws] invalid pong payload");
    }
  }

  private async handleEventFrame(frame: WsFrame) {
    const headerMap = new Map(frame.headers?.map((item) => [item.key, item.value]) ?? []);
    const messageId = headerMap.get(HEADER_MESSAGE_ID) ?? "";
    const sum = Number(headerMap.get(HEADER_SUM) ?? "1");
    const seq = Number(headerMap.get(HEADER_SEQ) ?? "0");
    const traceId = headerMap.get(HEADER_TRACE_ID) ?? "";
    const type = headerMap.get(HEADER_TYPE) ?? "";
    if (type !== MESSAGE_EVENT || !frame.payload) return;

    const merged = this.cache.mergeData({
      messageId,
      sum,
      seq,
      traceId,
      data: frame.payload,
    });
    if (!merged || !this.eventHandler) return;

    const eventType =
      (merged as { header?: { event_type?: string } })?.header?.event_type ?? "unknown";
    this.logger?.info?.(
      `[feishu-ws] event merged: type=${eventType} message_id=${messageId || "n/a"}`,
    );

    const start = Date.now();
    let response: JsonValue | void = undefined;
    try {
      response = await this.eventHandler(merged);
    } catch (err) {
      this.logger?.error?.(`[feishu-ws] event handler error: ${String(err)}`);
    }
    const end = Date.now();

    const respPayload: { code: number; data?: string } = {
      code: STATUS_OK,
    };
    if (response) {
      respPayload.data = Buffer.from(JSON.stringify(response)).toString("base64");
    }
    const payloadBytes = new TextEncoder().encode(JSON.stringify(respPayload));
    const headers = [...(frame.headers ?? []), { key: HEADER_BIZ_RT, value: String(end - start) }];
    this.sendFrame({
      ...frame,
      headers,
      payload: payloadBytes,
    });
  }

  private sendFrame(frame: WsFrame) {
    if (!this.ws || this.ws.readyState !== 1) return;
    const data = encodeFrame(frame);
    this.ws.send(data);
  }

  private cleanup() {
    if (this.pingTimer) clearTimeout(this.pingTimer);
    this.ws = null;
  }
}
