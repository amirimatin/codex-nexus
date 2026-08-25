#!/usr/bin/env bash

set -Eeuo pipefail

if [[ "$(uname -s)" != "Linux" ]]; then
  printf 'Desktop launcher installation skipped: this is not Linux.\n'
  exit 0
fi

ROOT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
CODE_BIN="${CODE_BIN:-$(command -v code || command -v code-insiders || true)}"

if [[ -z "$CODE_BIN" || ! -x "$CODE_BIN" ]]; then
  printf 'Desktop launcher installation skipped: VS Code executable was not found.\n' >&2
  exit 1
fi

if [[ "$(basename -- "$CODE_BIN")" == *insiders* ]]; then
  DESKTOP_ID=code-insiders.desktop
  APP_NAME='Visual Studio Code - Insiders'
  ICON_NAME=code-insiders
else
  DESKTOP_ID=code.desktop
  APP_NAME='Visual Studio Code'
  ICON_NAME=vscode
fi

CONFIG_DIR="$HOME/.config/codex-rtl"
APPLICATIONS_DIR="$HOME/.local/share/applications"
LAUNCHER_PATH="$CONFIG_DIR/launch-code-last-project.sh"
DESKTOP_PATH="$APPLICATIONS_DIR/$DESKTOP_ID"

mkdir -p -- "$CONFIG_DIR" "$APPLICATIONS_DIR"
install -m 0755 "$ROOT_DIR/scripts/launch-code-last-project.sh" "$LAUNCHER_PATH"

if [[ -f "$DESKTOP_PATH" ]] && ! grep -q '^X-Codex-Persian-RTL-Managed=true$' "$DESKTOP_PATH"; then
  BACKUP_PATH="$DESKTOP_PATH.backup-$(date +%Y%m%d-%H%M%S)"
  mv -- "$DESKTOP_PATH" "$BACKUP_PATH"
  printf 'Existing desktop override backed up to %s\n' "$BACKUP_PATH"
fi

DESKTOP_TMP="$(mktemp "$APPLICATIONS_DIR/.${DESKTOP_ID}.XXXXXX")"
cleanup() {
  rm -f -- "$DESKTOP_TMP"
}
trap cleanup EXIT

{
  printf '%s\n' \
    '[Desktop Entry]' \
    "Name=$APP_NAME" \
    'Comment=Code Editing. Redefined.' \
    'GenericName=Text Editor' \
    "Exec=/usr/bin/env CODEX_RTL_CODE_BIN=\"$CODE_BIN\" \"$LAUNCHER_PATH\" %F" \
    "Icon=$ICON_NAME" \
    'Type=Application' \
    'StartupNotify=false' \
    'StartupWMClass=Code' \
    'Categories=TextEditor;Development;IDE;' \
    'MimeType=application/x-code-workspace;' \
    'Actions=new-empty-window;' \
    'Keywords=vscode;' \
    'X-Codex-Persian-RTL-Managed=true' \
    '' \
    '[Desktop Action new-empty-window]' \
    'Name=New Empty Window' \
    "Exec=\"$CODE_BIN\" --new-window %F" \
    "Icon=$ICON_NAME"
} >"$DESKTOP_TMP"

chmod 0644 "$DESKTOP_TMP"
mv -f -- "$DESKTOP_TMP" "$DESKTOP_PATH"
trap - EXIT

if command -v update-desktop-database >/dev/null 2>&1; then
  update-desktop-database "$APPLICATIONS_DIR"
fi

printf 'Managed VS Code desktop launcher installed at %s\n' "$DESKTOP_PATH"
