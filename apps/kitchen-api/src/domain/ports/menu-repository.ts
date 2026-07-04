export interface MenuRepository {
  getCurrentMenu(kitchenId: string): Promise<unknown>;
  publishMenu(input: Record<string, unknown>): Promise<unknown>;
  upsertMenuProduct(input: Record<string, unknown>): Promise<unknown>;
}
