package com.aomu.printerandroid.printer

import android.content.Context
import android.net.Uri
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import java.io.File

/**
 * Persists the ticket logo to app-internal storage. We copy the picked image's
 * BYTES into filesDir (a fixed file) and reference that path — we never persist
 * the gallery Uri, whose read grant is temporary and dies with the process.
 * The file survives restarts and is restored via [existingPath].
 */
class LogoStore(context: Context) {

    private val appContext = context.applicationContext
    private val logoFile: File get() = File(appContext.filesDir, LOGO_FILENAME)

    /** Copies the picked image bytes into filesDir; returns its path or null on failure. */
    suspend fun save(uri: Uri): String? = withContext(Dispatchers.IO) {
        try {
            appContext.contentResolver.openInputStream(uri)?.use { input ->
                logoFile.outputStream().use { output -> input.copyTo(output) }
            } ?: return@withContext null
            logoFile.absolutePath
        } catch (e: Exception) {
            null
        }
    }

    /** Path of the previously saved logo if it exists (restored on app restart). */
    fun existingPath(): String? = logoFile.takeIf { it.exists() }?.absolutePath

    fun delete() {
        if (logoFile.exists()) logoFile.delete()
    }

    companion object {
        private const val LOGO_FILENAME = "ticket_logo.img"
    }
}
