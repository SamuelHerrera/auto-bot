package com.aomu.printerandroid.ui

import android.Manifest
import android.os.Build
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Button
import androidx.compose.material3.Card
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Scaffold
import androidx.compose.material3.SnackbarHost
import androidx.compose.material3.SnackbarHostState
import androidx.compose.material3.Switch
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.TopAppBar
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.input.PasswordVisualTransformation
import androidx.compose.ui.unit.dp
import com.aomu.printerandroid.api.ApiSettings
import com.aomu.printerandroid.api.ApiSettingsStore
import com.aomu.printerandroid.api.KitchenApiFactory
import com.aomu.printerandroid.api.ProvisioningPayload
import com.aomu.printerandroid.printer.PrinterViewModel
import com.aomu.printerandroid.queue.PrintQueueService
import com.journeyapps.barcodescanner.ScanContract
import com.journeyapps.barcodescanner.ScanOptions
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext

/**
 * Kitchen API connection settings + the auto-print service toggle. Values are
 * persisted in DataStore and read by [PrintQueueService]; the manual print
 * flow is untouched by anything here.
 */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun ApiSettingsScreen(
    viewModel: PrinterViewModel,
    onBack: () -> Unit
) {
    val context = LocalContext.current
    val store = remember { ApiSettingsStore(context.applicationContext) }
    val scope = rememberCoroutineScope()
    val snackbarHostState = remember { SnackbarHostState() }

    var loaded by remember { mutableStateOf(false) }
    var baseUrl by remember { mutableStateOf("") }
    var printerToken by remember { mutableStateOf("") }
    var kitchenId by remember { mutableStateOf("") }
    var printerIdentifier by remember { mutableStateOf("") }
    var printerMac by remember { mutableStateOf("") }
    var kitchenName by remember { mutableStateOf("") }
    var pollInterval by remember { mutableStateOf(ApiSettings.DEFAULT_POLL_INTERVAL_SECONDS.toString()) }
    var pollingEnabled by remember { mutableStateOf(false) }

    LaunchedEffect(Unit) {
        val settings = store.settings.first()
        baseUrl = settings.baseUrl
        printerToken = settings.printerToken
        kitchenId = settings.kitchenId
        printerIdentifier = settings.printerIdentifier
        printerMac = settings.printerMac
        kitchenName = settings.kitchenName
        pollInterval = settings.pollIntervalSeconds.toString()
        pollingEnabled = settings.pollingEnabled
        loaded = true
    }

    fun currentSettings() = ApiSettings(
        baseUrl = baseUrl,
        printerToken = printerToken,
        kitchenId = kitchenId,
        printerIdentifier = printerIdentifier,
        printerMac = printerMac,
        kitchenName = kitchenName,
        pollingEnabled = pollingEnabled,
        pollIntervalSeconds = pollInterval.toIntOrNull()
            ?: ApiSettings.DEFAULT_POLL_INTERVAL_SECONDS
    )

    fun applyPolling(enabled: Boolean) {
        pollingEnabled = enabled
        scope.launch {
            store.save(currentSettings())
            if (enabled) {
                if (!currentSettings().isComplete) {
                    snackbarHostState.showSnackbar("Completa todos los campos primero")
                    pollingEnabled = false
                    store.setPollingEnabled(false)
                    return@launch
                }
                PrintQueueService.start(context)
                snackbarHostState.showSnackbar("Auto-impresión activada")
            } else {
                PrintQueueService.stop(context)
                snackbarHostState.showSnackbar("Auto-impresión desactivada")
            }
        }
    }

    // Enqueues a "CONEXIÓN LISTA" test job on the backend. It prints through the
    // normal auto-print service once a Bluetooth printer is selected and
    // auto-print is on — proving API auth + queue + print + ack end to end.
    fun enqueueTestPrint(remindEnablePolling: Boolean) {
        val settings = currentSettings()
        if (settings.baseUrl.isBlank() || settings.printerToken.isBlank() ||
            settings.kitchenId.isBlank() || settings.printerIdentifier.isBlank()
        ) {
            scope.launch { snackbarHostState.showSnackbar("Faltan datos de la API") }
            return
        }
        scope.launch {
            val message = try {
                val api = KitchenApiFactory.create(settings.baseUrl, settings.printerToken)
                val response = withContext(Dispatchers.IO) {
                    api.createTestPrint(settings.kitchenId, settings.printerIdentifier)
                }
                if (response.isSuccessful && response.body()?.ok == true) {
                    if (settings.pollingEnabled || !remindEnablePolling) {
                        "Prueba enviada — imprimiendo…"
                    } else {
                        "Prueba en cola — activa auto-impresión para imprimir"
                    }
                } else {
                    "No se pudo enviar la prueba (${response.code()})"
                }
            } catch (e: Exception) {
                "Sin conexión con la API (${e.message ?: "error"})"
            }
            snackbarHostState.showSnackbar(message)
        }
    }

    val notificationPermissionLauncher = rememberLauncherForActivityResult(
        ActivityResultContracts.RequestPermission()
    ) { applyPolling(true) } // foreground service works either way; notification just may be hidden

    // QR provisioning: scan the code shown on the backend page and fill the
    // connection fields. The Bluetooth printer (printerMac) stays a manual pick.
    val scanLauncher = rememberLauncherForActivityResult(ScanContract()) { result ->
        val raw = result.contents
        if (raw == null) return@rememberLauncherForActivityResult // user cancelled
        val payload = ProvisioningPayload.parse(raw)
        if (payload == null) {
            scope.launch { snackbarHostState.showSnackbar("Código QR no válido") }
        } else {
            baseUrl = payload.baseUrl
            printerToken = payload.printerToken
            kitchenId = payload.kitchenId
            printerIdentifier = payload.printerIdentifier
            if (payload.kitchenName.isNotBlank()) kitchenName = payload.kitchenName
            scope.launch {
                store.save(currentSettings())
                snackbarHostState.showSnackbar("Configuración escaneada")
            }
            // Queue a connection-ready test print so the first thing that prints
            // once a printer is picked + auto-print is on is "CONEXIÓN LISTA".
            enqueueTestPrint(remindEnablePolling = true)
        }
    }

    fun launchScan() {
        scanLauncher.launch(
            ScanOptions()
                .setDesiredBarcodeFormats(ScanOptions.QR_CODE)
                .setPrompt("Escanea el QR de provisión")
                .setBeepEnabled(false)
                .setOrientationLocked(false)
        )
    }

    Scaffold(
        topBar = {
            TopAppBar(
                title = { Text("Configuración") },
                navigationIcon = { TextButton(onClick = onBack) { Text("Atrás") } }
            )
        },
        snackbarHost = { SnackbarHost(snackbarHostState) }
    ) { padding ->
        Column(
            modifier = Modifier
                .fillMaxSize()
                .padding(padding)
                .padding(16.dp)
                .verticalScroll(rememberScrollState()),
            verticalArrangement = Arrangement.spacedBy(12.dp)
        ) {
            Button(
                onClick = { launchScan() },
                enabled = loaded,
                modifier = Modifier.fillMaxWidth()
            ) { Text("Escanear QR") }
            Text(
                "Escanea el código del panel de la cocina para llenar los datos automáticamente. Luego elige la impresora Bluetooth abajo.",
                style = MaterialTheme.typography.bodySmall
            )

            OutlinedTextField(
                value = baseUrl,
                onValueChange = { baseUrl = it },
                label = { Text("URL de la API (http://IP:3000)") },
                singleLine = true,
                enabled = loaded,
                modifier = Modifier.fillMaxWidth()
            )
            OutlinedTextField(
                value = printerToken,
                onValueChange = { printerToken = it },
                label = { Text("Printer token (PRINTER_BRIDGE_API_KEY)") },
                singleLine = true,
                enabled = loaded,
                visualTransformation = PasswordVisualTransformation(),
                modifier = Modifier.fillMaxWidth()
            )
            OutlinedTextField(
                value = kitchenId,
                onValueChange = { kitchenId = it },
                label = { Text("Kitchen ID") },
                singleLine = true,
                enabled = loaded,
                keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Number),
                modifier = Modifier.fillMaxWidth()
            )
            OutlinedTextField(
                value = printerIdentifier,
                onValueChange = { printerIdentifier = it },
                label = { Text("Printer identifier (registrado en el backend)") },
                singleLine = true,
                enabled = loaded,
                modifier = Modifier.fillMaxWidth()
            )
            OutlinedTextField(
                value = kitchenName,
                onValueChange = { kitchenName = it },
                label = { Text("Nombre en el ticket (opcional)") },
                singleLine = true,
                enabled = loaded,
                modifier = Modifier.fillMaxWidth()
            )
            OutlinedTextField(
                value = pollInterval,
                onValueChange = { pollInterval = it },
                label = { Text("Intervalo de consulta (segundos)") },
                singleLine = true,
                enabled = loaded,
                keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Number),
                modifier = Modifier.fillMaxWidth()
            )

            Text("Impresora para auto-impresión", style = MaterialTheme.typography.titleMedium)
            val paired = remember(loaded) { runCatching { viewModel.pairedDevices() }.getOrDefault(emptyList()) }
            if (paired.isEmpty()) {
                Text(
                    "No hay impresoras emparejadas. Empareja la impresora en Ajustes de Android.",
                    style = MaterialTheme.typography.bodyMedium
                )
            } else {
                paired.forEach { device ->
                    val selected = device.address.equals(printerMac, ignoreCase = true)
                    Card(
                        modifier = Modifier
                            .fillMaxWidth()
                            .padding(vertical = 2.dp)
                    ) {
                        Row(
                            modifier = Modifier
                                .fillMaxWidth()
                                .padding(12.dp),
                            verticalAlignment = Alignment.CenterVertically
                        ) {
                            Column(modifier = Modifier.weight(1f)) {
                                Text(device.displayName(), style = MaterialTheme.typography.titleSmall)
                                Text(device.address, style = MaterialTheme.typography.bodySmall)
                            }
                            if (selected) {
                                Text("Seleccionada", style = MaterialTheme.typography.labelMedium)
                            } else {
                                TextButton(onClick = { printerMac = device.address }) { Text("Usar") }
                            }
                        }
                    }
                }
            }

            Spacer(Modifier.height(4.dp))

            Row(
                modifier = Modifier.fillMaxWidth(),
                verticalAlignment = Alignment.CenterVertically
            ) {
                Column(modifier = Modifier.weight(1f)) {
                    Text("Auto-impresión", style = MaterialTheme.typography.titleMedium)
                    Text(
                        "Consulta la cola e imprime pedidos confirmados",
                        style = MaterialTheme.typography.bodySmall
                    )
                }
                Switch(
                    checked = pollingEnabled,
                    enabled = loaded,
                    onCheckedChange = { enabled ->
                        if (enabled && Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
                            notificationPermissionLauncher.launch(Manifest.permission.POST_NOTIFICATIONS)
                        } else {
                            applyPolling(enabled)
                        }
                    }
                )
            }

            Button(
                onClick = {
                    scope.launch {
                        store.save(currentSettings())
                        snackbarHostState.showSnackbar("Ajustes guardados")
                    }
                },
                enabled = loaded,
                modifier = Modifier.fillMaxWidth()
            ) { Text("Guardar") }

            OutlinedButton(
                onClick = {
                    scope.launch { store.save(currentSettings()) }
                    enqueueTestPrint(remindEnablePolling = true)
                },
                enabled = loaded,
                modifier = Modifier.fillMaxWidth()
            ) { Text("Probar conexión (imprime CONEXIÓN LISTA)") }
        }
    }
}
