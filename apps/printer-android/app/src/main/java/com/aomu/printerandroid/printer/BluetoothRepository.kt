package com.aomu.printerandroid.printer

import android.annotation.SuppressLint
import android.bluetooth.BluetoothAdapter
import android.bluetooth.BluetoothDevice
import com.dantsu.escposprinter.connection.DeviceConnection
import com.dantsu.escposprinter.connection.bluetooth.BluetoothConnection
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext

/**
 * Bluetooth access using the CONNECT-PER-JOB model that the Prompt 2 spike
 * proved works on this printer: open a fresh SPP connection for each job, then
 * close it. (A single long-lived socket was tried but printing over a reused
 * DantSu connection was unreliable — these printers drop the idle link and
 * socket.isConnected() keeps returning true, so writes silently fail.)
 *
 * "Connected" therefore means "this printer is selected and was reachable",
 * not "a socket is held open". All blocking I/O runs on Dispatchers.IO.
 */
class BluetoothRepository(
    private val adapter: BluetoothAdapter?
) {
    /** The printer the user picked and we verified reachable. */
    var selectedDevice: BluetoothDevice? = null
        private set

    val isBluetoothEnabled: Boolean
        get() = adapter?.isEnabled == true

    @SuppressLint("MissingPermission")
    fun pairedDevices(): List<BluetoothDevice> =
        adapter?.bondedDevices?.toList() ?: emptyList()

    /**
     * Verifies [device] is reachable by opening then immediately closing a
     * connection, and remembers it as the selected printer. Throws on failure
     * (the ViewModel maps it to ConnectionState.Error).
     */
    @SuppressLint("MissingPermission")
    suspend fun connect(device: BluetoothDevice) = withContext(Dispatchers.IO) {
        openConnection(device).disconnect()
        selectedDevice = device
    }

    /**
     * Opens a fresh connection to the selected device, runs [block] on it, and
     * always closes it — exactly connect → print → disconnect per job.
     */
    @SuppressLint("MissingPermission")
    suspend fun <T> runJob(block: (DeviceConnection) -> T): T = withContext(Dispatchers.IO) {
        val device = selectedDevice
            ?: throw IllegalStateException("No printer selected")
        runJob(device, block)
    }

    /**
     * Same connect-per-job model, but for callers that already know the device
     * and do not need to mutate [selectedDevice].
     */
    @SuppressLint("MissingPermission")
    suspend fun <T> runJob(device: BluetoothDevice, block: (DeviceConnection) -> T): T =
        withContext(Dispatchers.IO) {
            val connection = openConnection(device)
            try {
                block(connection)
            } finally {
                connection.disconnect()
            }
        }

    /** Cancels discovery (it kills connect attempts) then opens an SPP socket. */
    @SuppressLint("MissingPermission")
    private fun openConnection(device: BluetoothDevice): BluetoothConnection {
        adapter?.cancelDiscovery()
        return BluetoothConnection(device).apply { connect() }
    }

    /** Forget the selected printer. No persistent socket is held. */
    fun disconnect() {
        selectedDevice = null
    }

    companion object {
        /** Bluetooth Classic Serial Port Profile UUID (used by DantSu internally). */
        const val SPP_UUID = "00001101-0000-1000-8000-00805F9B34FB"
    }
}
