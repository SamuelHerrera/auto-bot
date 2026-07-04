import { z } from "zod";
import { readFileSync } from "node:fs";

const configSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  PORT: z.coerce.number().int().positive().default(3000),
  LOG_LEVEL: z.enum(["fatal", "error", "warn", "info", "debug", "trace"]).default("info"),
  API_TOKEN: z.string().min(1).default("local-dev-token"),
  CORS_ORIGIN: z.string().min(1).default("*"),
  DATABASE_URL: z.string().min(1).default("postgres://postgres:postgres@127.0.0.1:5432/auto_bot"),
  BAILEYS_STATE_DIR: z.string().min(1).default("/opt/data/whatsapp-manager/baileys"),
  WHATSAPP_MEDIA_DIR: z.string().min(1).default("/opt/data/whatsapp-manager/media"),
  BRIDGE_DATABASE_FILE: z.string().default("/opt/data/whatsapp-manager/bridge-state.sqlite"),
  BRIDGE_STATE_FILE: z.string().default(""),
  AGENT_API_BASE_URL: z.string().url().optional(),
  AGENT_API_MODEL: z.string().optional(),
  AGENT_PLATFORM_EVENT_RETENTION_DAYS: z.coerce.number().int().nonnegative().optional(),
  HERMES_API_BASE_URL: z.string().url().default("http://127.0.0.1:8642"),
  HERMES_API_MODEL: z.string().default("hermes-agent"),
  POSTBACK_RUN_RETENTION_DAYS: z.coerce.number().int().nonnegative().default(30),
  HERMES_PLATFORM_EVENT_RETENTION_DAYS: z.coerce.number().int().nonnegative().default(7),
  WHATSAPP_MANAGER_NATIVE_ADAPTER_ENABLED: z.string().default("auto"),
  WHATSAPP_MANAGER_API_URL: z.string().default(""),
  WHATSAPP_MANAGER_API_TOKEN: z.string().default(""),
  WHATSAPP_MANAGER_ALLOW_ALL_USERS: z.string().default(""),
  WHATSAPP_MANAGER_ALLOWED_USERS: z.string().default(""),
});

type ParsedConfig = z.infer<typeof configSchema>;

export type AppConfig = ParsedConfig & {
  AGENT_API_BASE_URL: string;
  AGENT_API_MODEL: string;
  AGENT_PLATFORM_EVENT_RETENTION_DAYS: number;
  internalApiKey: string;
};

export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  const config = configSchema.parse(env);
  return {
    ...config,
    AGENT_API_BASE_URL: config.AGENT_API_BASE_URL ?? config.HERMES_API_BASE_URL,
    AGENT_API_MODEL: config.AGENT_API_MODEL ?? config.HERMES_API_MODEL,
    AGENT_PLATFORM_EVENT_RETENTION_DAYS: config.AGENT_PLATFORM_EVENT_RETENTION_DAYS ?? config.HERMES_PLATFORM_EVENT_RETENTION_DAYS,
    internalApiKey: getInternalApiKey(),
  };
}

function getInternalApiKey() {
  try {
    return readFileSync("/opt/data/whatsapp-manager/internal-api-key", "utf8").trim();
  } catch {
    return "auto-bot-internal-hermes-api-key";
  }
}
