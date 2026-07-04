package com.aomu.printerandroid.api

import android.content.Context
import androidx.datastore.preferences.core.booleanPreferencesKey
import androidx.datastore.preferences.core.edit
import androidx.datastore.preferences.core.intPreferencesKey
import androidx.datastore.preferences.core.stringPreferencesKey
import androidx.datastore.preferences.core.stringSetPreferencesKey
import androidx.datastore.preferences.preferencesDataStore
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.flow.map

/**
 * Connection settings for the KitchenBot API. The print-queue endpoint is
 * authenticated with a shared service token sent as the `x-printer-token`
 * header (see KitchenBot's PRINTER_BRIDGE_API_KEY), and each request names the
 * kitchen and the printer it is fetching jobs for.
 */
data class ApiSettings(
    /** e.g. http://192.168.1.50:3000 — the Docker host running the Kitchen API. */
    val baseUrl: String = "",
    /** Value of PRINTER_BRIDGE_API_KEY on the backend. */
    val printerToken: String = "",
    /** Kitchen id (BigInt as string) this tablet prints for. */
    val kitchenId: String = "",
    /** Printer identifier registered in the backend `printer` table. */
    val printerIdentifier: String = "",
    /** MAC address of the paired Bluetooth printer used for auto-printing. */
    val printerMac: String = "",
    /** Printed as the receipt header. */
    val kitchenName: String = "",
    /** Whether the polling service should run. */
    val pollingEnabled: Boolean = false,
    /** Seconds between print-queue polls. */
    val pollIntervalSeconds: Int = DEFAULT_POLL_INTERVAL_SECONDS
) {
    val isComplete: Boolean
        get() = baseUrl.isNotBlank() &&
            printerToken.isNotBlank() &&
            kitchenId.isNotBlank() &&
            printerIdentifier.isNotBlank() &&
            printerMac.isNotBlank()

    companion object {
        const val DEFAULT_POLL_INTERVAL_SECONDS = 20
    }
}

private val Context.apiSettingsDataStore by preferencesDataStore(name = "kitchen_api_settings")

/**
 * Persists [ApiSettings] plus the set of already-printed printKeys. The
 * printKey (`orderId:revision`) set is the local guard against reprinting an
 * order when the ack didn't reach the backend; the backend's PENDING filter is
 * the primary dedupe.
 */
class ApiSettingsStore(private val context: Context) {

    val settings: Flow<ApiSettings> = context.apiSettingsDataStore.data.map { prefs ->
        ApiSettings(
            baseUrl = prefs[KEY_BASE_URL] ?: "",
            printerToken = prefs[KEY_PRINTER_TOKEN] ?: "",
            kitchenId = prefs[KEY_KITCHEN_ID] ?: "",
            printerIdentifier = prefs[KEY_PRINTER_IDENTIFIER] ?: "",
            printerMac = prefs[KEY_PRINTER_MAC] ?: "",
            kitchenName = prefs[KEY_KITCHEN_NAME] ?: "",
            pollingEnabled = prefs[KEY_POLLING_ENABLED] ?: false,
            pollIntervalSeconds = prefs[KEY_POLL_INTERVAL] ?: ApiSettings.DEFAULT_POLL_INTERVAL_SECONDS
        )
    }

    val printedKeys: Flow<Set<String>> = context.apiSettingsDataStore.data.map { prefs ->
        prefs[KEY_PRINTED_KEYS] ?: emptySet()
    }

    suspend fun save(settings: ApiSettings) {
        context.apiSettingsDataStore.edit { prefs ->
            prefs[KEY_BASE_URL] = settings.baseUrl.trim()
            prefs[KEY_PRINTER_TOKEN] = settings.printerToken.trim()
            prefs[KEY_KITCHEN_ID] = settings.kitchenId.trim()
            prefs[KEY_PRINTER_IDENTIFIER] = settings.printerIdentifier.trim()
            prefs[KEY_PRINTER_MAC] = settings.printerMac.trim()
            prefs[KEY_KITCHEN_NAME] = settings.kitchenName.trim()
            prefs[KEY_POLLING_ENABLED] = settings.pollingEnabled
            prefs[KEY_POLL_INTERVAL] = settings.pollIntervalSeconds
        }
    }

    suspend fun setPollingEnabled(enabled: Boolean) {
        context.apiSettingsDataStore.edit { prefs -> prefs[KEY_POLLING_ENABLED] = enabled }
    }

    /** Records a printed key, keeping only the most recent [MAX_PRINTED_KEYS]. */
    suspend fun addPrintedKey(printKey: String) {
        context.apiSettingsDataStore.edit { prefs ->
            val current = (prefs[KEY_PRINTED_KEYS] ?: emptySet()) + printKey
            prefs[KEY_PRINTED_KEYS] = if (current.size > MAX_PRINTED_KEYS) {
                // Sets keep no insertion order in prefs; dropping arbitrary old
                // entries is fine — stale keys refer to long-gone orders.
                current.drop(current.size - MAX_PRINTED_KEYS).toSet()
            } else {
                current
            }
        }
    }

    suspend fun currentSettings(): ApiSettings = settings.first()

    private companion object {
        val KEY_BASE_URL = stringPreferencesKey("base_url")
        val KEY_PRINTER_TOKEN = stringPreferencesKey("printer_token")
        val KEY_KITCHEN_ID = stringPreferencesKey("kitchen_id")
        val KEY_PRINTER_IDENTIFIER = stringPreferencesKey("printer_identifier")
        val KEY_PRINTER_MAC = stringPreferencesKey("printer_mac")
        val KEY_KITCHEN_NAME = stringPreferencesKey("kitchen_name")
        val KEY_POLLING_ENABLED = booleanPreferencesKey("polling_enabled")
        val KEY_POLL_INTERVAL = intPreferencesKey("poll_interval_seconds")
        val KEY_PRINTED_KEYS = stringSetPreferencesKey("printed_keys")
        const val MAX_PRINTED_KEYS = 200
    }
}
