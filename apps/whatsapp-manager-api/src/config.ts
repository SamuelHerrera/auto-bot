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
  BRIDGE_DATABASE_FILE: z.string().default("/opt/data/whatsapp-manager/bridge-state.sqlite"),
  BRIDGE_STATE_FILE: z.string().default(""),
  HERMES_API_BASE_URL: z.string().url().default("http://127.0.0.1:8642"),
  HERMES_API_MODEL: z.string().default("hermes-agent"),
});

type ParsedConfig = z.infer<typeof configSchema>;

export type AppConfig = ParsedConfig & {
  internalApiKey: string;
};

export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  const config = configSchema.parse(env);
  return {
    ...config,
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
