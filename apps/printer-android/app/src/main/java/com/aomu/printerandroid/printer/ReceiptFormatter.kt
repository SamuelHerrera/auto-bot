package com.aomu.printerandroid.printer

import java.util.Locale

/**
 * Turns a [Receipt] into either:
 *  - [format]: the DantSu formatted-text markup ([C]/[L]/[R], <b>) that is sent
 *    to the printer, or
 *  - [previewText]: a plain monospace rendering justified to the printer's
 *    chars-per-line, for the on-screen preview.
 *
 * Both are pure (no Android, no DantSu) so the receipt-formatting logic can be
 * covered by plain JUnit tests without any hardware.
 */
object ReceiptFormatter {

    /** 80mm roll → 48 chars/line. Sourced from [PrinterConfig] (single config point). */
    const val DEFAULT_CHARS_PER_LINE = PrinterConfig.CHARS_PER_LINE

    /** DantSu markup for actual printing. */
    fun format(receipt: Receipt, charsPerLine: Int = DEFAULT_CHARS_PER_LINE): String {
        val divider = "-".repeat(charsPerLine)
        return buildList {
            add("[C]<b>${receipt.header}</b>")
            receipt.headerLines.forEach { add("[C]$it") }
            add("[C]$divider")
            receipt.items.forEach { item ->
                add("[L]${item.qty}x ${item.name}[R]${money(item.amount)}")
            }
            add("[C]$divider")
            add("[L]<b>TOTAL</b>[R]<b>${money(receipt.total)}</b>")
            if (receipt.footer.isNotBlank()) {
                add("[C]${receipt.footer}")
            }
        }.joinToString("\n")
    }

    /**
     * Plain-text preview: every line is exactly [charsPerLine] wide, headers/footers
     * centered, item name left / price right — mirrors how the printout justifies.
     */
    fun previewText(receipt: Receipt, charsPerLine: Int = DEFAULT_CHARS_PER_LINE): String {
        val divider = "-".repeat(charsPerLine)
        return buildList {
            add(center(receipt.header, charsPerLine))
            receipt.headerLines.forEach { add(center(it, charsPerLine)) }
            add(divider)
            receipt.items.forEach { item ->
                add(justify("${item.qty}x ${item.name}", money(item.amount), charsPerLine))
            }
            add(divider)
            add(justify("TOTAL", money(receipt.total), charsPerLine))
            if (receipt.footer.isNotBlank()) {
                add(center(receipt.footer, charsPerLine))
            }
        }.joinToString("\n")
    }

    /** Fixed 2-decimal money, dot separator (Locale.US) so output is deterministic. */
    fun money(value: Double): String = String.format(Locale.US, "%.2f", value)

    /** Centers [text] within [width]; truncates if it's too long. */
    private fun center(text: String, width: Int): String {
        if (text.length >= width) return text.take(width)
        val padTotal = width - text.length
        val left = padTotal / 2
        return " ".repeat(left) + text + " ".repeat(padTotal - left)
    }

    /** Left text + right text padded to exactly [width]; truncates left if needed. */
    private fun justify(left: String, right: String, width: Int): String {
        val maxLeft = (width - right.length - 1).coerceAtLeast(0)
        val trimmedLeft = if (left.length > maxLeft) left.take(maxLeft) else left
        val gap = (width - trimmedLeft.length - right.length).coerceAtLeast(1)
        return trimmedLeft + " ".repeat(gap) + right
    }
}
