package com.aomu.printerandroid.queue

import android.annotation.SuppressLint
import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.Service
import android.bluetooth.BluetoothManager
import android.content.Context
import android.content.Intent
import android.os.IBinder
import android.util.Log
import com.aomu.printerandroid.api.ApiSettings
import com.aomu.printerandroid.api.ApiSettingsStore
import com.aomu.printerandroid.api.AckPrintJobRequestDto
import com.aomu.printerandroid.api.ApiErrorParser
import com.aomu.printerandroid.api.KitchenApi
import com.aomu.printerandroid.api.KitchenApiFactory
import com.aomu.printerandroid.api.OrderReceiptMapper
import com.aomu.printerandroid.api.QueueOrderDto
import com.aomu.printerandroid.printer.BluetoothRepository
import com.aomu.printerandroid.printer.EscPosPrinterService
import com.aomu.printerandroid.printer.Receipt
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancel
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.launch
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale

/**
 * Foreground service that polls the KitchenBot print-queue endpoint and
 * auto-prints newly CONFIRMED orders on the Bluetooth thermal printer, then
 * acks them back (PRINTED/FAILED) so the backend drops them from the queue.
 *
 * Dedupe is two-layered: the backend only returns printStatus=PENDING orders,
 * and locally-printed printKeys are persisted so an order is never re-printed
 * while its ack is still failing. Bluetooth I/O reuses the connect-per-job
 * model (fresh SPP socket per receipt) proven in BluetoothRepository.
 */
class PrintQueueService : Service() {

    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.IO)
    private val printerService = EscPosPrinterService()
    private lateinit var settingsStore: ApiSettingsStore
    private lateinit var bluetoothRepository: BluetoothRepository

    private var api: KitchenApi? = null
    private var apiKey: String = ""

    /** Consecutive Bluetooth print failures per printKey; FAILED-acked after the cap. */
    private val printFailures = mutableMapOf<String, Int>()
    private var loopStarted = false

    override fun onBind(intent: Intent?): IBinder? = null

    override fun onCreate() {
        super.onCreate()
        settingsStore = ApiSettingsStore(applicationContext)
        val adapter = getSystemService(BluetoothManager::class.java)?.adapter
        bluetoothRepository = BluetoothRepository(adapter)
        createNotificationChannel()
    }

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        startForeground(NOTIFICATION_ID, buildNotification("Iniciando…"))
        if (!loopStarted) {
            loopStarted = true
            scope.launch { pollLoop() }
        }
        return START_STICKY
    }

    override fun onDestroy() {
        scope.cancel()
        super.onDestroy()
    }

    private suspend fun pollLoop() {
        var consecutiveErrors = 0
        while (true) {
            val settings = settingsStore.currentSettings()
            when {
                !settings.pollingEnabled -> {
                    stopSelf()
                    return
                }

                !settings.isComplete -> {
                    notify("Configura la API en Ajustes")
                    delay(IDLE_DELAY_MS)
                }

                else -> {
                    try {
                        val pending = pollOnce(settings)
                        consecutiveErrors = 0
                        notify("Última consulta ${timestamp()} — $pending pendiente(s)")
                    } catch (e: Exception) {
                        consecutiveErrors++
                        notify("Sin conexión con la API (${e.message ?: "error"})")
                    }
                    val backoff = minOf(consecutiveErrors, MAX_BACKOFF_MULTIPLIER)
                    delay(settings.pollIntervalSeconds * 1000L * (backoff + 1))
                }
            }
        }
    }

    /** One poll cycle: fetch queue, print unseen orders, ack. Returns pending count. */
    private suspend fun pollOnce(settings: ApiSettings): Int {
        val client = apiFor(settings)
        val response = client.getPrintQueue(settings.kitchenId, settings.printerIdentifier)
        val body = response.body()

        if (!response.isSuccessful || body == null || !body.ok) {
            throw IllegalStateException(
                ApiErrorParser.messageFor(
                    responseCode = response.code(),
                    structuredError = body?.error,
                    rawErrorBody = response.errorBody()?.string()
                )
            )
        }

        val printedKeys = settingsStore.printedKeys.first()

        for (order in body.orders) {
            if (order.printKey in printedKeys) {
                // Already printed but the backend still lists it — the ack got
                // lost. Retry the ack only; never print twice.
                ack(client, settings, order, "PRINTED")
                continue
            }

            notify("Imprimiendo pedido #${order.id}…")
            val receipt = OrderReceiptMapper.toReceipt(order, settings.kitchenName)

            val printResult = printReceipt(settings.printerMac, receipt)
            if (printResult.success) {
                printFailures.remove(order.printKey)
                settingsStore.addPrintedKey(order.printKey)
                ack(client, settings, order, "PRINTED")
            } else {
                val failures = (printFailures[order.printKey] ?: 0) + 1
                printFailures[order.printKey] = failures
                if (failures >= MAX_PRINT_FAILURES) {
                    // Printer unreachable repeatedly — tell the backend so the
                    // kitchen sees the order needs manual attention.
                    printFailures.remove(order.printKey)
                    settingsStore.addPrintedKey(order.printKey)
                    ack(client, settings, order, "FAILED")
                }
                notify(
                    "Fallo de impresión pedido #${order.id} " +
                        "(intento $failures): ${printResult.message}"
                )
            }
        }

        return body.orders.size
    }

    private suspend fun ack(
        client: KitchenApi,
        settings: ApiSettings,
        order: QueueOrderDto,
        printStatus: String
    ) {
        try {
            client.ackPrintJob(
                kitchenId = settings.kitchenId,
                orderId = order.id,
                body = AckPrintJobRequestDto(
                    printerIdentifier = settings.printerIdentifier,
                    printKey = order.printKey,
                    printStatus = printStatus,
                    printedAt = isoTimestamp()
                )
            )
        } catch (_: Exception) {
            // Ack lost — the printedKeys guard prevents a reprint and the ack
            // is retried on the next poll while the order stays in the queue.
        }
    }

    /** Connect-per-job print on the configured paired printer. True on success. */
    @SuppressLint("MissingPermission")
    private suspend fun printReceipt(printerMac: String, receipt: Receipt): PrintResult {
        val adapter = getSystemService(BluetoothManager::class.java)?.adapter
            ?: return PrintResult(false, "Bluetooth no disponible")
        val device = try {
            adapter.bondedDevices?.firstOrNull { it.address.equals(printerMac, ignoreCase = true) }
        } catch (_: SecurityException) {
            null
        } ?: return PrintResult(false, "impresora Bluetooth no encontrada")

        repeat(MAX_PRINT_ATTEMPTS) { attempt ->
            try {
                bluetoothRepository.runJob(device) { connection ->
                    printerService.print(connection, receipt)
                }
                return PrintResult(true)
            } catch (e: Exception) {
                Log.e(TAG, "Print attempt ${attempt + 1} failed for $printerMac", e)
                if (attempt + 1 < MAX_PRINT_ATTEMPTS) {
                    delay(RETRY_DELAY_MS)
                } else {
                    return PrintResult(
                        success = false,
                        message = e.message?.takeIf { it.isNotBlank() } ?: "error desconocido"
                    )
                }
            }
        }

        return PrintResult(false, "error desconocido")
    }

    private fun apiFor(settings: ApiSettings): KitchenApi {
        val key = "${settings.baseUrl}|${settings.printerToken}"
        val cached = api
        if (cached != null && key == apiKey) return cached
        val created = KitchenApiFactory.create(settings.baseUrl, settings.printerToken)
        api = created
        apiKey = key
        return created
    }

    // ---- Notification plumbing ----

    private fun createNotificationChannel() {
        val channel = NotificationChannel(
            CHANNEL_ID,
            "Auto-impresión de pedidos",
            NotificationManager.IMPORTANCE_LOW
        )
        getSystemService(NotificationManager::class.java)?.createNotificationChannel(channel)
    }

    private fun buildNotification(text: String): Notification =
        Notification.Builder(this, CHANNEL_ID)
            .setContentTitle("Cola de impresión activa")
            .setContentText(text)
            .setSmallIcon(android.R.drawable.stat_notify_sync)
            .setOngoing(true)
            .build()

    private fun notify(text: String) {
        getSystemService(NotificationManager::class.java)
            ?.notify(NOTIFICATION_ID, buildNotification(text))
    }

    private fun timestamp(): String =
        SimpleDateFormat("HH:mm:ss", Locale.getDefault()).format(Date())

    private fun isoTimestamp(): String =
        SimpleDateFormat("yyyy-MM-dd'T'HH:mm:ss.SSS'Z'", Locale.US).apply {
            timeZone = java.util.TimeZone.getTimeZone("UTC")
        }.format(Date())

    companion object {
        private const val TAG = "PrintQueueService"
        private const val CHANNEL_ID = "print_queue"
        private const val NOTIFICATION_ID = 1001
        private const val IDLE_DELAY_MS = 15_000L
        private const val MAX_BACKOFF_MULTIPLIER = 5
        private const val MAX_PRINT_FAILURES = 3
        private const val MAX_PRINT_ATTEMPTS = 2
        private const val RETRY_DELAY_MS = 2_000L

        fun start(context: Context) {
            context.startForegroundService(Intent(context, PrintQueueService::class.java))
        }

        fun stop(context: Context) {
            context.stopService(Intent(context, PrintQueueService::class.java))
        }
    }

    private data class PrintResult(
        val success: Boolean,
        val message: String = ""
    )
}
