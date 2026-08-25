const assert = require("node:assert/strict");
const test = require("node:test");

const { cleanupSettingsObject } = require("../cleanup-core");

test("full cleanup removes the dashboard font-size setting", () => {
  const settings = {
    "codexNexus.fontSize": 16,
    "codexNexus.preferredFontFamily": "Vazirmatn",
    "codexVazirmatnFont.fontSize": 16,
    "codexVazirmatnFont.preferredFontFamily": "Vazirmatn",
    "editor.fontSize": 14,
  };

  const result = cleanupSettingsObject(settings);

  assert.equal(result.changed, true);
  assert.equal(result.settings["codexNexus.fontSize"], undefined);
  assert.equal(result.settings["codexNexus.preferredFontFamily"], undefined);
  assert.equal(result.settings["codexVazirmatnFont.fontSize"], undefined);
  assert.equal(result.settings["codexVazirmatnFont.preferredFontFamily"], undefined);
  assert.equal(result.settings["editor.fontSize"], 14);
});
