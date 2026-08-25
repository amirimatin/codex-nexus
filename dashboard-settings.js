const BOOLEAN_SETTINGS = new Set([
  "patchOnStartup",
  "showReloadPrompt",
  "autoSetCodexLanguage",
  "patchAiChat"
]);

function normalizeDashboardSettingUpdate(key, value) {
  if (BOOLEAN_SETTINGS.has(key)) {
    if (typeof value !== "boolean") {
      throw new TypeError(`${key} must be a boolean.`);
    }
    return { key, value };
  }

  if (key === "fontSize") {
    const fontSize = Number(value);
    if (!Number.isInteger(fontSize) || (fontSize !== 0 && (fontSize < 10 || fontSize > 24))) {
      throw new RangeError("Font size must be 0 (Codex default) or an integer from 10 to 24.");
    }
    return { key, value: fontSize };
  }

  if (key === "preferredFontFamily") {
    if (typeof value !== "string") {
      throw new TypeError("Font family must be text.");
    }
    const fontFamily = value.trim();
    if (!/^[\w][\w\s-]{0,58}[\w]$|^[\w]{1}$/u.test(fontFamily)) {
      throw new TypeError("Font family may only contain letters, numbers, spaces, underscores, and hyphens.");
    }
    return { key, value: fontFamily };
  }

  if (key === "dashboardLanguage") {
    if (typeof value !== "string") {
      throw new TypeError("Dashboard language must be text.");
    }
    const lang = value.trim().toLowerCase();
    if (!["fa", "ar", "en"].includes(lang)) {
      throw new TypeError("Dashboard language must be 'fa', 'ar', or 'en'.");
    }
    return { key, value: lang };
  }

  throw new TypeError(`Dashboard setting is not allowed: ${String(key)}`);
}

function buildDashboardSettings(settings = {}) {
  return {
    patchOnStartup: settings.patchOnStartup !== false,
    showReloadPrompt: settings.showReloadPrompt !== false,
    autoSetCodexLanguage: settings.autoSetCodexLanguage !== false,
    patchAiChat: settings.patchAiChat !== false,
    dashboardLanguage:
      typeof settings.dashboardLanguage === "string" &&
      ["fa", "ar", "en"].includes(settings.dashboardLanguage.trim().toLowerCase())
        ? settings.dashboardLanguage.trim().toLowerCase()
        : "en",
    preferredFontFamily:
      typeof settings.preferredFontFamily === "string" && settings.preferredFontFamily.trim()
        ? settings.preferredFontFamily.trim()
        : "Vazirmatn",
    fontSize:
      Number.isInteger(settings.fontSize) &&
      (settings.fontSize === 0 || (settings.fontSize >= 10 && settings.fontSize <= 24))
        ? settings.fontSize
        : 0
  };
}

module.exports = {
  buildDashboardSettings,
  normalizeDashboardSettingUpdate
};
