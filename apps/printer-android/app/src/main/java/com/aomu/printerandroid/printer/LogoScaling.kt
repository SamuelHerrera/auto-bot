package com.aomu.printerandroid.printer

import kotlin.math.max
import kotlin.math.min
import kotlin.math.roundToInt

/** Pixel dimensions — a pure type (not android.util.Size) so it's plain-JUnit testable. */
data class LogoSize(val width: Int, val height: Int)

/**
 * Pure scaling/slicing math for logo printing. No Android types, so the sizing
 * logic can be unit-tested without a device (the actual Bitmap work lives in
 * EscPosPrinterService).
 */
object LogoScaling {

    /**
     * Downscale to fit [dotWidth] preserving aspect ratio; never upscale a smaller
     * image. Height is rounded to the nearest pixel (min 1).
     */
    fun scaledSize(srcWidth: Int, srcHeight: Int, dotWidth: Int): LogoSize {
        require(srcWidth > 0 && srcHeight > 0) { "source dimensions must be positive" }
        require(dotWidth > 0) { "dotWidth must be positive" }
        if (srcWidth <= dotWidth) return LogoSize(srcWidth, srcHeight)
        val scale = dotWidth.toDouble() / srcWidth
        val height = max(1, (srcHeight * scale).roundToInt())
        return LogoSize(dotWidth, height)
    }

    /**
     * Split [totalHeight] into consecutive slice heights, each at most
     * [maxSliceHeight]. Heights sum to [totalHeight]; empty when the image has no
     * height. Cheap printers overflow their buffer on tall bitmaps, hence slicing.
     */
    fun sliceHeights(totalHeight: Int, maxSliceHeight: Int): List<Int> {
        require(totalHeight >= 0) { "totalHeight must be >= 0" }
        require(maxSliceHeight > 0) { "maxSliceHeight must be positive" }
        val slices = ArrayList<Int>()
        var remaining = totalHeight
        while (remaining > 0) {
            val h = min(remaining, maxSliceHeight)
            slices.add(h)
            remaining -= h
        }
        return slices
    }
}
