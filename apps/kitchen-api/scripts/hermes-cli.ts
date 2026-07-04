import { promises as fs } from "node:fs";
import path from "node:path";
import readline from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";

type HermesCliSession = {
  sessionId: string;
  role?: string;
  phone?: string;
  kitchenId?: string;
  orderId?: string;
  id?: string;
  contactId?: string;
  platformAccess?: boolean;
};

const VALID_SESSION_ROLES = new Set(["CLIENT", "KITCHEN", "DELIVERER"]);

async function main() {
  const baseUrl = (getFlagValue("--base-url") ?? process.env.HERMES_PROVIDER_BASE_URL ?? "http://localhost:4000").replace(/\/+$/, "");
  const debug = hasFlag("--debug");
  const resetSession = hasFlag("--reset-session");
  const toolName = getFlagValue("--tool");
  const argsJson = getFlagValue("--args");
  const explicitSessionId = getFlagValue("--session");
  const sessionFile = path.resolve(process.cwd(), ".hermes-cli-session.json");
  const message = getPositionalMessage();

  let session = !resetSession
    ? await loadSavedSession(sessionFile, explicitSessionId)
    : null;

  if (!session) {
    const requestedRole = getFlagValue("--role") ? String(getFlagValue("--role")).toUpperCase() : null;

    if (requestedRole && !VALID_SESSION_ROLES.has(requestedRole) && !hasFlag("--platform")) {
      throw new Error(`Invalid role "${requestedRole}". Use one of: CLIENT, KITCHEN, DELIVERER.`);
    }

    session = await createSession(baseUrl, {
      ...(requestedRole ? { role: requestedRole } : {}),
      ...(getFlagValue("--phone") ? { phone: getFlagValue("--phone") } : {}),
      ...(getFlagValue("--kitchen-id") ? { kitchenId: getFlagValue("--kitchen-id") } : {}),
      ...(getFlagValue("--user-id") ? { id: getFlagValue("--user-id") } : {}),
      ...(getFlagValue("--contact-id") ? { contactId: getFlagValue("--contact-id") } : {}),
      ...(hasFlag("--platform") ? { role: "PLATFORM_SUPPORT", platformAccess: true } : {})
    });
    await saveSession(sessionFile, session);
  }

  console.log(`Hermes CLI`);
  console.log(`Provider URL: ${baseUrl}`);
  console.log(`Session ID: ${session.sessionId}`);
  if (session.role) {
    console.log(`Role: ${session.role}`);
  }
  if (session.phone) {
    console.log(`Phone: ${session.phone}`);
  }
  if (session.kitchenId) {
    console.log(`Kitchen ID: ${session.kitchenId}`);
  }
  if (session.orderId) {
    console.log(`Order ID: ${session.orderId}`);
  }

  if (toolName) {
    const args = argsJson ? JSON.parse(argsJson) : {};
    const result = await postJson(`${baseUrl}/tool-sessions/${encodeURIComponent(session.sessionId)}/tools`, {
      tool: toolName,
      arguments: args
    });
    printStructuredResult(result, debug);
    if (result?.session) {
      await saveSession(sessionFile, result.session);
    }
    return;
  }

  if (message) {
    const result = await postJson(`${baseUrl}/tool-sessions/${encodeURIComponent(session.sessionId)}/messages`, {
      text: message
    });
    printChatResult(result, debug);
    if (result?.session) {
      await saveSession(sessionFile, result.session);
    }
    return;
  }

  const rl = readline.createInterface({ input, output });

  try {
    while (true) {
      const line = (await rl.question("hermes> ")).trim();

      if (!line) {
        continue;
      }

      if (line === "/exit" || line === "/quit") {
        break;
      }

      if (line === "/session") {
        const current = await getJson(`${baseUrl}/tool-sessions/${encodeURIComponent(session.sessionId)}`);
        console.log(JSON.stringify(current, null, 2));
        continue;
      }

      const result = await postJson(`${baseUrl}/tool-sessions/${encodeURIComponent(session.sessionId)}/messages`, {
        text: line
      });
      printChatResult(result, debug);
      if (result?.session) {
        session = result.session;
        await saveSession(sessionFile, session);
      }
    }
  } finally {
    rl.close();
  }
}

async function createSession(baseUrl: string, body: Record<string, unknown>) {
  const response = await postJson(`${baseUrl}/tool-sessions`, body);

  if (!response?.ok || !response?.session) {
    throw new Error(`Failed to create Hermes CLI session: ${JSON.stringify(response)}`);
  }

  return response.session as HermesCliSession;
}

async function loadSavedSession(sessionFile: string, explicitSessionId?: string | null) {
  if (explicitSessionId) {
    return { sessionId: explicitSessionId } as HermesCliSession;
  }

  try {
    const raw = await fs.readFile(sessionFile, "utf8");
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" && typeof parsed.sessionId === "string"
      ? parsed as HermesCliSession
      : null;
  } catch {
    return null;
  }
}

async function saveSession(sessionFile: string, session: HermesCliSession) {
  await fs.writeFile(sessionFile, JSON.stringify(session, null, 2), "utf8");
}

async function postJson(url: string, body: Record<string, unknown>) {
  const response = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify(body)
  });
  return safeReadJson(response);
}

async function getJson(url: string) {
  const response = await fetch(url);
  return safeReadJson(response);
}

async function safeReadJson(response: Response) {
  const text = await response.text();
  return text ? JSON.parse(text) : {};
}

function printChatResult(result: any, debug: boolean) {
  console.log("");
  if (!result?.ok) {
    console.log(JSON.stringify(result, null, 2));
    return;
  }

  if (Array.isArray(result.toolCalls) && result.toolCalls.length > 0) {
    console.log(`Tools used: ${result.toolCalls.map((call: any) => call.name).join(", ")}`);
  }

  if (debug && Array.isArray(result.toolCalls)) {
    console.log(JSON.stringify(result.toolCalls, null, 2));
  }

  console.log(result.assistant?.message ?? "(no assistant message)");

  if (debug && result.session) {
    console.log(JSON.stringify(result.session, null, 2));
  }
}

function printStructuredResult(result: any, debug: boolean) {
  console.log("");
  console.log(JSON.stringify(result, null, debug ? 2 : 2));
}

function getPositionalMessage() {
  const args = process.argv.slice(2);
  const positional: string[] = [];

  for (let index = 0; index < args.length; index += 1) {
    const value = args[index];

    if (value.startsWith("--")) {
      if (!isBooleanFlag(value)) {
        index += 1;
      }
      continue;
    }

    positional.push(value);
  }

  return positional.length > 0 ? positional.join(" ") : null;
}

function hasFlag(flagName: string) {
  return process.argv.includes(flagName);
}

function getFlagValue(flagName: string) {
  const index = process.argv.indexOf(flagName);
  if (index === -1) {
    return null;
  }

  const next = process.argv[index + 1];
  return next && !next.startsWith("--") ? next : null;
}

function isBooleanFlag(flagName: string) {
  return ["--debug", "--reset-session", "--platform"].includes(flagName);
}

main().catch((error) => {
  if (isUserAbort(error)) {
    process.exitCode = 0;
    return;
  }

  console.error("Hermes CLI failed.");
  console.error(error);
  process.exitCode = 1;
});

function isUserAbort(error: unknown) {
  return Boolean(
    error &&
    typeof error === "object" &&
    "code" in error &&
    (error as { code?: unknown }).code === "ABORT_ERR"
  );
}
