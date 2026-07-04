import { createServer } from "node:http";
import { createApp } from "./app";
import { config } from "./config";

export function startServer() {
  const app = createApp();
  const server = createServer(app);

  server.listen(config.port);

  return server;
}
