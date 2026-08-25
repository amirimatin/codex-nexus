const os = require("os");
const path = require("path");
const { createLogger } = require("./patch-core");
const { performInstalledCleanup } = require("./local-cleanup");
const { getCodeUserDataDir } = require("./state-store");

function main() {
  const logger = createLogger((message) => console.log(message));
  performInstalledCleanup({
    extensionInstallPath: __dirname,
    extensionsDir: getExtensionsDir(),
    userDataDir: getUserDataDir(),
    settingsPath: getSettingsPath(),
    logger
  });
}

function getExtensionsDir() {
  const override = readCliOption("--extensions-dir") || process.env.VSCODE_EXTENSIONS;
  return path.resolve(override || path.join(os.homedir(), ".vscode", "extensions"));
}

function getUserDataDir() {
  return readCliOption("--user-data-dir") || process.env.VSCODE_USER_DATA_DIR || getCodeUserDataDir();
}

function getSettingsPath() {
  return path.join(getUserDataDir(), "User", "settings.json");
}

function readCliOption(optionName) {
  const inlinePrefix = `${optionName}=`;
  const inlineMatch = process.argv.find((argument) => argument.startsWith(inlinePrefix));
  if (inlineMatch) {
    return inlineMatch.slice(inlinePrefix.length);
  }

  const optionIndex = process.argv.indexOf(optionName);
  if (optionIndex >= 0) {
    return process.argv[optionIndex + 1] || null;
  }

  return null;
}

main();
