#!/bin/sh
# Electron's temporary files stay inside the sandbox's own runtime folder
export TMPDIR="$XDG_RUNTIME_DIR/app/$FLATPAK_ID"
exec zypak-wrapper /app/nuvo/nuvo "$@"
