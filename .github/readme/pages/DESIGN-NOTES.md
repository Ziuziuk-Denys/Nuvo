# Design notes

## Conventions Nuvo shares with other music players

Music players have settled on a few layouts because they work. Nuvo uses them on purpose.

- A navigation rail on the left with Home, Search and Library.
- A transport bar at the bottom: cover, title, play, previous, next, seek line, volume, queue.
- Covers in a grid for albums and playlists, and rows for tracks.
- A full-screen lyrics view with the current line highlighted and scrolling in time.
- A queue panel, a search field with a results page, and a context menu on every track.
- A settings page split into sections.

You will find your way around Nuvo if you have used any modern player. That is the point of keeping these.

## What was built for Nuvo

These parts have their own design and their own code in this repository.

- **A local daemon as the data layer.** A Rust service `nuvo-core` owns the library in an encrypted SQLCipher database. The window talks to it over a unix socket (a named pipe on Windows) with a per-launch token. There is no Nuvo server and no Nuvo account.
- **A recovery phrase.** The master key lives in the system keyring and maps to a 24-word phrase that restores the library.
- **An encrypted audio cache.** Audio is stored in 64 KiB sealed chunks, so seeking works without decrypting the whole file.
- **The Notch.** A small island at the top of the screen with the current track, live lyrics and controls, placed per desktop session.
- **The equalizer.** Ten bands on one curve over a live spectrum, with presets, auto gain and per-track memory of the curve.
- **Playback tools.** Crossfade with a gapless fallback, loudness normalization, tempo and pitch presets with reverb, sleep timer, A-B loop.
- **Share links.** A song or playlist becomes one compact link that carries the track list. The receiver's Nuvo rebuilds it locally.
- **Paste anything.** Search accepts links from several services and turns them into tracks or an import preview.
- **Local recommendations.** Mixes and radio are ranked on your machine from your plays, likes and "Not interested" choices.
- **Themes.** Nine presets, a colour editor with contrast warnings, theme files, and a custom CSS box with a strict checker and an appearance safe mode.
- **Local files.** Watched folders, tag and cover reading, and moved files that keep their likes.
- **A network check.** Per-host DNS, TCP and HTTPS rows, the proxy, clock skew and tool status in one report.
- **The icon set and the interface text.** The icons are drawn on one 24 px grid from the sources in `THIRD-PARTY-NOTICES`. Interface text exists in English and Russian.

## Where to read more

- [Features]({{site}}/docs/features/library)
- [How it is built]({{site}}/docs/architecture/overview)
- Licence terms for the code and the third-party parts: `LICENSING.md`, `THIRD-PARTY-NOTICES`
