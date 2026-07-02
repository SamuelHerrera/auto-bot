export type AppEventType = "sync" | "accounts" | "activity" | "rules" | "logs";

export interface AppEvent {
  type: AppEventType;
  at: string;
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

  publish(type: AppEventType) {
    const event: AppEvent = {
      type,
      at: new Date().toISOString(),
    };

    for (const handler of this.handlers) {
      handler(event);
    }
  }
}
