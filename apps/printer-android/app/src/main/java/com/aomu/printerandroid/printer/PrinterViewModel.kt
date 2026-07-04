package com.aomu.printerandroid.printer

import android.bluetooth.BluetoothDevice
import android.bluetooth.BluetoothManager
import android.content.Context
import android.net.Uri
import androidx.lifecycle.ViewModel
import androidx.lifecycle.ViewModelProvider
import androidx.lifecycle.viewModelScope
import androidx.lifecycle.viewmodel.initializer
import androidx.lifecycle.viewmodel.viewModelFactory
import com.dantsu.escposprinter.connection.DeviceConnection
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.MutableSharedFlow
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.SharedFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asSharedFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext

/**
 * The one place the UI talks to. Exposes:
 *  - [state]: single StateFlow<ConnectionState>
 *  - [messages]: one-shot transient feedback for Snackbars
 *  - [draft]: the editable receipt (held here so it survives rotation, nav, and reconnects)
 *
 * Connection is connect-per-job: each print/cut opens a fresh SPP socket and
 * closes it (the pattern proven on the hardware). A failed job is retried once
 * after a short delay (auto-reprint), then surfaces Error + Retry. [busy] is
 * true while a job runs so the UI can block overlapping taps and show progress.
 */
class PrinterViewModel(
    private val repository: BluetoothRepository,
    private val logoStore: LogoStore,
    private val printerService: EscPosPrinterService = EscPosPrinterService()
) : ViewModel() {

    private val _state = MutableStateFlow<ConnectionState>(ConnectionState.Disconnected)
    val state: StateFlow<ConnectionState> = _state.asStateFlow()

    private val _messages = MutableSharedFlow<String>(extraBufferCapacity = 8)
    val messages: SharedFlow<String> = _messages.asSharedFlow()

    private val _draft = MutableStateFlow(ReceiptDraft())
    val draft: StateFlow<ReceiptDraft> = _draft.asStateFlow()

    /** True while a print/cut job is running — UI disables actions and shows progress. */
    private val _busy = MutableStateFlow(false)
    val busy: StateFlow<Boolean> = _busy.asStateFlow()

    /** Last device connected to (for auto-reconnect) and last action (for Retry). */
    private var lastDevice: BluetoothDevice? = null
    private var lastAction: (() -> Unit)? = null

    init {
        // Restore a previously saved logo so it survives app restarts.
        logoStore.existingPath()?.let { path -> _draft.update { it.copy(logoPath = path) } }
    }

    val isBluetoothEnabled: Boolean get() = repository.isBluetoothEnabled

    fun pairedDevices(): List<BluetoothDevice> = repository.pairedDevices()

    // ---- Receipt draft editing ----
    fun setStoreName(value: String) = _draft.update { it.copy(storeName = value) }
    fun setFooter(value: String) = _draft.update { it.copy(footer = value) }
    fun setHeaderLine1(value: String) = _draft.update { it.copy(headerLine1 = value) }
    fun setHeaderLine2(value: String) = _draft.update { it.copy(headerLine2 = value) }
    fun addItem() = _draft.update { it.copy(items = it.items + ItemDraft()) }

    // ---- Logo ----
    /** Picked from the photo picker: persist the bytes to filesDir, keep the path. */
    fun onLogoPicked(uri: Uri) {
        viewModelScope.launch {
            val path = logoStore.save(uri)
            if (path != null) {
                _draft.update { it.copy(logoPath = path) }
                _messages.tryEmit("Logo added")
            } else {
                _messages.tryEmit("Couldn't load that image")
            }
        }
    }

    fun removeLogo() {
        logoStore.delete()
        _draft.update { it.copy(logoPath = null) }
    }

    fun removeItem(index: Int) = _draft.update { draft ->
        if (index in draft.items.indices) {
            draft.copy(items = draft.items.toMutableList().also { it.removeAt(index) })
        } else {
            draft
        }
    }

    fun setItem(index: Int, item: ItemDraft) = _draft.update { draft ->
        if (index in draft.items.indices) {
            draft.copy(items = draft.items.toMutableList().also { it[index] = item })
        } else {
            draft
        }
    }

    // ---- Connection ----
    fun connect(device: BluetoothDevice) {
        lastDevice = device
        lastAction = null
        _state.value = ConnectionState.Connecting
        viewModelScope.launch {
            _state.value = try {
                repository.connect(device)
                ConnectionState.Connected(device)
            } catch (e: Exception) {
                // IOException (surfaced by DantSu as EscPosConnectionException) etc.
                repository.disconnect()
                ConnectionState.Error(e.message ?: "Connection failed")
            }
        }
    }

    fun disconnect() {
        lastAction = null
        viewModelScope.launch {
            withContext(Dispatchers.IO) { repository.disconnect() }
            _state.value = ConnectionState.Disconnected
        }
    }

    /** Retry the last failed action (print/cut), or reconnect if there was none. */
    fun retry() {
        val action = lastAction
        if (action != null) action() else lastDevice?.let { connect(it) }
    }

    // ---- Print / cut ----
    fun print() {
        lastAction = ::print
        val receipt = _draft.value.toReceipt()
        executeJob(success = "Printed & cut", failure = "Print failed") {
            printerService.print(it, receipt)
        }
    }

    fun cut() {
        lastAction = ::cut
        executeJob(success = "Paper cut", failure = "Cut failed") {
            printerService.cut(it)
        }
    }

    /**
     * Runs a printer job connect-per-job. Each attempt opens a fresh connection
     * (via repository.runJob), so a failure is auto-recovered by simply retrying
     * ONCE — attempt 2 reconnects and re-sends (auto-reprint). If it still fails,
     * surface Error + Retry. docs/02-Architecture.md §4.
     */
    private fun executeJob(
        success: String,
        failure: String,
        block: (DeviceConnection) -> Unit
    ) {
        if (_busy.value) return // a job is already running — ignore overlapping taps
        _busy.value = true
        viewModelScope.launch {
            try {
                var attempt = 0
                while (true) {
                    attempt++
                    try {
                        repository.runJob(block)
                        _messages.tryEmit(success)
                        lastDevice?.let {
                            if (_state.value !is ConnectionState.Connected) {
                                _state.value = ConnectionState.Connected(it)
                            }
                        }
                        return@launch
                    } catch (e: Exception) {
                        if (attempt >= MAX_PRINT_ATTEMPTS) {
                            _state.value = ConnectionState.Error(
                                "$failure. Turn the printer on, then tap Retry."
                            )
                            return@launch
                        }
                        // Wait for the printer to come back before re-sending.
                        _messages.tryEmit("$failure — retrying…")
                        delay(RETRY_DELAY_MS)
                    }
                }
            } finally {
                _busy.value = false
            }
        }
    }

    override fun onCleared() {
        super.onCleared()
        // Close the socket when the ViewModel dies (docs/02-Architecture.md §4).
        repository.disconnect()
    }

    companion object {
        /** Total print attempts before giving up: 1 initial + 1 auto-retry. */
        private const val MAX_PRINT_ATTEMPTS = 2

        /** Pause before the auto-retry, giving a briefly-interrupted printer time to return. */
        private const val RETRY_DELAY_MS = 2000L

        fun factory(context: Context): ViewModelProvider.Factory {
            val appContext = context.applicationContext
            return viewModelFactory {
                initializer {
                    val manager = appContext.getSystemService(BluetoothManager::class.java)
                    PrinterViewModel(
                        repository = BluetoothRepository(manager?.adapter),
                        logoStore = LogoStore(appContext)
                    )
                }
            }
        }
    }
}
