package com.aomu.printerandroid.printer

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

/** Plain JUnit — the draft→Receipt mapping and text parsing. */
class ReceiptDraftTest {

    @Test
    fun `item draft parses qty and price`() {
        val item = ItemDraft("Coffee", "3", "3.50").toLineItemOrNull()!!
        assertEquals("Coffee", item.name)
        assertEquals(3, item.qty)
        assertEquals(3.50, item.price, 0.0001)
    }

    @Test
    fun `blank name yields no line item`() {
        assertNull(ItemDraft("   ", "1", "1.00").toLineItemOrNull())
    }

    @Test
    fun `unparseable qty and price default to zero`() {
        val item = ItemDraft("Odd", "", "abc").toLineItemOrNull()!!
        assertEquals(0, item.qty)
        assertEquals(0.0, item.price, 0.0001)
    }

    @Test
    fun `draft converts to a receipt with only named items and correct total`() {
        val draft = ReceiptDraft(
            storeName = "SHOP",
            items = listOf(
                ItemDraft("Coffee", "1", "3.50"),
                ItemDraft("", "1", "9.99"), // dropped — no name
                ItemDraft("Bagel", "2", "2.00")
            ),
            footer = "Bye"
        )
        val receipt = draft.toReceipt()
        assertEquals("SHOP", receipt.header)
        assertEquals(2, receipt.items.size)
        assertEquals(7.50, receipt.total, 0.0001) // 3.50 + 2×2.00
    }

    @Test
    fun `hasPrintableItems reflects presence of a named item`() {
        assertTrue(ReceiptDraft().hasPrintableItems)
        assertTrue(!ReceiptDraft(items = listOf(ItemDraft(name = ""))).hasPrintableItems)
    }
}
