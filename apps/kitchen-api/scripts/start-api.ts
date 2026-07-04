import { startServer } from "../src";
import { config } from "../src/infrastructure/config";

const server = startServer();

console.log(`KitchenIA backend listening on http://localhost:${config.port}`);
console.log(`Health: http://localhost:${config.port}/healthz`);
console.log(`Readiness: http://localhost:${config.port}/readyz`);
console.log(`Hermes transport: POST http://localhost:${config.port}/hermes/messages`);
console.log(`Hermes provider mode: ${config.hermes.providerMode}`);
console.log(`Hermes provider configured: ${config.hermes.providerConfigured}`);

function shutdown(signal: NodeJS.Signals) {
  console.log(`Shutting down API after ${signal}.`);
  server.close(() => {
    process.exit(0);
  });
}

process.on("SIGINT", () => shutdown("SIGINT"));
process.on("SIGTERM", () => shutdown("SIGTERM"));
