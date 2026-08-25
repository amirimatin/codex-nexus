const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const childProcess = require("node:child_process");
const test = require("node:test");

const {
  readInstallerConfig,
  readJsonLiteralSetting,
} = require("../scripts/offline-apply");

test("offline installer reads JSONC-style scalar settings", (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "codex-rtl-installer-"));
  const settingsFile = path.join(root, "settings.json");
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));

  fs.writeFileSync(
    settingsFile,
    `{
      // Existing user values must survive the offline install.
      "codexNexus.enabled": true,
      "codexNexus.preferredFontFamily": "Vazirmatn",
      "codexNexus.fontSize": 16,
    }`,
  );

  const config = readInstallerConfig(settingsFile);
  assert.equal(config.enabled, true);
  assert.equal(config.preferredFontFamily, "Vazirmatn");
  assert.equal(config.fontSize, 16);
});

test("offline installer ignores missing and malformed scalar settings", () => {
  assert.equal(readJsonLiteralSetting("{}", "missing.key"), undefined);
  assert.equal(
    readJsonLiteralSetting('{"codexNexus.fontSize": nope}', "codexNexus.fontSize"),
    undefined,
  );
});

test("installer builds its VSIX outside the repository", () => {
  const installer = fs.readFileSync(
    path.join(__dirname, "..", "installer.sh"),
    "utf8",
  );

  assert.match(installer, /BUILD_DIR="\$\(mktemp -d /);
  assert.match(
    installer,
    /VSIX_PATH="\$BUILD_DIR\/codex-nexus-\$\{VERSION\}\.vsix"/,
  );
  assert.match(
    installer,
    /else\s+VSIX_PATH="\$ROOT_DIR\/codex-nexus-\$\{VERSION\}\.vsix"/,
  );
});

test("installer installs the managed last-project desktop launcher by default", () => {
  const installer = fs.readFileSync(
    path.join(__dirname, "..", "installer.sh"),
    "utf8",
  );

  assert.match(
    installer,
    /CODE_BIN="\$CODE_BIN" "\$ROOT_DIR\/scripts\/install-linux-launcher\.sh"/,
  );
  assert.match(installer, /--no-launcher/);
});

test("Linux launcher installation is idempotent and resolves the last folder", (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "codex-rtl-launcher-"));
  const home = path.join(root, "home");
  const binDir = path.join(root, "bin");
  const fakeCode = path.join(binDir, "code");
  const userDataDir = path.join(home, ".config", "Code");
  const storageDir = path.join(userDataDir, "User", "globalStorage");
  const projectDir = path.join(root, "project with spaces");
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));

  fs.mkdirSync(binDir, { recursive: true });
  fs.mkdirSync(storageDir, { recursive: true });
  fs.mkdirSync(projectDir, { recursive: true });
  fs.writeFileSync(fakeCode, "#!/usr/bin/env bash\nexit 0\n", { mode: 0o755 });
  fs.writeFileSync(
    path.join(storageDir, "storage.json"),
    JSON.stringify({
      windowsState: {
        lastActiveWindow: { folder: new URL(`file://${projectDir}`).href },
      },
    }),
  );

  const installScript = path.join(
    __dirname,
    "..",
    "scripts",
    "install-linux-launcher.sh",
  );
  const env = { ...process.env, HOME: home, CODE_BIN: fakeCode };

  for (let attempt = 0; attempt < 2; attempt += 1) {
    const result = childProcess.spawnSync("bash", [installScript], {
      env,
      encoding: "utf8",
    });
    assert.equal(result.status, 0, result.stderr);
  }

  const launcher = path.join(home, ".config", "codex-rtl", "launch-code-last-project.sh");
  const desktop = path.join(home, ".local", "share", "applications", "code.desktop");
  assert.equal(fs.existsSync(launcher), true);
  assert.match(fs.readFileSync(desktop, "utf8"), /X-Codex-Persian-RTL-Managed=true/);
  assert.deepEqual(
    fs.readdirSync(path.dirname(desktop)).filter((name) => name.includes(".backup-")),
    [],
  );

  const resolved = childProcess.spawnSync("bash", [launcher], {
    env: {
      ...env,
      CODEX_RTL_CODE_BIN: fakeCode,
      CODEX_RTL_USER_DATA_DIR: userDataDir,
      CODEX_RTL_LAUNCHER_DRY_RUN: "1",
    },
    encoding: "utf8",
  });
  assert.equal(resolved.status, 0, resolved.stderr);
  assert.equal(resolved.stdout.trim(), projectDir);
});
