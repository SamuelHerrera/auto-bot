export interface ProcessedEventRepository {
  findByMessageId(input: Record<string, unknown>): Promise<unknown>;
  create(input: Record<string, unknown>): Promise<unknown>;
}
