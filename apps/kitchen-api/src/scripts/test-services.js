const service = require("../services/prisma-service");
const { prisma } = require("../db/prisma");

function stringifyForConsole(value) {
  return JSON.stringify(
    value,
    (_, currentValue) => (typeof currentValue === "bigint" ? currentValue.toString() : currentValue),
    2
  );
}

async function main() {
  const suffix = Date.now();

  const kitchen = await service.createKitchen({
    name: `Kitchen ${suffix}`,
    description: { businessName: "Kitchen Bot", tone: "friendly" },
    zone: "North",
    schedule: "09:00-18:00",
    setupStatus: "CHANNEL_READY"
  });

  const kitchenAdmin = await service.createUser({
    name: `Kitchen Admin ${suffix}`,
    role: "KITCHEN",
    kitchenId: kitchen.id
  });

  const client = await service.createUser({
    name: `Client ${suffix}`,
    role: "CLIENT"
  });

  await service.linkUserToKitchen({
    userId: client.id,
    kitchenId: kitchen.id
  });

  const deliverer = await service.createUser({
    name: `Deliverer ${suffix}`,
    role: "DELIVERER",
    kitchenId: kitchen.id
  });

  const phone = await service.linkPhoneToUser({
    userId: client.id,
    phone: `555${String(suffix).slice(-7)}`
  });

  const address = await service.linkAddressToUser({
    userId: client.id,
    addressLine: "Street 123",
    street: "Street",
    exteriorNumber: "123",
    neighborhood: "Centro",
    description: "Home"
  });

  const savedConfiguration = await service.saveKitchenConfiguration({
    kitchenId: kitchen.id,
    configuration: {
      greeting: "Hola, bienvenido",
      paymentPolicy: "cash or transfer"
    }
  });

  const menu = await service.createMenu({
    kitchenId: kitchen.id,
    createdByUserId: kitchenAdmin.id,
    name: `Menu ${suffix}`,
    status: "PUBLISHED",
    isCurrent: true,
    items: [
      {
        productName: "Tacos",
        productDescription: "Beef tacos",
        productStock: 25,
        portionSize: "FULL",
        portionPrice: 100,
        menuPrice: 110,
        stockQuantity: 20
      },
      {
        productName: "Quesadilla",
        productDescription: "Cheese quesadilla",
        productStock: 18,
        portionSize: "HALF",
        portionPrice: 50,
        menuPrice: 55,
        stockQuantity: 15
      }
    ]
  });

  const conversation = await service.createOrUpdateConversation({
    kitchenId: kitchen.id,
    linkedPhoneId: phone.id,
    clientUserId: client.id
  });

  const draftOrder = await service.createOrUpdateDraftOrder({
    kitchenId: kitchen.id,
    clientUserId: client.id,
    linkedPhoneId: phone.id,
    addressId: address.id,
    deliveryType: "DELIVERY",
    paymentMethod: "TRANSFER",
    paymentStatus: "PENDING",
    comments: "No onions",
    deliveryFee: 15,
    deliveryAddressSnapshot: {
      street: "Street",
      exteriorNumber: "123",
      neighborhood: "Centro",
      description: "Home"
    },
    items: menu.items.map((item, index) => ({
      productPortionId: item.productPortionId,
      quantity: index + 1
    }))
  });

  const updatedConversation = await service.createOrUpdateConversation({
    kitchenId: kitchen.id,
    linkedPhoneId: phone.id,
    clientUserId: client.id,
    currentOrderId: draftOrder.id
  });

  const confirmedOrder = await service.changeOrderStatus({
    orderId: draftOrder.id,
    actorRole: "CLIENT",
    actorUserId: client.id,
    nextStatus: "CONFIRMED"
  });

  const session = await service.registerWhatsappSession({
    kitchenId: kitchen.id,
    externalSessionId: `session-${suffix}`,
    sessionStatus: "CONNECTED",
    connectedAt: new Date()
  });

  const menuByKitchen = await service.getMenuByKitchen(kitchen.id);
  const userByPhone = await service.getUserByPhone(phone.phone, kitchen.id);
  const orderById = await service.getOrderById(confirmedOrder.id);
  const activeOrders = await service.listOrdersByFilter({
    kitchenId: kitchen.id,
    filter: "active"
  });

  console.log(
    stringifyForConsole({
      kitchenId: kitchen.id.toString(),
      savedConfiguration,
      menu,
      menuByKitchen,
      userByPhone,
      conversation,
      updatedConversation,
      draftOrder,
      confirmedOrder,
      orderById,
      activeOrders,
      session,
      kitchenAdminId: kitchenAdmin.id.toString(),
      clientId: client.id.toString(),
      delivererId: deliverer.id.toString()
    })
  );
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
