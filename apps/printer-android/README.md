# Printer-Android

Android app to list Bluetooth printers, connect to an AOMU My-A1 thermal ticket
printer over Bluetooth Classic (SPP), compose and print ESC/POS receipts, and
trigger the paper cutter.

- **Stack:** Kotlin, Jetpack Compose, single-Activity MVVM, Coroutines + `StateFlow`
- **Min Android:** 8.0 (API 26)
- **ESC/POS:** [DantSu/ESCPOS-ThermalPrinter-Android](https://github.com/DantSu/ESCPOS-ThermalPrinter-Android)

See `docs/` for the requirements, architecture, and build notes.

## Build

Windows (from the project root):

```
gradlew assembleDebug
```

The generated APK is written to:

```
app\build\outputs\apk\debug\app-debug.apk
```

Other useful tasks: `gradlew test` (unit tests), `gradlew lintDebug` (lint).

## Install

A **debug** APK is fine for your own device. (Distribution via the Play Store
would require a signed *release* build with a keystore — a separate step.)

First, on the phone, pair the My-A1 in **Settings → Bluetooth** (PIN is usually
`0000` or `1234`).

### Method A — USB + adb (best during development)

1. On the phone: **Settings → About phone** → tap **Build number** 7× to enable
   Developer options, then turn on **USB debugging**.
2. Connect the phone by USB and accept the debugging prompt.
3. Install (the `-r` flag reinstalls over an existing copy, keeping data):

   ```
   adb install -r app\build\outputs\apk\debug\app-debug.apk
   ```

### Method B — manual file transfer (no cable/adb)

1. Copy `app\build\outputs\apk\debug\app-debug.apk` to the phone (USB drag-and-drop,
   Google Drive, email to yourself, etc.).
2. On the phone, open the file with a file manager.
3. When prompted, allow **Install unknown apps** for the app you're installing from,
   then confirm the install.

## Using it

1. Launch the app and grant the Bluetooth permissions when asked.
2. Pick the My-A1 from the paired-devices list to connect.
3. Compose a receipt (store name, items, footer), watch the preview, then
   **Print** (prints and cuts) or use **Cut paper** on its own.
