package com.aomu.printerandroid.ui

import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.PickVisualMediaRequest
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.Image
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Button
import androidx.compose.material3.Card
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Scaffold
import androidx.compose.material3.SnackbarHost
import androidx.compose.material3.SnackbarHostState
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.TopAppBar
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.produceState
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.ImageBitmap
import androidx.compose.ui.graphics.asImageBitmap
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.unit.dp
import com.aomu.printerandroid.printer.ConnectionState
import com.aomu.printerandroid.printer.ItemDraft
import com.aomu.printerandroid.printer.LogoImages
import com.aomu.printerandroid.printer.PrinterViewModel
import com.aomu.printerandroid.printer.ReceiptFormatter
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext

/**
 * FR-5..FR-7: compose a receipt (store name, add/remove items, auto total,
 * footer), preview it at the printer width, Print (prints AND cuts), and a
 * separate Cut paper button. The editable draft lives in the ViewModel, so it
 * survives rotation and mid-print reconnects. Recovery (auto-reconnect + reprint,
 * then Error + Retry) is handled in the ViewModel and reflected here.
 */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun ReceiptScreen(
    state: ConnectionState,
    viewModel: PrinterViewModel,
    onDisconnect: () -> Unit
) {
    val draft by viewModel.draft.collectAsState()
    val snackbarHostState = remember { SnackbarHostState() }
    LaunchedEffect(Unit) {
        viewModel.messages.collect { snackbarHostState.showSnackbar(it) }
    }

    val busy by viewModel.busy.collectAsState()

    // Android photo picker — no storage permission required.
    val pickLogo = rememberLauncherForActivityResult(
        ActivityResultContracts.PickVisualMedia()
    ) { uri -> uri?.let { viewModel.onLogoPicked(it) } }

    // Decode the persisted logo off the main thread for display (thumbnail + preview).
    val logoBitmap: ImageBitmap? by produceState<ImageBitmap?>(null, draft.logoPath) {
        val path = draft.logoPath
        value = if (path == null) {
            null
        } else {
            withContext(Dispatchers.IO) { LogoImages.decodeSampled(path, 240)?.asImageBitmap() }
        }
    }

    val receipt = draft.toReceipt()
    val connected = state is ConnectionState.Connected
    val connecting = state is ConnectionState.Connecting
    val error = state as? ConnectionState.Error

    Scaffold(
        topBar = {
            TopAppBar(
                title = { Text("Receipt") },
                actions = { TextButton(onClick = onDisconnect) { Text("Disconnect") } }
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
            if (busy || connecting) {
                Row(
                    verticalAlignment = Alignment.CenterVertically,
                    horizontalArrangement = Arrangement.spacedBy(12.dp)
                ) {
                    CircularProgressIndicator(Modifier.size(20.dp), strokeWidth = 2.dp)
                    Text(
                        if (busy) "Working…" else "Reconnecting…",
                        style = MaterialTheme.typography.bodyLarge
                    )
                }
            }
            error?.let {
                Text(
                    it.message,
                    color = MaterialTheme.colorScheme.error,
                    style = MaterialTheme.typography.bodyLarge
                )
                Button(onClick = { viewModel.retry() }, enabled = !busy) { Text("Retry") }
            }

            // --- Composer ---
            OutlinedTextField(
                value = draft.storeName,
                onValueChange = viewModel::setStoreName,
                label = { Text("Store name") },
                singleLine = true,
                modifier = Modifier.fillMaxWidth()
            )

            // --- Header (logo + optional text lines) ---
            Text("Header", style = MaterialTheme.typography.titleMedium)
            if (logoBitmap != null) {
                Row(
                    verticalAlignment = Alignment.CenterVertically,
                    horizontalArrangement = Arrangement.spacedBy(12.dp)
                ) {
                    Image(
                        bitmap = logoBitmap!!,
                        contentDescription = "Ticket logo",
                        modifier = Modifier.size(72.dp)
                    )
                    TextButton(onClick = viewModel::removeLogo) { Text("✕ Remove logo") }
                }
            } else {
                OutlinedButton(
                    onClick = {
                        pickLogo.launch(
                            PickVisualMediaRequest(ActivityResultContracts.PickVisualMedia.ImageOnly)
                        )
                    },
                    modifier = Modifier.fillMaxWidth()
                ) { Text("Add logo") }
            }
            OutlinedTextField(
                value = draft.headerLine1,
                onValueChange = viewModel::setHeaderLine1,
                label = { Text("Header line 1 (optional)") },
                singleLine = true,
                modifier = Modifier.fillMaxWidth()
            )
            OutlinedTextField(
                value = draft.headerLine2,
                onValueChange = viewModel::setHeaderLine2,
                label = { Text("Header line 2 (optional)") },
                singleLine = true,
                modifier = Modifier.fillMaxWidth()
            )

            Text("Items", style = MaterialTheme.typography.titleMedium)
            draft.items.forEachIndexed { index, item ->
                ItemRow(
                    item = item,
                    onChange = { viewModel.setItem(index, it) },
                    onRemove = { viewModel.removeItem(index) }
                )
            }
            OutlinedButton(
                onClick = viewModel::addItem,
                modifier = Modifier.fillMaxWidth()
            ) { Text("+ Add item") }

            Text(
                "Total: ${ReceiptFormatter.money(receipt.total)}",
                style = MaterialTheme.typography.titleMedium
            )

            OutlinedTextField(
                value = draft.footer,
                onValueChange = viewModel::setFooter,
                label = { Text("Footer") },
                singleLine = true,
                modifier = Modifier.fillMaxWidth()
            )

            // --- Preview (logo thumbnail + header lines + monospace body) ---
            Text("Preview", style = MaterialTheme.typography.titleMedium)
            Card(modifier = Modifier.fillMaxWidth()) {
                Column(
                    modifier = Modifier.fillMaxWidth().padding(12.dp),
                    horizontalAlignment = Alignment.CenterHorizontally
                ) {
                    logoBitmap?.let {
                        Image(
                            bitmap = it,
                            contentDescription = null,
                            modifier = Modifier.size(96.dp)
                        )
                        Spacer(Modifier.height(8.dp))
                    }
                    Text(
                        text = ReceiptFormatter.previewText(receipt),
                        fontFamily = FontFamily.Monospace,
                        style = MaterialTheme.typography.bodySmall,
                        modifier = Modifier
                            .fillMaxWidth()
                            .horizontalScroll(rememberScrollState())
                    )
                }
            }

            // --- Actions ---
            Row(
                modifier = Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.spacedBy(12.dp)
            ) {
                Button(
                    onClick = viewModel::print,
                    enabled = connected && draft.hasPrintableItems && !busy,
                    modifier = Modifier.weight(1f)
                ) { Text("Print") }
                OutlinedButton(
                    onClick = viewModel::cut,
                    enabled = connected && !busy,
                    modifier = Modifier.weight(1f)
                ) { Text("Cut paper") }
            }
            Spacer(Modifier.height(8.dp))
        }
    }
}

@Composable
private fun ItemRow(
    item: ItemDraft,
    onChange: (ItemDraft) -> Unit,
    onRemove: () -> Unit
) {
    Row(
        modifier = Modifier.fillMaxWidth(),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(8.dp)
    ) {
        OutlinedTextField(
            value = item.name,
            onValueChange = { onChange(item.copy(name = it)) },
            label = { Text("Name") },
            singleLine = true,
            modifier = Modifier.weight(1f)
        )
        OutlinedTextField(
            value = item.qty,
            onValueChange = { onChange(item.copy(qty = it.filter { c -> c.isDigit() })) },
            label = { Text("Qty") },
            singleLine = true,
            keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Number),
            modifier = Modifier.width(64.dp)
        )
        OutlinedTextField(
            value = item.price,
            onValueChange = { onChange(item.copy(price = it)) },
            label = { Text("Price") },
            singleLine = true,
            keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Decimal),
            modifier = Modifier.width(96.dp)
        )
        TextButton(onClick = onRemove) { Text("✕") }
    }
}
