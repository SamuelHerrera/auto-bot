export interface PrinterRepository {
  getPrintQueue(input: Record<string, unknown>): Promise<unknown[]>;
}
