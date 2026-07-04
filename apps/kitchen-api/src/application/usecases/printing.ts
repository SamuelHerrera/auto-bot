import { repositories } from "../../infrastructure/container";

export async function getPrintQueue(input: any, context: any) {
  if (input.printerCredential?.type !== "service_token") {
    return {
      ok: false,
      error: "printer_not_authorized"
    };
  }

  const printer = (context.printers ?? []).find((candidatePrinter: any) => {
    return (
      candidatePrinter.identifier === input.printerIdentifier &&
      candidatePrinter.kitchenId === input.kitchenId &&
      candidatePrinter.isActive &&
      candidatePrinter.status !== "NOT_CONNECTED"
    );
  });

  if (!printer) {
    return {
      ok: false,
      error: "printer_not_authorized"
    };
  }

  return {
    ok: true,
    orders: context.orders
      .filter((order: any) => order.kitchenId === input.kitchenId && order.status === "CONFIRMED")
      .map((order: any) => ({
        id: order.id,
        printKey: `${order.id}:${order.revision}`,
        status: order.status,
        items: order.items
      }))
  };
}

export async function executeGetPrintQueue(input: any, deps: any = repositories) {
  const printer = await deps.printers.getByIdentifier({
    kitchenId: input.kitchenId,
    printerIdentifier: input.printerIdentifier
  });
  const orders = await deps.printers.getPrintQueue({
    kitchenId: input.kitchenId
  });

  return getPrintQueue(input, {
    printers: printer ? [printer] : [],
    orders
  });
}
