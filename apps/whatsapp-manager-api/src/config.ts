import { z } from "zod";

const configSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  PORT: z.coerce.number().int().positive().default(3000),
  LOG_LEVEL: z.enum(["fatal", "error", "warn", "info", "debug", "trace"]).default("info"),
  API_TOKEN: z.string().min(1).default("local-dev-token"),
  CORS_ORIGIN: z.string().min(1).default("http://127.0.0.1:4173,http://localhost:4173"),
  DATABASE_URL: z.string().min(1).default("postgres://postgres:postgres@127.0.0.1:5432/auto_bot"),
  BAILEYS_STATE_DIR: z.string().min(1).default("/opt/data/whatsapp-manager/baileys"),
  HERMES_ADAPTER_MODE: z.enum(["mock", "cli"]).default("mock"),
});

export type AppConfig = z.infer<typeof configSchema>;

export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  return configSchema.parse(env);
}
