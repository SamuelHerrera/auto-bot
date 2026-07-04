import express, { type Express } from "express";
import { registerRoutes } from "../adapters/http/routes";
import { notFoundHandler, errorHandler } from "../adapters/http/middleware/error-handler";
import { resolveActor } from "../adapters/http/middleware/resolve-actor";

export function createApp(): Express {
  const app = express();

  app.use(express.json());
  app.use(resolveActor);

  registerRoutes(app);

  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
}

export const app = createApp();

export default app;
