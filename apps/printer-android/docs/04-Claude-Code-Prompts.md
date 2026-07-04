# Claude Code Prompts — copy-paste in order

Run `claude` inside the project folder. After each prompt, build/test before moving to the next. Don't feed it two prompts at once — verify, then proceed.

---

## Step 0 — HUMAN TASK, before any prompt: confirm ESC/POS

No datasheet exists for the AOMU My-A1, so the whole plan rests on one unverified assumption: that it speaks **ESC/POS**. Verify it now, not after five screens are built:

1. Power on the printer holding the FEED button → it prints a **self-test page**.
2. Look for "ESC/POS" (often listed as "Command" or "Emulation"). Also note **chars per line** (32 = 58mm, 48 = 80mm) and **charset/code page** — you'll need both in Prompt 2.
3. Cross-check: install any generic "Bluetooth Print" ESC/POS app from the Play Store and print a line.

✅ Self-test says ESC/POS and the test app prints → proceed to Prompt 1.
❌ It says TSPL, CPCL, or the test app prints garbage → **stop; the library and command set in docs/02-Architecture.md must be swapped before any coding.**

## Prompt 1 — Ground rules + project scaffold

```
Read all files in docs/ first. Then:
1. Create a CLAUDE.md at the project root summarizing the rules from
   docs/02-Architecture.md: Kotlin, Jetpack Compose, MVVM single-Activity,
   min SDK 26, all Bluetooth I/O on Dispatchers.IO, UI never touches
   Bluetooth APIs directly, connection state via StateFlow<ConnectionState>.
2. Scaffold the Android project per Steps 1-2 of docs/03-Getting-Started.md:
   Gradle files with Compose and the DantSu ESCPOS-ThermalPrinter-Android
   library (JitPack repo, check the repo for the latest version), and the
   AndroidManifest with the exact Bluetooth permissions from the guide.
Do not write any screens or ViewModels yet. When done, verify the project
compiles with gradlew assembleDebug and fix any build errors.
```

**Verify:** build succeeds.

## Prompt 2 — Hardware spike (prove printing works)

```
Implement Step 3 of docs/03-Getting-Started.md as a minimal spike:
a single screen with one "Print Test" button that requests
BLUETOOTH_CONNECT/SCAN at runtime, connects to the first paired printer,
prints the sample receipt, and cuts. Use the DantSu library
(printFormattedTextAndCut). All I/O on Dispatchers.IO. Use the
chars-per-line and charset values I give you from the printer's self-test
page: chars-per-line = <FILL IN: 32 or 48>, charset = <FILL IN, e.g. CP437>.
Show a Toast or Snackbar with success or the exception message. Keep it in
MainActivity for now — this is throwaway code to validate the printer.
```

**Verify on hardware:** install on your phone (Prompt 7 shows how), pair the My-A1, tap Print Test. This is the checkpoint that proves the ESC/POS assumption from Step 0 end-to-end: text formatted correctly AND the cut fires. Garbled output = wrong charset or wrong protocol — go back to Step 0 before touching the prompt again. **Do not continue until this prints and cuts.**

## Prompt 3 — State model + data layer

```
The spike works. Now build the real data layer per docs/02-Architecture.md:
1. ConnectionState sealed class: Disconnected, Connecting, Connected(device),
   Error(message).
2. BluetoothRepository: list paired devices, connect (cancelDiscovery first,
   SPP UUID), disconnect. Wrap IOException into ConnectionState.Error.
3. EscPosPrinterService: wraps the DantSu library; takes a Receipt data class
   (header, list of line items with name/qty/price, total, footer) and
   produces the formatted print string; separate cut() function.
4. PrinterViewModel exposing StateFlow<ConnectionState>, with connect/
   disconnect/print/cut functions. Close the socket in onCleared().
Unit-test the receipt-formatting logic (plain JUnit, no device needed).
Keep the spike screen working. Run the tests and the build.
```

**Verify:** `gradlew test` passes, build succeeds.

## Prompt 4 — Printer list screen

```
Build PrinterListScreen per FR-1..FR-4 in docs/01-BRD-Flowchart.md and the
flowchart: permission request with a rationale screen if denied, prompt to
enable Bluetooth if off, list of paired devices, tap to connect showing
Connecting state, error with Retry on failure, navigate to ReceiptScreen
on Connected. Wire it to PrinterViewModel. Replace the spike screen's role
as launcher; keep navigation with androidx.navigation.compose. Build it.
```

**Verify on phone:** list shows My-A1, connect/disconnect works, airplane-test the error path (printer off → Retry appears).

## Prompt 5 — Receipt screen + cut

```
Build ReceiptScreen per FR-5..FR-7: a simple receipt composer (store name,
line items with add/remove, auto total, footer), a text preview matching
the printer's chars-per-line, a Print button (prints AND cuts, with feed
before cut) and a separate "Cut paper" button. Handle mid-print
disconnect: map to Error state, offer one auto-reconnect then a Retry
button, per docs/02-Architecture.md section 4. Build it.
```

**Verify on phone:** full flow — compose receipt, print, cut, pull printer power mid-print and confirm the app recovers without crashing.

## Prompt 6 — Hardening pass

```
Run through the test checklist in Step 5 of docs/03-Getting-Started.md and
the acceptance criteria in docs/01-BRD-Flowchart.md section 7. For each
item, tell me whether the current code handles it; fix what doesn't
(rotation during print must not drop state, denied permissions show
rationale, accented characters print correctly - set an explicit charset).
Remove the leftover spike code. Then run lint and the unit tests.
```

**Verify:** walk the checklist yourself on the phone.

## Prompt 7 — Build the APK for your phone

```
Build a release-ready debug APK: run gradlew assembleDebug, confirm it
succeeds, and tell me the exact path of the generated APK. Also add a
short "Install" section to README.md explaining both install methods:
adb install and manual file transfer.
```

Then get it onto the phone (either way works):

**Option A — USB + adb** (best during development):
1. On the phone: Settings → About → tap "Build number" 7× → enable Developer options → USB debugging.
2. `adb install -r app\build\outputs\apk\debug\app-debug.apk`

**Option B — file transfer:** copy `app-debug.apk` to the phone (USB/Drive/email), open it, allow "Install unknown apps" when prompted.

> Note: a debug APK is fine for your own device. Only if you later distribute it (Play Store etc.) do you need a signed release build — that's a separate step with a keystore.

---

## Prompt 8 — Ticket header with logo (v1.1)

```
Add a customizable ticket header. Requirements:

1. Extend the Receipt model with an optional header block: a logo image
   and/or up to 2 free-text header lines (keep the existing store name).
2. ReceiptScreen: add a "Header" section above the line items — a tappable
   placeholder ("Add logo") that opens the Android photo picker
   (ActivityResultContracts.PickVisualMedia, no storage permission needed),
   shows a thumbnail once selected, with a remove (X) button, plus the two
   optional text line fields.
3. Printing: use DantSu's <img> tag with
   PrinterTextParserImg.bitmapToHexadecimalString(printer, bitmap).
   Before printing, process the bitmap in EscPosPrinterService (NOT in a
   composable, per CLAUDE.md layer rules): downscale to the printer's dot
   width (32 chars/58mm → 384 px; 48 chars/80mm → 576 px, derive from the
   existing PrinterConfig constant), convert to 1-bit black/white with a
   simple threshold, center it. If the image is taller than 256 px, split
   it into horizontal slices and print them sequentially — tall bitmaps
   overflow the buffer on cheap printers.
4. Persist the logo: copy the picked image bytes to app-internal storage
   (filesDir) so it survives restarts — do NOT persist the gallery URI.
5. Preview shows the logo thumbnail and header lines above the text preview.
6. Unit-test the scaling/slicing math (plain JUnit). Build with
   gradlew assembleDebug.
```

**Verify on hardware:** pick a high-contrast logo, print. Expect a few seconds' delay (bitmaps are slow over SPP). Black box or garbage output → report it; threshold/slicing is the first suspect. Photos print poorly on thermal paper — use simple black-on-white logos.

## If Claude Code goes off the rails
- "That violates CLAUDE.md — Bluetooth I/O must be on Dispatchers.IO. Fix it."
- "You skipped the verify step. Run gradlew assembleDebug and show me the result."
- "Revert that; re-read docs/02-Architecture.md section 2 and follow the layer rules."
