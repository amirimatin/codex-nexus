#!/usr/bin/env bash

set -Eeuo pipefail

ROOT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
REOPEN_PATH="$ROOT_DIR"
SKIP_BUILD=0
NO_OPEN=0
INSTALL_LAUNCHER=1
CODE_WAS_RUNNING=0
CODE_REOPENED=0
INSTALL_LOG="/tmp/codex-nexus-installer-${UID}.log"
LOCK_FILE="/tmp/codex-nexus-installer-${UID}.lock"
BUILD_DIR=""

cleanup() {
  if [[ -n "$BUILD_DIR" && -d "$BUILD_DIR" ]]; then
    rm -rf -- "$BUILD_DIR"
  fi
}
trap cleanup EXIT

usage() {
  printf '%s\n' \
    "Usage: ./installer.sh [--reopen PATH] [--skip-build] [--no-open] [--no-launcher]" \
    "" \
    "Builds and installs the current VSIX while every VS Code process is stopped," \
    "applies the Codex webview patch offline, then safely opens VS Code again."
}

while (($# > 0)); do
  case "$1" in
    --reopen)
      if (($# < 2)); then
        printf 'Missing path after --reopen.\n' >&2
        exit 2
      fi
      REOPEN_PATH="$2"
      shift 2
      ;;
    --skip-build)
      SKIP_BUILD=1
      shift
      ;;
    --no-open)
      NO_OPEN=1
      shift
      ;;
    --no-launcher)
      INSTALL_LAUNCHER=0
      shift
      ;;
    -h|--help)
      usage
      exit 0
      ;;
    *)
      printf 'Unknown argument: %s\n' "$1" >&2
      usage >&2
      exit 2
      ;;
  esac
done

if [[ "${TERM_PROGRAM:-}" == "vscode" && "${CODEX_INSTALLER_ALLOW_VSCODE_TERMINAL:-0}" != "1" ]]; then
  printf '%s\n' \
    "Refusing to run from the VS Code integrated terminal." \
    "Open a normal system terminal and run:" \
    "  cd '$ROOT_DIR'" \
    "  ./installer.sh" >&2
  exit 2
fi

if [[ "$(id -u)" == "0" ]]; then
  printf 'Do not run this installer with sudo or as root.\n' >&2
  exit 2
fi

for command_name in bash node npm pgrep stat find grep sort mktemp rm; do
  if ! command -v "$command_name" >/dev/null 2>&1; then
    printf 'Required command is missing: %s\n' "$command_name" >&2
    exit 2
  fi
done

CODE_BIN="${CODE_BIN:-$(command -v code || true)}"
if [[ -z "$CODE_BIN" ]]; then
  printf 'The code command was not found in PATH.\n' >&2
  exit 2
fi

exec 9>"$LOCK_FILE"
if command -v flock >/dev/null 2>&1 && ! flock -n 9; then
  printf 'Another Codex Nexus installer is already running.\n' >&2
  exit 2
fi

list_code_main_pids() {
  {
    pgrep -f '^/usr/share/code/code( |$)' || true
    pgrep -f '^/usr/share/code-insiders/code-insiders( |$)' || true
  } | sort -nu
}

code_is_running() {
  [[ -n "$(list_code_main_pids)" ]]
}

open_code() {
  if ((NO_OPEN == 1 || CODE_REOPENED == 1)); then
    return
  fi
  printf 'Opening VS Code at %s ...\n' "$REOPEN_PATH"
  nohup "$CODE_BIN" --new-window "$REOPEN_PATH" >"$INSTALL_LOG" 2>&1 &
  CODE_REOPENED=1
}

recover_on_error() {
  local exit_code=$?
  printf 'Installation failed with exit code %s.\n' "$exit_code" >&2
  if ((CODE_WAS_RUNNING == 1 && CODE_REOPENED == 0)); then
    printf 'Reopening VS Code after the failed installation.\n' >&2
    open_code || true
  fi
  exit "$exit_code"
}
trap recover_on_error ERR

cd "$ROOT_DIR"
VERSION="$(node -p 'require("./package.json").version')"

printf '%s\n' \
  "Installer isolation policy: no other extension is enabled, disabled, or removed." \
  "Only the Codex Nexus VSIX is explicitly installed."

if ((SKIP_BUILD == 0)); then
  BUILD_DIR="$(mktemp -d "${TMPDIR:-/tmp}/codex-nexus-build.XXXXXX")"
  VSIX_PATH="$BUILD_DIR/codex-nexus-${VERSION}.vsix"
  printf 'Running tests for version %s ...\n' "$VERSION"
  npm test
  printf 'Building %s ...\n' "$VSIX_PATH"
  npm run package:vsix -- --out "$VSIX_PATH"
else
  VSIX_PATH="$ROOT_DIR/codex-nexus-${VERSION}.vsix"
  if [[ ! -f "$VSIX_PATH" ]]; then
    printf 'VSIX does not exist: %s\n' "$VSIX_PATH" >&2
    exit 2
  fi
fi

if code_is_running; then
  CODE_WAS_RUNNING=1
  printf 'Stopping all VS Code windows before installation ...\n'
  mapfile -t code_pids < <(list_code_main_pids)
  kill "${code_pids[@]}"

  for _ in {1..15}; do
    if ! code_is_running; then
      break
    fi
    sleep 1
  done

  if code_is_running; then
    printf '%s\n' \
      "VS Code did not stop within 15 seconds." \
      "Close it manually and run installer.sh again." >&2
    exit 1
  fi
fi

printf 'VS Code is fully stopped. Installing %s ...\n' "$(basename "$VSIX_PATH")"
unset VSCODE_IPC_HOOK_CLI
"$CODE_BIN" --install-extension "$VSIX_PATH" --force

printf 'Applying the Codex webview patch while VS Code is offline ...\n'
node "$ROOT_DIR/scripts/offline-apply.js"

if ((INSTALL_LAUNCHER == 1)); then
  printf 'Installing the managed last-project desktop launcher ...\n'
  CODE_BIN="$CODE_BIN" "$ROOT_DIR/scripts/install-linux-launcher.sh"
fi

if ((NO_OPEN == 1)); then
  trap - ERR
  printf '%s\n' \
    "Installation and offline patch completed successfully." \
    "VS Code was intentionally left closed because --no-open was used."
  exit 0
fi

STARTUP_EPOCH="$(date +%s)"
open_code

printf 'Waiting for the Codex webview startup log ...\n'
CODEX_LOG=""
for _ in {1..20}; do
  CODEX_LOG="$(find "${VSCODE_USER_DATA_DIR:-$HOME/.config/Code}/logs" -type f -path '*/openai.chatgpt/Codex.log' -newermt "@${STARTUP_EPOCH}" -print 2>/dev/null | sort | tail -n 1)"
  if [[ -n "$CODEX_LOG" ]] && grep -q 'ready provider mounted' "$CODEX_LOG"; then
    printf 'Codex mounted successfully.\n'
    grep -n -E 'React root render|app routes mounted|ready provider mounted' "$CODEX_LOG" | tail -n 6
    trap - ERR
    exit 0
  fi
  sleep 1
done

trap - ERR
if [[ -n "$CODEX_LOG" ]]; then
  printf '%s\n' \
    "VS Code reopened, but Codex did not report a ready mount within 20 seconds." \
    "Relevant startup log: $CODEX_LOG" >&2
  grep -n -i -E 'Activating Codex|Initialize received|React root render|app routes mounted|ready provider mounted|error|fatal|terminated' "$CODEX_LOG" | tail -n 80 >&2 || true
  exit 1
fi

printf '%s\n' \
  "VS Code reopened. Codex was not activated during the 20-second check." \
  "Open the Codex panel once; its next startup will use the offline patch."
