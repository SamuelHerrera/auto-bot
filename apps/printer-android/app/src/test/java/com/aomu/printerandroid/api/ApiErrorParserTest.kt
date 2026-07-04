package com.aomu.printerandroid.api

import org.junit.Assert.assertEquals
import org.junit.Test

class ApiErrorParserTest {

    @Test
    fun `maps printer authorization error to actionable message`() {
        val message = ApiErrorParser.messageFor(
            responseCode = 403,
            rawErrorBody = """{"ok":false,"error":"printer_not_authorized"}"""
        )

        assertEquals(
            "printer_not_authorized. Revisa Printer token, Kitchen ID y Printer identifier.",
            message
        )
    }

    @Test
    fun `falls back to http code when body is empty`() {
        val message = ApiErrorParser.messageFor(responseCode = 403)

        assertEquals("HTTP 403", message)
    }
}
