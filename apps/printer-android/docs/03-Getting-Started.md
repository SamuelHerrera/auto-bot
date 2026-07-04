# Getting Started — first line of code to first printed receipt

## Step 0 — Hardware sanity check (before any code)
1. Power on the My-A1, pair it in Android Settings → Bluetooth.
2. Print the self-test page (hold FEED while powering on). Note: chars per line, charset, whether it lists "ESC/POS".
3. Install any generic "Bluetooth Print" app from Play Store and print a test line. If that works, the printer is standard ESC/POS and everything below will work.

## Step 1 — Project setup
1. Android Studio → New Project → **Empty Activity (Compose)**, language Kotlin, min SDK 26.
2. Add the ESC/POS library. In `settings.gradle.kts` add JitPack, then in `app/build.gradle.kts`:

```kotlin
// settings.gradle.kts → dependencyResolutionManagement → repositories
maven(url = "https://jitpack.io")

// app/build.gradle.kts
implementation("com.github.DantSu:ESCPOS-ThermalPrinter-Android:3.5.0") // check repo for latest
```

## Step 2 — Manifest permissions

```xml
<!-- Android 12+ -->
<uses-permission android:name="android.permission.BLUETOOTH_CONNECT" />
<uses-permission android:name="android.permission.BLUETOOTH_SCAN"
    android:usesPermissionFlags="neverForLocation" />
<!-- Android 11 and below -->
<uses-permission android:name="android.permission.BLUETOOTH" android:maxSdkVersion="30" />
<uses-permission android:name="android.permission.BLUETOOTH_ADMIN" android:maxSdkVersion="30" />
```

Request `BLUETOOTH_CONNECT`/`BLUETOOTH_SCAN` at runtime (API 31+) with `rememberLauncherForActivityResult(RequestMultiplePermissions())`.

## Step 3 — Prove the pipe works (spike, ~30 lines)
Before building screens, print something. With the DantSu library:

```kotlin
// Runs on Dispatchers.IO — never the main thread
suspend fun printTest() = withContext(Dispatchers.IO) {
    val connection = BluetoothPrintersConnections.selectFirstPaired()
        ?: error("No paired printer found — pair the My-A1 first")

    // 203 dpi, 58mm→48f/32 chars ; 80mm→72f/48 chars (use self-test values)
    val printer = EscPosPrinter(connection, 203, 48f, 32)

    printer.printFormattedTextAndCut(
        """
        [C]<b>MY STORE</b>
        [C]--------------------------------
        [L]1x Coffee[R]3.50
        [L]1x Bagel[R]2.00
        [C]--------------------------------
        [L]<b>TOTAL</b>[R]<b>5.50</b>
        [C]Thank you!
        """.trimIndent()
    ) // ...AndCut appends feed + GS V cut automatically

    printer.disconnectPrinter()
}
```

If the library misbehaves with this printer, drop to raw bytes:

```kotlin
val socket = device.createRfcommSocketToServiceRecord(
    UUID.fromString("00001101-0000-1000-8000-00805F9B34FB"))
adapter.cancelDiscovery()
socket.connect()
socket.outputStream.run {
    write(byteArrayOf(0x1B, 0x40))                    // init
    write("Hello My-A1\n".toByteArray(Charsets.US_ASCII))
    write(byteArrayOf(0x1B, 0x64, 4))                 // feed 4 lines
    write(byteArrayOf(0x1D, 0x56, 0x42, 0x00))        // partial cut
    flush()
}
socket.close()
```

## Step 4 — Build the real app (order of work)
1. `ConnectionState` sealed class + `PrinterViewModel` with `StateFlow`.
2. `BluetoothRepository`: list paired devices (`adapter.bondedDevices`), connect/disconnect.
3. `PrinterListScreen`: device list → tap to connect → navigate on `Connected`.
4. `ReceiptScreen`: receipt form/preview, Print button, Cut button.
5. `EscPosPrinterService`: wraps the library; receipt model → formatted string.
6. Error paths: printer off, out of range, mid-print disconnect (test all three physically).

## Step 5 — Test checklist
Print while printer is off (expect clean error, no crash) · kill printer power mid-print · rotate device during print (state survives via ViewModel) · deny permissions (rationale shown) · print accented text · cut fires only after full receipt is out.

## Pitfalls (learned the hard way)
- Calling `socket.connect()` on the main thread → ANR. Always `Dispatchers.IO`.
- Forgetting `cancelDiscovery()` before connect → intermittent connect failures.
- Cutting without feeding first → cutter slices through the last printed lines.
- These generic printers often ship paired with PIN `0000` or `1234`.
