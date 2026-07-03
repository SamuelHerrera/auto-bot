export type AppEventType = "sync" | "accounts" | "activity" | "rules" | "logs";

export interface AppEvent {
  type: AppEventType;
  at: string;
  details?: Record<string, unknown>;
}

type EventHandler = (event: AppEvent) => void;

export class AppEventBus {
  private readonly handlers = new Set<EventHandler>();

  subscribe(handler: EventHandler) {
    this.handlers.add(handler);
    return () => {
      this.handlers.delete(handler);
    };
  }

  publish(type: AppEventType, details?: Record<string, unknown>) {
    const event: AppEvent = {
      type,
      at: new Date().toISOString(),
      ...(details ? { details } : {}),
    };

    for (const handler of this.handlers) {
      handler(event);
    }
  }
}
