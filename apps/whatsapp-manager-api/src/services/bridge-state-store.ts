import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import type { ChatSessionMapping, AgentSession } from "../domain/types.js";
import type { ChatSessionRouterSnapshot, ChatSessionRouterStore } from "./chat-session-router.js";

interface PersistedBridgeState {
  mappings: ChatSessionMapping[];
  sessions: AgentSession[];
  processedMessages: string[];
}

export class FileBridgeStateStore implements ChatSessionRouterStore {
  constructor(private readonly filePath: string) {}

  load(): ChatSessionRouterSnapshot {
    try {
      const state = JSON.parse(readFileSync(this.filePath, "utf8")) as PersistedBridgeState;
      return {
        mappings: state.mappings ?? [],
        sessions: state.sessions ?? [],
        processedMessages: state.processedMessages ?? [],
      };
    } catch {
      return {
        mappings: [],
        sessions: [],
        processedMessages: [],
      };
    }
  }

  save(snapshot: ChatSessionRouterSnapshot): void {
    mkdirSync(path.dirname(this.filePath), { recursive: true });
    writeFileSync(
      this.filePath,
      JSON.stringify(
        {
          mappings: snapshot.mappings,
          sessions: snapshot.sessions,
          processedMessages: snapshot.processedMessages,
        },
        null,
        2,
      ),
    );
  }
}
