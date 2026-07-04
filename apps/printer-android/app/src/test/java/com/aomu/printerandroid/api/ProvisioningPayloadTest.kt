package com.aomu.printerandroid.api

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertNotNull
import org.junit.Test

class ProvisioningPayloadTest {

    @Test
    fun `parses a valid provisioning QR`() {
        val raw = """
            {"v":1,"baseUrl":"http://192.168.1.50:3000","printerToken":"abc123",
             "kitchenId":"2","printerIdentifier":"printer-thermal-1","kitchenName":"Cocina Norte"}
        """.trimIndent()

        val payload = ProvisioningPayload.parse(raw)

        assertNotNull(payload)
        assertEquals("http://192.168.1.50:3000", payload!!.baseUrl)
        assertEquals("abc123", payload.printerToken)
        assertEquals("2", payload.kitchenId)
        assertEquals("printer-thermal-1", payload.printerIdentifier)
        assertEquals("Cocina Norte", payload.kitchenName)
    }

    @Test
    fun `ignores unknown fields`() {
        val raw = """{"v":1,"baseUrl":"http://x:3000","printerToken":"t","kitchenId":"1","printerIdentifier":"p","extra":"ignored"}"""
        assertNotNull(ProvisioningPayload.parse(raw))
    }

    @Test
    fun `returns null for garbage`() {
        assertNull(ProvisioningPayload.parse("not json at all"))
    }

    @Test
    fun `returns null when required fields missing`() {
        val raw = """{"v":1,"baseUrl":"http://x:3000","kitchenId":"1"}"""
        assertNull(ProvisioningPayload.parse(raw))
    }
}
