export interface ClientRepository {
  findByPhone(kitchenId: string, phone: string): Promise<unknown>;
  upsertClient(input: Record<string, unknown>): Promise<unknown>;
}
