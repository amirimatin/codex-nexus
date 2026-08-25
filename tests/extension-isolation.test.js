const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const root = path.resolve(__dirname, "..");
const executableFiles = [
  "installer.sh",
  "scripts/offline-apply.js",
  "extension.js",
  "patch-core.js",
  "cleanup-core.js",
  "local-cleanup.js",
  "lifecycle-core.js",
  "locale-core.js",
  "remote-core.js",
  "state-store.js",
  "uninstall.js",
];

const forbiddenStateMutations = [
  /github\.copilot-chat/i,
  /extensionsIdentifiers\/disabled/i,
  /--disable-extension/i,
  /state\.vscdb/i,
  /globalStorage\/github/i,
  /--uninstall-extension/i,
];

test("installer and runtime preserve every other extension state", () => {
  for (const relativePath of executableFiles) {
    const contents = fs.readFileSync(path.join(root, relativePath), "utf8");
    for (const forbidden of forbiddenStateMutations) {
      assert.doesNotMatch(contents, forbidden, `${relativePath} contains ${forbidden}`);
    }
  }
});

test("the only declared dependency is the official OpenAI extension", () => {
  const manifest = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8"));
  assert.deepEqual(manifest.extensionDependencies, ["openai.chatgpt"]);
});
