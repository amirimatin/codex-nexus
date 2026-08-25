const fs = require("fs");

const {
  DEFAULT_CODEX_LOCALE,
  LOCALE_OVERRIDE_SETTING,
  normalizeCodexLocale
} = require("./locale-core");
const { CONFIG_SECTION, LEGACY_CONFIG_SECTION } = require("./patch-core");

const MANAGED_SETTING_SUFFIXES = [
  "enabled",
  "patchOnStartup",
  "showReloadPrompt",
  "autoSetCodexLanguage",
  "dashboardLanguage",
  "patchAiChat",
  "preferredCodexLocale",
  "preferredFontFamily",
  "fontSize",
  "showLegacyStartupWarning",
  "localeManaged"
];

function getManagedSettingKeys() {
  const sections = Array.from(new Set([CONFIG_SECTION, LEGACY_CONFIG_SECTION].filter(Boolean)));
  const keys = [];
  for (const sec of sections) {
    for (const suffix of MANAGED_SETTING_SUFFIXES) {
      keys.push(`${sec}.${suffix}`);
    }
  }
  return keys;
}

function resolveLocaleCleanupAction(options = {}) {
  const currentLocale = normalizeCodexLocale(options.currentLocale);
  const managedLocale = normalizeCodexLocale(options.managedLocale) ?? DEFAULT_CODEX_LOCALE;
  const previousLocale = normalizeCodexLocale(options.previousLocale);

  if (options.wasManaged !== true) {
    return { shouldUpdate: false, reason: "unmanaged", currentLocale, managedLocale, previousLocale };
  }

  if (!currentLocale) {
    return { shouldUpdate: false, reason: "localeAlreadyMissing", currentLocale, managedLocale, previousLocale };
  }

  if (currentLocale !== managedLocale) {
    return { shouldUpdate: false, reason: "currentLocaleChanged", currentLocale, managedLocale, previousLocale };
  }

  if (previousLocale) {
    return {
      shouldUpdate: true,
      reason: "restorePreviousLocale",
      currentLocale,
      managedLocale,
      previousLocale,
      value: options.previousLocale
    };
  }

  return {
    shouldUpdate: true,
    reason: "removeManagedLocale",
    currentLocale,
    managedLocale,
    previousLocale,
    value: undefined
  };
}

function cleanupSettingsObject(settings, options = {}) {
  const removedKeys = [];
  for (const key of getManagedSettingKeys()) {
    if (Object.prototype.hasOwnProperty.call(settings, key)) {
      delete settings[key];
      removedKeys.push(key);
    }
  }

  let localeChanged = false;
  let localeAction = null;
  if (options.localeCleanupState) {
    localeAction = resolveLocaleCleanupAction({
      currentLocale: settings[LOCALE_OVERRIDE_SETTING],
      ...options.localeCleanupState
    });
  } else if (options.cleanupManagedLocaleWithoutState) {
    const currentLocale = normalizeCodexLocale(settings[LOCALE_OVERRIDE_SETTING]);
    const managedLocale = normalizeCodexLocale(options.managedLocale) ?? DEFAULT_CODEX_LOCALE;
    localeAction =
      currentLocale === managedLocale
        ? {
            shouldUpdate: true,
            reason: "missingStateFallbackRemoveManagedLocale",
            currentLocale,
            managedLocale,
            previousLocale: null,
            value: undefined
          }
        : {
            shouldUpdate: false,
            reason: "missingStateFallbackSkipped",
            currentLocale,
            managedLocale,
            previousLocale: null
          };
  }

  if (localeAction) {
    if (localeAction.shouldUpdate) {
      localeChanged = true;
      if (typeof localeAction.value === "string") {
        settings[LOCALE_OVERRIDE_SETTING] = localeAction.value;
      } else {
        delete settings[LOCALE_OVERRIDE_SETTING];
      }
    }
  }

  return {
    changed: removedKeys.length > 0 || localeChanged,
    removedKeys,
    localeChanged,
    localeAction,
    settings
  };
}

function cleanupUserSettingsFile(settingsPath, options = {}) {
  if (!fs.existsSync(settingsPath)) {
    return { found: false, changed: false, removedKeys: [], localeChanged: false, localeAction: null };
  }

  const original = fs.readFileSync(settingsPath, "utf8");
  let settings;
  try {
    settings = JSON.parse(original);
  } catch {
    return { found: true, changed: false, removedKeys: [], localeChanged: false, localeAction: null, parseError: true };
  }
  const result = cleanupSettingsObject(settings, options);

  if (!result.changed) {
    return { found: true, ...result };
  }

  fs.writeFileSync(settingsPath, `${JSON.stringify(settings, null, 2)}\n`, "utf8");
  return { found: true, ...result };
}

module.exports = {
  MANAGED_SETTING_SUFFIXES,
  cleanupSettingsObject,
  cleanupUserSettingsFile,
  getManagedSettingKeys,
  resolveLocaleCleanupAction
};
