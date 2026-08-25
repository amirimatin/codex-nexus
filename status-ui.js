const vscode = require("vscode");

// ── Status Bar UI ────────────────────────────────────────────────────────────
//
// A single status-bar item in the right group. Shows a compact health badge
// for the Codex Nexus patch. Click to open a QuickPick menu.
//
// Every label uses the compact "V.OpenAI" wordmark so a user who has both the
// Claude and Codex Nexus extensions installed can tell the two status-bar
// items apart at a glance. The companion Claude extension uses "V.Claude".
//
// Why "V.OpenAI" and not "V.Codex":
//
//   The activity-bar icon is the wordmark "VO" (V for Vazirmatn, O for
//   OpenAI). To stay visually consistent across the status-bar label, the
//   activity-bar icon, and the dashboard title, the second letter of the
//   label must match the second letter of the icon. So Claude uses VC →
//   "V.Claude", and Codex uses VO → "V.OpenAI". Calling it "V.Codex" would
//   break the pairing — the icon would say "O" while the text said "C".
//
// Text templates (minimal, monochrome except for inherited background):
//   idle      — $(pass) V.OpenAI
//   scanning  — $(sync~spin) V.OpenAI · <message>
//   ok        — $(pass-filled) V.OpenAI
//   warn      — $(warning) V.OpenAI · N
//   error     — $(error) V.OpenAI
//   noTarget  — $(info) V.OpenAI

const STATUS_BAR_PRIORITY = 100;
const TARGET_LABEL = "V.OpenAI";

let item = null;
let currentState = null;

function createStatusBarItem(context, menuCommandId) {
  item = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, STATUS_BAR_PRIORITY);
  item.name = "Codex Nexus";
  item.command = menuCommandId;
  context.subscriptions.push(item);
  setIdle();
  item.show();
  return item;
}

function setIdle() {
  currentState = { kind: "idle" };
  if (!item) return;
  item.text = `$(pass) ${TARGET_LABEL}`;
  item.tooltip = "Codex Nexus — idle. Click for actions.";
  item.backgroundColor = undefined;
}

function setScanning(message) {
  currentState = { kind: "scanning", message };
  if (!item) return;
  const suffix = message ? " · " + message : "";
  item.text = `$(sync~spin) ${TARGET_LABEL}` + suffix;
  item.tooltip = "Checking compatibility…";
  item.backgroundColor = undefined;
}

function setOk(info) {
  currentState = { kind: "ok", info };
  if (!item) return;
  const codexV = info?.codexVersion ?? "?";
  const ourV = info?.ourVersion ?? "?";
  item.text = `$(pass-filled) ${TARGET_LABEL}`;
  item.tooltip =
    `Codex Nexus — healthy\n` +
    `Codex: ${codexV}\n` +
    `Extension: ${ourV}\n` +
    `Click for actions.`;
  item.backgroundColor = undefined;
}

function setWarn(info) {
  currentState = { kind: "warn", info };
  if (!item) return;
  const count = info?.warningCount ?? 0;
  item.text = `$(warning) ${TARGET_LABEL}${count ? " · " + count : ""}`;
  item.tooltip =
    `Codex Nexus — ${count} compatibility warning${count === 1 ? "" : "s"}\n` +
    `Codex: ${info?.codexVersion ?? "?"}\n` +
    `Patch was applied, but some structural signals are missing.\n` +
    `Click for details.`;
  item.backgroundColor = new vscode.ThemeColor("statusBarItem.warningBackground");
}

function setError(info) {
  currentState = { kind: "error", info };
  if (!item) return;
  item.text = `$(error) ${TARGET_LABEL}`;
  item.tooltip =
    `Codex Nexus — error\n` +
    `${info?.message ?? "Unknown error"}\n` +
    `Click for recovery options.`;
  item.backgroundColor = new vscode.ThemeColor("statusBarItem.errorBackground");
}

function setNoTarget() {
  currentState = { kind: "noTarget" };
  if (!item) return;
  item.text = `$(info) ${TARGET_LABEL}`;
  item.tooltip =
    `Codex is not installed.\n` +
    `Click to open the Marketplace.`;
  item.backgroundColor = new vscode.ThemeColor("statusBarItem.warningBackground");
}

function getCurrentState() {
  return currentState;
}

// ── QuickPick menu ──────────────────────────────────────────────────────────

async function showMenu(handlers) {
  const state = currentState ?? { kind: "idle" };
  const items = [];

  items.push({
    label: formatStateLabel(state),
    description: formatStateDescription(state),
    kind: vscode.QuickPickItemKind.Separator
  });

  items.push({
    id: "check",
    label: "$(search) Check compatibility",
    description: "Scan Codex files"
  });

  if (state.kind !== "noTarget") {
    items.push({
      id: "reapply",
      label: "$(refresh) Re-apply patch",
      description: "Reapply the patch to Codex"
    });
  }

  items.push({
    id: "logs",
    label: "$(output) Open logs",
    description: "View the Output Channel"
  });

  items.push({
    id: "marketplace",
    label: "$(cloud-download) Check for update",
    description: "Open the extension page on the Marketplace"
  });

  if (state.kind !== "noTarget") {
    items.push({
      id: "restore",
      label: "$(discard) Restore original files",
      description: "Remove the patch and revert Codex"
    });
  }

  const picked = await vscode.window.showQuickPick(items, {
    title: "Codex Nexus",
    placeHolder: "Choose an action…"
  });

  if (!picked || !picked.id) return;

  const handler = handlers[picked.id];
  if (typeof handler === "function") {
    try {
      await handler();
    } catch (error) {
      vscode.window.showErrorMessage(
        `Action failed: ${error instanceof Error ? error.message : String(error)}`
      );
    }
  }
}

function formatStateLabel(state) {
  switch (state.kind) {
    case "ok": return `Healthy — Codex ${state.info?.codexVersion ?? "?"}`;
    case "warn": return `Warnings (${state.info?.warningCount ?? 0})`;
    case "error": return `Error`;
    case "noTarget": return `Codex not installed`;
    case "scanning": return `Checking…`;
    default: return `Idle`;
  }
}

function formatStateDescription(state) {
  switch (state.kind) {
    case "ok": return "All signals pass";
    case "warn": return "Patch applied but signals are missing";
    case "error": return state.info?.message ?? "";
    case "noTarget": return "Install Codex first";
    case "scanning": return state.message ?? "";
    default: return "";
  }
}

// ── Progress notification wrapper ────────────────────────────────────────────

async function runWithProgress(title, task) {
  return vscode.window.withProgress(
    {
      location: vscode.ProgressLocation.Notification,
      title,
      cancellable: false
    },
    async (progress) => {
      let finished = false;
      const report = (message, increment) => {
        if (finished) return;
        progress.report({ message, increment });
        setScanning(message);
      };
      const stateBefore = currentState;
      try {
        return await task(report);
      } finally {
        finished = true;
        // Safety net: never leave the spinner on.
        if (currentState && currentState.kind === "scanning") {
          if (stateBefore && stateBefore.kind !== "scanning") {
            applyState(stateBefore);
          } else {
            setIdle();
          }
        }
      }
    }
  );
}

function applyState(state) {
  switch (state.kind) {
    case "ok": return setOk(state.info);
    case "warn": return setWarn(state.info);
    case "error": return setError(state.info);
    case "noTarget": return setNoTarget();
    default: return setIdle();
  }
}

module.exports = {
  createStatusBarItem,
  setIdle,
  setScanning,
  setOk,
  setWarn,
  setError,
  setNoTarget,
  getCurrentState,
  showMenu,
  runWithProgress
};
