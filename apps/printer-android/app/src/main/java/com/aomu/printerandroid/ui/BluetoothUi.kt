package com.aomu.printerandroid.ui

import android.Manifest
import android.annotation.SuppressLint
import android.bluetooth.BluetoothDevice
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.net.Uri
import android.os.Build
import android.provider.Settings
import androidx.core.content.ContextCompat

/**
 * Shared Bluetooth/permission helpers for the UI layer.
 * (The UI still never touches the socket — it only checks permissions and
 * reads device labels, both required to render the picker.)
 */

/** Runtime BT permissions needed on Android 12+ (API 31+); none below that. */
fun requiredBluetoothPermissions(): List<String> =
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
        listOf(Manifest.permission.BLUETOOTH_CONNECT, Manifest.permission.BLUETOOTH_SCAN)
    } else {
        emptyList()
    }

/** True when every required BT permission is already granted. */
fun hasBluetoothPermissions(context: Context): Boolean =
    requiredBluetoothPermissions().all {
        ContextCompat.checkSelfPermission(context, it) == PackageManager.PERMISSION_GRANTED
    }

/** Human-readable label for a device; falls back to MAC if the name is null. */
@SuppressLint("MissingPermission")
fun BluetoothDevice.displayName(): String = name ?: address

/** Opens this app's system settings page (for permanently-denied permissions). */
fun Context.openAppSettings() {
    startActivity(
        Intent(
            Settings.ACTION_APPLICATION_DETAILS_SETTINGS,
            Uri.fromParts("package", packageName, null)
        ).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
    )
}
