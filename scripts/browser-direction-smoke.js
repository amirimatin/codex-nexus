"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const http = require("node:http");
const os = require("node:os");
const path = require("node:path");
const { execFile } = require("node:child_process");
const { promisify } = require("node:util");

const { buildBlocks } = require("../patch-core");

const execFileAsync = promisify(execFile);

function browserFixture() {
  const blocks = buildBlocks({ customModel: "cx/gpt-5.6-sol", customProvider: "9Router" });
  return `<!doctype html>
<html lang="fa" data-vazirmatn="rtl">
<head><meta charset="utf-8"><style>
html, body { background: #fff !important; color: #111 !important; }
body { width: 900px; margin: 20px; }
.vscode-markdown { width: 800px; border: 1px solid #888; }
p, pre, [data-diff] { width: 760px; margin: 12px; padding: 8px; border: 1px dashed #aaa; }
[role="listbox"] { width: 760px; margin: 12px; padding: 8px; border: 1px solid #888; }
.command-row { padding: 8px; }
.composer-root { width: 760px; margin: 12px; padding: 8px; border: 1px solid #888; }
.composer-actions { display: flex; align-items: center; }
${blocks.rtlAppendBlock}
</style></head>
<body><div id="root"><main class="vscode-markdown">
  <p id="mixed">English first</p>
  <p id="english">This paragraph is entirely English.</p>
  <pre id="code">const پیام = true;</pre>
  <div id="diff" data-diff>+ const پیام = true;</div>
</main>
<div id="composer-root" class="composer-root" data-codex-composer-root>
  <div id="composer-input" class="ProseMirror" data-codex-composer contenteditable="true"></div>
  <div id="composer-actions" class="composer-actions">
    <button id="attach-button" type="button" aria-label="Attach"><svg width="12" height="12"></svg></button>
    <button id="send-button" type="button" aria-label="Send"><svg width="12" height="12"></svg></button>
  </div>
</div>
</div>
<div id="slash-menu" role="listbox">
  <div class="command-row" role="option">
    <div id="command-title"><span>ب</span><span>ا</span><span>ز</span><span>خ</span><span>و</span><span>ر</span><span>د</span></div>
    <div id="command-description">ارسال بازخورد درباره Codex</div>
  </div>
</div>
<script>${blocks.toggleJs.replace(/<\/script/gi, "<\\/script")}</script>
<script>
window.addEventListener("load", function () {
  setTimeout(function () {
    document.getElementById("mixed").firstChild.appendData("، سپس متن فارسی");
  }, 20);
  setTimeout(function () {
    var result = {};
    ["mixed", "english", "code", "diff"].forEach(function (id) {
      var el = document.getElementById(id);
      var style = getComputedStyle(el);
      result[id] = {
        flow: el.getAttribute("data-vazirmatn-flow"),
        dir: el.getAttribute("dir"),
        direction: style.direction,
        textAlign: style.textAlign,
        unicodeBidi: style.unicodeBidi
      };
    });
    var title = document.getElementById("command-title");
    var titleStyle = getComputedStyle(title);
    result.commandTitle = {
      direction: titleStyle.direction,
      textAlign: titleStyle.textAlign,
      unicodeBidi: titleStyle.unicodeBidi,
      charXs: Array.from(title.children).map(function (span) {
        return Math.round(span.getBoundingClientRect().x * 100) / 100;
      })
    };
    var descriptionStyle = getComputedStyle(document.getElementById("command-description"));
    result.commandDescription = {
      direction: descriptionStyle.direction,
      textAlign: descriptionStyle.textAlign,
      unicodeBidi: descriptionStyle.unicodeBidi
    };
    var toggle = document.getElementById("vazirmatn-dir-toggle");
    var composerInput = document.getElementById("composer-input");
    result.toggle = {
      exists: !!toggle,
      label: toggle ? toggle.textContent : null,
      parentId: toggle && toggle.parentElement ? toggle.parentElement.id : null,
      beforeSend: !!toggle && toggle.nextElementSibling === document.getElementById("send-button"),
      insideInput: !!toggle && composerInput.contains(toggle)
    };
    var modelBadge = document.getElementById("vazirmatn-custom-model");
    result.modelBadge = {
      exists: !!modelBadge,
      text: modelBadge ? modelBadge.textContent : null,
      title: modelBadge ? modelBadge.title : null,
      parentId: modelBadge && modelBadge.parentElement ? modelBadge.parentElement.id : null,
      beforeToggle: !!modelBadge && modelBadge.nextElementSibling === toggle,
      insideInput: !!modelBadge && composerInput.contains(modelBadge)
    };
    if (toggle) {
      toggle.click();
      result.toggle.labelAfterLtrClick = toggle.textContent;
      result.toggle.dirAfterLtrClick = composerInput.getAttribute("data-vazirmatn-dir");
      toggle.click();
      result.toggle.labelAfterRtlClick = toggle.textContent;
      result.toggle.dirAfterRtlClick = composerInput.getAttribute("data-vazirmatn-dir");
    }
    document.body.setAttribute("data-smoke-result", encodeURIComponent(JSON.stringify(result)));
  }, 100);
});
</script></body></html>`;
}

async function main() {
  const chrome = process.env.CHROME_BIN || "/usr/bin/google-chrome";
  if (!fs.existsSync(chrome)) throw new Error(`Chrome was not found at ${chrome}`);

  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "codex-persian-rtl-browser-"));
  const screenshot = path.join(tempDir, "direction-smoke.png");
  const html = browserFixture();
  const server = http.createServer((request, response) => {
    response.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
    response.end(html);
  });

  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address();
  try {
    const { stdout } = await execFileAsync(chrome, [
      "--headless=new",
      "--no-sandbox",
      "--disable-gpu",
      `--user-data-dir=${path.join(tempDir, "profile")}`,
      "--virtual-time-budget=1000",
      "--window-size=1000,500",
      `--screenshot=${screenshot}`,
      "--dump-dom",
      `http://127.0.0.1:${port}/`,
    ], { maxBuffer: 4 * 1024 * 1024 });

    const match = stdout.match(/data-smoke-result="([^"]+)"/);
    assert.ok(match, "Browser did not publish the smoke-test result");
    const result = JSON.parse(decodeURIComponent(match[1].replace(/&amp;/g, "&")));
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    process.stdout.write(`Screenshot: ${screenshot}\n`);

    assert.deepEqual(result.mixed, {
      flow: "rtl", dir: "rtl", direction: "rtl", textAlign: "right", unicodeBidi: "isolate",
    });
    assert.deepEqual(result.english, {
      flow: "ltr", dir: "ltr", direction: "ltr", textAlign: "left", unicodeBidi: "isolate",
    });
    assert.equal(result.code.direction, "ltr");
    assert.equal(result.code.textAlign, "left");
    assert.equal(result.diff.direction, "ltr");
    assert.equal(result.diff.textAlign, "left");
    assert.equal(result.commandTitle.direction, "rtl");
    assert.equal(result.commandTitle.textAlign, "right");
    assert.equal(result.commandTitle.unicodeBidi, "normal");
    for (let index = 1; index < result.commandTitle.charXs.length; index += 1) {
      assert.ok(
        result.commandTitle.charXs[index] < result.commandTitle.charXs[index - 1],
        `Persian slash-command characters are visually reversed: ${result.commandTitle.charXs.join(", ")}`,
      );
    }
    assert.deepEqual(result.commandDescription, {
      direction: "rtl", textAlign: "right", unicodeBidi: "normal",
    });
    assert.deepEqual(result.toggle, {
      exists: true,
      label: "فا",
      parentId: "composer-actions",
      beforeSend: true,
      insideInput: false,
      labelAfterLtrClick: "EN",
      dirAfterLtrClick: "ltr",
      labelAfterRtlClick: "فا",
      dirAfterRtlClick: "rtl",
    });
    assert.deepEqual(result.modelBadge, {
      exists: true,
      text: "cx/gpt-5.6-sol",
      title: "Active provider: 9Router — cx/gpt-5.6-sol",
      parentId: "composer-actions",
      beforeToggle: true,
      insideInput: false,
    });

  } finally {
    server.close();
  }
}

main().catch((error) => {
  process.stderr.write(`${error.stack || error.message}\n`);
  process.exitCode = 1;
});
