package com.aomu.printerandroid.printer

import android.graphics.Bitmap
import android.graphics.BitmapFactory
import kotlin.math.max

/**
 * Decoding helpers for the persisted logo file. Both decode from an absolute
 * path (no Context needed) and downsample to avoid loading huge photos whole.
 */
object LogoImages {

    /**
     * Decode for printing: downsample so the result is at least [targetWidth] wide
     * (keeps enough resolution for the exact scale-down later) without decoding a
     * multi-megapixel photo at full size.
     */
    fun decodeForWidth(path: String, targetWidth: Int): Bitmap? {
        val bounds = decodeBounds(path) ?: return null
        var sample = 1
        while (bounds.outWidth / (sample * 2) >= targetWidth) sample *= 2
        return decode(path, sample)
    }

    /** Decode a small thumbnail: downsample so the largest side is near [maxPx]. */
    fun decodeSampled(path: String, maxPx: Int): Bitmap? {
        val bounds = decodeBounds(path) ?: return null
        var sample = 1
        while (max(bounds.outWidth, bounds.outHeight) / (sample * 2) >= maxPx) sample *= 2
        return decode(path, sample)
    }

    private fun decodeBounds(path: String): BitmapFactory.Options? {
        val bounds = BitmapFactory.Options().apply { inJustDecodeBounds = true }
        BitmapFactory.decodeFile(path, bounds)
        return if (bounds.outWidth > 0 && bounds.outHeight > 0) bounds else null
    }

    private fun decode(path: String, sampleSize: Int): Bitmap? =
        BitmapFactory.decodeFile(path, BitmapFactory.Options().apply { inSampleSize = sampleSize })
}
