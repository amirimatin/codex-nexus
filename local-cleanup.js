const os = require("os");
const path = require("path");

const { cleanupUserSettingsFile } = require("./cleanup-core");
const { createLogger, createTargetPaths, findInstalledWorkbenchTarget, findLatestInstalledTarget, restoreTarget, restoreWorkbenchTarget } = require("./patch-core");
const { removeLegacyStartupHooks } = require("./legacy-startup-core");
const { clearCleanupState, getCodeUserDataDir, readCleanupState } = require("./state-store");

function performInstalledCleanup(options = {}) {
  const logger = options.logger ?? createLogger((message) => console.log(message));
  const extensionInstallPath = options.extensionInstallPath ? path.resolve(options.extensionInstallPath) : __dirname;
  const extensionsDir = path.resolve(options.extensionsDir || path.dirname(extensionInstallPath) || defaultExtensionsDir());
  const userDataDir = options.userDataDir || getCodeUserDataDir();
  const settingsPath = options.settingsPath || path.join(userDataDir, "User", "settings.json");
  const cleanupLegacyStartupHooks = options.cleanupLegacyStartupHooks !== false;
  const cleanupState = readCleanupState({ userDataDir });
  const fontSource = path.join(extensionInstallPath, "assets", "Vazir.woff");

  const managedTarget = resolveManagedTarget(cleanupState, fontSource);
  const fallbackTarget = findLatestInstalledTarget(extensionsDir, fontSource);
  let restored = restoreTarget(managedTarget || fallbackTarget, logger);
  if (managedTarget && !restored.foundTarget) {
    logger.info("Managed target path was not available. Falling back to latest installed Codex extension path.");
    restored = restoreTarget(fallbackTarget, logger);
  }
  const workbenchAppRoot = options.workbenchAppRoot || cleanupState?.workbenchAppRoot || (typeof vscode !== "undefined" && vscode.env?.appRoot);
  const workbenchTarget = findInstalledWorkbenchTarget(workbenchAppRoot, fontSource);
  const restoredWorkbench = restoreWorkbenchTarget(workbenchTarget, logger);
  const settingsResult = cleanupUserSettingsFile(settingsPath, {
    localeCleanupState: cleanupState.localeOverride,
    cleanupManagedLocaleWithoutState: true
  });
  const legacyStartupResult = cleanupLegacyStartupHooks
    ? removeLegacyStartupHooks({
        appData: process.env.APPDATA,
        programData: process.env.ProgramData
      })
    : { changed: false, removedHooks: [], failedHooks: [] };
  clearCleanupState({ userDataDir });

  if (!settingsResult.found) {
    logger.info(`VS Code user settings file was not found at ${settingsPath}`);
  } else if (settingsResult.changed) {
    logger.info(`Removed managed settings from ${settingsPath}`);
  } else {
    logger.info(`No managed settings found in ${settingsPath}`);
  }
  if (legacyStartupResult.changed) {
    logger.info(`Removed ${legacyStartupResult.removedHooks.length} legacy external startup hook(s).`);
  } else {
    logger.info("No removable legacy external startup hooks were found.");
  }
  if (legacyStartupResult.failedHooks.length > 0) {
    logger.info(`Failed to remove ${legacyStartupResult.failedHooks.length} legacy startup hook(s).`);
  }

  return {
    ...restored,
    patchChanged: restored.changed || restoredWorkbench.changed,
    workbenchChanged: restoredWorkbench.changed,
    settingsPath,
    settingsChanged: settingsResult.changed,
    settingsFound: settingsResult.found,
    localeChanged: settingsResult.localeChanged,
    localeAction: settingsResult.localeAction,
    removedKeys: settingsResult.removedKeys,
    legacyStartupChanged: legacyStartupResult.changed,
    legacyStartupRemoved: legacyStartupResult.removedHooks,
    legacyStartupFailed: legacyStartupResult.failedHooks
  };
}

function resolveManagedTarget(cleanupState, fontSource) {
  const managedPath = cleanupState?.targetExtensionPath;
  if (typeof managedPath !== "string" || !managedPath.trim()) {
    return null;
  }

  return createTargetPaths(path.resolve(managedPath), fontSource);
}

function defaultExtensionsDir() {
  return path.join(os.homedir(), ".vscode", "extensions");
}

module.exports = {
  performInstalledCleanup
};
