# Releasing and automatic updates

Installed copies of MotionCraft check GitHub for a newer signed release (Settings, Updates; off in offline mode) and offer
"Install and restart". Nothing installs without a click, and an update is only accepted if its signature verifies against the
public key in `src-tauri/tauri.conf.json`.

## One-time setup (the owner)

1. The signing key pair was created with `npx tauri signer generate`. The **private key is never in the repository**. Keep it at
   `C:\Users\eduni\.motioncraft-signing\motioncraft.key` and back it up: if it is lost, installed apps can never update again
   and must be reinstalled with a new public key.
2. Add it to GitHub as a repository secret (Settings, Secrets and variables, Actions): `TAURI_SIGNING_PRIVATE_KEY` (the file's
   contents). Add `TAURI_SIGNING_PRIVATE_KEY_PASSWORD` only if the key has a password (this one has none).

## Making a release

1. Bump the version in `package.json`, `src-tauri/tauri.conf.json` and `src-tauri/Cargo.toml`.
2. `git tag vX.Y.Z` and `git push origin vX.Y.Z`.
3. CI builds Windows and both Mac versions with signing, `scripts/make_latest_json.py` writes `latest.json`, and the `release` job
   publishes the installers, the portable zip and `latest.json` to the GitHub release. Apps read
   `releases/latest/download/latest.json`.

Ordinary builds (branches, pull requests, local `tauri build`) do not sign and do not make update packages.
Not checked: an update has never been installed end to end, and nothing has run on a Mac.
