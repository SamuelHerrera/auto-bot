interface ApiError {
  error: string;
}

export const defaultApiToken =
  import.meta.env.VITE_WHATSAPP_MANAGER_API_TOKEN?.trim() || "local-dev-token";

export async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const headers = new Headers(init?.headers);
  if (init?.body !== undefined && !headers.has("Content-Type")) {
    headers.set("Content-Type", "application/json");
  }
  headers.set("authorization", `Bearer ${defaultApiToken}`);

  const response = await fetch(path, {
    ...init,
    headers,
  });

  if (!response.ok) {
    const body = (await safeJson<ApiError>(response)) ?? { error: response.statusText };
    throw new Error(body.error || `Request failed with ${response.status}`);
  }

  if (response.status === 204) {
    return undefined as T;
  }

  const contentType = response.headers.get("content-type") ?? "";
  if (!contentType.includes("application/json")) {
    const body = await response.text();
    throw new Error(`Expected JSON from ${path}, got ${contentType || "unknown content type"}: ${body.slice(0, 80)}`);
  }

  return response.json() as Promise<T>;
}

export function buildEventUrl() {
  const url = new URL("/events", window.location.origin);
  url.searchParams.set("token", defaultApiToken);
  return `${url.pathname}${url.search}`;
}

export function normalizeError(error: unknown) {
  if (error instanceof Error) {
    return error.message;
  }

  return "Unexpected error";
}

async function safeJson<T>(response: Response): Promise<T | null> {
  try {
    return (await response.json()) as T;
  } catch {
    return null;
  }
}
