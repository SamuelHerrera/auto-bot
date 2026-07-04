import type { NextFunction, Request, Response } from "express";
import { toErrorResponse } from "../../../shared/errors";

export function notFoundHandler(_request: Request, response: Response) {
  response.status(404).json({
    ok: false,
    error: "route_not_found"
  });
}

export function errorHandler(error: unknown, _request: Request, response: Response, _next: NextFunction) {
  console.error("HTTP error:", error);

  const { statusCode, body } = toErrorResponse(error);
  response.status(statusCode).json(body);
}