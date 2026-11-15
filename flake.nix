{
  description = "Nuvo - local-first desktop music player";

  inputs = {
    nixpkgs.url = "github:nixos/nixpkgs/nixpkgs-unstable";
  };

  outputs = { self, nixpkgs }:
    let
      systems = [ "x86_64-linux" "aarch64-linux" ];
      forAllSystems = nixpkgs.lib.genAttrs systems;
    in {
      # 1. Packages for installation (nix build, nix profile install, environment.systemPackages)
      packages = forAllSystems (system:
        let
          pkgs = nixpkgs.legacyPackages.${system};
        in rec {
          # Pure Rust server core built from source
          core = pkgs.callPackage ./nix/core.nix { };

          # Complete Nuvo desktop application (Electron + React + Core + .desktop + Icons)
          default = pkgs.callPackage ./nix/package.nix {
            nuvo-core = core;
          };
        }
      );

      # 2. Development environment for direnv and nix develop
      devShells = forAllSystems (system:
        let
          pkgs = nixpkgs.legacyPackages.${system};

          # Native runtime libraries (GTK, Electron, Wayland, X11, Audio, Crypto)
          runtimeLibs = with pkgs; [
            # Rust Core / Crypto / Secret Service
            openssl
            sqlcipher
            libsecret
            dbus

            # GUI, Display & Audio
            alsa-lib
            at-spi2-core
            cairo
            cups
            expat
            glib
            gsettings-desktop-schemas
            gtk3
            libdrm
            libgbm
            libglvnd
            libGL
            libnotify
            util-linux
            libva
            libxkbcommon
            mesa
            nspr
            nss
            pango
            systemd
            vulkan-loader
            wayland
            wayland-protocols

            # X11 / XWayland (top-level attributes in NixOS 26.11)
            libx11
            libxscrnsaver
            libxcomposite
            libxcursor
            libxdamage
            libxext
            libxfixes
            libxi
            libxrandr
            libxrender
            libxtst
            libxcb
            libxshmfence
          ];

          # Build tools and CLI utilities
          nativeTools = with pkgs; [
            # Node & Package Managers
            nodejs_22
            pnpm

            # Rust & C Toolchain
            rustc
            cargo
            clippy
            rustfmt
            gcc
            gnumake
            pkg-config

            # External runtime tools
            ffmpeg
            yt-dlp
            deno

            # Packaging tools (.deb, .rpm for electron-builder)
            dpkg
            fakeroot
            fpm
            rpm
          ];
        in {
          # Default devShell — native for direnv and nix develop
          default = pkgs.mkShell {
            nativeBuildInputs = nativeTools;
            buildInputs = runtimeLibs;

            shellHook = ''
              # Dynamic libraries for Electron and prebuilt binaries
              export LD_LIBRARY_PATH="${pkgs.lib.makeLibraryPath runtimeLibs}:$LD_LIBRARY_PATH"

              # Wayland & Ozone support for Electron / Chromium on Hyprland
              export NIXOS_OZONE_WL=1
              export ELECTRON_OZONE_PLATFORM_HINT="auto"

              # GSettings schemas for GTK/GLib settings (prevents GLib-GIO-CRITICAL)
              export XDG_DATA_DIRS="${pkgs.gsettings-desktop-schemas}/share/gsettings-schemas/${pkgs.gsettings-desktop-schemas.name}:${pkgs.gtk3}/share/gsettings-schemas/${pkgs.gtk3.name}:$XDG_DATA_DIRS"

              # Use system fpm from nixpkgs instead of downloading prebuilt fpm (for deb/rpm builds on NixOS)
              export USE_SYSTEM_FPM="true"

              # Environment variables for Rust crates linking OpenSSL (openssl-sys / rusqlite)
              export OPENSSL_NO_VENDOR=1
              export OPENSSL_DIR="${pkgs.openssl.dev}"
              export OPENSSL_LIB_DIR="${pkgs.lib.getLib pkgs.openssl}/lib"
              export OPENSSL_INCLUDE_DIR="${pkgs.openssl.dev}/include"

              # Pkg-config search paths
              export PKG_CONFIG_PATH="${pkgs.lib.makeSearchPathOutput "dev" "lib/pkgconfig" runtimeLibs}:$PKG_CONFIG_PATH"
            '';
          };

          # Optional FHS chroot (run on demand: nix develop .#fhs)
          fhs = (pkgs.buildFHSEnv {
            name = "nuvo-fhs-env";
            extraOutputsToInstall = [ "dev" ];
            targetPkgs = pkgs: nativeTools ++ runtimeLibs;
            profile = ''
              export NIXOS_OZONE_WL=1
              export ELECTRON_OZONE_PLATFORM_HINT="auto"
              export OPENSSL_DIR="/usr"
              export OPENSSL_INCLUDE_DIR="/usr/include"
              export OPENSSL_LIB_DIR="/usr/lib"
              export PKG_CONFIG_PATH="/usr/lib/pkgconfig:/usr/lib64/pkgconfig:/usr/share/pkgconfig:$PKG_CONFIG_PATH"
              export LIBRARY_PATH="/usr/lib:/usr/lib64:$LIBRARY_PATH"
            '';
            runScript = "bash";
          }).env;
        }
      );
    };
}
