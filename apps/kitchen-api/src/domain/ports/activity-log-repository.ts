export interface ActivityLogRepository {
  create(input: Record<string, unknown>): Promise<unknown>;
}
