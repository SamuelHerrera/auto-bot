import { extractHermesActionRequest, SUPPORTED_HERMES_ACTIONS } from "./contract";
import { decideHermesActionByRules } from "./decision";
import type {
  HermesOrchestratorRequest,
  HermesProviderMode,
  HermesRuntimeBridgeInput,
  HermesRuntimeBridgeProvider
} from "./types";

function readNumber(value: string | undefined, fallback: number) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

export type HermesHttpProviderOptions = {
  url: string;
  apiKey?: string;
  timeoutMs?: number;
  authHeader?: string;
  authScheme?: string;
  fetchImpl?: typeof fetch;
};

export class HermesRulesProvider implements HermesRuntimeBridgeProvider {
  decideAction(input: HermesRuntimeBridgeInput): HermesOrchestratorRequest {
    return decideHermesActionByRules(input, {
      fallbackToDraft: true
    });
  }
}

export class HermesHttpProvider implements HermesRuntimeBridgeProvider {
  private readonly timeoutMs: number;
  private readonly authHeader: string;
  private readonly authScheme: string;
  private readonly fetchImpl: typeof fetch;

  constructor(private readonly options: HermesHttpProviderOptions) {
    this.timeoutMs = options.timeoutMs ?? readNumber(process.env.HERMES_PROVIDER_TIMEOUT_MS, 15000);
    this.authHeader = options.authHeader ?? process.env.HERMES_PROVIDER_AUTH_HEADER ?? "Authorization";
    this.authScheme = options.authScheme ?? process.env.HERMES_PROVIDER_AUTH_SCHEME ?? "Bearer";
    this.fetchImpl = options.fetchImpl ?? fetch;
  }

  async decideAction(input: HermesRuntimeBridgeInput): Promise<HermesOrchestratorRequest> {
    const headers: Record<string, string> = {
      "Content-Type": "application/json"
    };

    if (this.options.apiKey) {
      headers[this.authHeader] = this.authScheme
        ? `${this.authScheme} ${this.options.apiKey}`
        : this.options.apiKey;
    }

    const response = await this.fetchImpl(this.options.url, {
      method: "POST",
      headers,
      body: JSON.stringify({
        message: input.message,
        context: input.context ?? {},
        supportedActions: SUPPORTED_HERMES_ACTIONS
      }),
      signal: AbortSignal.timeout(this.timeoutMs)
    });

    const text = await response.text();
    const payload = text ? safeParseJson(text) : null;

    if (!response.ok) {
      const error: any = new Error("provider_request_failed");
      error.code = "provider_request_failed";
      error.details = {
        statusCode: response.status,
        body: payload
      };
      throw error;
    }

    try {
      return extractHermesActionRequest(payload);
    } catch (error: any) {
      const normalizedError: any = new Error("provider_invalid_response");
      normalizedError.code = "provider_invalid_response";
      normalizedError.details = {
        body: payload,
        ...(error?.details ? { validation: error.details } : {})
      };
      throw normalizedError;
    }
  }
}

export class HermesMisconfiguredProvider implements HermesRuntimeBridgeProvider {
  constructor(
    private readonly mode: HermesProviderMode,
    private readonly details: Record<string, unknown>
  ) {}

  decideAction(): never {
    const error: any = new Error("provider_misconfigured");
    error.code = "provider_misconfigured";
    error.details = {
      mode: this.mode,
      ...this.details
    };
    throw error;
  }
}

export function createHermesRuntimeProviderFromEnv(): HermesRuntimeBridgeProvider | undefined {
  const mode = readProviderMode(process.env.HERMES_PROVIDER_MODE);

  switch (mode) {
    case "rules":
      return new HermesRulesProvider();
    case "http": {
      const url = process.env.HERMES_PROVIDER_URL?.trim();
      if (!url) {
        return new HermesMisconfiguredProvider(mode, {
          reason: "missing_provider_url",
          requiredEnv: ["HERMES_PROVIDER_URL"]
        });
      }

      return new HermesHttpProvider({
        url,
        apiKey: process.env.HERMES_PROVIDER_API_KEY?.trim() || undefined
      });
    }
    case "structured":
    default:
      return undefined;
  }
}

export function readProviderMode(value: string | undefined): HermesProviderMode {
  switch ((value ?? "structured").trim().toLowerCase()) {
    case "rules":
      return "rules";
    case "http":
      return "http";
    default:
      return "structured";
  }
}

export function isHermesProviderConfigured(mode: HermesProviderMode, env: NodeJS.ProcessEnv = process.env) {
  switch (mode) {
    case "http":
      return Boolean(env.HERMES_PROVIDER_URL?.trim());
    default:
      return true;
  }
}

function safeParseJson(value: string) {
  try {
    return JSON.parse(value);
  } catch {
    return {
      rawText: value
    };
  }
}
