package com.aomu.printerandroid.printer

import android.bluetooth.BluetoothDevice

/**
 * Single source of truth for the printer connection status.
 *
 * Per docs/02-Architecture.md the whole app observes ONE StateFlow<ConnectionState>;
 * no booleans-and-flags. Both screens (added later) render off these four states.
 */
sealed interface ConnectionState {
    data object Disconnected : ConnectionState
    data object Connecting : ConnectionState
    data class Connected(val device: BluetoothDevice) : ConnectionState
    data class Error(val message: String) : ConnectionState
}
