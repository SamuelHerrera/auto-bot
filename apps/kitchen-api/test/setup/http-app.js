import request from "supertest";

process.env.NODE_ENV ??= "test";
process.env.HERMES_KITCHENIA_API_KEY ??= "test-kitchenia-internal-key";
process.env.HERMES_KITCHENIA_AUTH_HEADER ??= "Authorization";
process.env.HERMES_KITCHENIA_AUTH_SCHEME ??= "Bearer";
process.env.HERMES_RUNTIME_ROUTE_ENABLED ??= "true";
process.env.PLATFORM_SUPPORT_API_KEY ??= "test-platform-support-key";
process.env.PLATFORM_SUPPORT_AUTH_HEADER ??= "x-platform-support-token";
process.env.PRINTER_BRIDGE_API_KEY ??= "test-printer-bridge-key";
process.env.PRINTER_BRIDGE_AUTH_HEADER ??= "x-printer-token";

export const SESSION_CONTEXT_HEADER = "x-hermes-session-context";
export const LOCAL_IDENTITY_HEADER = "x-hermes-local-identity";

export function getTrustedCallerContextHeaders(callerContext) {
  const authHeader = process.env.HERMES_KITCHENIA_AUTH_HEADER ?? "Authorization";
  const authScheme = process.env.HERMES_KITCHENIA_AUTH_SCHEME ?? "Bearer";
  const apiKey = process.env.HERMES_KITCHENIA_API_KEY ?? "test-kitchenia-internal-key";

  return {
    "x-caller-context": JSON.stringify(callerContext),
    [authHeader]: `${authScheme} ${apiKey}`
  };
}

export function getPrinterBridgeHeaders() {
  const authHeader = process.env.PRINTER_BRIDGE_AUTH_HEADER ?? "x-printer-token";
  const apiKey = process.env.PRINTER_BRIDGE_API_KEY ?? "test-printer-bridge-key";

  return {
    [authHeader]: apiKey
  };
}

export function getPlatformSupportHeaders() {
  const authHeader = process.env.PLATFORM_SUPPORT_AUTH_HEADER ?? "x-platform-support-token";
  const apiKey = process.env.PLATFORM_SUPPORT_API_KEY ?? "test-platform-support-key";

  return {
    ...getTrustedCallerContextHeaders({}),
    [authHeader]: apiKey
  };
}

export function getTrustedSessionHeaders(sessionContext) {
  return {
    [SESSION_CONTEXT_HEADER]: JSON.stringify(sessionContext)
  };
}

export function getLocalIdentityHeaders(identity) {
  return {
    [LOCAL_IDENTITY_HEADER]: JSON.stringify(identity)
  };
}

export async function loadHttpApp() {
  const module = await import("../../src/infrastructure/app.ts");

  if (typeof module.createApp === "function") {
    return module.createApp();
  }

  if (module.app) {
    return module.app;
  }

  if (module.default) {
    return module.default;
  }

  throw new Error("Unable to resolve Express app export from src/infrastructure/app.ts");
}

export async function createHttpClient() {
  const app = await loadHttpApp();

  return request(app);
}
