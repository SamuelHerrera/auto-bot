export interface OrderRepository {
  getById(orderId: string): Promise<unknown>;
  getCurrentMenuItems(kitchenId: string): Promise<unknown[]>;
  getExistingDraft(input: Record<string, unknown>): Promise<unknown>;
  query(input: Record<string, unknown>): Promise<unknown[]>;
  saveDraft(input: Record<string, unknown>): Promise<unknown>;
  confirmOrderAtomically(input: Record<string, unknown>): Promise<unknown>;
  changeStatus(input: Record<string, unknown>): Promise<unknown>;
}
