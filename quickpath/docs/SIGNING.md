# Signing QuickPath (Windows and Mac)

Signing is what turns "Windows protected your PC / unknown publisher" and "macOS cannot verify this app" into a normal install. It needs an identity that **you** hold, bought in your name, so I cannot do the buying or the account setup. Everything else is already wired up: add the secrets below to GitHub and the next build signs itself.

## What is already done

- **Mac:** the hardened runtime is on, with the small set of permissions Electron itself needs (`build/entitlements.mac.plist`); notarisation is switched on and runs by itself once the Apple secrets exist. Both Apple Silicon and Intel disk images are built (`QuickPath_0.2.0_arm64.dmg`, `QuickPath_0.2.0_x64.dmg`). The Mac app has a proper first menu (About, Hide, Quit) and no duplicate Exit.
- **Windows:** the build signs the installer and the program when a certificate is supplied.
- **CI proves the app starts.** After each build the packaged app is started on Windows and on a Mac, loads its own page and checks the menu, the guides and the server (`QUICKPATH_SMOKE=1`). A Mac build that does not start fails the build.
- **Still unproven:** nobody has opened the Mac app on a real Mac. CI shows it starts; it does not show how it feels, or that Gatekeeper's first-run dialog is acceptable once signed.

## What you need to buy or set up

### Mac: Apple Developer Program (about $99 a year)

1. Join at developer.apple.com/programs (an individual account works; a company needs a D-U-N-S number and takes longer).
2. In Xcode or the developer site, create a **Developer ID Application** certificate and export it as a `.p12` file with a password.
3. Create an **app-specific password** at appleid.apple.com (for notarisation) and note your **Team ID** (developer site, Membership).
4. Turn the `.p12` into one line of text: on a Mac, `base64 -i certificate.p12 | pbcopy`.

GitHub secrets to add (repository Settings, Secrets and variables, Actions):

| Secret | Value |
|---|---|
| `MAC_CSC_LINK` | the base64 text of the `.p12` |
| `MAC_CSC_KEY_PASSWORD` | the `.p12` password |
| `APPLE_ID` | your Apple ID email |
| `APPLE_APP_SPECIFIC_PASSWORD` | the app-specific password |
| `APPLE_TEAM_ID` | the 10-character Team ID |

### Windows: one of these

- **Azure Artifact Signing** (formerly Trusted Signing), about $10 a month. Cheapest and gives immediate reputation, but Microsoft verifies the identity first and has limits on who qualifies (individuals only in some countries); check eligibility before relying on it. It needs a small build change (`azureSignOptions`) that I can add once you have an account.
- **An OV code-signing certificate** (about $100 to $300 a year) from a certificate authority. Since 2023 these live on a hardware token or a cloud service, so the file route below only works if the provider lets you export a `.pfx`; many do not. Windows SmartScreen still warns for a while until the program builds a reputation.
- **An EV certificate** (about $300 to $500 a year) gives the fastest SmartScreen trust, again on a token or cloud service.

If you get a `.pfx` file, the GitHub secrets are `WIN_CSC_LINK` (its base64 text, `base64 -w0 cert.pfx`, or in PowerShell `[Convert]::ToBase64String([IO.File]::ReadAllBytes("cert.pfx"))`) and `WIN_CSC_KEY_PASSWORD`.

## Until you have them

- **Windows:** the installer shows "unknown publisher". "More info", then "Run anyway" installs it.
- **Mac:** open the disk image, drag QuickPath to Applications, then the first time right-click it and choose Open. If macOS says the app is damaged, run `xattr -dr com.apple.quarantine /Applications/QuickPath.app` in Terminal once.

## How to check a signed build

- **Windows:** right-click the installer, Properties, Digital Signatures. Or `Get-AuthenticodeSignature .\QuickPath_0.2.0_x64-setup.exe` should say `Valid`.
- **Mac:** `codesign --verify --deep --strict --verbose=2 /Applications/QuickPath.app` and `spctl --assess --type execute --verbose /Applications/QuickPath.app` should say accepted, source Notarized Developer ID.

## Automatic updates (later)

Updates need signed builds first. After signing works, adding an update check is a small change (electron-updater reading the GitHub releases) and I can do it then.
