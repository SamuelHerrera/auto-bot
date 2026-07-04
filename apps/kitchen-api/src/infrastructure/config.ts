import { HERMES_LOCAL_IDENTITY_HEADER } from "../integrations/hermes/local-identity";

function readNumber(value: string | undefined, fallback: number): number {
  const parsed = Number(value);

  return Number.isFinite(parsed) ? parsed : fallback;
}

function readProviderMode(value: string | undefined) {
  switch ((value ?? "structured").trim().toLowerCase()) {
    case "rules":
      return "rules";
    case "http":
      return "http";
    default:
      return "structured";
  }
}

function readBoolean(value: string | undefined, fallback: boolean) {
  if (value === undefined) {
    return fallback;
  }

  switch (value.trim().toLowerCase()) {
    case "1":
    case "true":
    case "yes":
    case "on":
      return true;
    case "0":
    case "false":
    case "no":
    case "off":
      return false;
    default:
      return fallback;
  }
}

export const config = {
  nodeEnv: process.env.NODE_ENV ?? "development",
  port: readNumber(process.env.PORT, 3000),
  databaseUrl: process.env.DATABASE_URL ?? "",
  isTest: (process.env.NODE_ENV ?? "development") === "test",
  platformSupport: {
    apiKey:
      process.env.PLATFORM_SUPPORT_API_KEY?.trim() ||
      (((process.env.NODE_ENV ?? "development") === "test") ? "test-platform-support-key" : ""),
    authHeader: process.env.PLATFORM_SUPPORT_AUTH_HEADER ?? "x-platform-support-token"
  },
  printing: {
    printerBridgeApiKey:
      process.env.PRINTER_BRIDGE_API_KEY?.trim() ||
      (((process.env.NODE_ENV ?? "development") === "test") ? "test-printer-bridge-key" : ""),
    printerBridgeAuthHeader: process.env.PRINTER_BRIDGE_AUTH_HEADER ?? "x-printer-token"
  },
  hermes: {
    kitcheniaApiKey:
      process.env.HERMES_KITCHENIA_API_KEY?.trim() ||
      (((process.env.NODE_ENV ?? "development") === "test") ? "test-kitchenia-internal-key" : ""),
    kitcheniaAuthHeader: process.env.HERMES_KITCHENIA_AUTH_HEADER ?? "Authorization",
    kitcheniaAuthScheme: process.env.HERMES_KITCHENIA_AUTH_SCHEME ?? "Bearer",
    runtimeRouteEnabled: readBoolean(
      process.env.HERMES_RUNTIME_ROUTE_ENABLED,
      (process.env.NODE_ENV ?? "development") === "test"
    ),
    providerMode: readProviderMode(process.env.HERMES_PROVIDER_MODE),
    providerUrl: process.env.HERMES_PROVIDER_URL ?? "",
    providerTimeoutMs: readNumber(process.env.HERMES_PROVIDER_TIMEOUT_MS, 15000),
    providerAuthHeader: process.env.HERMES_PROVIDER_AUTH_HEADER ?? "Authorization",
    providerAuthScheme: process.env.HERMES_PROVIDER_AUTH_SCHEME ?? "Bearer",
    localIdentityEnabled: readBoolean(
      process.env.HERMES_LOCAL_IDENTITY_ENABLED,
      (process.env.NODE_ENV ?? "development") !== "production"
    ),
    localBootstrapEnabled: readBoolean(
      process.env.HERMES_LOCAL_BOOTSTRAP_ENABLED,
      (process.env.NODE_ENV ?? "development") !== "production"
    ),
    localIdentityHeader: process.env.HERMES_LOCAL_IDENTITY_HEADER ?? HERMES_LOCAL_IDENTITY_HEADER,
    conversationStore: process.env.HERMES_CONVERSATION_STORE ?? "memory",
    providerConfigured:
      readProviderMode(process.env.HERMES_PROVIDER_MODE) !== "http" ||
      Boolean(process.env.HERMES_PROVIDER_URL?.trim())
  }
};

export type AppConfig = typeof config;
