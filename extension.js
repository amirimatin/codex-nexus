const fs = require("fs");
const path = require("path");
const vscode = require("vscode");
const {
  CONFIG_SECTION,
  DEFAULT_CONFIG,
  TARGET_EXTENSION_ID,
  applyPatchToTarget,
  applyPatchToWorkbench,
  createLogger,
  createTargetPaths,
  detectOrphanArtifacts,
  findInstalledWorkbenchTarget,
  inspectTargetCompatibility,
  inspectWorkbenchCompatibility,
  normalizeConfig,
  restoreTarget,
  restoreWorkbenchTarget,
  stripManagedArtifactsFromIndex
} = require("./patch-core");
const {
  DEFAULT_CODEX_LOCALE,
  LOCALE_OVERRIDE_SETTING,
  normalizeCodexLocale,
  resolveCodexLocaleAction
} = require("./locale-core");
const { updateExtensionState } = require("./state-store");
const { shouldCleanupOnDeactivate } = require("./lifecycle-core");
const { performInstalledCleanup } = require("./local-cleanup");
const { inspectLegacyStartupHooks, removeLegacyStartupHooks } = require("./legacy-startup-core");
const {
  classifyTargetAvailability,
  shouldAttemptPatch,
  shouldExplainRemote,
  buildRemoteGuidanceMessage
} = require("./remote-core");
const statusUi = require("./status-ui");
const { DashboardProvider } = require("./dashboard");
const {
  buildDashboardSettings,
  normalizeDashboardSettingUpdate
} = require("./dashboard-settings");
const {
  defaultCodexConfigPath,
  deleteModelProvider,
  fetchProviderModelsFromConfig,
  readCodexModelConfig,
  sanitizeAndMigrateProviders,
  setActiveModelProvider,
  upsertModelProvider,
  writeCodexModelConfig
} = require("./codex-config-core");

// ── State keys ───────────────────────────────────────────────────────────────
const AUTO_PATCH_SIGNATURE_STATE_KEY = "autoPatch.lastPatchedTargetSignature";
// Tracks the last Codex version we successfully patched (separate from our
// own extension version). When this changes we know Codex updated.
const LAST_PATCHED_CODEX_VERSION_KEY = "autoPatch.lastPatchedCodexVersion";
// Records the (extensionVersion, codexVersion) pair the user last *acknowledged*
// by reloading VS Code. If this pair differs from the current runtime pair,
// a reload is still pending — because Codex's webview process is still running
// the pre-patch files in memory. Persists across sessions, so a user who
// dismisses the reload prompt and restarts VS Code will see it again until
// they actually reload.
const LAST_RELOADED_PAIR_KEY = "autoPatch.lastReloadedPair";
const LEGACY_WARNING_DISMISSED_STATE_KEY = "legacyStartup.warningDismissed";
// Once per window-session flag: have we already shown the "orphan artifacts
// from a previous install are still active" prompt? We don't persist this
// across sessions because the orphans themselves are persistent — if they're
// still there next session, it's worth reminding the user.
let orphanWarningShownThisSession = false;

// ── Constants ─────────────────────────────────────────────────────────────────
const RELOAD_PROMPT_DELAY_MS = 1200;
const MARKETPLACE_URL =
  "https://marketplace.visualstudio.com/items?itemName=amirimatin.codex-nexus";
const CODEX_MARKETPLACE_URL =
  "https://marketplace.visualstudio.com/items?itemName=openai.chatgpt";

// ── Module-level state ────────────────────────────────────────────────────────
let autoPatchInFlight = null;
let lastAutoPatchedSignature = null;
let extensionGlobalState = null;
let extensionRuntimeVersion = "unknown";
let extensionTestedMeta = { testedCodexVersion: null, testedOn: null };
let reloadPromptVisible = false;
let pendingReloadResult = null;
let pendingReloadTimer = null;
let reloadStatusBarItem = null;
let extensionInstallPath = null;
let uninstallCleanupInFlight = null;
let output = null;
let logger = null;
let structuralWarnShownThisSession = false;
let reloadPromptShownThisSession = false;
let dashboardProvider = null;
let lastSignalResults = [];
let lastCheckAt = null;
let legacyStartupWarningVisible = false;
let legacyStartupWarningChecked = false;
let remoteGuidanceShownThisSession = false;
let codexProviderModelsState = { status: "idle", models: [], error: null, updatedAt: null };
let lifecycleLogger = createLogger((message) => console.log(`${new Date().toISOString()} ${message}`));

function activate(context) {
  extensionInstallPath = context.extensionPath;
  extensionGlobalState = context.globalState;
  extensionRuntimeVersion = context.extension?.packageJSON?.version ?? "unknown";
  extensionTestedMeta = {
    testedCodexVersion:
      context.extension?.packageJSON?.codexNexusMeta?.testedCodexVersion ??
      context.extension?.packageJSON?.codexVazirmatnFontMeta?.testedCodexVersion ??
      null,
    testedOn:
      context.extension?.packageJSON?.codexNexusMeta?.testedOn ??
      context.extension?.packageJSON?.codexVazirmatnFontMeta?.testedOn ??
      null
  };
  lastAutoPatchedSignature = extensionGlobalState.get(AUTO_PATCH_SIGNATURE_STATE_KEY, null);
  clearUninstallMarker(context.extensionPath);
  try {
    sanitizeAndMigrateProviders(defaultCodexConfigPath());
  } catch {
    /* ignore migration errors on activation */
  }

  output = vscode.window.createOutputChannel("Codex Nexus");
  logger = createLogger((message) => output.appendLine(`${new Date().toISOString()} ${message}`));
  lifecycleLogger = logger;
  context.subscriptions.push(output);

  function registerCmd(name, handler) {
    const primary = vscode.commands.registerCommand(`codexNexus.${name}`, handler);
    const legacy = vscode.commands.registerCommand(`codexVazirmatnFont.${name}`, handler);
    context.subscriptions.push(primary, legacy);
    return primary;
  }

  reloadStatusBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 1000);
  reloadStatusBarItem.command = "codexNexus.reloadForRtl";
  context.subscriptions.push(reloadStatusBarItem);

  registerCmd("reloadForRtl", async () => {
    await markReloadAcknowledged();
    await vscode.commands.executeCommand("workbench.action.reloadWindow");
  });

  // ── Commands ──────────────────────────────────────────────────────────────

  const applyCommand = registerCmd("applyPatch", async () => {
    try {
      const result = await applyPatch({ interactive: true });
      if (result.skipped && result.reason === "disabled") {
        const choice = await vscode.window.showInformationMessage(
          "Codex Nexus is disabled in settings.",
          "Open Settings"
        );
        if (choice === "Open Settings") {
          await vscode.commands.executeCommand("workbench.action.openSettings", `${CONFIG_SECTION}.enabled`);
        }
        return;
      }
      if (result.foundTarget && getSettings().showReloadPrompt) {
        if (result.changed || isReloadStillPending()) {
          await showReloadPrompt(result);
          return;
        }
        vscode.window.showInformationMessage("Codex Nexus patch is already up to date.");
      }
    } catch (error) {
      handleError(error, true);
    }
  });

  const compatibilityCommand = registerCmd("checkCompatibility", async () => {
    const target = getTargetPaths();
    const compatibility = inspectTargetCompatibility(target, getSettings());
    logCompatibilityToOutput(compatibility);

    if (!compatibility.foundTarget) {
      const codexVersion = getCodexVersion();
      const msg = codexVersion
        ? `Codex v${codexVersion} found but its files are missing or inaccessible.`
        : "OpenAI Codex extension was not found. Install it from the VS Code Marketplace first.";
      vscode.window.showWarningMessage(msg, "Open Marketplace").then((choice) => {
        if (choice === "Open Marketplace") {
          vscode.env.openExternal(vscode.Uri.parse(CODEX_MARKETPLACE_URL));
        }
      });
      return;
    }

    if (compatibility.ok && (!compatibility.structuralWarnings || compatibility.structuralWarnings.length === 0)) {
      vscode.window.showInformationMessage("Codex Nexus compatibility check passed.");
      return;
    }

    if (!compatibility.ok) {
      const choice = await vscode.window.showErrorMessage(
        `Compatibility check failed: ${compatibility.reasons[0]}`,
        "Open Logs"
      );
      if (choice === "Open Logs") output.show(true);
      return;
    }

    // Structural warnings present (patch may be stale against this Codex).
    showStructuralWarningNotification(compatibility.structuralWarnings, { force: true });
  });

  const restoreCommand = registerCmd("restorePatch", async () => {
    try {
      const restored = restorePatch();
      if (!restored.foundTarget) {
        vscode.window.showWarningMessage("OpenAI Codex extension was not found.");
        return;
      }
      // Reverting the Codex UI language is independent of whether any files
      // actually changed: even if the patch had nothing to strip, we should
      // still undo the `chatgpt.localeOverride = "fa"` that a previous install
      // put in place. Otherwise the user sees Persian menus with no RTL
      // CSS — a broken half-state.
      const localeReverted = await revertManagedLocaleToEnglish("restore");

      if (!restored.changed && !localeReverted) {
        vscode.window.showInformationMessage(
          "No managed Codex Nexus changes were found to restore."
        );
        return;
      }
      const detail = buildRestoreCompletionMessage(restored, localeReverted);
      const choice = await vscode.window.showInformationMessage(
        detail,
        "Reload Window"
      );
      if (choice === "Reload Window") {
        await markReloadAcknowledged();
        await vscode.commands.executeCommand("workbench.action.reloadWindow");
      }
    } catch (error) {
      handleError(error, true);
    }
  });

  // Explicit UI-language commands. Unlike the toggle button in the webview
  // (which only flips the input direction), these commands actually change
  // `chatgpt.localeOverride` and prompt for a reload — Codex reads that
  // setting only at webview hydration time, so a reload is strictly needed
  // for the UI-language change to take effect.
  const setLocalePersianCommand = registerCmd(
    "setLocalePersian",
    async () => {
      try {
        const changed = await setManagedLocaleToPersian("manual");
        if (!changed) {
          vscode.window.showInformationMessage(
            "Codex UI language is already set to Persian."
          );
          return;
        }
        const choice = await vscode.window.showInformationMessage(
          "Codex UI language set to Persian. Reload VS Code to apply.",
          { modal: true, detail: "Without reloading, Codex will keep rendering the current UI language until the next restart." },
          "Reload Window",
          "Later"
        );
        if (choice === "Reload Window") {
          await markReloadAcknowledged();
          await vscode.commands.executeCommand("workbench.action.reloadWindow");
        } else {
          showReloadStatusBar({ foundTarget: true });
        }
      } catch (error) {
        handleError(error, true);
      }
    }
  );

  const setLocaleEnglishCommand = registerCmd(
    "setLocaleEnglish",
    async () => {
      try {
        const changed = await revertManagedLocaleToEnglish("manual");
        if (!changed) {
          vscode.window.showInformationMessage(
            "Codex UI language is not currently set to Persian."
          );
          return;
        }
        const choice = await vscode.window.showInformationMessage(
          "Codex UI language reverted to English. Reload VS Code to apply.",
          { modal: true, detail: "Without reloading, Codex will keep rendering the current UI language until the next restart." },
          "Reload Window",
          "Later"
        );
        if (choice === "Reload Window") {
          await markReloadAcknowledged();
          await vscode.commands.executeCommand("workbench.action.reloadWindow");
        } else {
          showReloadStatusBar({ foundTarget: true });
        }
      } catch (error) {
        handleError(error, true);
      }
    }
  );

  const setLocaleArabicCommand = registerCmd(
    "setLocaleArabic",
    async () => {
      try {
        const changed = await setManagedLocaleToArabic("manual");
        if (!changed) {
          vscode.window.showInformationMessage(
            "Codex UI language is already set to Arabic."
          );
          return;
        }
        const choice = await vscode.window.showInformationMessage(
          "Codex UI language set to Arabic. Reload VS Code to apply.",
          { modal: true, detail: "Without reloading, Codex will keep rendering the current UI language until the next restart." },
          "Reload Window",
          "Later"
        );
        if (choice === "Reload Window") {
          await markReloadAcknowledged();
          await vscode.commands.executeCommand("workbench.action.reloadWindow");
        } else {
          showReloadStatusBar({ foundTarget: true });
        }
      } catch (error) {
        handleError(error, true);
      }
    }
  );

  const cleanOrphansCommand = registerCmd(
    "cleanOrphanArtifacts",
    async () => {
      try {
        const result = cleanOrphanArtifacts();
        if (!result.foundTarget) {
          vscode.window.showWarningMessage("OpenAI Codex extension was not found.");
          return;
        }
        if (!result.changed) {
          vscode.window.showInformationMessage(
            "No orphan patch artifacts were found in the Codex install."
          );
          return;
        }
        const choice = await vscode.window.showInformationMessage(
          `Cleaned up ${result.removedCount} orphan artifact${result.removedCount === 1 ? "" : "s"} from Codex. Reload VS Code to finish.`,
          "Reload Window",
          "Open Logs"
        );
        if (choice === "Reload Window") {
          await markReloadAcknowledged();
          await vscode.commands.executeCommand("workbench.action.reloadWindow");
        } else if (choice === "Open Logs") {
          output.show(true);
        }
      } catch (error) {
        handleError(error, true);
      }
    }
  );

  const cleanupCommand = registerCmd("fullCleanup", async () => {
    try {
      const result = await runFullCleanup(logger);
      if (!result.patchChanged && !result.settingsChanged && !result.localeChanged && !result.legacyStartupChanged) {
        vscode.window.showInformationMessage("No managed Codex Nexus changes were found to clean up.");
        return;
      }
      const choice = await vscode.window.showInformationMessage(
        buildCleanupMessage(result),
        "Reload Window"
      );
      if (choice === "Reload Window") {
        await markReloadAcknowledged();
        await vscode.commands.executeCommand("workbench.action.reloadWindow");
      }
    } catch (error) {
      handleError(error, true);
    }
  });

  const auditEnvironmentCommand = registerCmd("auditEnvironment", async () => {
    try {
      const report = inspectLegacyStartupHooks();
      output.appendLine(`${new Date().toISOString()} [Codex Nexus] Environment audit`);
      logLegacyStartupReport(report);
      if (!report.found) {
        vscode.window.showInformationMessage("No legacy external Startup hooks were found.");
        return;
      }
      const choice = await vscode.window.showWarningMessage(
        "Legacy external Startup scripts were found. They are not required by this extension version.",
        "Remove Hooks",
        "Open Startup Folder"
      );
      if (choice === "Remove Hooks") {
        await vscode.commands.executeCommand("codexNexus.removeLegacyStartupHooks");
      } else if (choice === "Open Startup Folder" && report.startupFolderPath) {
        await vscode.env.openExternal(vscode.Uri.file(report.startupFolderPath));
      }
    } catch (error) {
      handleError(error, true);
    }
  });

  const removeLegacyHooksCommand = registerCmd(
    "removeLegacyStartupHooks",
    async () => {
      try {
        const result = removeLegacyStartupHooks();
        output.appendLine(`${new Date().toISOString()} [Codex Nexus] Legacy Startup cleanup`);
        logLegacyStartupRemoval(result);

        if (result.failedHooks.length > 0) {
          const firstFailure = result.failedHooks[0];
          vscode.window.showErrorMessage(
            `Failed to remove startup hook ${firstFailure.name}: ${firstFailure.error}`,
            "Open Logs"
          ).then((choice) => {
            if (choice === "Open Logs") output.show(true);
          });
          return;
        }

        if (!result.changed) {
          vscode.window.showInformationMessage("No legacy startup hooks were found.");
          return;
        }

        await persistLegacyWarningDismissed(true);
        const removedNames = result.removedHooks.map((hook) => hook.name).join(", ");
        vscode.window.showInformationMessage(`Removed legacy startup hooks: ${removedNames}.`);
      } catch (error) {
        handleError(error, true);
      }
    }
  );

  // ── Status bar menu ────────────────────────────────────────────────────────
  const menuCommandId = "codexNexus.showStatusMenu";
  registerCmd("showStatusMenu", async () => {
    await statusUi.showMenu({
      check: async () => {
        await runInteractiveCompatibilityCheck();
      },
      reapply: async () => {
        let reapplyResult = null;
        await statusUi.runWithProgress("Re-applying Codex Nexus patch…", async (report) => {
          report("Reading Codex files", 20);
          try {
            reapplyResult = await applyPatch({ interactive: true });
          } catch (error) {
            handleError(error, true);
            return;
          }
          report("Done", 100);
          updateStatusBarFromResult(reapplyResult);
        });
        if (reapplyResult && reapplyResult.foundTarget && getSettings().showReloadPrompt) {
          if (reapplyResult.changed || isReloadStillPending()) {
            await showReloadPrompt(reapplyResult);
          }
        }
      },
      logs: () => output.show(true),
      marketplace: async () => {
        await vscode.env.openExternal(vscode.Uri.parse(MARKETPLACE_URL));
      },
      restore: async () => {
        await vscode.commands.executeCommand("codexNexus.restorePatch");
      }
    });
  });

  statusUi.createStatusBarItem(context, menuCommandId);

  // ── Dashboard webview in the activity bar ─────────────────────────────────
  dashboardProvider = new DashboardProvider(
    context.extensionUri,
    buildDashboardState,
    updateDashboardSetting,
    updateCodexModel,
    refreshCodexProviderModels,
    switchActiveProvider,
    saveCustomProvider,
    deleteCustomProvider
  );
  globalThis.__codexNexusDashboard = dashboardProvider;
  globalThis.__codexVazirmatnDashboard = dashboardProvider;
  context.subscriptions.push(
    vscode.window.registerWebviewViewProvider("codexNexus.dashboard", dashboardProvider, {
      webviewOptions: { retainContextWhenHidden: true }
    }),
    vscode.window.registerWebviewViewProvider("codexVazirmatnFont.dashboard", dashboardProvider, {
      webviewOptions: { retainContextWhenHidden: true }
    })
  );

  registerCmd("openMarketplace", async () => {
    await vscode.env.openExternal(vscode.Uri.parse(MARKETPLACE_URL));
  });
  registerCmd("refreshDashboard", async () => {
    await runInteractiveCompatibilityCheck();
  });
  registerCmd("showLogs", () => {
    if (output) output.show(true);
  });

  context.subscriptions.push(
    vscode.extensions.onDidChange(() => {
      if (shouldCleanupOnDeactivate(extensionInstallPath)) {
        void runAutomaticUninstallCleanup(lifecycleLogger);
        return;
      }
      void queueAutoPatch();
    })
  );

  context.subscriptions.push(
    vscode.workspace.onDidChangeConfiguration((event) => {
      if (
        !event.affectsConfiguration(`${CONFIG_SECTION}.fontSize`) &&
        !event.affectsConfiguration(`${CONFIG_SECTION}.preferredFontFamily`)
      ) return;
      void applyPatch({ interactive: false }).catch((error) => handleError(error, true));
    })
  );

  context.subscriptions.push(
    vscode.window.onDidChangeWindowState((state) => {
      if (state.focused) void flushPendingReloadPrompt();
    })
  );

  void flushPendingReloadPrompt();
  initializeStatusBar();
  void queueAutoPatch();
  void maybeWarnLegacyStartupHooks();
  void maybeWarnOrphans();
}

function initializeStatusBar() {
  const codexVersion = getCodexVersion();
  const workbenchTarget = getWorkbenchTargetPaths();
  if (!codexVersion && !workbenchTarget) {
    statusUi.setNoTarget();
    return;
  }
  statusUi.setIdle();

  // If a previous session asked for a reload and the user dismissed it,
  // show the reload status-bar affordance immediately on boot — before the
  // first auto-patch run — so the user still has a visible hint.
  if (isReloadStillPending()) {
    showReloadStatusBar({ foundTarget: true });
  }
}

// ── Core patch logic ──────────────────────────────────────────────────────────

async function applyPatch(options) {
  const target = getTargetPaths();
  const workbenchTarget = getWorkbenchTargetPaths();

  if (!target && !workbenchTarget) {
    output.appendLine(
      `${new Date().toISOString()} [Codex Nexus] Neither OpenAI Codex extension nor VS Code Workbench was found.`
    );
    if (options.interactive) {
      const codexVersion = getCodexVersion();
      if (!codexVersion) {
        const choice = await vscode.window.showWarningMessage(
          "OpenAI Codex extension was not found. Install it from the VS Code Marketplace.",
          "Install Codex"
        );
        if (choice === "Install Codex") {
          await vscode.env.openExternal(vscode.Uri.parse(CODEX_MARKETPLACE_URL));
        }
      } else {
        vscode.window.showWarningMessage(
          `Codex v${codexVersion} found but its webview files are inaccessible. Try reloading VS Code.`
        );
      }
    }
    return { changed: false, foundTarget: false };
  }

  const settings = getSettings();
  let patchResult = { changed: false, foundTarget: false, skipped: false };
  let localeResult = { changed: false };
  let workbenchResult = { changed: false, foundTarget: false, skipped: false };

  // 1. Patch OpenAI Codex if available
  if (target) {
    const classification = classifyTargetAvailability({
      targetFound: true,
      targetReadable: fs.existsSync(target.indexFile),
      remoteName: vscode.env.remoteName,
      extensionIsLocalUi: Boolean(vscode.env.remoteName)
    });
    if (shouldAttemptPatch(classification)) {
      const codexModel = readCodexModelConfig();
      patchResult = applyPatchToTarget(target, {
        ...settings,
        customModel: codexModel.modelProvider && codexModel.model ? codexModel.model : null,
        customProvider: codexModel.modelProvider
          ? (codexModel.provider?.name || codexModel.modelProvider)
          : null
      }, logger);
      localeResult = await ensureCodexLanguagePreference(settings);
    } else {
      maybeShowRemoteGuidance(classification, options.interactive);
    }
  }

  // 2. Patch VS Code AI Chat / Workbench if available
  if (workbenchTarget && settings.patchAiChat !== false) {
    workbenchResult = applyPatchToWorkbench(workbenchTarget, settings, logger);
  }

  persistManagedTargetForCleanup(target, workbenchTarget);

  // ── Version-change logging ────────────────────────────────────────────────
  const currentCodexVersion = getCodexVersion() ?? "unknown";
  const prevCodexVersion = extensionGlobalState?.get(LAST_PATCHED_CODEX_VERSION_KEY, null);
  const codexVersionChanged = prevCodexVersion && prevCodexVersion !== currentCodexVersion;

  if (codexVersionChanged) {
    logger.info(`Codex updated: ${prevCodexVersion} → ${currentCodexVersion}. Re-patching.`);
  } else if (!prevCodexVersion && target) {
    logger.info(`First patch for Codex v${currentCodexVersion}.`);
  }

  if (patchResult.foundTarget) {
    void extensionGlobalState?.update(LAST_PATCHED_CODEX_VERSION_KEY, currentCodexVersion);
  }

  // ── Structural warnings ───────────────────────────────────────────────────
  const warnings = patchResult.structuralWarnings ?? [];
  if (warnings.length > 0) {
    logger.info(`Structural scan: ${warnings.length} warning(s) after patching Codex v${currentCodexVersion}.`);
    for (const w of warnings) logger.info(`  WARN ${w}`);
    if (!structuralWarnShownThisSession) {
      showStructuralWarningNotification(warnings);
    }
  } else if (patchResult.foundTarget) {
    logger.info(`Structural scan: all signals OK for Codex v${currentCodexVersion}.`);
  }

  // Update dashboard state
  if (patchResult.foundTarget) {
    lastSignalResults = normalizeDetailedSignals(patchResult.structuralSignals);
    lastCheckAt = Date.now();
  }

  const anyChanged = patchResult.changed || workbenchResult.changed || localeResult.changed;
  const anyFound = patchResult.foundTarget || workbenchResult.foundTarget;

  const result = {
    ...patchResult,
    changed: anyChanged,
    foundTarget: anyFound,
    skipped: (patchResult.skipped && workbenchResult.skipped),
    patchChanged: patchResult.changed,
    workbenchChanged: workbenchResult.changed,
    localeChanged: localeResult.changed,
    localeResult,
    workbenchResult
  };

  const currentPair = `${extensionRuntimeVersion}|${currentCodexVersion}|${vscode.version}`;
  const acknowledgedPair = extensionGlobalState?.get(LAST_RELOADED_PAIR_KEY, null);
  const pairChanged = acknowledgedPair !== currentPair;
  const needsReload =
    anyFound &&
    (anyChanged || codexVersionChanged || !prevCodexVersion || pairChanged);

  if (needsReload && settings.showReloadPrompt && !options.interactive) {
    queueReloadPrompt(result);
  }

  if (needsReload) {
    showReloadStatusBar(result);
  } else {
    hideReloadStatusBar();
  }

  if (options.interactive && workbenchResult.skipped && workbenchResult.reason === "permissionDenied") {
    const fixCmd = process.platform === "darwin"
      ? `sudo chown -R $(whoami) "/Applications/Visual Studio Code.app"`
      : `sudo chown -R $(whoami) "${workbenchTarget?.appRoot || "/usr/share/code"}"`;
    void vscode.window.showWarningMessage(
      "VS Code AI Chat RTL requires write permissions to the VS Code installation folder.",
      "Copy Fix Command",
      "Open Logs"
    ).then(async (choice) => {
      if (choice === "Copy Fix Command") {
        await vscode.env.clipboard.writeText(fixCmd);
        void vscode.window.showInformationMessage(
          `Command copied to clipboard:
${fixCmd}
Paste it into your terminal, then re-apply the patch.`
        );
      } else if (choice === "Open Logs") {
        output?.show(true);
      }
    });
  }

  updateStatusBarFromResult(result);
  refreshDashboard();

  return result;
}

// ── Status bar state updates ─────────────────────────────────────────────────

function updateStatusBarFromResult(result) {
  const codexVersion = getCodexVersion();

  if (!result || !result.foundTarget) {
    if (!codexVersion) {
      statusUi.setNoTarget();
    } else {
      statusUi.setError({ message: "Codex is not accessible." });
    }
    return;
  }

  const warnings = result.structuralWarnings ?? [];
  if (warnings.length > 0) {
    statusUi.setWarn({
      codexVersion,
      ourVersion: extensionRuntimeVersion,
      warningCount: warnings.length,
      warnings
    });
    return;
  }

  statusUi.setOk({
    codexVersion,
    ourVersion: extensionRuntimeVersion
  });
}

// ── Interactive compatibility check with progress UI ─────────────────────────

async function runInteractiveCompatibilityCheck() {
  let finalResult = null;
  await statusUi.runWithProgress(
    "Codex Nexus: Checking compatibility…",
    async (report) => {
      report("Locating components", 10);
      const target = getTargetPaths();
      const workbenchTarget = getWorkbenchTargetPaths();
      const codexVersion = getCodexVersion();
      const settings = getSettings();

      if (!target && !workbenchTarget) {
        finalResult = { kind: "noTarget", codexVersion };
        return;
      }

      report("Verifying target files", 30);
      await sleep(200);

      let compatibility = null;
      if (target) {
        report(`Scanning Codex v${codexVersion}`, 50);
        compatibility = inspectTargetCompatibility(target, settings);
        logCompatibilityToOutput(compatibility);
        lastSignalResults = normalizeDetailedSignals(compatibility.structuralSignals);
      }

      if (workbenchTarget) {
        report("Scanning VS Code Workbench AI Chat", 75);
        const wbCompatibility = inspectWorkbenchCompatibility(workbenchTarget, settings);
        logCompatibilityToOutput(wbCompatibility);
      }

      lastCheckAt = Date.now();

      report("Evaluating results", 90);
      await sleep(150);

      if (compatibility && !compatibility.ok) {
        finalResult = { kind: "error", compatibility, codexVersion };
        return;
      }
      const warnings = compatibility?.structuralWarnings ?? [];
      finalResult = {
        kind: warnings.length > 0 ? "warn" : "ok",
        warnings,
        codexVersion,
        compatibility
      };
      report(warnings.length > 0 ? `${warnings.length} warning(s)` : "All signals pass ✓", 100);
      refreshDashboard();
    }
  );

  if (!finalResult) return;
  if (finalResult.kind === "noTarget") {
    statusUi.setNoTarget();
    const choice = await vscode.window.showWarningMessage(
      !finalResult.codexVersion
        ? "Codex is not installed. Install it from the Marketplace first."
        : `Codex v${finalResult.codexVersion} is installed but its files are inaccessible.`,
      !finalResult.codexVersion ? "Install Codex" : "Open Logs"
    );
    if (choice === "Install Codex") {
      await vscode.env.openExternal(vscode.Uri.parse(CODEX_MARKETPLACE_URL));
    } else if (choice === "Open Logs") {
      output.show(true);
    }
  } else if (finalResult.kind === "error") {
    statusUi.setError({ message: finalResult.compatibility.reasons[0] });
    const choice = await vscode.window.showErrorMessage(
      `Compatibility check failed: ${finalResult.compatibility.reasons[0]}`,
      "Open Logs"
    );
    if (choice === "Open Logs") output.show(true);
  } else if (finalResult.kind === "warn") {
    statusUi.setWarn({
      codexVersion: finalResult.codexVersion,
      ourVersion: extensionRuntimeVersion,
      warningCount: finalResult.warnings.length,
      warnings: finalResult.warnings
    });
    showStructuralWarningNotification(finalResult.warnings, { force: true });
  } else {
    statusUi.setOk({
      codexVersion: finalResult.codexVersion,
      ourVersion: extensionRuntimeVersion
    });
    vscode.window.showInformationMessage(
      `✓ Codex Nexus is active and compatible.`
    );
  }
  refreshDashboard();
}

function refreshDashboard() {
  try {
    if (dashboardProvider) dashboardProvider.refresh();
  } catch {}
}

function buildDashboardState() {
  const statusState = statusUi.getCurrentState() ?? { kind: "idle" };
  const codexVersion = getCodexVersion();
  const lastCheckAtText = lastCheckAt ? formatRelativeTime(Date.now() - lastCheckAt) : null;

  const signals = lastSignalResults.map((s) => ({
    name: s.name,
    ok: s.ok,
    tier: s.tier,
    category: s.category,
    scope: s.scope,
    why: s.why
  }));

  const warnings = [];
  if (statusState.kind === "warn" && Array.isArray(statusState.info?.warnings)) {
    for (const w of statusState.info.warnings) warnings.push(w);
  }

  const coreSignals = signals.filter((s) => s.tier === 1);
  const featureSignals = signals.filter((s) => s.tier === 2);
  const signalSummary = {
    core:    { passed: coreSignals.filter((s) => s.ok).length,    total: coreSignals.length },
    feature: { passed: featureSignals.filter((s) => s.ok).length, total: featureSignals.length }
  };

  return {
    kind: statusState.kind,
    message: statusState.message,
    info: {
      codexVersion: codexVersion ?? "—",
      ourVersion: extensionRuntimeVersion,
      lastCheckAt: lastCheckAtText,
      ...(statusState.info || {})
    },
    signals,
    signalSummary,
    warnings,
    tested: computeTestedCompatibility(codexVersion, signals),
    locale: readCurrentLocaleState(),
    settings: buildDashboardSettings(getSettings()),
    codexModel: readCodexModelState()
  };
}

async function updateDashboardSetting(key, value) {
  const update = normalizeDashboardSettingUpdate(key, value);
  const config = vscode.workspace.getConfiguration(CONFIG_SECTION);
  await config.update(update.key, update.value, vscode.ConfigurationTarget.Global);
  refreshDashboard();
}

function readCodexModelState() {
  try {
    return { ok: true, ...readCodexModelConfig(), models: codexProviderModelsState };
  } catch (error) {
    return {
      ok: false,
      path: null,
      exists: false,
      model: null,
      modelProvider: null,
      reasoningEffort: null,
      provider: null,
      models: codexProviderModelsState,
      error: error instanceof Error ? error.message : String(error)
    };
  }
}

async function refreshCodexProviderModels() {
  codexProviderModelsState = { status: "loading", models: [], error: null, updatedAt: null };
  refreshDashboard();
  try {
    const models = await fetchProviderModelsFromConfig();
    codexProviderModelsState = { status: "ready", models: models || [], error: null, updatedAt: Date.now() };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    codexProviderModelsState = { status: "error", models: [], error: message, updatedAt: Date.now() };
    vscode.window.showErrorMessage(`Could not load provider models: ${message}`);
  } finally {
    refreshDashboard();
  }
}

async function updateCodexModel(model) {
  const saved = writeCodexModelConfig(model);
  await applyPatch({ interactive: false });
  refreshDashboard();
  const choice = await vscode.window.showInformationMessage(
    `Codex model saved: ${saved.model}. Reload VS Code for the running Codex webview to pick it up.`,
    "Reload window"
  );
  if (choice === "Reload window") {
    await markReloadAcknowledged();
    await vscode.commands.executeCommand("workbench.action.reloadWindow");
  }
}

async function switchActiveProvider(providerId) {
  setActiveModelProvider(providerId);
  codexProviderModelsState = { status: "idle", models: [], error: null, updatedAt: null };
  refreshDashboard();
}

async function saveCustomProvider(providerId, data) {
  upsertModelProvider(providerId, data);
  if (data && data.activate) {
    await switchActiveProvider(providerId);
  } else {
    refreshDashboard();
  }
}

async function deleteCustomProvider(providerId) {
  deleteModelProvider(providerId);
  codexProviderModelsState = { status: "idle", models: [], error: null, updatedAt: null };
  refreshDashboard();
}

// Snapshot of the Codex UI-language setting for the dashboard. Returns the
// current locale value (possibly null) plus a flag noting whether we set it
// ourselves. The dashboard uses this to highlight the active language in
// the language-switcher card.
function readCurrentLocaleState() {
  try {
    const chatgptConfig = vscode.workspace.getConfiguration("chatgpt");
    const current = normalizeCodexLocale(chatgptConfig.get("localeOverride", null));
    const ourConfig = vscode.workspace.getConfiguration(CONFIG_SECTION);
    const managed = ourConfig.get("localeManaged", false) === true;
    return { current: current ?? null, managed };
  } catch {
    return { current: null, managed: false };
  }
}

// Compares the currently-installed Codex version against the version this
// build was explicitly regression-tested against. Codex uses four-part
// versions like 26.5409.20454 — compareVersion below handles arbitrary
// number of numeric segments.
// Compares the currently-installed Codex version against the version this
// build was explicitly regression-tested against, AND folds in the live
// structural-scan result so the verdict reflects reality instead of just
// metadata. See the matching helper in claude/extension.js for the design
// rationale; the user-visible states are identical except for "Codex" vs
// "Claude Code" wording, so the dashboard can render either side with the
// same code path.
function computeTestedCompatibility(installedCodexVersion, signals) {
  const tested = extensionTestedMeta?.testedCodexVersion ?? null;
  const testedOn = extensionTestedMeta?.testedOn ?? null;
  if (!tested || !installedCodexVersion) {
    return { state: "unknown", tested, installed: installedCodexVersion ?? null, testedOn };
  }

  const cmp = compareVersion(installedCodexVersion, tested);

  if (cmp === 0) {
    return { state: "match", tested, installed: installedCodexVersion, testedOn };
  }

  if (cmp < 0) {
    return { state: "older", tested, installed: installedCodexVersion, testedOn };
  }

  // cmp > 0 — installed is newer than tested. Look at the live scan to
  // decide between Compatible / Ready-to-verify / Untested.
  const hasScanned = lastCheckAt !== null && Array.isArray(signals) && signals.length > 0;
  if (!hasScanned) {
    return { state: "needs-check", tested, installed: installedCodexVersion, testedOn };
  }

  const coreFailures = signals.filter((s) => s.tier === 1 && !s.ok).length;
  const featureFailures = signals.filter((s) => s.tier === 2 && !s.ok).length;
  if (coreFailures > 0) {
    return {
      state: "newer-with-warns",
      tested,
      installed: installedCodexVersion,
      testedOn,
      coreFailures,
      featureFailures
    };
  }

  return {
    state: "compatible",
    tested,
    installed: installedCodexVersion,
    testedOn,
    featureFailures
  };
}

// Generic numeric-version compare — supports any number of segments and
// collapses non-numeric fragments to 0 so it never throws on unexpected
// input (e.g. pre-release tags like "26.5409.20454-beta").
function compareVersion(a, b) {
  const parse = (v) =>
    String(v)
      .split(/[^0-9]+/)
      .filter(Boolean)
      .map((n) => Number(n) || 0);
  const pa = parse(a);
  const pb = parse(b);
  const len = Math.max(pa.length, pb.length);
  for (let i = 0; i < len; i += 1) {
    const da = pa[i] ?? 0;
    const db = pb[i] ?? 0;
    if (da > db) return 1;
    if (da < db) return -1;
  }
  return 0;
}

function formatRelativeTime(ms) {
  const sec = Math.floor(ms / 1000);
  if (sec < 5) return "just now";
  if (sec < 60) return sec + "s ago";
  const min = Math.floor(sec / 60);
  if (min < 60) return min + "m ago";
  const hr = Math.floor(min / 60);
  if (hr < 24) return hr + "h ago";
  const day = Math.floor(hr / 24);
  return day + "d ago";
}

// Map a detailed signal record (from patch-core's scanStructuralSignalsDetailed)
// into the shape the dashboard consumes. Keeping tier + category + why lets the
// UI group, color, and explain each row without re-parsing warning strings.
function normalizeDetailedSignals(detailed) {
  if (!Array.isArray(detailed)) return [];
  return detailed.map((r) => ({
    name: r.label,
    ok: !!r.ok,
    tier: r.tier,
    category: r.category,
    scope: r.scope,
    why: r.why
  }));
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// ── Structural warning notification ──────────────────────────────────────────
// `structuralWarnings` already only contains Tier-1 (core) misses — the
// patch-core scanner filters Tier-2 (feature) advisories out. So any warning
// here is, by definition, a core signal that would break Persian typing.

function showStructuralWarningNotification(warnings, options = {}) {
  if (structuralWarnShownThisSession && !options.force) return;
  if ((!warnings || warnings.length === 0) && !options.force) return;

  structuralWarnShownThisSession = true;

  const codexVersion = getCodexVersion() ?? "unknown";
  const count = warnings.length;
  const headline =
    count === 1
      ? `Codex Nexus: 1 compatibility warning for Codex v${codexVersion}`
      : `Codex Nexus: ${count} compatibility warnings for Codex v${codexVersion}`;

  vscode.window
    .showWarningMessage(
      headline + " — the RTL toggle button may not work correctly.",
      "Open Logs"
    )
    .then((choice) => {
      if (choice === "Open Logs") output.show(true);
    });
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function restorePatch() {
  const codexTarget = getTargetPaths();
  const workbenchTarget = getWorkbenchTargetPaths();
  const codexRestored = restoreTarget(codexTarget, logger);
  const workbenchRestored = restoreWorkbenchTarget(workbenchTarget, logger);
  return {
    changed: codexRestored.changed || workbenchRestored.changed,
    foundTarget: codexRestored.foundTarget || workbenchRestored.foundTarget,
    codexRestored,
    workbenchRestored
  };
}


function getWorkbenchTargetPaths() {
  const fontSource = path.join(__dirname, "assets", "Vazir.woff");
  return findInstalledWorkbenchTarget(vscode.env.appRoot, fontSource);
}

function getTargetPaths() {
  const extension = vscode.extensions.getExtension(TARGET_EXTENSION_ID);
  if (!extension) return null;
  return createTargetPaths(extension.extensionPath, path.join(__dirname, "assets", "Vazir.woff"));
}

function getCodexVersion() {
  const extension = vscode.extensions.getExtension(TARGET_EXTENSION_ID);
  return extension?.packageJSON?.version ?? null;
}

function getTargetSignature() {
  const extension = vscode.extensions.getExtension(TARGET_EXTENSION_ID);
  const codexSig = extension ? `${extension.id}@${extension.packageJSON?.version ?? "unknown"}:${extension.extensionPath}` : "no-codex";
  const workbenchTarget = getWorkbenchTargetPaths();
  const wbSig = workbenchTarget ? `vscode@${vscode.version}:${workbenchTarget.workbenchHtml}` : "no-wb";
  return `${codexSig}|${wbSig}`;
}

function getAutoPatchSignature() {
  const targetSignature = getTargetSignature();
  if (!targetSignature) return null;
  return `${targetSignature}|patch@${extensionRuntimeVersion}`;
}

function getSettings() {
  const settings = vscode.workspace.getConfiguration("codexNexus");
  const legacy = vscode.workspace.getConfiguration("codexVazirmatnFont");
  const getVal = (key, def) => settings.get(key, legacy.get(key, def));
  return {
    ...normalizeConfig({
      enabled: getVal("enabled", DEFAULT_CONFIG.enabled),
      patchOnStartup: getVal("patchOnStartup", DEFAULT_CONFIG.patchOnStartup),
      showReloadPrompt: getVal("showReloadPrompt", DEFAULT_CONFIG.showReloadPrompt),
      preferredFontFamily: getVal("preferredFontFamily", DEFAULT_CONFIG.preferredFontFamily),
      fontSize: getVal("fontSize", DEFAULT_CONFIG.fontSize),
      patchAiChat: getVal("patchAiChat", DEFAULT_CONFIG.patchAiChat)
    }),
    dashboardLanguage: getVal("dashboardLanguage", "en"),
    showLegacyStartupWarning: getVal("showLegacyStartupWarning", true),
    patchAiChat: getVal("patchAiChat", true),
    autoSetCodexLanguage: getVal("autoSetCodexLanguage", true),
    preferredCodexLocale:
      normalizeCodexLocale(getVal("preferredCodexLocale", DEFAULT_CODEX_LOCALE)) ?? DEFAULT_CODEX_LOCALE
  };
}

// Explicitly sets `chatgpt.localeOverride` to the user's preferred Codex
// locale (defaults to "fa"). Idempotent — returns false if the setting is
// already at the desired value. Stores the previous locale in the state
// store so a subsequent revert can restore the user's prior choice rather
// than blindly forcing English.
async function setManagedLocaleToPersian(trigger) {
  try {
    const settings = getSettings();
    const chatgptConfig = vscode.workspace.getConfiguration("chatgpt");
    const currentLocale = normalizeCodexLocale(chatgptConfig.get("localeOverride", null));
    const targetLocale = normalizeCodexLocale(settings.preferredCodexLocale) ?? DEFAULT_CODEX_LOCALE;

    if (currentLocale === targetLocale) {
      logger.info(`Locale set (${trigger}): already at "${targetLocale}".`);
      return false;
    }

    updateExtensionState((state) => ({
      ...state,
      localeOverride: {
        wasManaged: true,
        previousLocale: typeof currentLocale === "string" ? currentLocale : null,
        managedLocale: targetLocale
      }
    }));
    await chatgptConfig.update("localeOverride", targetLocale, vscode.ConfigurationTarget.Global);

    const extensionConfig = vscode.workspace.getConfiguration(CONFIG_SECTION);
    try {
      await extensionConfig.update("localeManaged", true, vscode.ConfigurationTarget.Global);
    } catch {}

    logger.info(`Locale set (${trigger}): ${LOCALE_OVERRIDE_SETTING} "${currentLocale ?? "(unset)"}" → "${targetLocale}".`);
    return true;
  } catch (error) {
    logger.info(`Locale set (${trigger}) failed: ${error && error.message ? error.message : String(error)}`);
    return false;
  }
}

async function setManagedLocaleToArabic(trigger) {
  try {
    const chatgptConfig = vscode.workspace.getConfiguration("chatgpt");
    const currentLocale = normalizeCodexLocale(chatgptConfig.get("localeOverride", null));
    const targetLocale = "ar";

    if (currentLocale === targetLocale) {
      logger.info(`Locale set (${trigger}): already at "${targetLocale}".`);
      return false;
    }

    updateExtensionState((state) => ({
      ...state,
      localeOverride: {
        wasManaged: true,
        previousLocale: typeof currentLocale === "string" ? currentLocale : null,
        managedLocale: targetLocale
      }
    }));
    await chatgptConfig.update("localeOverride", targetLocale, vscode.ConfigurationTarget.Global);

    const extensionConfig = vscode.workspace.getConfiguration(CONFIG_SECTION);
    try {
      await extensionConfig.update("localeManaged", true, vscode.ConfigurationTarget.Global);
    } catch {}

    logger.info(`Locale set (${trigger}): ${LOCALE_OVERRIDE_SETTING} "${currentLocale ?? "(unset)"}" → "${targetLocale}".`);
    return true;
  } catch (error) {
    logger.info(`Locale set (${trigger}) failed: ${error && error.message ? error.message : String(error)}`);
    return false;
  }
}

// Reverts the Codex UI language back to English when we are tearing down the
// patch. This is the counterpart to `ensureCodexLanguagePreference`: Apply
// sets `chatgpt.localeOverride = "fa"`, Restore/Uninstall should flip it back.
//
// Policy (deliberate, to avoid stepping on the user's own preferences):
//
//   - If `localeOverride` is currently "fa" AND we previously marked it as
//     managed (via `codexVazirmatnFont.localeManaged` flag or the persisted
//     state-store record), we own it — revert it to the previous value if we
//     recorded one, otherwise explicitly set it to "en".
//   - If `localeOverride` is "fa" but we have NO record of having set it,
//     we conservatively still flip it to "en" here, because the alternative
//     (leaving Persian menus with no RTL CSS) is the exact broken half-state
//     the user is complaining about. Safer bias: restore should make the UI
//     look like Codex did before the extension existed.
//   - If `localeOverride` is anything other than "fa" (empty, "en", "de",
//     etc.), the user has chosen it themselves — we do not touch it.
//
// `trigger` is a label that flows into the output log so the audit trail
// shows *why* the locale changed (restore / uninstall / toggle-button-to-en).
async function revertManagedLocaleToEnglish(trigger) {
  try {
    const chatgptConfig = vscode.workspace.getConfiguration("chatgpt");
    const currentLocale = normalizeCodexLocale(chatgptConfig.get("localeOverride", null));

    if (currentLocale !== "fa") {
      logger.info(`Locale revert (${trigger}): skipped — current localeOverride is "${currentLocale ?? "(unset)"}", not "fa".`);
      return false;
    }

    // Look up what the locale was *before* we set it, so we can restore the
    // user's prior value rather than always forcing "en". The state-store
    // persists this across sessions (same payload we wrote in
    // `ensureCodexLanguagePreference`).
    let previousLocale = null;
    try {
      const stored = require("./state-store").readCleanupState?.();
      previousLocale = normalizeCodexLocale(stored?.localeOverride?.previousLocale);
    } catch {
      previousLocale = null;
    }

    const targetLocale = previousLocale && previousLocale !== "fa" ? previousLocale : "en";

    await chatgptConfig.update("localeOverride", targetLocale, vscode.ConfigurationTarget.Global);

    // Tear down our managed-locale markers too: the settings flag and the
    // state-store record. If the user later re-applies the patch, the
    // `ensureCodexLanguagePreference` flow will re-create both from scratch.
    const extensionConfig = vscode.workspace.getConfiguration(CONFIG_SECTION);
    try {
      await extensionConfig.update("localeManaged", undefined, vscode.ConfigurationTarget.Global);
    } catch {}
    try {
      updateExtensionState((state) => {
        if (!state || !state.localeOverride) return state;
        const next = { ...state };
        delete next.localeOverride;
        return next;
      });
    } catch {}

    logger.info(`Locale revert (${trigger}): set ${LOCALE_OVERRIDE_SETTING} to "${targetLocale}".`);
    return true;
  } catch (error) {
    logger.info(`Locale revert (${trigger}) failed: ${error && error.message ? error.message : String(error)}`);
    return false;
  }
}

// Build a single completion message covering the mix of outcomes that a
// restore run can produce (files reverted, locale reverted, neither, both).
function buildRestoreCompletionMessage(restored, localeReverted) {
  if (restored.changed && localeReverted) {
    return "Codex files restored and UI language reverted to English. Reload VS Code to apply the change.";
  }
  if (restored.changed) {
    return "Codex files restored. Reload VS Code to apply the change.";
  }
  if (localeReverted) {
    return "Codex UI language reverted to English. Reload VS Code to apply the change.";
  }
  return "No managed Codex Nexus changes were found to restore.";
}

async function ensureCodexLanguagePreference(settings) {
  const chatgptConfig = vscode.workspace.getConfiguration("chatgpt");
  const currentLocale = chatgptConfig.get("localeOverride", null);
  const action = resolveCodexLocaleAction({
    extensionEnabled: settings.enabled,
    autoSetLocale: settings.autoSetCodexLanguage,
    preferredLocale: settings.preferredCodexLocale,
    currentLocale
  });

  if (!action.shouldUpdate) {
    if (action.reason === "userConfiguredOtherLocale") {
      logger.info(
        `Skipped setting ${LOCALE_OVERRIDE_SETTING} because Codex is already configured for "${action.currentLocale}".`
      );
    } else if (action.reason === "alreadyConfigured") {
      logger.info(`${LOCALE_OVERRIDE_SETTING} is already set to "${action.locale}".`);
    } else if (action.reason === "autoLocaleDisabled") {
      logger.info("Automatic Codex language configuration is disabled in settings.");
    }
    return { changed: false, ...action };
  }

  updateExtensionState((state) => ({
    ...state,
    localeOverride: {
      wasManaged: true,
      previousLocale: typeof currentLocale === "string" ? currentLocale : null,
      managedLocale: action.locale
    }
  }));
  await chatgptConfig.update("localeOverride", action.locale, vscode.ConfigurationTarget.Global);
  const extensionConfig = vscode.workspace.getConfiguration(CONFIG_SECTION);
  await extensionConfig.update("localeManaged", true, vscode.ConfigurationTarget.Global);
  logger.info(`Set ${LOCALE_OVERRIDE_SETTING} to "${action.locale}".`);
  return { changed: true, ...action };
}

function persistManagedTargetForCleanup(target) {
  if (!target?.extensionPath) return;
  updateExtensionState((state) => ({ ...state, targetExtensionPath: target.extensionPath }));
}

async function runFullCleanup(logger) {
  return performInstalledCleanup({ extensionInstallPath, logger });
}

function maybeShowRemoteGuidance(classification, interactive) {
  if (!shouldExplainRemote(classification)) return;
  const remoteName = vscode.env.remoteName;
  logger?.info(`Patch skipped (${classification}); remoteName=${remoteName ?? "local"}.`);
  if (!interactive && remoteGuidanceShownThisSession) return;
  remoteGuidanceShownThisSession = true;
  const message = buildRemoteGuidanceMessage(classification, "Codex", remoteName);
  vscode.window.showInformationMessage(message, "Open Logs").then((choice) => {
    if (choice === "Open Logs") output?.show(true);
  });
}

function handleError(error, interactive) {
  const message = error instanceof Error ? error.message : String(error);
  output?.appendLine(`${new Date().toISOString()} [Codex Nexus] ERROR ${message}`);
  if (interactive) {
    void vscode.window.showErrorMessage(`Codex Nexus: ${message}`, "Open Logs").then((choice) => {
      if (choice === "Open Logs") output?.show(true);
    });
  }
}

// ── Auto-patch queue ──────────────────────────────────────────────────────────

function queueAutoPatch() {
  const settings = getSettings();
  if (!settings.enabled || !settings.patchOnStartup) {
    logger.info("Auto patch skipped because startup patching is disabled in settings.");
    // Even when auto-patch is disabled, we still want the dashboard to show
    // real signal counts and a useful Tested-with verdict. A read-only scan
    // is cheap and side-effect free.
    void runSilentBackgroundScan("auto-patch disabled");
    return Promise.resolve();
  }

  const autoPatchSignature = getAutoPatchSignature();
  if (autoPatchSignature && autoPatchSignature === lastAutoPatchedSignature) {
    logger.info("Auto patch skipped because the installed Codex target has not changed.");
    // Signature match means we've already patched this exact target — no file
    // work needed, but we still need a scan to populate the dashboard. Without
    // this the user sees "Last check: never" and the Tested-with card falls
    // back to "Ready to verify" until they click the button.
    void runSilentBackgroundScan("signature match");
    return Promise.resolve();
  }

  if (autoPatchInFlight) return autoPatchInFlight;

  autoPatchInFlight = applyPatch({ interactive: false })
    .then((result) => {
      if (result?.foundTarget) {
        lastAutoPatchedSignature = autoPatchSignature;
        void persistAutoPatchSignature(autoPatchSignature);
      } else {
        lastAutoPatchedSignature = null;
        void persistAutoPatchSignature(null);
      }
      return result;
    })
    .catch((error) => {
      lastAutoPatchedSignature = null;
      void persistAutoPatchSignature(null);
      handleError(error, false);
      // Surface the failure on the status bar so the user knows something
      // went wrong without having to open the Output channel. Without this
      // the bar would stay at "idle" forever and the silent failure would
      // be invisible.
      try {
        statusUi.setError({ message: error instanceof Error ? error.message : String(error) });
      } catch {}
      refreshDashboard();
    })
    .finally(() => {
      autoPatchInFlight = null;
    });

  return autoPatchInFlight;
}

function persistAutoPatchSignature(signature) {
  if (!extensionGlobalState) return Promise.resolve();
  return extensionGlobalState.update(AUTO_PATCH_SIGNATURE_STATE_KEY, signature);
}

// Runs a read-only structural scan and pushes the results into the dashboard
// and status bar. Used on activate when we can't or shouldn't run the full
// patch flow but still need accurate signal data so the Tested-with card
// never falls back to a misleading "Ready to verify" (or worse, "never").
//
// Read-only: never writes to Codex's files, never shows a notification.
// All errors are swallowed — this is a UI-warming hint, not a primary flow.
async function runSilentBackgroundScan(reason) {
  try {
    const target = getTargetPaths();
    if (!target) return;
    const compatibility = inspectTargetCompatibility(target, getSettings());
    if (!compatibility?.foundTarget) return;
    lastSignalResults = normalizeDetailedSignals(compatibility.structuralSignals);
    lastCheckAt = Date.now();
    updateStatusBarFromResult({
      foundTarget: true,
      structuralWarnings: compatibility.structuralWarnings ?? []
    });
    refreshDashboard();
    logger?.info(`Silent background scan ran (${reason}); dashboard refreshed.`);
  } catch (error) {
    logger?.info(
      `Silent background scan failed (${reason}): ` +
      (error && error.message ? error.message : String(error))
    );
  }
}

// ── Reload prompt ─────────────────────────────────────────────────────────────

async function showReloadPrompt(result) {
  if (reloadPromptVisible) return;
  showReloadStatusBar(result);
  reloadPromptVisible = true;
  try {
    // Use a modal dialog for the first prompt of the session so a
    // non-technical user can't miss it behind other notifications.
    const useModal = !reloadPromptShownThisSession;
    reloadPromptShownThisSession = true;

    const choice = await vscode.window.showInformationMessage(
      buildReloadMessage(result),
      {
        modal: useModal,
        detail: useModal
          ? "Without reloading, the Codex webview will keep running the un-patched UI code already loaded in memory."
          : undefined
      },
      "Reload Window",
      "Later"
    );
    if (choice === "Reload Window") {
      await markReloadAcknowledged();
      await vscode.commands.executeCommand("workbench.action.reloadWindow");
    }
  } finally {
    reloadPromptVisible = false;
  }
}

function queueReloadPrompt(result) {
  pendingReloadResult = result;
  showReloadStatusBar(result);
  if (pendingReloadTimer) clearTimeout(pendingReloadTimer);
  pendingReloadTimer = setTimeout(() => {
    pendingReloadTimer = null;
    void flushPendingReloadPrompt();
  }, RELOAD_PROMPT_DELAY_MS);
}

async function flushPendingReloadPrompt() {
  if (!pendingReloadResult || reloadPromptVisible || !vscode.window.state.focused) return;
  const result = pendingReloadResult;
  pendingReloadResult = null;
  await showReloadPrompt(result);
}

function buildReloadMessage(result) {
  if (result?.patchChanged && result?.localeChanged) {
    return "Codex Nexus: patch applied and Persian language set. Reload VS Code to apply.";
  }
  if (result?.localeChanged) {
    return "Codex Nexus: Persian language configured. Reload VS Code to apply.";
  }
  return "Codex Nexus: patch applied. Reload the VS Code window so Codex picks up the Persian RTL changes.";
}

function showReloadStatusBar(result) {
  if (!reloadStatusBarItem) return;
  reloadStatusBarItem.text = "$(refresh) Reload for Codex RTL";
  reloadStatusBarItem.tooltip =
    "Codex Nexus patch is applied on disk, but the running Codex webview is still using the old UI. Click to reload VS Code.";
  // Use the prominent warning background so the button actually draws the eye
  // of a non-technical user instead of blending into the status bar.
  reloadStatusBarItem.backgroundColor = new vscode.ThemeColor("statusBarItem.warningBackground");
  reloadStatusBarItem.show();
}

function hideReloadStatusBar() {
  if (!reloadStatusBarItem) return;
  // Clear the warning background before hiding so a future show() that's not
  // a reload-pending state doesn't accidentally inherit the warning color.
  reloadStatusBarItem.backgroundColor = undefined;
  reloadStatusBarItem.hide();
}

async function markReloadAcknowledged() {
  if (!extensionGlobalState) return;
  const codexVersion = getCodexVersion() ?? "unknown";
  const pair = `${extensionRuntimeVersion}|${codexVersion}`;
  try {
    await extensionGlobalState.update(LAST_RELOADED_PAIR_KEY, pair);
  } catch {}
}

function isReloadStillPending() {
  if (!extensionGlobalState) return false;
  const codexVersion = getCodexVersion() ?? "unknown";
  const currentPair = `${extensionRuntimeVersion}|${codexVersion}`;
  const acknowledgedPair = extensionGlobalState.get(LAST_RELOADED_PAIR_KEY, null);
  return acknowledgedPair !== currentPair;
}

// ── Legacy startup hooks (carried over from pre-dashboard extension) ────────

async function maybeWarnLegacyStartupHooks() {
  if (legacyStartupWarningChecked || legacyStartupWarningVisible) return;
  legacyStartupWarningChecked = true;

  const settings = getSettings();
  if (!settings.showLegacyStartupWarning) return;

  const dismissed = extensionGlobalState?.get(LEGACY_WARNING_DISMISSED_STATE_KEY, false) === true;
  if (dismissed) return;

  const report = inspectLegacyStartupHooks();
  logLegacyStartupReport(report);
  if (!report.found) return;

  legacyStartupWarningVisible = true;
  try {
    const choice = await vscode.window.showWarningMessage(
      "Legacy external Windows Startup scripts detected for Codex RTL. This extension works without them.",
      "Remove Hooks",
      "Open Startup Folder",
      "Don't Show Again"
    );
    if (choice === "Remove Hooks") {
      await vscode.commands.executeCommand("codexNexus.removeLegacyStartupHooks");
      return;
    }
    if (choice === "Open Startup Folder" && report.startupFolderPath) {
      await vscode.env.openExternal(vscode.Uri.file(report.startupFolderPath));
      return;
    }
    if (choice === "Don't Show Again") {
      await persistLegacyWarningDismissed(true);
    }
  } finally {
    legacyStartupWarningVisible = false;
  }
}

function logLegacyStartupReport(report) {
  const userStartup = report.startupFolders?.user ?? "N/A";
  const commonStartup = report.startupFolders?.common ?? "N/A";
  output.appendLine(`${new Date().toISOString()} [Codex Nexus] Legacy startup folder (user): ${userStartup}`);
  output.appendLine(`${new Date().toISOString()} [Codex Nexus] Legacy startup folder (common): ${commonStartup}`);
  for (const hook of report.startupFiles ?? []) {
    output.appendLine(
      `${new Date().toISOString()} [Codex Nexus] ${hook.exists ? "FOUND" : "MISSING"} legacy startup file (${hook.scope}): ${hook.name}`
    );
  }
  if (report.registryHooks?.available) {
    for (const entry of report.registryHooks.foundEntries ?? []) {
      output.appendLine(
        `${new Date().toISOString()} [Codex Nexus] FOUND legacy HKCU Run value: ${entry.name} -> ${entry.command}`
      );
    }
  } else if (report.registryHooks?.error) {
    output.appendLine(
      `${new Date().toISOString()} [Codex Nexus] Registry audit unavailable: ${report.registryHooks.error}`
    );
  }
}

function logLegacyStartupRemoval(result) {
  for (const hook of result.removedHooks) {
    if (hook.type === "registryRun") {
      output.appendLine(
        `${new Date().toISOString()} [Codex Nexus] Removed legacy HKCU Run value: ${hook.name}`
      );
      continue;
    }
    output.appendLine(
      `${new Date().toISOString()} [Codex Nexus] Removed legacy startup file (${hook.scope}): ${hook.name}`
    );
  }
  for (const hook of result.failedHooks) {
    output.appendLine(
      `${new Date().toISOString()} [Codex Nexus] Failed to remove ${hook.name}: ${hook.error}`
    );
  }
}

function persistLegacyWarningDismissed(value) {
  if (!extensionGlobalState) return Promise.resolve();
  return extensionGlobalState.update(LEGACY_WARNING_DISMISSED_STATE_KEY, Boolean(value));
}

function buildCleanupMessage(result) {
  if (result.patchChanged && result.localeChanged && result.settingsChanged && result.legacyStartupChanged) {
    return "Codex patch, managed settings, managed locale, and legacy external startup hooks were cleaned up. Reload VS Code to finish.";
  }
  if (result.patchChanged && result.localeChanged && result.settingsChanged) {
    return "Codex Nexus patch, managed settings, and managed locale changes were cleaned up. Reload VS Code to finish.";
  }
  if (result.legacyStartupChanged && (result.patchChanged || result.localeChanged || result.settingsChanged)) {
    return "Codex cleanup completed and legacy external startup hooks were removed. Reload VS Code to finish.";
  }
  if (result.legacyStartupChanged) {
    return "Legacy external startup hooks were removed.";
  }
  if (result.patchChanged && (result.localeChanged || result.settingsChanged)) {
    return "Codex Nexus patch and managed settings were cleaned up. Reload VS Code to finish.";
  }
  if (result.localeChanged || result.settingsChanged) {
    return "Managed Codex Nexus settings were cleaned up. Reload VS Code to finish.";
  }
  return "Original Codex files were restored. Reload VS Code to finish.";
}

// Clean up orphan artifacts left behind by a previous install — the
// <link rel="stylesheet" href="./assets/codex-rtl.css"> that older versions
// injected directly into index.html's <head>, plus the companion file on
// disk, plus any stray <script src> tags for the toggle script. Each of
// these was previously unreachable by `restoreTarget` when no backup existed.
//
// Returns a small result object the command handler uses to build a user
// message. Safe to call even when no target is present — it just reports
// `foundTarget: false`.
function cleanOrphanArtifacts() {
  const target = getTargetPaths();
  if (!target) {
    return { foundTarget: false, changed: false, removedCount: 0 };
  }

  let removedCount = 0;
  const path = require("path");
  const fs = require("fs");

  // Strip the managed block and any stray inline tags from index.html.
  try {
    const stripped = stripManagedArtifactsFromIndex(target.indexFile);
    if (stripped.changed) {
      logger.info(`Orphan cleanup: stripped ${stripped.removed.join(", ")} from ${target.indexFile}`);
      removedCount += stripped.removed.length;
    }
  } catch (error) {
    logger.info(`Orphan cleanup: could not process ${target.indexFile}: ${error && error.message ? error.message : String(error)}`);
  }

  // Remove the companion stylesheet if it exists but no managed block is
  // wrapping a reference to it. Codex vanilla does not ship this file, so
  // the only legitimate reason for it to exist is an active install.
  // detectOrphanArtifacts below captured that condition already — re-test
  // here on the freshly-stripped file for a single source of truth.
  const orphans = detectOrphanArtifacts(target).orphans;
  for (const orphan of orphans) {
    if (orphan.type === "rtlCssFile" || orphan.type === "toggleJsFile" || orphan.type === "legacyArtifact") {
      try {
        if (fs.existsSync(orphan.path)) {
          fs.unlinkSync(orphan.path);
          logger.info(`Orphan cleanup: removed ${orphan.path}`);
          removedCount += 1;
        }
      } catch (error) {
        logger.info(`Orphan cleanup: could not remove ${orphan.path}: ${error && error.message ? error.message : String(error)}`);
      }
    }
  }

  return { foundTarget: true, changed: removedCount > 0, removedCount };
}

// Shown once per session when we detect leftover artifacts from an older
// install that are still actively styling Codex even without this extension
// present. Gives the user a clear one-click path to clean them up.
async function maybeWarnOrphans() {
  if (orphanWarningShownThisSession) return;
  const target = getTargetPaths();
  if (!target) return;
  let report;
  try {
    report = detectOrphanArtifacts(target);
  } catch {
    return;
  }
  if (!report.hasOrphans) return;
  orphanWarningShownThisSession = true;

  logger.info(`Orphan detection: ${report.orphans.length} leftover artifact(s) found.`);
  for (const o of report.orphans) logger.info(`  ORPHAN ${o.type}: ${o.label}`);

  const count = report.orphans.length;
  const headline =
    count === 1
      ? "Codex is still loading a leftover Vazirmatn override from a previous install."
      : `Codex is still loading ${count} leftover artifacts from a previous install.`;
  const choice = await vscode.window.showWarningMessage(
    `${headline} This can make the Persian font appear before this extension is active.`,
    { modal: false },
    "Clean up",
    "Open Logs"
  );
  if (choice === "Clean up") {
    await vscode.commands.executeCommand("codexNexus.cleanOrphanArtifacts");
  } else if (choice === "Open Logs") {
    output.show(true);
  }
}

function logCompatibilityToOutput(compatibility) {
  output.appendLine(`${new Date().toISOString()} [Codex Nexus] Compatibility check`);
  for (const check of compatibility.checks ?? []) {
    const state = check.ok ? "OK" : "FAIL";
    const details = check.details ? ` (${check.details})` : "";
    output.appendLine(
      `${new Date().toISOString()} [Codex Nexus] ${state} ${check.name}: ${check.value}${details}`
    );
  }
  for (const reason of compatibility.reasons ?? []) {
    output.appendLine(`${new Date().toISOString()} [Codex Nexus] FAIL ${reason}`);
  }
  for (const w of compatibility.structuralWarnings ?? []) {
    output.appendLine(`${new Date().toISOString()} [Codex Nexus] WARN (structural) ${w}`);
  }
}

// ── Lifecycle ─────────────────────────────────────────────────────────────────

async function deactivate() {
  if (pendingReloadTimer) {
    clearTimeout(pendingReloadTimer);
    pendingReloadTimer = null;
  }
  if (!shouldCleanupOnDeactivate(extensionInstallPath)) return;
  await runAutomaticUninstallCleanup(lifecycleLogger);
}

function clearUninstallMarker(extensionPath) {
  if (!extensionPath) return;
  const markerPath = path.join(extensionPath, ".codex-vazirmatn-uninstall-cleanup.lock");
  if (fs.existsSync(markerPath)) fs.unlinkSync(markerPath);
}

async function runAutomaticUninstallCleanup(logger) {
  if (uninstallCleanupInFlight) return uninstallCleanupInFlight;
  uninstallCleanupInFlight = (async () => {
    try {
      const markerPath = path.join(extensionInstallPath, ".codex-vazirmatn-uninstall-cleanup.lock");
      if (fs.existsSync(markerPath)) return;
      fs.writeFileSync(markerPath, "cleanup-started\n", "utf8");
      await runFullCleanup(logger);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      logger.info(`Automatic uninstall cleanup failed: ${message}`);
    }
  })().finally(() => {
    uninstallCleanupInFlight = null;
  });
  return uninstallCleanupInFlight;
}

module.exports = { activate, deactivate };
