{
  lib,
  stdenv,
  fetchPnpmDeps,
  pnpmConfigHook,
  pnpm,
  nodejs,
  electron_44,
  makeWrapper,
  copyDesktopItems,
  makeDesktopItem,
  ffmpeg,
  yt-dlp,
  deno,
  nuvo-core,
}:

stdenv.mkDerivation (finalAttrs: {
  pname = "nuvo";
  version = (lib.importJSON ../package.json).version;

  src = lib.cleanSourceWith {
    src = ../.;
    filter = path: type:
      let
        base = baseNameOf path;
      in
      ! (
        base == ".git"
        || base == ".direnv"
        || base == "release"
        || base == "target"
        || base == "node_modules"
        || base == "dist"
        || base == "dist-electron"
      );
  };

  pnpmDeps = fetchPnpmDeps {
    inherit (finalAttrs) pname version src;
    fetcherVersion = 4;
    hash = "sha256-tG+jdV5LfsKuC+tCoEePY/4tH3imP721E784YoxuwaQ=";
  };

  nativeBuildInputs = [
    nodejs
    pnpm
    pnpmConfigHook
    makeWrapper
    copyDesktopItems
  ];

  env = {
    # Prevent downloading prebuilt Electron binaries via npm/pnpm
    ELECTRON_SKIP_BINARY_DOWNLOAD = "1";
    # Suppress Vite warning about native config loader
    VITE_CONFIG_NATIVE_IGNORE_WARNING = "true";
  };

  buildPhase = ''
    runHook preBuild

    # 1. Build frontend (React/Vite) and Electron main/preload bundles
    pnpm run build

    # 2. Pack desktop panel integration widgets (Waybar, Plasma, GNOME)
    node scripts/pack-panel-widgets.mjs

    runHook postBuild
  '';

  installPhase = ''
    runHook preInstall

    # 1. Prune devDependencies to keep only runtime dependencies
    rm -rf node_modules
    pnpm install \
      --offline \
      --ignore-scripts \
      --frozen-lockfile \
      --prod

    # 2. Application root directory
    mkdir -p $out/lib/nuvo
    cp -r dist dist-electron package.json node_modules build desktop $out/lib/nuvo/

    # 3. Integrate Rust nuvo-core server (app.isPackaged is false when launched from folder)
    mkdir -p $out/lib/nuvo/core/target/debug
    ln -s ${nuvo-core}/bin/nuvo-core $out/lib/nuvo/core/target/debug/nuvo-core

    # 4. Executable wrapper around system Electron 44 from Nixpkgs
    mkdir -p $out/bin
    makeWrapper ${electron_44}/bin/electron $out/bin/nuvo \
      --add-flags "$out/lib/nuvo" \
      --prefix PATH : ${lib.makeBinPath [ ffmpeg yt-dlp deno ]} \
      --add-flags "\''${NIXOS_OZONE_WL:+\''${WAYLAND_DISPLAY:+--ozone-platform-hint=auto --enable-features=WaylandWindowDecorations}}"

    # 5. Application icons
    for size in 16 32 48 64 128 256 512; do
      icon="build/icons/''${size}x''${size}.png"
      if [ -f "$icon" ]; then
        mkdir -p "$out/share/icons/hicolor/''${size}x''${size}/apps"
        cp "$icon" "$out/share/icons/hicolor/''${size}x''${size}/apps/quest.nuvo.Nuvo.png"
      fi
    done

    if [ -f "build/icons/nuvo.svg" ]; then
      mkdir -p "$out/share/icons/hicolor/scalable/apps"
      cp "build/icons/nuvo.svg" "$out/share/icons/hicolor/scalable/apps/quest.nuvo.Nuvo.svg"
    fi

    # 6. AppStream metadata
    if [ -f "build/linux/quest.nuvo.Nuvo.metainfo.xml" ]; then
      mkdir -p "$out/share/metainfo"
      cp "build/linux/quest.nuvo.Nuvo.metainfo.xml" "$out/share/metainfo/quest.nuvo.Nuvo.metainfo.xml"
    fi

    runHook postInstall
  '';

  desktopItems = [
    (makeDesktopItem {
      name = "quest.nuvo.Nuvo";
      desktopName = "Nuvo";
      genericName = "Music Player";
      comment = "Local-first desktop music player";
      exec = "nuvo %U";
      icon = "quest.nuvo.Nuvo";
      categories = [
        "AudioVideo"
        "Audio"
        "Player"
        "Music"
      ];
      keywords = [
        "music"
        "player"
        "audio"
        "lyrics"
        "playlist"
      ];
      mimeTypes = [ "x-scheme-handler/nuvo" ];
      startupWMClass = "Nuvo";
    })
  ];

  meta = with lib; {
    description = "Local-first desktop music player";
    homepage = "https://nuvo.quest";
    license = licenses.agpl3Plus;
    mainProgram = "nuvo";
    platforms = [ "x86_64-linux" "aarch64-linux" ];
  };
})
