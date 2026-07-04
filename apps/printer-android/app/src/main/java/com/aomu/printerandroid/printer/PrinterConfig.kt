package com.aomu.printerandroid.printer

import com.dantsu.escposprinter.EscPosCharsetEncoding

/**
 * Single source of truth for the My-A1's print parameters. CLAUDE.md: chars-per-line
 * and charset are config constants — don't hardcode them in multiple places.
 *
 * Values confirmed from the printer's self-test page: 203 dpi, 80mm roll
 * (72mm print width), 48 characters per line.
 *
 * Charset is CP437 (ESC/POS code page id 0). If accented / special characters do
 * not render correctly on the paper, switch to the printer's Western-European
 * page here — CP850 (id 2) or WPC1252 / windows-1252 (id 16) are the usual ones —
 * by editing CHARSET_NAME/CHARSET_ID only. The name must be a charset the JVM
 * knows and the id must be the matching ESC/POS page the printer supports.
 */
object PrinterConfig {
    const val DPI = 203
    const val WIDTH_MM = 72f
    const val CHARS_PER_LINE = 48

    const val CHARSET_NAME = "CP437"
    const val CHARSET_ID = 0

    /**
     * Printable dot (pixel) width per line for images: 12 dots/char, matching the
     * standard thermal head — 32 chars/58mm → 384px, 48 chars/80mm → 576px.
     * Derived from [CHARS_PER_LINE] so it tracks the paper-width config.
     */
    const val DOTS_PER_CHAR = 12
    const val DOT_WIDTH = CHARS_PER_LINE * DOTS_PER_CHAR

    /** Max logo slice height (px); taller bitmaps overflow the buffer on cheap printers. */
    const val MAX_LOGO_SLICE_HEIGHT = 256

    fun charsetEncoding(): EscPosCharsetEncoding = EscPosCharsetEncoding(CHARSET_NAME, CHARSET_ID)
}
