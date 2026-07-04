package com.aomu.printerandroid.api

import com.aomu.printerandroid.printer.LineItem
import com.aomu.printerandroid.printer.Receipt

/**
 * Maps a Kitchen API queue order onto the existing [Receipt] model so the
 * unchanged formatting/printing pipeline (ReceiptFormatter → EscPosPrinterService)
 * can print it.
 */
object OrderReceiptMapper {

    fun toReceipt(order: QueueOrderDto, kitchenName: String): Receipt = Receipt(
        header = kitchenName.ifBlank { "PEDIDO" },
        headerLines = listOf("Pedido #${order.id}"),
        items = order.items.map { item ->
            LineItem(
                name = item.nameSnapshot.ifBlank { "Producto" },
                qty = item.quantity,
                price = item.unitPriceSnapshot
            )
        },
        footer = order.printKey
    )
}
