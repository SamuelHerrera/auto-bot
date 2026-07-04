export interface KitchenRepository {
  getById(kitchenId: string): Promise<unknown>;
  registerKitchen(input: Record<string, unknown>): Promise<unknown>;
  updateConfiguration(input: Record<string, unknown>): Promise<unknown>;
  upsertAuthorizedContact(input: Record<string, unknown>): Promise<unknown>;
}
