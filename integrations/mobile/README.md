# Suntec+ app integration kits (Play & Win WebView)

Play & Win opens **inside the existing Suntec+ app** as a WebView. The app's code changes are small: one menu entry, one backend call and a message listener. The Suntec+ app's existing loyalty features stay untouched.

```
Member taps "Play & Win" in the Suntec+ app
  → app asks ITS OWN backend for a Play & Win link (the member is already signed in to Suntec+)
  → Suntec+ backend: POST https://<play-host>/api/v1/integrations/sessions   (X-API-Key, scope sessions:write)
       { "member_id": "SUN-00010001", "entry": "home", "profile": { "first_name": "…", "tier": "gold", … } }
     ← { "url": "https://<play-host>/api/v1/auth/exchange?code=…", "expires_at": "…" }   (single use, 60 s)
  → app opens `url` in a WebView → member is signed in → lands on /embed
```

The API key **never ships in the app**: only the Suntec+ backend calls `/integrations/sessions`.

## Entry points (`entry`)

`home` · `missions` · `rewards` · `badges` · `leaderboard` · `inbox` · `checkin`, or `spin` / `scratch` / `quiz` plus `game_id` to open a specific game. This lets push-notification deep links such as `suntecplus://play/rewards` open the correct screen.

## Messages from the WebView to the app

The page posts JSON messages `{ "source": "suntec-play", "type": "...", "data": {...} }` through whichever channel the platform provides:

| Platform | Channel the page calls |
|---|---|
| iOS WKWebView | `window.webkit.messageHandlers.suntecPlay.postMessage(msg)` |
| Android WebView | `window.SuntecPlayAndroid.postMessage(JSON.stringify(msg))` |
| React Native (`react-native-webview`) | `window.ReactNativeWebView.postMessage(JSON.stringify(msg))` |
| Flutter (`webview_flutter`) | `SuntecPlayFlutter.postMessage(JSON.stringify(msg))` |

| `type` | When | Suggested native action |
|---|---|---|
| `ready` | each screen loaded | hide the native spinner |
| `close` | user taps ✕ on the Play & Win home screen | close the WebView |
| `haptic` | spin, win, error (`data.kind` = light / success / warning) | trigger haptic feedback |
| `reward_won` | prize won (`data.reward`, `data.type`, `data.ref`) | optional: analytics event or refresh the points badge |
| `balance_changed` | Play Points changed | optional: refresh the home tile (`GET /integrations/members/{id}/summary`) |

## WebView requirements

* JavaScript and DOM storage enabled. Cookies enabled; on Android also allow **third-party cookies** for the Play & Win host.
* Allow camera access (QR scanning) if the app grants it to the WebView. Without it, members can type the code instead.
* Keep navigation inside the WebView for the Play & Win host. Open any other host in the system browser.
* Set `EMBED_FRAME_ANCESTORS` on the server only if you embed in an iframe on the web. Native WebViews load `/embed` as the top-level page.

## Kits

* [`ios/PlayWinViewController.swift`](ios/PlayWinViewController.swift): UIKit and WKWebView
* [`android/PlayWinActivity.kt`](android/PlayWinActivity.kt): Kotlin and WebView
* [`react-native/PlayWinScreen.tsx`](react-native/PlayWinScreen.tsx): `react-native-webview`
* [`flutter/play_win_page.dart`](flutter/play_win_page.dart): `webview_flutter`
* [`backend/create-session.http`](backend/create-session.http): the server-to-server calls (sessions, events, attempts)
