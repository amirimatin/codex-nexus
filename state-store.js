const fs = require("fs");
const os = require("os");
const path = require("path");

const STATE_DIRECTORY = "amirimatin.codex-nexus";
const LEGACY_STATE_DIRECTORIES = [
  "amirimatin.codex-ai-studio",
  "amiri.codex-persian-rtl",
  "mytermeh.codex-vazirmatn-font"
];
const STATE_FILENAME = "cleanup-state.json";

function getCodeUserDataDir(options = {}) {
  if (options.userDataDir) {
    return path.resolve(options.userDataDir);
  }

  if (process.env.VSCODE_PORTABLE) {
    return path.join(process.env.VSCODE_PORTABLE, "user-data");
  }

  if (process.platform === "win32") {
    return path.join(process.env.APPDATA || path.join(os.homedir(), "AppData", "Roaming"), "Code");
  }

  if (process.platform === "darwin") {
    return path.join(os.homedir(), "Library", "Application Support", "Code");
  }

  return path.join(process.env.XDG_CONFIG_HOME || path.join(os.homedir(), ".config"), "Code");
}

function getStateFilePath(options = {}) {
  return path.join(getCodeUserDataDir(options), "User", "globalStorage", STATE_DIRECTORY, STATE_FILENAME);
}

function getLegacyStateFilePaths(options = {}) {
  const base = path.join(getCodeUserDataDir(options), "User", "globalStorage");
  return LEGACY_STATE_DIRECTORIES.map(dir => path.join(base, dir, STATE_FILENAME));
}

function readExtensionState(options = {}) {
  const stateFilePath = getStateFilePath(options);
  if (fs.existsSync(stateFilePath)) {
    try {
      return JSON.parse(fs.readFileSync(stateFilePath, "utf8"));
    } catch {
      return {};
    }
  }

  for (const legacyFilePath of getLegacyStateFilePaths(options)) {
    if (fs.existsSync(legacyFilePath)) {
      try {
        return JSON.parse(fs.readFileSync(legacyFilePath, "utf8"));
      } catch {
        return {};
      }
    }
  }

  return {};
}

function writeExtensionState(state, options = {}) {
  const stateFilePath = getStateFilePath(options);
  fs.mkdirSync(path.dirname(stateFilePath), { recursive: true });
  fs.writeFileSync(stateFilePath, `${JSON.stringify(state, null, 2)}\n`, "utf8");
  return stateFilePath;
}

function updateExtensionState(mutator, options = {}) {
  const currentState = readExtensionState(options);
  const nextState = mutator({ ...currentState }) || currentState;
  writeExtensionState(nextState, options);
  return nextState;
}

function clearExtensionState(options = {}) {
  const stateFilePath = getStateFilePath(options);
  let cleared = false;
  if (fs.existsSync(stateFilePath)) {
    fs.unlinkSync(stateFilePath);
    cleared = true;
  }

  for (const legacyFilePath of getLegacyStateFilePaths(options)) {
    if (fs.existsSync(legacyFilePath)) {
      try {
        fs.unlinkSync(legacyFilePath);
        cleared = true;
      } catch {
        // ignore
      }
    }
  }

  return cleared;
}

function readCleanupState(options = {}) {
  return readExtensionState(options);
}

function writeCleanupState(state, options = {}) {
  return writeExtensionState(state, options);
}

function clearCleanupState(options = {}) {
  return clearExtensionState(options);
}

module.exports = {
  STATE_DIRECTORY,
  STATE_FILENAME,
  clearCleanupState,
  clearExtensionState,
  getCodeUserDataDir,
  getStateFilePath,
  readExtensionState,
  readCleanupState,
  updateExtensionState,
  writeExtensionState,
  writeCleanupState
};
