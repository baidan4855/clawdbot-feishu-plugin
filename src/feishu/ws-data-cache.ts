export type JsonValue =
  | string
  | number
  | boolean
  | null
  | JsonValue[]
  | { [key: string]: JsonValue };

type CacheEntry = {
  buffer: Array<Uint8Array | undefined>;
  traceId: string;
  messageId: string;
  createdAt: number;
};

type Logger = {
  debug?: (message: string) => void;
};

export class WsDataCache {
  private readonly cache = new Map<string, CacheEntry>();
  private readonly logger?: Logger;

  constructor(params: { logger?: Logger }) {
    this.logger = params.logger;
    this.clearExpired();
  }

  mergeData(params: {
    messageId: string;
    sum: number;
    seq: number;
    traceId: string;
    data: Uint8Array;
  }): JsonValue | null {
    const { messageId, sum, seq, traceId, data } = params;
    const cached = this.cache.get(messageId);
    if (!cached) {
      const buffer = new Array<Uint8Array | undefined>(sum).fill(undefined);
      buffer[seq] = data;
      this.cache.set(messageId, {
        buffer,
        traceId,
        messageId,
        createdAt: Date.now(),
      });
    } else {
      cached.buffer[seq] = data;
    }

    const merged = this.cache.get(messageId);
    if (!merged) return null;
    if (!merged.buffer.every(Boolean)) {
      return null;
    }

    const full = merged.buffer.reduce((acc, chunk) => {
      const next = chunk ?? new Uint8Array();
      const combined = new Uint8Array(acc.length + next.length);
      combined.set(acc, 0);
      combined.set(next, acc.length);
      return combined;
    }, new Uint8Array());

    const text = new TextDecoder("utf-8").decode(full);
    const parsed = JSON.parse(text) as JsonValue;
    this.cache.delete(messageId);
    return parsed;
  }

  private clearExpired() {
    const ttlMs = 10_000;
    const timer = setInterval(() => {
      const now = Date.now();
      for (const [key, value] of this.cache.entries()) {
        if (now - value.createdAt > ttlMs) {
          this.logger?.debug?.(
            `feishu ws cache expired: message=${value.messageId} trace=${value.traceId}`,
          );
          this.cache.delete(key);
        }
      }
    }, ttlMs);
    // 允许进程在没有其他活动时退出
    timer.unref();
  }
}
