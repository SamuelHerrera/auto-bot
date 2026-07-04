import type { Application } from "express";
import { createClientsRouter } from "./clients";
import { createHermesRouter } from "./hermes";
import { createKitchensRouter } from "./kitchens";
import { createMenusRouter } from "./menus";
import { createOrdersRouter } from "./orders";
import { createPrintingRouter } from "./printing";
import { createSystemRouter } from "./system";
import { config } from "../../../infrastructure/config";

export function registerRoutes(app: Application) {
  app.use(createSystemRouter());
  if (config.hermes.runtimeRouteEnabled || (config.hermes.localIdentityEnabled && config.hermes.localBootstrapEnabled)) {
    app.use(createHermesRouter());
  }
  app.use(createOrdersRouter());
  app.use(createMenusRouter());
  app.use(createPrintingRouter());
  app.use(createKitchensRouter());
  app.use(createClientsRouter());
}
