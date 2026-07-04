export interface SessionRepository {
  registerWhatsappSession(input: Record<string, unknown>): Promise<unknown>;
}
