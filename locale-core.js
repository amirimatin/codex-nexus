const DEFAULT_CODEX_LOCALE = "fa";
const LOCALE_OVERRIDE_SETTING = "chatgpt.localeOverride";
const ENGLISH_CODEX_LOCALES = new Set(["en", "en-us"]);

function normalizeCodexLocale(value) {
  if (typeof value !== "string") {
    return null;
  }

  const normalized = value.trim().replace(/_/g, "-").toLowerCase();
  if (!normalized) {
    return null;
  }

  return /^[a-z]{2,3}(?:-[a-z0-9]{2,8}){0,3}$/u.test(normalized) ? normalized : null;
}

function resolveCodexLocaleAction(options = {}) {
  const locale = normalizeCodexLocale(options.preferredLocale) ?? DEFAULT_CODEX_LOCALE;
  const currentLocale = normalizeCodexLocale(options.currentLocale);

  if (options.extensionEnabled === false) {
    return { shouldUpdate: false, locale, currentLocale, reason: "extensionDisabled" };
  }

  if (options.autoSetLocale === false) {
    return { shouldUpdate: false, locale, currentLocale, reason: "autoLocaleDisabled" };
  }

  if (currentLocale === locale) {
    return { shouldUpdate: false, locale, currentLocale, reason: "alreadyConfigured" };
  }

  if (currentLocale && ENGLISH_CODEX_LOCALES.has(currentLocale)) {
    return { shouldUpdate: true, locale, currentLocale, reason: "replaceEnglishLocale" };
  }

  if (currentLocale) {
    return { shouldUpdate: false, locale, currentLocale, reason: "userConfiguredOtherLocale" };
  }

  return { shouldUpdate: true, locale, currentLocale, reason: "missingLocale" };
}

module.exports = {
  DEFAULT_CODEX_LOCALE,
  ENGLISH_CODEX_LOCALES,
  LOCALE_OVERRIDE_SETTING,
  normalizeCodexLocale,
  resolveCodexLocaleAction
};
