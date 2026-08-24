#!/bin/bash
# Electron ships its own sandbox, which cannot nest inside flatpak's. zypak
# redirects it onto the flatpak sandbox instead of disabling it.
exec zypak-wrapper.sh /app/main/slacky "$@"
