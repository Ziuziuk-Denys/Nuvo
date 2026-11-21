# Changelog

## {{VERSION}}

A ring of new songs on Home. Spin it with the wheel, a drag or the arrow keys, and the sky behind it takes the colours of the cover in the middle. This release also brings a Poster scene, Settings you can search, imports that open at once and every fix since 0.4.0.

- **A ring of new songs on Home.** About three in four come from New to you, the rest from your mixes, offline too. Click a side cover and it plays at once.
- **Scene gets a Poster look.** The cover printed in two flat tones with lyrics set like a poster, plus a second background drawn in characters. That makes 13 ready scenes.
- **Settings in 23 plain sections.** Search finds a setting by other words in English and Russian, such as EQ, tray or VPN, and Ctrl+K jumps straight to it.
- **Imports open at once.** The playlist opens while songs still match. Nuvo remembers earlier matches, so a second import of a 153-song playlist placed 147 songs within a second.
- **Fewer stalled starts.** A YouTube source that stays silent gets the next one started beside it, and one refused stream no longer asks you to change your VPN.
- **Find lyrics from the karaoke view.** The search forgives swapped fields and titles full of tags like "slowed" or "fyp", and a slowed or sped-up cut gets its timing stretched to fit.
- **Try a look before you keep it.** The first time you open lyrics, the whole view plays Scene or Karaoke. One switch tries the other, one button keeps it.
- **Your own files, dropped anywhere.** Drop songs or folders on the window, or add single files. The first Home is never empty: four genre shelves play at once.
- **Controls where you want them.** Settings, Theme, Navigation puts the sections in a rail on the left. Settings, Player moves play, previous and next to the left edge of the player.
- **An update offer at every launch.** Nuvo asks github.com for a new version at launch, and every 4 hours while Update automatically is on, and offers it in one small message. Later hides it until the next start. Turn off Check for updates at launch in Settings, Updates, and it asks only when you press Check now.

**Updating from 0.4.** Your settings stay as they are. New installs start with the Notch on Automatic and Auto gain off.

Tell us what works and what breaks in [the chat](https://t.me/getnuvo_chat), on [Discord](https://discord.gg/rHz3dg9S9T) or on [GitHub Issues](https://github.com/Ziuziuk-Denys/Nuvo/issues).

### По-русски

Кольцо новых песен на главной. Крутите его колесом, мышью или стрелками, а небо за ним берёт цвета обложки в центре. Ещё в релизе сцена «Постер», настройки с поиском, импорт, который открывается сразу, и все исправления с 0.4.0.

- **Кольцо новых песен на главной.** Примерно три из четырёх из подборки «Новое для вас», остальные из ваших миксов, и без сети тоже. Клик по боковой обложке сразу включает песню.
- **Сцена «Постер».** Обложка, напечатанная в два плоских тона, текст свёрстан как афиша, а второй фон нарисован символами. Готовых сцен теперь 13.
- **Настройки в 23 понятных разделах.** Поиск находит настройку и по другим словам, на русском и английском: эквалайзер, трей, VPN. Ctrl+K сразу открывает нужную.
- **Импорт открывается сразу.** Плейлист открывается, пока песни ещё ищутся. Nuvo помнит прошлые совпадения: повторный импорт плейлиста на 153 песни расставил 147 из них за секунду.
- **Меньше зависших стартов.** Если источник YouTube молчит, рядом сразу запускается следующий, а один отказ в потоке больше не просит сменить VPN.
- **«Найти текст» прямо из караоке.** Поиск прощает перепутанные поля и названия с хвостами вроде «slowed» или «fyp», а у замедленной или ускоренной версии тайминг растягивается под неё.
- **Сначала попробуйте вид.** При первом открытии текста весь экран показывает сцену или караоке. Один переключатель пробует другой вид, одна кнопка оставляет выбранный.
- **Свои файлы - просто перетащите.** Бросьте песни или папки в окно или добавьте отдельные файлы. Первая главная никогда не пустая: четыре жанровые полки играют сразу.
- **Кнопки там, где удобно.** Настройки, Тема, Навигация ставит разделы в колонку слева. Настройки, Плеер переносит воспроизведение и переключение песен к левому краю плеера.
- **Обновление при каждом запуске.** Nuvo спрашивает github.com о новой версии при запуске и раз в 4 часа, пока включено «Обновляться автоматически», и предлагает её одним небольшим сообщением. «Позже» скрывает его до следующего запуска. Выключите «Проверять обновления при запуске» в Настройках, раздел «Обновления», и Nuvo будет спрашивать только по кнопке «Проверить».

**Обновление с 0.4.** Ваши настройки не меняются. В новых установках нотч включён в режиме «Автоматически», а автоусиление выключено.

### All changes

#### New

- Discover ring on Home: new songs under a sky from the cover
- Poster scene with a print background and poster lyrics; Print in characters
- Look choice previews Scene and Karaoke across the whole view
- Settings: 23 sections, search by other words in English and Russian, Ctrl+K jumps to a setting
- Navigation in a side rail: Settings, Theme, Navigation
- Player controls at the side: Settings, Player
- Update check on every launch, with an offer you can put off until the next start; Check for updates at launch turns it off (Settings, Updates)
- Find lyrics in the karaoke view and the track menu
- Lyrics model setting: Auto, Light (82 MB) or Full (264 MB)
- Add single music files, drop songs and folders anywhere on the window
- Spotify song links play, including spotify.link
- Host shells can read the current track, synced lyrics and up next over D-Bus, and play from up next (thanks @doctorsalamii)

#### Better

- Imports open the playlist at once and show the songs still matching
- Imports remember earlier matches and run twice as many searches at once
- The first Home shows one import line and four genre shelves that play at once
- Quick search finds SoundCloud songs and ranks like the search page
- Lyrics search forgives swapped fields and tagged upload titles
- Slowed and sped-up cuts get stretched lyric timing
- The next song starts caching after 3 s of play instead of 10 s
- Notch on Automatic by default: it shows while the window is hidden or minimized
- Auto gain off by default, and a limiter keeps EQ boosts from clipping in playback and clip export
- Tabs, filters, panels and the Scene editor share one motion
- The GNOME panel widget updates itself when Nuvo brings a newer one
- What's new shows the short notes in your language
- The Discover ring shows as soon as Home has a mix, offline too
- Slow starts fall through sooner: clients that need no warm-up go first, a silent YouTube client gets the next one started beside it, and SoundCloud refusals are known early
- Ctrl+K puts matching commands and settings above songs, so Enter runs them
- Queue rows rise one by one when the queue opens
- Poster takes turns between narrow capitals and light italics phrase by phrase, with a large echo word behind most italic phrases
- Random per song can pick Poster for any song, also without word timing, and Poster is the second tile in the Scene studio
- Over a Scene, each karaoke control turns light or dark to read over the picture behind it

#### Fixed

- The Scene background no longer flashes between black and white
- A failed start says "No source could play it" instead of blaming your region
- The Library toolbar no longer covers its tabs in a narrow window
- Genre shelves on the first Home hold their place while they load
- One refused YouTube stream no longer shows the VPN message; a real block still does
- A playlist that is still importing opens from the Library and plays the songs already matched
- Skip messages and the stand-in hover follow the app language
- The karaoke view and Scene open over the Discover ring, not under it
- The karaoke view follows a seek made right after a line change
- Kinetic text stays inside its lyric box, and the look choice keeps its line above the prompt in every language
- The lyrics bar reads on light scenes
- The tour tip no longer covers New theme from this
- The Recognize sources fit one row in Russian
- Word by word no longer slides sideways when a line ends
- The Film effect adds black bars only when you raise its Letterbox slider

## 0.4.0

Songs you can watch now. Scene, Nuvo's own visual engine, draws each song to the beat while the words land as they are sung, and its clip studio turns any moment into a short video. This release also brings two editions, moving sound, lyrics that follow the version that plays, and every fix since 0.3.0.

- **Scene draws each song to the beat.** Open the lyrics view and pick Scene. Start from twelve ready scenes, or build your own from a background, up to three effects, a centrepiece and a text style.
- **A clip studio inside the player.** Pick a moment on the timeline and export MP4 in 9:16, 1:1 or 16:9, up to 4K at 60 fps. Your EQ, reverb and speed stay in the sound, and every frame carries a small "Made with Nuvo" mark.
- **Two editions, the same features.** Standard is the main download. Nuvo Encrypted keeps the library and the audio cache encrypted under a key in your system keyring.
- **Moving sound in 4D, 8D and 16D.** The music circles around your head on headphones, at three speeds. It sits in the Sound panel, on the Space tab.
- **Lyrics follow the version that plays.** A music video with a long intro no longer gets the album's timing, and Find lyrics in the lyrics editor searches by title and artist.
- **Notch placement.** Choose the screen, the side, the top edge, a gap and the stacking. On Hyprland and Sway the Notch sits below your bar.
- **Back goes back.** One press always plays the previous track.

**Updating from 0.3.** The update moves you to the Standard edition and converts your library on the first start: likes, playlists, lyrics and settings stay. To keep encryption, install the Nuvo Encrypted download instead.

Tell us what works and what breaks in [the chat](https://t.me/getnuvo_chat), on [Discord](https://discord.gg/rHz3dg9S9T) or on [GitHub Issues](https://github.com/Ziuziuk-Denys/Nuvo/issues).

### По-русски

Песни, которые можно смотреть. Сцена, собственный визуальный движок Nuvo, рисует каждую песню в такт, а слова появляются, когда их поют. Студия сцены превращает любой момент в короткое видео. Ещё в релизе две версии, объёмный звук, текст под ту версию песни, что играет, и все исправления с 0.3.0.

- **Сцена рисует песню в такт.** Откройте текст песни и выберите «Сцена». Двенадцать готовых сцен или своя: фон, до трёх эффектов, центральный элемент и стиль текста.
- **Студия сцены прямо в плеере.** Выберите момент на таймлайне и сохраните MP4 в 9:16, 1:1 или 16:9, до 4K и 60 fps. Эквалайзер, реверб и скорость остаются в звуке, на каждом кадре небольшая метка «Made with Nuvo».
- **Две версии, функции одинаковые.** Стандартная версия - основная загрузка. Версия с шифрованием хранит библиотеку и кэш аудио зашифрованными, ключ лежит в системной связке ключей.
- **Объёмный звук 4D, 8D и 16D.** Музыка кружит вокруг головы в наушниках, на трёх скоростях. Он в панели звука, на вкладке «Объём».
- **Текст идёт за той версией, что играет.** Клип с длинным вступлением больше не получает тайминг альбома, а «Найти текст» в редакторе ищет по названию и исполнителю.
- **Место нотча.** Экран, сторона, верхний край, отступ и слой. В Hyprland и Sway нотч встаёт под вашу панель.
- **«Назад» значит назад.** Одно нажатие всегда включает предыдущий трек.

**Обновление с 0.3.** Обновление переводит на стандартную версию и при первом запуске переносит библиотеку: лайки, плейлисты, тексты и настройки остаются. Нужно шифрование - поставьте версию с шифрованием.

### All changes

#### New

- Scene, Nuvo's own visual engine: 12 ready scenes or your own
- Clip studio: MP4 up to 4K 60 fps, 9:16, 1:1 or 16:9, with your EQ and speed
- Standard and Encrypted editions, data converts on start
- Moving sound 4D, 8D, 16D, three speeds, Space tab
- Find lyrics by title and artist in the lyrics editor
- Notch placement: screen, side, top edge, gap, stacking
- Updates install on quit, plus Check for updates
- Right-click song menu on Home
- Telegram and Discord links in About
- Taskbar thumbnail buttons on Windows, NixOS support

#### Better

- Lyrics follow the cut that plays
- Back always goes to the previous track
- Home fills within seconds after the first picks, up to 15 picks
- The tour points at what it describes
- macOS: native window, Notch around the camera
- GNOME panel: larger controls
- Big local libraries import faster

#### Fixed

- SoundCloud starts at once
- Lyrics keep their place on pause
- A pause near the end no longer skips
- Hyprland fullscreen no longer turns on HDR
- Kaomoji no longer show as boxes
- Files with old-encoding names play
- Import never picks an instrumental
- Liked songs lists every song
- The Whisper model downloads once

## 0.3.1-beta.2

A beta with a reworked updater. Install on quit is checked by an automated test with the Linux AppImage and the Windows installer. Not checked yet: the Restart now button from start to finish, Windows arm64 and macOS.

- **Updates install when you quit Nuvo.** Before, a downloaded update installed only through the button in Settings, About. Restart now still installs at once.
- **Nuvo checks for updates on its own:** at start, every 4 hours and after waking from sleep. After a failed check it tries again at growing intervals, up to every 30 minutes.
- **Check for updates in Settings, About,** also with automatic updates off. The row shows whether Nuvo is up to date, downloading or ready.
- **The Windows portable .zip links to the release page** instead of installing a second copy.
- **The AppImage menu entry follows the new file** when an update renames it.

**Getting this beta.** Nuvo's updater offers only stable releases, so 0.3.1-beta.1 and older versions do not offer this beta: download it from the release page. Older versions keep their old updater and install a downloaded update only through the button in Settings, About.

Please report what works and what breaks in [the chat](https://t.me/getnuvo_chat) or on [GitHub Issues](https://github.com/Ziuziuk-Denys/Nuvo/issues).

## 0.3.1-beta.1

A beta with fixes since 0.3.0. The macOS changes are checked in CI only and wait for a tester on a real Mac.

- **Recognize paces itself** to the service's limit, so a few recognitions in a row get an answer instead of failing as busy.
- **Import playlist stays in the Library toolbar,** next to Create playlist, after the first import.
- **Add lyrics shows progress** as it goes: the model download in percent, then the transcription phrase by phrase.
- **No white corner under the settings sheet** with a strong wallpaper blur or fade.
- **macOS: the native window frame,** with the traffic lights in the top bar and native full screen.
- **macOS: the Notch sits over the menu bar** and wraps the camera notch of a MacBook.
- **macOS: Discord status finds the desktop app.**

Please report what works and what breaks in [the chat](https://t.me/getnuvo_chat) or on [GitHub Issues](https://github.com/Ziuziuk-Denys/Nuvo/issues).

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
