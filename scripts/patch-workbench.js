#!/usr/bin/env node
"use strict";

const fs = require("fs");
const os = require("os");
const path = require("path");

const {
  applyPatchToWorkbench,
  createLogger,
  findInstalledWorkbenchTarget,
  inspectWorkbenchCompatibility,
  restoreWorkbenchTarget
} = require("../patch-core");
const { readInstallerConfig } = require("./offline-apply");

function main() {
  const args = process.argv.slice(2);
  const isRestore = args.includes("--restore") || args.includes("-r");
  const isCheck = args.includes("--check") || args.includes("-c");

  const home = os.homedir();
  const repoRoot = path.resolve(__dirname, "..");
  const fontSource = path.join(repoRoot, "assets", "Vazir.woff");
  const userDataDir = process.env.VSCODE_USER_DATA_DIR || path.join(home, ".config", "Code");
  const settingsFile = path.join(userDataDir, "User", "settings.json");
  const config = readInstallerConfig(settingsFile);

  const target = findInstalledWorkbenchTarget(null, fontSource);
  if (!target) {
    console.error("Error: Could not locate VS Code Workbench installation on this machine.");
    process.exit(1);
  }

  console.log(`Found VS Code Workbench at: ${target.workbenchHtml}`);
  console.log(`Product.json: ${target.productJson}`);

  const logger = createLogger((msg) => console.log(`[Patch] ${msg}`));

  if (isRestore) {
    console.log("\nRestoring original VS Code Workbench files...");
    const restored = restoreWorkbenchTarget(target, logger);
    if (restored.changed) {
      console.log("\n✓ Original VS Code Workbench files restored successfully.");
    } else {
      console.log("\nNo modified Workbench files were found to restore.");
    }
    return;
  }

  const compat = inspectWorkbenchCompatibility(target, config);
  if (!compat.ok) {
    if (compat.permissionDenied) {
      console.error("\nPermission denied: Cannot write to VS Code installation files.");
      console.error("To fix this, please run the following command once in your terminal:");
      if (process.platform === "linux") {
        console.error(`  sudo chown -R $(whoami) "${target.appRoot}"`);
      } else if (process.platform === "darwin") {
        console.error(`  sudo chown -R $(whoami) "/Applications/Visual Studio Code.app"`);
      }
      console.error("Or run this script with sudo:");
      console.error("  sudo node ./scripts/patch-workbench.js");
      process.exit(2);
    }
    console.error("\nCompatibility error:", compat.reasons.join("\n"));
    process.exit(1);
  }

  if (isCheck) {
    console.log("\n✓ VS Code Workbench is compatible and writable.");
    return;
  }

  console.log("\nApplying Persian RTL and Vazirmatn font patch to VS Code AI Chat...");
  const result = applyPatchToWorkbench(target, config, logger);
  if (result.changed) {
    console.log("\n✓ VS Code AI Chat patch applied successfully!");
    console.log("Please restart VS Code (or reload window) to activate changes.");
  } else {
    console.log("\n✓ VS Code AI Chat patch is already up to date.");
  }
}

if (require.main === module) {
  main();
}
