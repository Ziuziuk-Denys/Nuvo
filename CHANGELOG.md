# Changelog

## 0.3.0

The redesign release. Every screen of Nuvo is new, and everything merged since 0.2.10 and the 0.2.11 betas is in it.

- **A new interface.** A new top bar with search in it, Home, the search palette (Ctrl K), Library, album, artist and playlist pages, the queue, menus, dialogs, settings, toasts, the lock and crash screens and the welcome tour are all redrawn, with our own icon set. Settings are grouped into Player, Interface, Integrations and Application, each one scrolling page with a search on top.
- **Themes.** Nine themes with their own colours, Matcha and Blossom among them, an illustrated app icon for eight of them, and a soft cross-fade when you switch.
- **Wallpapers** work in the light theme too, and can be a photo, a GIF or a video. Video pauses when the window is hidden.
- **SoundCloud search.** Search SoundCloud directly, with YouTube and SoundCloud songs ranked in one list.
- **Imports.** Playlists from Soundiiz, TuneMyMusic, Google Takeout, XSPF and TXT files, and public Yandex Music playlists, albums and tracks by link. Imported songs are matched on YouTube and SoundCloud together.
- **Lyrics made on your computer.** Nuvo can time every word of synced lyrics, time plain lyrics, and write lyrics for songs that have none, with Whisper running locally.
- **Proxies.** Play, recognize and fetch through SOCKS5 proxies with a login, and check each service through the proxy with a plain hint on what to do.
- **Tools download by themselves.** yt-dlp, Deno and ffmpeg are fetched on every platform when needed.
- **Last.fm** shows the playing song as now playing.
- **Discord** shows the playing song by default.
- **Fixes.** The Notch sits at the top on KDE Plasma. Per-track loudness normalization works again. A YouTube stream that answers 403 gets a fresh link. SQLCipher is updated to 4.20 (RUSTSEC-2026-0502).

Linux and Windows are supported. macOS is supported, and we are looking for testers: please report what works and what breaks in [the chat](https://t.me/getnuvo_chat) or on [GitHub Issues](https://github.com/Ziuziuk-Denys/Nuvo/issues).

## 0.2.11-beta.5

- **The song cover always shows in Discord,** and there is a Get Nuvo button on the card.
- **Larger GNOME panel controls** with a card tinted by the cover.
- **Notch buttons work on Windows.**
- **macOS builds are signed ad hoc** and open after Open Anyway in Privacy & Security.

## 0.2.11-beta.4

- **Move the window from the whole top band.** Drag anywhere along the top to move it, and double click to maximize. It works on Wayland too.

## 0.2.11-beta.3

- **The Notch stays out of your way.** It no longer takes the mouse outside its pill, and it is off until you turn it on.
- **Closing the window quits Nuvo,** unless you choose to keep it in the tray.
- **No console window on Windows.**
- **Security fixes.**

## 0.2.11-beta.2

- **No console window on Windows.** Nuvo no longer opens a black terminal next to the app.
- **Security fixes.** A slow-matching cover link pattern, incomplete tag stripping in lyrics translation, and an unchecked language lookup are fixed and covered by tests.
- **Code cleanup.** Fewer comments and dead code.

## 0.2.11-beta.1

A beta for testers: the first Windows and macOS builds of Nuvo, plus Linux and Chromebook.

- **Windows** x64 and arm64: installer and portable zip. **macOS** Apple silicon and Intel: dmg and zip. These builds have not been tried on real machines yet, and they are not signed.
- **Chromebook:** turn on Linux in ChromeOS settings, then install the Linux .deb for your processor.
- Fixes since 0.2.10: the key store builds on Windows, folder watching works on macOS, and file permissions are set only where the system supports them.

Please report what works and what breaks in [the chat](https://t.me/getnuvo_chat) or on [GitHub Issues](https://github.com/Ziuziuk-Denys/Nuvo/issues).

## 0.2.10

The first public release of Nuvo: a desktop music player that keeps your library encrypted on your own computer, with no account and no server of its own.

- **Library.** A local daemon keeps the library and the audio cache encrypted, behind a recovery phrase you write down once. Music folders are read with their tags and covers and watched for changes; songs you stream can be saved as files, and playlists exported.
- **Playback.** Gapless transitions, crossfade, a ten-band equalizer, loudness normalization, speed, pitch and reverb, a sleep timer and an A-B loop. One click on a song plays it in its list.
- **Lyrics.** Synced lyrics from LRCLIB, word-by-word karaoke, your own lyrics and timing offsets, and translation by a model running on your computer.
- **Discovery.** Mixes, radio and Home shelves worked out on your computer from what you play, with "Not interested" for a song, a version or an artist.
- **Imports and links.** Playlists from YouTube, SoundCloud, Spotify, Apple Music and Deezer links and from CSV, JSON and M3U files; pasted links and compact share links.
- **Desktop.** Nine themes, a colour editor, fonts, wallpapers and custom CSS with a safe mode; the Notch, a panel widget for GNOME, Plasma and Waybar, the tray, rebindable shortcuts, and English and Russian.
- **Statistics.** Listening history and yearly numbers, kept on your computer, with a switch that pauses them.

Linux (AppImage, deb, rpm) is supported. Windows and macOS builds are experimental and not signed yet.
