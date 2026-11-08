# Packaging

How to build Nuvo from source and what the release files contain. Using Nuvo is covered at https://nuvo.quest/docs.

## Build from source

Requirements: Node 22 with pnpm, a stable Rust toolchain, SQLCipher (`libsqlcipher-dev` or `sqlcipher-devel`) and a Secret Service keyring (GNOME Keyring or KWallet).

```sh
pnpm install
pnpm electron:build:linux   # AppImage, deb and rpm for this machine's arch, in release/
```

`pnpm electron:build:win` and `pnpm electron:build:mac` build the other systems; the Windows installer needs Wine on Linux and the macOS packages need a Mac. The release workflow builds all of them.

Every package carries the `nuvo-core` daemon built for its own arch. `pnpm core:build` compiles it and `node scripts/stage-core.mjs` copies it where the packager reads it. Linux builds made on Ubuntu 22.04 run on glibc 2.35 and newer.

## Release files

Files are named `Nuvo-<version>-<os>-<arch>.<ext>`.

| System                | Files                               | Updates                                                       |
| --------------------- | ----------------------------------- | ------------------------------------------------------------- |
| Linux x64 and arm64   | `.AppImage`, `.deb`, `.rpm`         | AppImage updates itself; deb and rpm say a new version is out |
| Windows x64 and arm64 | `.exe` (per-user installer), `.zip` | updates itself                                                |
| macOS arm64 and x64   | `.dmg`, `.zip`                      | says a new version is out                                     |

Each release also has `SHA256SUMS`, the `latest*.yml` update feeds and CycloneDX SBOMs for the npm and cargo dependencies.

## Identity

The app id is `quest.nuvo.Nuvo` everywhere: the desktop entry, the Wayland app id and X11 window class, the AppStream metadata and the Windows AppUserModelID. The deb and rpm install `quest.nuvo.Nuvo.desktop` and the `nuvo` icon. An AppImage writes its own `quest.nuvo.Nuvo.desktop` and icons into `~/.local/share` on first start, unless a package already installed them; Settings, Playback, "Show Nuvo in the applications menu" removes them.

The profile stays at `~/.config/@nuvo/client` (Linux), `%APPDATA%\@nuvo\client` (Windows) or `~/Library/Application Support/@nuvo/client` (macOS), and the library key in the system keyring as `nuvo-core`. Uninstalling keeps both.
