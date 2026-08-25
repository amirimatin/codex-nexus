"use strict";

const fs = require("fs");
const os = require("os");
const path = require("path");

const {
  DEFAULT_CONFIG,
  applyPatchToTarget,
  createLogger,
  findLatestInstalledTarget,
  normalizeConfig,
} = require("../patch-core");

const SETTING_KEYS = {
  enabled: ["codexNexus.enabled", "codexVazirmatnFont.enabled"],
  patchOnStartup: ["codexNexus.patchOnStartup", "codexVazirmatnFont.patchOnStartup"],
  showReloadPrompt: ["codexNexus.showReloadPrompt", "codexVazirmatnFont.showReloadPrompt"],
  patchAiChat: ["codexNexus.patchAiChat", "codexVazirmatnFont.patchAiChat"],
  preferredFontFamily: ["codexNexus.preferredFontFamily", "codexVazirmatnFont.preferredFontFamily"],
  fontSize: ["codexNexus.fontSize", "codexVazirmatnFont.fontSize"],
};

function readJsonLiteralSetting(contents, key) {
  const escapedKey = key.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const literal = '("(?:\\\\.|[^"\\\\])*"|true|false|null|-?\\d+(?:\\.\\d+)?)';
  const match = contents.match(new RegExp(`"${escapedKey}"\\s*:\\s*${literal}`));
  if (!match) {
    return undefined;
  }
  try {
    return JSON.parse(match[1]);
  } catch {
    return undefined;
  }
}

function readInstallerConfig(settingsFile) {
  if (!fs.existsSync(settingsFile)) {
    return { ...DEFAULT_CONFIG };
  }
  const contents = fs.readFileSync(settingsFile, "utf8");
  const values = {};
  for (const [configKey, keys] of Object.entries(SETTING_KEYS)) {
    const keyList = Array.isArray(keys) ? keys : [keys];
    for (const settingKey of keyList) {
      const value = readJsonLiteralSetting(contents, settingKey);
      if (value !== undefined) {
        values[configKey] = value;
        break;
      }
    }
  }
  return normalizeConfig({ ...DEFAULT_CONFIG, ...values });
}

function main() {
  const home = os.homedir();
  const repoRoot = path.resolve(__dirname, "..");
  const extensionsDir = process.env.VSCODE_EXTENSIONS_DIR || path.join(home, ".vscode", "extensions");
  const userDataDir = process.env.VSCODE_USER_DATA_DIR || path.join(home, ".config", "Code");
  const settingsFile = path.join(userDataDir, "User", "settings.json");
  const fontSource = path.join(repoRoot, "assets", "Vazir.woff");
  const config = readInstallerConfig(settingsFile);
  const target = findLatestInstalledTarget(extensionsDir, fontSource);

  if (!target) {
    throw new Error(`The OpenAI Codex extension was not found under ${extensionsDir}.`);
  }

  const logger = createLogger((message) => process.stdout.write(`${message}\n`));
  const result = applyPatchToTarget(target, config, logger);
  if (!result.foundTarget || result.compatibility?.ok === false) {
    throw new Error("The installed Codex webview is not compatible with this patch.");
  }

  process.stdout.write(
    `Offline patch verified for ${target.extensionPath} (fontSize=${config.fontSize}).\n`,
  );
}

if (require.main === module) {
  try {
    main();
  } catch (error) {
    process.stderr.write(`Offline patch failed: ${error.message}\n`);
    process.exitCode = 1;
  }
}

module.exports = {
  readInstallerConfig,
  readJsonLiteralSetting,
};

