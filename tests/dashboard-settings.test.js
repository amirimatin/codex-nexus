const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const {
  buildDashboardSettings,
  normalizeDashboardSettingUpdate,
} = require("../dashboard-settings");

test("dashboard accepts only safe user-facing settings", () => {
  assert.deepEqual(normalizeDashboardSettingUpdate("fontSize", "16"), {
    key: "fontSize",
    value: 16,
  });
  assert.deepEqual(normalizeDashboardSettingUpdate("preferredFontFamily", "  Vazirmatn  "), {
    key: "preferredFontFamily",
    value: "Vazirmatn",
  });
  assert.deepEqual(normalizeDashboardSettingUpdate("patchOnStartup", false), {
    key: "patchOnStartup",
    value: false,
  });
  assert.deepEqual(normalizeDashboardSettingUpdate("patchAiChat", false), {
    key: "patchAiChat",
    value: false,
  });
  assert.deepEqual(normalizeDashboardSettingUpdate("dashboardLanguage", "ar"), {
    key: "dashboardLanguage",
    value: "ar",
  });

  assert.throws(() => normalizeDashboardSettingUpdate("fontSize", 9), /Font size/);
  assert.throws(() => normalizeDashboardSettingUpdate("dashboardLanguage", "invalid"), /Dashboard language/);
  assert.throws(() => normalizeDashboardSettingUpdate("enabled", false), /not allowed/);
  assert.throws(() => normalizeDashboardSettingUpdate("localeManaged", true), /not allowed/);
  assert.throws(() => normalizeDashboardSettingUpdate("preferredFontFamily", 'Bad"Font'), /Font family/);
});

test("dashboard settings expose safe defaults", () => {
  assert.deepEqual(buildDashboardSettings({}), {
    patchOnStartup: true,
    showReloadPrompt: true,
    autoSetCodexLanguage: true,
    patchAiChat: true,
    dashboardLanguage: "en",
    preferredFontFamily: "Vazirmatn",
    fontSize: 0,
  });
});

test("dashboard no longer renders the legacy product name and contains modern UI components", () => {
  const dashboard = fs.readFileSync(path.join(__dirname, "..", "dashboard.js"), "utf8");
  const manifest = JSON.parse(
    fs.readFileSync(path.join(__dirname, "..", "package.json"), "utf8"),
  );
  assert.doesNotMatch(dashboard, /Codex Vazirmatn/);
  assert.match(dashboard, /Codex Nexus/);
  assert.match(dashboard, /data-setting=\\?"fontSize/);
  assert.match(dashboard, /min-height: 28px/);
  assert.match(dashboard, /flex: 0 0 auto/);
  assert.match(dashboard, /hero-card/);
  assert.match(dashboard, /toggle-switch/);
  assert.match(dashboard, /segmented-group/);
  assert.match(dashboard, /details-card/);
  assert.match(dashboard, /aria-pressed/);
  assert.match(dashboard, /error-box/);
  assert.match(dashboard, /combobox-wrapper/);
  assert.match(dashboard, /provider-manager/);
  assert.match(dashboard, /font-preset-select/);
  assert.match(dashboard, /switchActiveProvider/);
  assert.match(dashboard, /saveCustomProvider/);
  assert.match(dashboard, /deleteCustomProvider/);
  assert.match(dashboard, /data-dashboard-lang=\\?"ar\\?"/);
  assert.match(dashboard, /data-codex-locale=\\?"ar\\?"/);
  assert.match(dashboard, /Noto Sans Arabic/);
  assert.match(dashboard, /Noto Sans Arabic UI/);
  assert.match(dashboard, /codexNexus\.setLocaleArabic/);
  assert.match(dashboard, /id=\"btn-toggle-combobox\"/);
  assert.match(dashboard, /id=\"btn-cancel-provider\"/);
  assert.match(dashboard, /id=\"btn-save-provider\"/);
  assert.match(dashboard, /id=\"btn-close-provider-mgr\"/);
  assert.match(dashboard, /id=\"model-dropdown-menu\"/);
  assert.match(dashboard, /id=\"combobox-options-list\"/);
  assert.doesNotMatch(
    dashboard,
    /modelInput\.addEventListener\(["`']focus["`'],\s*\(\)\s*=>\s*\{[^}]*toggleCombobox\(true\)/,
    "Focusing model input must not force combobox dropdown to open, so user can edit model manually."
  );
  assert.doesNotMatch(
    dashboard,
    /return `<!--[\s\S]*?\$\{esc\(/,
    "The webview source must not contain nested template literals; they break extension activation.",
  );
  assert.equal(manifest.name, "codex-nexus");
  assert.equal(manifest.publisher, "amirimatin");
  assert.equal(manifest.version, "1.0.5");
  assert.equal(manifest.contributes.viewsContainers.activitybar[0].title, "Codex Nexus");
  assert.equal(
    manifest.contributes.views.codexNexus[0].name,
    "Dashboard",
  );
  assert.ok(
    manifest.contributes.commands.some(c => c.command === "codexNexus.setLocaleArabic")
  );
});
