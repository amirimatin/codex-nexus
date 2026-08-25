#!/usr/bin/env bash

set -u

CODE_BIN="${CODEX_RTL_CODE_BIN:-}"
if [[ -z "$CODE_BIN" ]]; then
  if [[ -x /usr/share/code/code ]]; then
    CODE_BIN=/usr/share/code/code
  elif [[ -x /usr/share/code-insiders/code-insiders ]]; then
    CODE_BIN=/usr/share/code-insiders/code-insiders
  else
    CODE_BIN="$(command -v code || command -v code-insiders || true)"
  fi
fi

if [[ -z "$CODE_BIN" || ! -x "$CODE_BIN" ]]; then
  printf 'Unable to locate the VS Code executable.\n' >&2
  exit 1
fi

# Keep file-open and explicit workspace requests unchanged.
if (( $# > 0 )); then
  exec "$CODE_BIN" "$@"
fi

if [[ -n "${CODEX_RTL_USER_DATA_DIR:-}" ]]; then
  USER_DATA_DIR="$CODEX_RTL_USER_DATA_DIR"
elif [[ "$(basename -- "$CODE_BIN")" == *insiders* ]]; then
  USER_DATA_DIR="$HOME/.config/Code - Insiders"
else
  USER_DATA_DIR="$HOME/.config/Code"
fi

STORAGE_JSON="$USER_DATA_DIR/User/globalStorage/storage.json"
TARGET_URI=""

if [[ -r "$STORAGE_JSON" ]] && command -v node >/dev/null 2>&1; then
  TARGET_URI="$(node -e '
    const fs = require("node:fs");
    try {
      const state = JSON.parse(fs.readFileSync(process.argv[1], "utf8"));
      const window = state?.windowsState?.lastActiveWindow ?? {};
      const workspace = typeof window.workspace === "string"
        ? window.workspace
        : window.workspace?.configPath;
      process.stdout.write(workspace || window.folder || "");
    } catch {}
  ' "$STORAGE_JSON")"
fi

if [[ "$TARGET_URI" == file://* ]]; then
  TARGET_PATH="$(node -e '
    try {
      const value = new URL(process.argv[1]);
      process.stdout.write(decodeURIComponent(value.pathname));
    } catch {}
  ' "$TARGET_URI")"

  if [[ -n "$TARGET_PATH" && -e "$TARGET_PATH" ]]; then
    if [[ "${CODEX_RTL_LAUNCHER_DRY_RUN:-0}" == "1" ]]; then
      printf '%s\n' "$TARGET_PATH"
      exit 0
    fi
    exec "$CODE_BIN" --new-window "$TARGET_PATH"
  fi
fi

if [[ "${CODEX_RTL_LAUNCHER_DRY_RUN:-0}" == "1" ]]; then
  printf 'NO_VALID_LAST_PROJECT\n'
  exit 1
fi

exec "$CODE_BIN"
