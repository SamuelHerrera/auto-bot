package com.aomu.printerandroid.printer

import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

/** Plain JUnit — the pure logo scaling/slicing math (no Android, no device). */
class LogoScalingTest {

    // ---- scaledSize ----

    @Test
    fun `wider than dot width scales down preserving aspect`() {
        // 1000×500 into 576 wide → 576×288 (500 * 576/1000)
        assertEquals(LogoSize(576, 288), LogoScaling.scaledSize(1000, 500, 576))
    }

    @Test
    fun `narrower image is not upscaled`() {
        assertEquals(LogoSize(300, 200), LogoScaling.scaledSize(300, 200, 576))
    }

    @Test
    fun `exact width is kept`() {
        assertEquals(LogoSize(576, 120), LogoScaling.scaledSize(576, 120, 576))
    }

    @Test
    fun `height is rounded to nearest pixel`() {
        // 333 * 576/1000 = 191.808 → 192
        assertEquals(192, LogoScaling.scaledSize(1000, 333, 576).height)
    }

    @Test
    fun `58mm dot width scaling`() {
        // 800×400 into 384 wide → 384×192
        assertEquals(LogoSize(384, 192), LogoScaling.scaledSize(800, 400, 384))
    }

    // ---- sliceHeights ----

    @Test
    fun `tall image splits under the max`() {
        assertEquals(listOf(256, 244), LogoScaling.sliceHeights(500, 256))
    }

    @Test
    fun `exact multiple splits evenly`() {
        assertEquals(listOf(256, 256), LogoScaling.sliceHeights(512, 256))
    }

    @Test
    fun `single slice when under the max`() {
        assertEquals(listOf(200), LogoScaling.sliceHeights(200, 256))
    }

    @Test
    fun `just over the max splits into two`() {
        assertEquals(listOf(256, 1), LogoScaling.sliceHeights(257, 256))
    }

    @Test
    fun `zero height yields no slices`() {
        assertTrue(LogoScaling.sliceHeights(0, 256).isEmpty())
    }

    @Test
    fun `slices sum to the total and never exceed the max`() {
        val slices = LogoScaling.sliceHeights(1000, 256)
        assertEquals(1000, slices.sum())
        assertTrue(slices.all { it in 1..256 })
    }
}
