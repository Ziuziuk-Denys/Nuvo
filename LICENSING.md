# Licensing

Nuvo is licensed under the GNU Affero General Public License, version 3 or any later version (AGPL-3.0-or-later). The text is in `LICENSE`.

## What you can do

- Use Nuvo for any purpose, personal or commercial.
- Read, change and rebuild the source.
- Redistribute Nuvo or a modified version, for free or for money.
- Run a modified version as a network service.

## What you must do

If you distribute a modified version, or let people use it over a network, you must offer them the complete source of your version under the AGPL-3.0-or-later. That includes your changes and any code you combine with Nuvo into one work. Keep the copyright and licence notices.

## What the licence does not cover

- Closed-source use is not licensed. You cannot ship Nuvo, or a work built on Nuvo code, as a proprietary product.
- The name and mark "Nuvo" are not licensed. See `TRADEMARKS.md`.
- Third-party components keep their own licences. See `THIRD-PARTY-NOTICES`.

## Helper tools downloaded at run time

Nuvo does not ship yt-dlp, Deno or ffmpeg, so they are not part of its packages or of `THIRD-PARTY-NOTICES`. When one is missing, the app downloads an official build from the source below, checks its SHA-256 hash and keeps it in its own tools folder. A working copy already on the system is used first. Each tool keeps its own licence.

| Tool                  | Licence                                                          | Source                                                                                                                            |
| --------------------- | ---------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------- |
| yt-dlp                | Unlicense; the standalone builds are GPL-3.0-or-later as a whole | [yt-dlp releases](https://github.com/yt-dlp/yt-dlp/releases), checked against the release's `SHA2-256SUMS` and updated once a day |
| Deno 2.9.8            | MIT                                                              | [Deno releases](https://github.com/denoland/deno/releases/tag/v2.9.8)                                                             |
| ffmpeg 7.0.2, Linux   | GPL-3.0                                                          | [John Van Sickle's static builds](https://johnvansickle.com/ffmpeg/)                                                              |
| ffmpeg 9.0.2, Windows | GPL-3.0                                                          | [Gyan Doshi's essentials build](https://github.com/GyanD/codexffmpeg/releases/tag/9.0.2)                                          |
| ffmpeg 9.0.2, macOS   | GPL-3.0                                                          | [Martin Riedl's signed builds](https://ffmpeg.martin-riedl.de/)                                                                   |

## If you break the terms

Using Nuvo outside the AGPL-3.0-or-later is copyright infringement. Section 8 of the licence ends your rights when you violate it. You can get them back under the conditions in that section.

## Commercial licence

If the AGPL does not fit your product, ask the author for a separate commercial licence: hello@nuvo.quest.

Contributions are accepted under a Developer Certificate of Origin sign-off, which lets the author offer such licences. See `CONTRIBUTING.md`.

This summary is not legal advice. `LICENSE` governs.
