const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

const {
  applyPatchToWorkbench,
  buildWorkbenchBlocks,
  buildWorkbenchUiCss,
  computeFileChecksum,
  findInstalledWorkbenchTarget,
  inspectWorkbenchCompatibility,
  restoreWorkbenchTarget,
  updateProductChecksum
} = require("../patch-core");
const { performInstalledCleanup } = require("../local-cleanup");

function createWorkbenchFixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "vscode-workbench-test-"));
  const appRoot = path.join(root, "resources", "app");
  const outDir = path.join(appRoot, "out");
  const workbenchDir = path.join(outDir, "vs", "code", "electron-browser", "workbench");
  fs.mkdirSync(workbenchDir, { recursive: true });

  const initialHtml = `<!-- Copyright (C) Microsoft Corporation. All rights reserved. -->
<!DOCTYPE html>
<html>
\t<head>
\t\t<meta charset="utf-8" />
\t\t<link rel="stylesheet" href="../../../workbench/workbench.desktop.main.css">
\t</head>
\t<body aria-label="">
\t</body>
\t<script src="./workbench.js" type="module"></script>
</html>
`;
  const workbenchHtml = path.join(workbenchDir, "workbench.html");
  fs.writeFileSync(workbenchHtml, initialHtml, "utf8");

  const initialChecksum = crypto
    .createHash("sha256")
    .update(initialHtml)
    .digest("base64")
    .replace(/=+$/, "");

  const productJsonPath = path.join(appRoot, "product.json");
  const productData = {
    nameShort: "Code",
    nameLong: "Visual Studio Code",
    checksums: {
      "vs/code/electron-browser/workbench/workbench.html": initialChecksum,
      "vs/workbench/workbench.desktop.main.css": "test-css-checksum"
    }
  };
  fs.writeFileSync(productJsonPath, JSON.stringify(productData, null, "\t") + "\n", "utf8");

  const fontSource = path.join(__dirname, "..", "assets", "Vazir.woff");
  const target = findInstalledWorkbenchTarget(appRoot, fontSource);

  return { root, appRoot, workbenchHtml, productJsonPath, initialHtml, initialChecksum, fontSource, target };
}

test("findInstalledWorkbenchTarget finds workbench files and computes checksum key", () => {
  const { appRoot, target, workbenchHtml, productJsonPath } = createWorkbenchFixture();
  assert.ok(target);
  assert.equal(target.appRoot, appRoot);
  assert.equal(target.workbenchHtml, workbenchHtml);
  assert.equal(target.productJson, productJsonPath);
  assert.equal(target.checksumKey, "vs/code/electron-browser/workbench/workbench.html");
  assert.equal(target.fontTarget, path.join(path.dirname(workbenchHtml), "Vazir.woff"));
});

test("inspectWorkbenchCompatibility validates required files and write permissions", () => {
  const { target } = createWorkbenchFixture();
  const compat = inspectWorkbenchCompatibility(target);
  assert.equal(compat.ok, true);
  assert.equal(compat.foundTarget, true);
  assert.equal(compat.permissionDenied, false);
  assert.ok(compat.checks.every((c) => c.ok));
});

test("buildWorkbenchUiCss generates scoped RTL rules for AI Chat and preserves LTR for code", () => {
  const css = buildWorkbenchUiCss("'Vazirmatn', sans-serif", "./Vazir.woff", 15);

  // Font faces and root variables
  assert.match(css, /@font-face\s*\{[^}]*font-family:\s*"Vazirmatn"/);
  assert.match(css, /@font-face\s*\{[^}]*font-family:\s*"CodexPersian"/);
  assert.match(css, /--codex-persian-font-family:\s*'Vazirmatn', sans-serif;/);

  // AI Chat text containers
  assert.match(css, /\.interactive-session \.rendered-markdown/);
  assert.match(css, /\.chat-widget \.rendered-markdown/);
  assert.match(css, /\.chat-markdown-part/);
  assert.match(css, /unicode-bidi:\s*plaintext\s*!important/);

  // List and blockquote mirroring
  assert.match(css, /padding-inline-start:\s*24px/);
  assert.match(css, /border-inline-start:\s*3px solid/);

  // Chat input / Monaco line direction
  assert.match(css, /\.interactive-input-editor \.view-line/);
  assert.match(css, /\.chat-input-part \.monaco-editor \.view-line/);

  // Code blocks, diffs, terminals must stay LTR
  assert.match(css, /\.chat-code-block/);
  assert.match(css, /\[data-chat-part-type="codeBlock"\]/);
  assert.match(css, /\[data-chat-part-type="diff"\]/);
  assert.match(css, /direction:\s*ltr\s*!important/);
  assert.match(css, /text-align:\s*left\s*!important/);
  assert.match(css, /unicode-bidi:\s*isolate\s*!important/);

  // Font size override
  assert.match(css, /--codex-chat-font-size:\s*15px\s*!important/);
});

test("applyPatchToWorkbench patches workbench.html, copies font, and updates product.json checksum", () => {
  const { target, workbenchHtml, productJsonPath, initialChecksum } = createWorkbenchFixture();
  const result = applyPatchToWorkbench(target, { fontSize: 16 });

  assert.equal(result.changed, true);
  assert.equal(result.foundTarget, true);
  assert.equal(result.skipped, false);

  // Check font was copied
  assert.ok(fs.existsSync(target.fontTarget));

  // Check workbench.html contains managed style block
  const patchedHtml = fs.readFileSync(workbenchHtml, "utf8");
  assert.match(patchedHtml, /<!-- codex-vazirmatn-font:start -->/);
  assert.match(patchedHtml, /<style id="codex-persian-workbench-style">/);
  assert.match(patchedHtml, /--codex-chat-font-size: 16px !important/);
  assert.match(patchedHtml, /<!-- codex-vazirmatn-font:end -->/);

  // Check product.json checksum was updated to match the patched workbench.html
  const newHash = computeFileChecksum(workbenchHtml);
  const updatedProduct = JSON.parse(fs.readFileSync(productJsonPath, "utf8"));
  assert.notEqual(newHash, initialChecksum);
  assert.equal(updatedProduct.checksums["vs/code/electron-browser/workbench/workbench.html"], newHash);

  // Check idempotency: applying again results in changed: false
  const repeat = applyPatchToWorkbench(target, { fontSize: 16 });
  assert.equal(repeat.changed, false);
});

test("restoreWorkbenchTarget restores original workbench.html, product.json, and cleans up artifacts", () => {
  const { target, workbenchHtml, productJsonPath, initialHtml, initialChecksum } = createWorkbenchFixture();

  // Apply patch first
  applyPatchToWorkbench(target, { fontSize: 14 });
  assert.ok(fs.existsSync(target.fontTarget));

  // Restore
  const restoreResult = restoreWorkbenchTarget(target);
  assert.equal(restoreResult.changed, true);
  assert.equal(restoreResult.foundTarget, true);

  // Check workbench.html is restored to initial content
  const restoredHtml = fs.readFileSync(workbenchHtml, "utf8");
  assert.equal(restoredHtml.trim(), initialHtml.trim());
  assert.doesNotMatch(restoredHtml, /codex-vazirmatn-font/);

  // Check font was removed
  assert.equal(fs.existsSync(target.fontTarget), false);

  // Check product.json checksum was restored to initial checksum
  const restoredProduct = JSON.parse(fs.readFileSync(productJsonPath, "utf8"));
  assert.equal(
    restoredProduct.checksums["vs/code/electron-browser/workbench/workbench.html"],
    initialChecksum
  );

  // Repeating restore is a clean no-op
  const repeatRestore = restoreWorkbenchTarget(target);
  assert.equal(repeatRestore.changed, false);
});

test("performInstalledCleanup cleans up both Codex and Workbench managed targets", () => {
  const { appRoot, target, workbenchHtml, productJsonPath, initialChecksum } = createWorkbenchFixture();
  const fontSource = path.join(__dirname, "..", "assets", "Vazir.woff");

  // Apply patch to workbench
  applyPatchToWorkbench(target);
  assert.ok(fs.existsSync(target.fontTarget));

  // Perform cleanup
  const cleanupResult = performInstalledCleanup({
    extensionInstallPath: path.join(__dirname, ".."),
    workbenchAppRoot: appRoot,
    userDataDir: path.join(appRoot, "..", "User"),
    cleanupLegacyStartupHooks: false
  });

  // Verify workbench target was restored
  assert.equal(fs.existsSync(target.fontTarget), false);
  const restoredProduct = JSON.parse(fs.readFileSync(productJsonPath, "utf8"));
  assert.equal(
    restoredProduct.checksums["vs/code/electron-browser/workbench/workbench.html"],
    initialChecksum
  );
});
