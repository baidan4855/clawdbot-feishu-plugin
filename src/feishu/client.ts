type FeishuTokenResponse = {
  tenant_access_token?: string;
  expire?: number;
  code?: number;
  msg?: string;
};

type FeishuApiError = {
  code?: number;
  msg?: string;
  error?: string;
};

export type FeishuClientConfig = {
  appId: string;
  appSecret: string;
  baseUrl?: string;
  logger?: {
    info?: (message: string) => void;
    warn?: (message: string) => void;
    error?: (message: string) => void;
    debug?: (message: string) => void;
  };
};

export type FeishuApiResponse<T> = {
  data?: T;
  code?: number;
  msg?: string;
};

type TokenCache = {
  value: string;
  expiresAt: number;
};

const DEFAULT_BASE_URL = "https://open.feishu.cn/open-apis";

function nowMs() {
  return Date.now();
}

export class FeishuClient {
  private readonly appId: string;
  private readonly appSecret: string;
  private readonly baseUrl: string;
  private readonly logger?: FeishuClientConfig["logger"];
  private tokenCache: TokenCache | null = null;

  constructor(config: FeishuClientConfig) {
    this.appId = config.appId;
    this.appSecret = config.appSecret;
    this.baseUrl = (config.baseUrl ?? DEFAULT_BASE_URL).replace(/\/+$/, "");
    this.logger = config.logger;
  }

  async request<T>(params: {
    method: "GET" | "POST" | "PATCH" | "PUT" | "DELETE";
    path: string;
    query?: Record<string, string | number | undefined>;
    body?: unknown;
  }): Promise<FeishuApiResponse<T>> {
    const token = await this.getTenantAccessToken();
    const url = this.buildUrl(params.path, params.query);
    const response = await fetch(url, {
      method: params.method,
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json; charset=utf-8",
      },
      body: params.body === undefined ? undefined : JSON.stringify(params.body),
    });
    const text = await response.text();
    const json = text ? (JSON.parse(text) as FeishuApiResponse<T>) : {};
    if (!response.ok) {
      const err = json as FeishuApiError;
      const message = err.msg ?? err.error ?? response.statusText;
      throw new Error(`Feishu API error ${response.status}: ${message}`);
    }
    if (json.code && json.code !== 0) {
      throw new Error(`Feishu API error ${json.code}: ${json.msg ?? "unknown"}`);
    }
    return json;
  }

  private buildUrl(path: string, query?: Record<string, string | number | undefined>) {
    const normalized = path.startsWith("/") ? path : `/${path}`;
    const url = new URL(`${this.baseUrl}${normalized}`);
    if (query) {
      Object.entries(query).forEach(([key, value]) => {
        if (value === undefined || value === null) return;
        url.searchParams.set(key, String(value));
      });
    }
    return url.toString();
  }

  private async getTenantAccessToken(): Promise<string> {
    const cache = this.tokenCache;
    if (cache && cache.expiresAt > nowMs() + 60_000) {
      return cache.value;
    }
    const response = await fetch(`${this.baseUrl}/auth/v3/tenant_access_token/internal`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json; charset=utf-8",
      },
      body: JSON.stringify({
        app_id: this.appId,
        app_secret: this.appSecret,
      }),
    });
    const json = (await response.json()) as FeishuTokenResponse;
    if (!response.ok || json.code) {
      const message = json.msg ?? response.statusText;
      throw new Error(`Feishu auth failed: ${message}`);
    }
    if (!json.tenant_access_token) {
      throw new Error("Feishu auth failed: missing access token");
    }
    const expiresAt = nowMs() + (json.expire ?? 0) * 1000;
    this.tokenCache = {
      value: json.tenant_access_token,
      expiresAt,
    };
    return json.tenant_access_token;
  }
}
