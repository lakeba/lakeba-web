# Lex — the boardroom tablet app (Android)

The tablet at the board table: it records directors' meetings with the portal's Observer, Lex answers
aloud with its face, and decks are presented — all in the portal. The app is a thin, locked-down window
onto the portal's `/tablet` page; everything it may reach is decided by the portal.

## How a meeting starts

1. The tablet shows a six-digit code (it changes every 5 minutes).
2. The company secretary, signed in to the portal with two-step, opens the meeting
   (**Admin → Boardroom → the meeting**) and enters the code under **Connect a tablet**.
3. The tablet opens that meeting's Observer at once. Nobody signs in on the tablet: it acts for the
   secretary who connected it, on that meeting only (portal: `src/lib/tablets.ts`).
4. When the meeting is finished, disconnected on its page, or after 12 hours, the tablet lets go and
   shows a new code. Nothing from the meeting stays on the tablet.

The same works in any browser at `<portal>/tablet`; the app adds:

- full screen, always awake, Back does nothing;
- the microphone for the portal's own pages only (Android asks once);
- Lex's voice and face play without a tap;
- a "Can't reach the portal" screen that reloads by itself when the network returns;
- kiosk mode on a dedicated tablet (below);
- only the portal's address opens in it.

**Settings:** tap the top-right corner five times within three seconds: the portal address, the
tablet's name (shown on the meeting page) and, in kiosk mode, Lock / Unlock.

## Builds

| Build | App | Opens |
|---|---|---|
| `debug` | "Lex (staging)", `com.lakeba.lex.staging` | `https://giuseppe-macbook-pro.tail21d16f.ts.net` (the tablet needs Tailscale) |
| `release` | "Lex", `com.lakeba.lex` | `https://investors.lakeba.com` |

Both can be installed side by side.

```bash
export JAVA_HOME=/opt/homebrew/opt/openjdk@17 ANDROID_HOME=$HOME/Library/Android/sdk
./gradlew assembleDebug        # app/build/outputs/apk/debug/app-debug.apk
./gradlew assembleRelease      # needs a signing key first (below)
```

Tools on the Mac (installed 29 October 2026): Homebrew `openjdk@17`, `android-commandlinetools`, the SDK
in `~/Library/Android/sdk` (platform 35, build tools 35, emulator, `system-images;android-35;google_apis;arm64-v8a`).
The project pins Gradle 8.10.2 (wrapper), Android Gradle Plugin 8.7.3 and Kotlin 2.0.21; no other libraries.

**Release signing:** make a key once and keep it safe (Google Play and updates need the same key):
`keytool -genkeypair -v -keystore ~/.lakeba/lex-release.jks -alias lex -keyalg RSA -keysize 4096 -validity 10000`,
then add a `signingConfigs` block reading its passwords from `~/.gradle/gradle.properties`. Never commit the key.

## Installing on a tablet

- **From the Mac:** enable Developer options and USB debugging on the tablet, plug it in, then
  `adb install -r app/build/outputs/apk/debug/app-debug.apk`.
- **Without a cable:** copy the APK to the tablet (email, Drive), open it, and allow "Install unknown apps"
  for the app that opens it.
- For staging, install Tailscale on the tablet and sign in to Lakeba's tailnet.

## Kiosk mode (a dedicated boardroom tablet)

On a tablet that has been factory reset and has **no Google account added yet**:

```bash
adb install -r app-release.apk
adb shell dpm set-device-owner com.lakeba.lex/.LexDeviceAdmin
```

Lex then locks the tablet to itself (no home screen, notifications or other apps) and can be its home
app, so it opens when the tablet starts. Unlock from the settings (five taps, top-right). To undo:
factory reset, or `adb shell dpm remove-active-admin com.lakeba.lex/.LexDeviceAdmin` while unlocked.
Without device owner, choose Lex as the home app in Android's settings and use screen pinning.

## Tests

- **Portal, pairing** (staging, 29 October 2026): 25 of 25 — codes, connecting and disconnecting, the
  tablet reaching only its meeting's Observer, audit entries "via tablet", finishing lets the tablet
  go, 10 wrong codes stop.
- **App on the emulator** (Pixel Tablet, Android 15, against staging over Tailscale): the code shows,
  the secretary connects it from the meeting page, the Observer opens by itself in tablet mode, recording
  starts with the microphone and Simli's face, the meeting finishes, the tablet lets go and shows a new
  code. The emulator has no working microphone on this Mac (headless), so audio reaching the portal is
  checked on a real device.

## Later

- On-device "Lex" wake word (instant, works offline).
- Audio kept on the tablet while the network is down, sent when it returns.
- Google Play (needs a Google developer account) or managed distribution to Lakeba's tablets.
