import { createHermesKitcheniaAdapter } from "../src/integrations/hermes";

async function main() {
  const adapter = createHermesKitcheniaAdapter();
  const kitchenId = process.env.HERMES_DEMO_KITCHEN_ID ?? "2";
  const phone = process.env.HERMES_DEMO_PHONE ?? `+5299${String(Date.now()).slice(-8)}`;

  console.log("Hermes adapter demo");
  console.log(`Backend URL: ${process.env.HERMES_KITCHENIA_BASE_URL ?? "http://localhost:3000"}`);
  console.log(`Kitchen ID: ${kitchenId}`);
  console.log(`Client phone: ${phone}`);

  const draft = await adapter.execute("create_order_draft", {
    phone,
    kitchenId,
    items: [
      {
        productName: "Taco",
        quantity: 1
      }
    ],
    deliveryType: "PICKUP",
    paymentMethod: "CASH",
    comments: "Hermes adapter demo"
  });
  logStep("create_order_draft", draft);

  if (!draft.ok || !draft.data?.orderId) {
    process.exitCode = 1;
    return;
  }

  const orderId = String(draft.data.orderId);

  const read = await adapter.execute("get_order", {
    actor: {
      role: "CLIENT",
      phone
    },
    orderId
  });
  logStep("get_order", read);

  const confirm = await adapter.execute("change_order_status", {
    actor: {
      role: "CLIENT",
      phone
    },
    orderId,
    targetOrderStatus: "CONFIRMED"
  });
  logStep("change_order_status", confirm);

  const activeOrders = await adapter.execute("query_orders", {
    actor: {
      role: "KITCHEN",
      kitchenId
    },
    filter: "active"
  });
  logStep("query_orders", activeOrders);

  if (!read.ok || !confirm.ok || !activeOrders.ok) {
    process.exitCode = 1;
  }
}

function logStep(step: string, result: { ok: boolean; statusCode: number; data: any; error: any }) {
  console.log(`\n[${step}] status=${result.statusCode} ok=${result.ok}`);

  if (result.ok) {
    console.log(JSON.stringify(result.data, null, 2));
    return;
  }

  console.log(JSON.stringify(result.error, null, 2));
}

main().catch((error) => {
  console.error("Hermes adapter demo failed.");
  console.error(error);
  process.exitCode = 1;
});
