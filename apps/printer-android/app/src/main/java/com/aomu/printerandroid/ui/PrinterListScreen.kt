package com.aomu.printerandroid.ui

import android.bluetooth.BluetoothAdapter
import android.bluetooth.BluetoothDevice
import android.content.Intent
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.material3.Button
import androidx.compose.material3.Card
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.TopAppBar
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import com.aomu.printerandroid.printer.ConnectionState
import com.aomu.printerandroid.printer.PrinterViewModel

/**
 * FR-1..FR-4 + the flowchart's front half: request permissions (rationale if
 * denied), prompt to enable Bluetooth if off, list paired devices, tap to
 * connect (Connecting shown), and Error with Retry. Navigation to the receipt
 * screen on Connected is handled centrally in [PrinterApp].
 */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun PrinterListScreen(
    state: ConnectionState,
    viewModel: PrinterViewModel,
    onOpenApiSettings: () -> Unit = {}
) {
    val context = LocalContext.current

    var hasPermissions by remember { mutableStateOf(hasBluetoothPermissions(context)) }
    var permissionsRequested by remember { mutableStateOf(false) }
    var btEnabled by remember { mutableStateOf(viewModel.isBluetoothEnabled) }
    var devices by remember { mutableStateOf<List<BluetoothDevice>>(emptyList()) }
    var selectedDevice by remember { mutableStateOf<BluetoothDevice?>(null) }

    val permissionLauncher = rememberLauncherForActivityResult(
        ActivityResultContracts.RequestMultiplePermissions()
    ) {
        permissionsRequested = true
        hasPermissions = hasBluetoothPermissions(context)
        btEnabled = viewModel.isBluetoothEnabled
    }

    val enableBtLauncher = rememberLauncherForActivityResult(
        ActivityResultContracts.StartActivityForResult()
    ) {
        btEnabled = viewModel.isBluetoothEnabled
    }

    // Ask for permissions once on entry.
    LaunchedEffect(Unit) {
        if (!hasPermissions) {
            val needed = requiredBluetoothPermissions()
            if (needed.isEmpty()) hasPermissions = true else permissionLauncher.launch(needed.toTypedArray())
        }
    }

    // (Re)load paired devices whenever we're allowed to see them.
    LaunchedEffect(hasPermissions, btEnabled) {
        if (hasPermissions && btEnabled) devices = viewModel.pairedDevices()
    }

    Scaffold(
        topBar = {
            TopAppBar(
                title = { Text("Select printer") },
                actions = {
                    TextButton(onClick = onOpenApiSettings) { Text("Configuración") }
                }
            )
        }
    ) { padding ->
        Box(
            modifier = Modifier
                .fillMaxSize()
                .padding(padding)
        ) {
            when {
                !hasPermissions -> PermissionRationale(
                    denied = permissionsRequested,
                    onRequest = {
                        val needed = requiredBluetoothPermissions()
                        if (needed.isNotEmpty()) permissionLauncher.launch(needed.toTypedArray())
                    },
                    onOpenSettings = { context.openAppSettings() }
                )

                !btEnabled -> EnableBluetoothPrompt(
                    onEnable = { enableBtLauncher.launch(Intent(BluetoothAdapter.ACTION_REQUEST_ENABLE)) }
                )

                else -> DeviceListContent(
                    state = state,
                    devices = devices,
                    selectedDevice = selectedDevice,
                    onConnect = { device ->
                        selectedDevice = device
                        viewModel.connect(device)
                    },
                    onRetry = { viewModel.retry() },
                    onRefresh = { devices = viewModel.pairedDevices() }
                )
            }
        }
    }
}

@Composable
private fun DeviceListContent(
    state: ConnectionState,
    devices: List<BluetoothDevice>,
    selectedDevice: BluetoothDevice?,
    onConnect: (BluetoothDevice) -> Unit,
    onRetry: () -> Unit,
    onRefresh: () -> Unit
) {
    val connecting = state is ConnectionState.Connecting

    Column(modifier = Modifier.fillMaxSize().padding(16.dp)) {
        when (state) {
            is ConnectionState.Connecting -> StatusBanner(
                message = "Connecting to ${selectedDevice?.displayName() ?: "printer"}…",
                showSpinner = true
            )

            is ConnectionState.Error -> ErrorBanner(message = state.message, onRetry = onRetry)

            else -> { /* Disconnected / Connected: no banner */ }
        }

        Row(
            modifier = Modifier.fillMaxWidth(),
            verticalAlignment = Alignment.CenterVertically
        ) {
            Text(
                text = "Paired printers",
                style = MaterialTheme.typography.titleMedium,
                modifier = Modifier.weight(1f)
            )
            TextButton(onClick = onRefresh) { Text("Refresh") }
        }

        Spacer(Modifier.height(8.dp))

        if (devices.isEmpty()) {
            Text(
                text = "No paired devices found.\nPair your printer in Android Settings, then tap Refresh.",
                style = MaterialTheme.typography.bodyMedium
            )
        } else {
            LazyColumn {
                items(devices) { device ->
                    DeviceRow(
                        name = device.displayName(),
                        address = device.address,
                        connecting = connecting && device == selectedDevice,
                        enabled = !connecting,
                        onClick = { onConnect(device) }
                    )
                }
            }
        }
    }
}

@Composable
private fun DeviceRow(
    name: String,
    address: String,
    connecting: Boolean,
    enabled: Boolean,
    onClick: () -> Unit
) {
    Card(
        modifier = Modifier
            .fillMaxWidth()
            .padding(vertical = 4.dp)
            .clickable(enabled = enabled, onClick = onClick)
    ) {
        Row(
            modifier = Modifier.fillMaxWidth().padding(16.dp),
            verticalAlignment = Alignment.CenterVertically
        ) {
            Column(modifier = Modifier.weight(1f)) {
                Text(name, style = MaterialTheme.typography.titleMedium)
                Text(address, style = MaterialTheme.typography.bodySmall)
            }
            if (connecting) {
                CircularProgressIndicator(modifier = Modifier.size(24.dp), strokeWidth = 2.dp)
            }
        }
    }
}

@Composable
private fun StatusBanner(message: String, showSpinner: Boolean) {
    Row(
        modifier = Modifier.fillMaxWidth().padding(bottom = 12.dp),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(12.dp)
    ) {
        if (showSpinner) CircularProgressIndicator(modifier = Modifier.size(20.dp), strokeWidth = 2.dp)
        Text(message, style = MaterialTheme.typography.bodyLarge)
    }
}

@Composable
private fun ErrorBanner(message: String, onRetry: () -> Unit) {
    Column(
        modifier = Modifier.fillMaxWidth().padding(bottom = 12.dp),
        verticalArrangement = Arrangement.spacedBy(8.dp)
    ) {
        Text(
            text = message,
            color = MaterialTheme.colorScheme.error,
            style = MaterialTheme.typography.bodyLarge
        )
        Button(onClick = onRetry) { Text("Retry") }
    }
}

@Composable
private fun PermissionRationale(
    denied: Boolean,
    onRequest: () -> Unit,
    onOpenSettings: () -> Unit
) {
    CenteredMessage(
        title = "Bluetooth permission required",
        body = "This app connects to a Bluetooth printer, so it can't do anything " +
            "without Bluetooth permission. Please grant it to continue."
    ) {
        Button(onClick = onRequest) { Text("Grant permission") }
        if (denied) {
            Spacer(Modifier.height(8.dp))
            TextButton(onClick = onOpenSettings) { Text("Open app settings") }
        }
    }
}

@Composable
private fun EnableBluetoothPrompt(onEnable: () -> Unit) {
    CenteredMessage(
        title = "Bluetooth is off",
        body = "Turn Bluetooth on to find and connect to your printer."
    ) {
        Button(onClick = onEnable) { Text("Enable Bluetooth") }
    }
}

@Composable
private fun CenteredMessage(
    title: String,
    body: String,
    actions: @Composable () -> Unit
) {
    Column(
        modifier = Modifier.fillMaxSize().padding(24.dp),
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.Center
    ) {
        Text(title, style = MaterialTheme.typography.headlineSmall, textAlign = TextAlign.Center)
        Spacer(Modifier.height(8.dp))
        Text(body, style = MaterialTheme.typography.bodyMedium, textAlign = TextAlign.Center)
        Spacer(Modifier.height(16.dp))
        actions()
    }
}
