package com.aomu.printerandroid.api

import org.junit.Assert.assertEquals
import org.junit.Test

class OrderReceiptMapperTest {

    private val order = QueueOrderDto(
        id = "42",
        printKey = "42:3",
        status = "CONFIRMED",
        items = listOf(
            QueueItemDto(nameSnapshot = "Torta de asado", quantity = 2, unitPriceSnapshot = 45.0),
            QueueItemDto(nameSnapshot = "Agua", quantity = 1, unitPriceSnapshot = 15.5)
        )
    )

    @Test
    fun `maps order onto receipt model`() {
        val receipt = OrderReceiptMapper.toReceipt(order, kitchenName = "Cocina Norte")

        assertEquals("Cocina Norte", receipt.header)
        assertEquals(listOf("Pedido #42"), receipt.headerLines)
        assertEquals(2, receipt.items.size)
        assertEquals("Torta de asado", receipt.items[0].name)
        assertEquals(2, receipt.items[0].qty)
        assertEquals(45.0, receipt.items[0].price, 0.001)
        assertEquals("42:3", receipt.footer)
        assertEquals(105.5, receipt.total, 0.001)
    }

    @Test
    fun `falls back to generic header when kitchen name blank`() {
        val receipt = OrderReceiptMapper.toReceipt(order, kitchenName = "")
        assertEquals("PEDIDO", receipt.header)
    }

    @Test
    fun `blank item names become placeholder`() {
        val receipt = OrderReceiptMapper.toReceipt(
            order.copy(items = listOf(QueueItemDto(nameSnapshot = "", quantity = 1, unitPriceSnapshot = 1.0))),
            kitchenName = "X"
        )
        assertEquals("Producto", receipt.items[0].name)
    }
}
