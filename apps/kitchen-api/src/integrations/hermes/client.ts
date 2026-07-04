import { serializeResult } from "../../shared/serialize";
import { HERMES_LOCAL_IDENTITY_HEADER } from "./local-identity";
import type { HermesCallerContext, HermesHttpIdentity, KitcheniaHttpResponse } from "./types";

function readNumber(value: string | undefined, fallback: number) {
  const parsed = Number(value);

  return Number.isFinite(parsed) ? parsed : fallback;
}

export type KitcheniaHttpClientOptions = {
  baseUrl?: string;
  timeoutMs?: number;
  apiKey?: string;
  authHeader?: string;
  authScheme?: string;
  useLocalIdentity?: boolean;
  localIdentityHeader?: string;
  fetchImpl?: typeof fetch;
};

export class KitcheniaHttpClient {
  readonly baseUrl: string;
  readonly timeoutMs: number;
  readonly apiKey: string;
  readonly authHeader: string;
  readonly authScheme: string;
  readonly useLocalIdentity: boolean;
  readonly localIdentityHeader: string;
  private readonly fetchImpl: typeof fetch;

  constructor(options: KitcheniaHttpClientOptions = {}) {
    this.baseUrl = (
      options.baseUrl ??
      process.env.HERMES_KITCHENIA_BASE_URL ??
      `http://localhost:${process.env.PORT ?? "3000"}`
    ).replace(/\/+$/, "");
    this.timeoutMs = options.timeoutMs ?? readNumber(process.env.HERMES_KITCHENIA_TIMEOUT_MS, 10000);
    this.apiKey =
      options.apiKey ??
      process.env.HERMES_KITCHENIA_API_KEY?.trim() ??
      ((process.env.NODE_ENV ?? "development") === "test" ? "test-kitchenia-internal-key" : "");
    this.authHeader = options.authHeader ?? process.env.HERMES_KITCHENIA_AUTH_HEADER ?? "Authorization";
    this.authScheme = options.authScheme ?? process.env.HERMES_KITCHENIA_AUTH_SCHEME ?? "Bearer";
    this.useLocalIdentity = options.useLocalIdentity ?? (process.env.HERMES_KITCHENIA_USE_LOCAL_IDENTITY ?? "").trim().toLowerCase() === "true";
    this.localIdentityHeader = options.localIdentityHeader ?? process.env.HERMES_LOCAL_IDENTITY_HEADER ?? HERMES_LOCAL_IDENTITY_HEADER;
    this.fetchImpl = options.fetchImpl ?? fetch;
  }

  async get(path: string, actor: HermesHttpIdentity, query?: Record<string, string | number | undefined>) {
    return this.request({
      method: "GET",
      path,
      actor,
      query
    });
  }

  async post(path: string, actor: HermesHttpIdentity, body: Record<string, unknown>) {
    return this.request({
      method: "POST",
      path,
      actor,
      body
    });
  }

  async request(input: {
    method: "GET" | "POST";
    path: string;
    actor: HermesHttpIdentity;
    query?: Record<string, string | number | undefined>;
    body?: Record<string, unknown>;
  }): Promise<KitcheniaHttpResponse> {
    const url = new URL(`${this.baseUrl}${input.path}`);

    for (const [key, value] of Object.entries(input.query ?? {})) {
      if (value !== undefined && value !== null) {
        url.searchParams.set(key, String(value));
      }
    }

    const headers: Record<string, string> = {};

    if (this.useLocalIdentity) {
      headers[this.localIdentityHeader] = JSON.stringify(input.actor);
    } else {
      headers["x-caller-context"] = JSON.stringify(input.actor);
    }

    if (!this.useLocalIdentity && this.apiKey) {
      headers[this.authHeader] = `${this.authScheme} ${this.apiKey}`;
    }

    if (input.body) {
      headers["Content-Type"] = "application/json";
    }

    let response: Response;

    try {
      response = await this.fetchImpl(url, {
        method: input.method,
        headers,
        body: input.body ? JSON.stringify(input.body) : undefined,
        signal: AbortSignal.timeout(this.timeoutMs)
      });
    } catch (error: any) {
      return {
        statusCode: 0,
        body: serializeResult({
          ok: false,
          error: "network_error",
          message: error?.message ?? "network_error"
        })
      };
    }

    const text = await response.text();
    const body = text ? safeParseJson(text) : null;

    return {
      statusCode: response.status,
      body: serializeResult(body)
    };
  }
}

function safeParseJson(value: string) {
  try {
    return JSON.parse(value);
  } catch {
    return {
      ok: false,
      error: "invalid_json_response",
      rawText: value
    };
  }
}
