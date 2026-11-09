# Changelog

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
