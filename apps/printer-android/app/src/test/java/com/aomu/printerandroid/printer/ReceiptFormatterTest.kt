package com.aomu.printerandroid.printer

import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * Plain JUnit — no Android, no device. Verifies the receipt-formatting logic
 * that turns a Receipt into DantSu markup.
 */
class ReceiptFormatterTest {

    private val sample = Receipt(
        header = "MY STORE",
        items = listOf(
            LineItem("Coffee", 1, 3.50),
            LineItem("Bagel", 2, 2.00)
        ),
        footer = "Thank you!"
    )

    @Test
    fun `total is the sum of line amounts`() {
        // 1×3.50 + 2×2.00 = 7.50
        assertEquals(7.50, sample.total, 0.0001)
    }

    @Test
    fun `line amount multiplies qty by price`() {
        assertEquals(4.00, LineItem("Bagel", 2, 2.00).amount, 0.0001)
    }

    @Test
    fun `money formats to two decimals with a dot`() {
        assertEquals("3.50", ReceiptFormatter.money(3.5))
        assertEquals("2.00", ReceiptFormatter.money(2.0))
        assertEquals("10.00", ReceiptFormatter.money(9.999))
    }

    @Test
    fun `format produces the expected markup`() {
        val divider = "-".repeat(48)
        val expected = listOf(
            "[C]<b>MY STORE</b>",
            "[C]$divider",
            "[L]1x Coffee[R]3.50",
            "[L]2x Bagel[R]4.00",
            "[C]$divider",
            "[L]<b>TOTAL</b>[R]<b>7.50</b>",
            "[C]Thank you!"
        ).joinToString("\n")

        assertEquals(expected, ReceiptFormatter.format(sample))
    }

    @Test
    fun `divider width matches chars per line`() {
        val out = ReceiptFormatter.format(sample, charsPerLine = 32)
        val dividerLine = out.lines().first { it == "[C]" + "-".repeat(32) }
        // Strip the [C] tag → exactly 32 dashes.
        assertEquals(32, dividerLine.removePrefix("[C]").length)
    }

    @Test
    fun `blank footer is omitted`() {
        val noFooter = sample.copy(footer = "")
        val out = ReceiptFormatter.format(noFooter)
        assertTrue("Should not contain a footer line", !out.contains("Thank you!"))
        // Last line is the total, not an empty [C] line.
        assertEquals("[L]<b>TOTAL</b>[R]<b>7.50</b>", out.lines().last())
    }

    // --- previewText (plain monospace, justified to chars-per-line) ---

    @Test
    fun `preview lines are all exactly chars-per-line wide`() {
        ReceiptFormatter.previewText(sample, charsPerLine = 48).lines().forEach {
            assertEquals("Line not padded to width: '$it'", 48, it.length)
        }
    }

    @Test
    fun `preview justifies item name left and price right`() {
        val line = ReceiptFormatter.previewText(sample, charsPerLine = 48)
            .lines().first { it.trimStart().startsWith("1x Coffee") }
        assertTrue("name on the left", line.startsWith("1x Coffee"))
        assertTrue("price on the right", line.endsWith("3.50"))
        assertEquals(48, line.length)
    }

    @Test
    fun `preview centers the header`() {
        val header = ReceiptFormatter.previewText(sample, charsPerLine = 48).lines().first()
        assertEquals("MY STORE", header.trim())
        // Roughly centered: leading padding within one space of trailing.
        val leading = header.takeWhile { it == ' ' }.length
        val trailing = header.takeLastWhile { it == ' ' }.length
        assertTrue("centered", kotlin.math.abs(leading - trailing) <= 1)
    }

    @Test
    fun `preview total line shows computed total on the right`() {
        val out = ReceiptFormatter.previewText(sample, charsPerLine = 48)
        val totalLine = out.lines().first { it.startsWith("TOTAL") }
        assertTrue(totalLine.endsWith("7.50"))
    }
}
