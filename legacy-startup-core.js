const fs = require("fs");
const path = require("path");
const { spawnSync } = require("child_process");

const LEGACY_STARTUP_FILENAMES = ["CodexRTL.cmd", "codex-rtl-watch.vbs"];
const LEGACY_COMMAND_SIGNATURES = ["codex-rtl", "codexfontpatch", "apply-codex-rtl.ps1"];
const HKCU_RUN_KEY = "HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Run";

function resolveStartupFolderPath(options = {}) {
  const startupFolderPath = options.startupFolderPath;
  if (typeof startupFolderPath === "string" && startupFolderPath.trim()) {
    return path.resolve(startupFolderPath);
  }

  return resolveStartupFolders(options).user;
}

function resolveStartupFolders(options = {}) {
  const startupFolderPath =
    typeof options.startupFolderPath === "string" && options.startupFolderPath.trim()
      ? path.resolve(options.startupFolderPath)
      : null;
  const commonStartupFolderPath =
    typeof options.commonStartupFolderPath === "string" && options.commonStartupFolderPath.trim()
      ? path.resolve(options.commonStartupFolderPath)
      : null;
  const appData = options.appData ?? process.env.APPDATA;
  const programData = options.programData ?? process.env.ProgramData;
  const user = startupFolderPath
    ? startupFolderPath
    : appData && typeof appData === "string"
      ? path.join(appData, "Microsoft", "Windows", "Start Menu", "Programs", "Startup")
      : null;
  const common = commonStartupFolderPath
    ? commonStartupFolderPath
    : programData && typeof programData === "string"
      ? path.join(programData, "Microsoft", "Windows", "Start Menu", "Programs", "Startup")
      : null;

  return { user, common };
}

function inspectLegacyStartupHooks(options = {}) {
  const startupFolders = resolveStartupFolders(options);
  const startupFiles = [
    ...inspectStartupFolder(startupFolders.user, "user"),
    ...inspectStartupFolder(startupFolders.common, "common")
  ];
  const registryHooks = inspectLegacyRunKeyHooks(options);
  const hooks = [...startupFiles.filter((entry) => entry.exists), ...registryHooks.foundEntries];

  return {
    startupFolderPath: startupFolders.user,
    startupFolders,
    startupFiles,
    registryHooks,
    hooks,
    foundHooks: hooks,
    found: hooks.length > 0
  };
}

function removeLegacyStartupHooks(options = {}) {
  const inspection = inspectLegacyStartupHooks(options);
  const removedHooks = [];
  const failedHooks = [];

  for (const hook of inspection.foundHooks) {
    if (hook.type === "startupFile") {
      try {
        fs.unlinkSync(hook.path);
        removedHooks.push(hook);
      } catch (error) {
        failedHooks.push({
          ...hook,
          error: error instanceof Error ? error.message : String(error)
        });
      }
      continue;
    }

    if (hook.type === "registryRun") {
      const removed = removeRunValue(hook.name, options);
      if (removed.ok) {
        removedHooks.push(hook);
      } else {
        failedHooks.push({
          ...hook,
          error: removed.error || "Failed to delete registry value."
        });
      }
    }
  }

  return {
    ...inspection,
    removedHooks,
    failedHooks,
    changed: removedHooks.length > 0
  };
}

function inspectStartupFolder(folderPath, scope) {
  if (!folderPath) {
    return LEGACY_STARTUP_FILENAMES.map((name) => ({
      type: "startupFile",
      scope,
      name,
      path: null,
      exists: false
    }));
  }

  return LEGACY_STARTUP_FILENAMES.map((name) => {
    const filePath = path.join(folderPath, name);
    return {
      type: "startupFile",
      scope,
      name,
      path: filePath,
      exists: fs.existsSync(filePath)
    };
  });
}

function inspectLegacyRunKeyHooks(options = {}) {
  const canUseRegistry = process.platform === "win32" || typeof options.runRegCommand === "function";
  if (!canUseRegistry) {
    return {
      key: HKCU_RUN_KEY,
      available: false,
      entries: [],
      foundEntries: [],
      error: "Registry inspection is only available on Windows."
    };
  }

  const query = runReg(["query", HKCU_RUN_KEY], options);
  if (!query.ok) {
    return {
      key: HKCU_RUN_KEY,
      available: false,
      entries: [],
      foundEntries: [],
      error: query.error
    };
  }

  const entries = parseRegistryQueryEntries(query.stdout);
  const foundEntries = entries
    .filter((entry) => containsLegacyCommandSignature(entry.data))
    .map((entry) => ({
      type: "registryRun",
      key: HKCU_RUN_KEY,
      name: entry.name,
      command: entry.data
    }));

  return {
    key: HKCU_RUN_KEY,
    available: true,
    entries,
    foundEntries,
    error: null
  };
}

function parseRegistryQueryEntries(stdout) {
  const lines = String(stdout || "")
    .split(/\r?\n/)
    .map((line) => line.trimEnd());
  const entries = [];

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("HKEY_")) {
      continue;
    }
    const parts = trimmed.split(/\s{2,}/);
    if (parts.length < 3 || !parts[1].startsWith("REG_")) {
      continue;
    }
    entries.push({
      name: parts[0],
      type: parts[1],
      data: parts.slice(2).join("  ")
    });
  }

  return entries;
}

function containsLegacyCommandSignature(value) {
  const normalized = String(value || "").toLowerCase();
  return LEGACY_COMMAND_SIGNATURES.some((signature) => normalized.includes(signature));
}

function removeRunValue(valueName, options = {}) {
  const canUseRegistry = process.platform === "win32" || typeof options.runRegCommand === "function";
  if (!canUseRegistry) {
    return { ok: false, error: "Registry cleanup is only available on Windows." };
  }
  return runReg(["delete", HKCU_RUN_KEY, "/v", valueName, "/f"], options);
}

function runReg(args, options = {}) {
  const runRegCommand = options.runRegCommand;
  if (typeof runRegCommand === "function") {
    return normalizeRegResult(runRegCommand(args));
  }

  const result = spawnSync("reg", args, {
    encoding: "utf8",
    windowsHide: true
  });
  return normalizeRegResult(result);
}

function normalizeRegResult(result = {}) {
  if (result.error) {
    return { ok: false, stdout: "", stderr: "", error: result.error.message || String(result.error) };
  }
  const status = typeof result.status === "number" ? result.status : 1;
  const stdout = String(result.stdout || "");
  const stderr = String(result.stderr || "");
  return {
    ok: status === 0,
    stdout,
    stderr,
    error: status === 0 ? null : stderr || "Command failed."
  };
}

module.exports = {
  HKCU_RUN_KEY,
  LEGACY_COMMAND_SIGNATURES,
  LEGACY_STARTUP_FILENAMES,
  containsLegacyCommandSignature,
  inspectLegacyRunKeyHooks,
  inspectLegacyStartupHooks,
  parseRegistryQueryEntries,
  removeLegacyStartupHooks,
  resolveStartupFolderPath,
  resolveStartupFolders
};
