package com.aomu.printerandroid.api

import kotlinx.serialization.json.Json
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive

private val errorJson = Json { ignoreUnknownKeys = true }

object ApiErrorParser {

    fun messageFor(
        responseCode: Int,
        structuredError: String? = null,
        rawErrorBody: String? = null
    ): String {
        val error = structuredError
            ?: parseErrorField(rawErrorBody)
            ?: rawErrorBody?.trim()?.takeIf { it.isNotEmpty() }

        return when (error) {
            "printer_not_authorized" ->
                "printer_not_authorized. Revisa Printer token, Kitchen ID y Printer identifier."
            null -> "HTTP $responseCode"
            else -> error
        }
    }

    private fun parseErrorField(rawErrorBody: String?): String? {
        if (rawErrorBody.isNullOrBlank()) {
            return null
        }

        return runCatching {
            errorJson
                .parseToJsonElement(rawErrorBody)
                .jsonObject["error"]
                ?.jsonPrimitive
                ?.content
                ?.trim()
                ?.takeIf { it.isNotEmpty() }
        }.getOrNull()
    }
}
