# macOS build notes

- Builds: Apple silicon (`aarch64-apple-darwin`) and Intel (`x86_64-apple-darwin`) `.dmg`, produced by CI (`.github/workflows/build.yml`). macOS cannot be built on Windows.
- Native behaviour: app menu (About, Settings Cmd+,, Hide, Quit Cmd+Q), no `&` mnemonics, Cmd shortcuts, minimum macOS 11.
- Hardened runtime + `src-tauri/Entitlements.plist` are on, as notarization requires. Without an Apple Developer ID the app is only ad-hoc signed: first launch needs right-click, Open.
- To notarize, add repository secrets `APPLE_CERTIFICATE`, `APPLE_CERTIFICATE_PASSWORD`, `APPLE_SIGNING_IDENTITY`, `APPLE_ID`, `APPLE_PASSWORD`, `APPLE_TEAM_ID` (Tauri reads them).
- NOT checked: anything on a real Mac (launch, menus, draft movie, EffectCraft detection under /Applications).
