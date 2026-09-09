const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const { buildBlocks, buildWorkbenchUiCss } = require("../patch-core");

const TOKENS_LIGHT = {
  "--mk-bg": "#FAF8F2",
  "--mk-text": "#403E41",
  "--mk-h1": "#D81B60",
  "--mk-h2": "#E56B2F",
  "--mk-h3": "#B88600",
  "--mk-h4": "#4F8A10",
  "--mk-h5": "#008C95",
  "--mk-h6": "#7655B8",
  "--mk-bold": "#272522",
  "--mk-italic": "#7655B8",
  "--mk-link": "#008C95",
  "--mk-link-hover": "#4F8A10",
  "--mk-inline-code-text": "#C2185B",
  "--mk-inline-code-bg": "#F1EEE5",
  "--mk-code-block-bg": "#F1EEE5",
  "--mk-blockquote": "#4F8A10",
  "--mk-highlight": "#D4A017",
  "--mk-muted": "#78716C",
  "--mk-border": "#D6D3D1"
};

const TOKENS_DARK = {
  "--mk-bg": "#2D2A2E",
  "--mk-text": "#FCFCFA",
  "--mk-h1": "#FF6188",
  "--mk-h2": "#FC9867",
  "--mk-h3": "#FFD866",
  "--mk-h4": "#A9DC76",
  "--mk-h5": "#78DCE8",
  "--mk-h6": "#AB9DF2",
  "--mk-bold": "#FFFFFF",
  "--mk-italic": "#AB9DF2",
  "--mk-link": "#78DCE8",
  "--mk-link-hover": "#A9DC76",
  "--mk-inline-code-text": "#FFD866",
  "--mk-inline-code-bg": "#221F22",
  "--mk-code-block-bg": "#221F22",
  "--mk-blockquote": "#A9DC76",
  "--mk-highlight": "#FC9867",
  "--mk-muted": "#939293",
  "--mk-border": "#403E41"
};

test("assets/persian-ui.css defines all 19 Monokai tokens for light and dark themes", () => {
  const css = fs.readFileSync(path.join(__dirname, "../assets/persian-ui.css"), "utf8");

  for (const [token, hex] of Object.entries(TOKENS_LIGHT)) {
    const regex = new RegExp(`${token}:\\s*${hex}`, "i");
    assert.match(css, regex, `Light token ${token} should be ${hex}`);
  }

  for (const [token, hex] of Object.entries(TOKENS_DARK)) {
    const regex = new RegExp(`${token}:\\s*${hex}`, "i");
    assert.match(css, regex, `Dark token ${token} should be ${hex}`);
  }
});

test("assets/persian-ui.css implements typography specifications exactly", () => {
  const css = fs.readFileSync(path.join(__dirname, "../assets/persian-ui.css"), "utf8");

  // Headings
  assert.match(css, /h1\s*\{[^}]*color:\s*var\(--mk-h1\)/);
  assert.match(css, /h1\s*\{[^}]*font-size:\s*1\.85rem/);
  assert.match(css, /h1\s*\{[^}]*font-weight:\s*800/);
  assert.match(css, /h1\s*\{[^}]*line-height:\s*1\.35/);
  assert.match(css, /h1\s*\{[^}]*margin:\s*24px 0 14px 0/);

  assert.match(css, /h2\s*\{[^}]*color:\s*var\(--mk-h2\)/);
  assert.match(css, /h2\s*\{[^}]*font-size:\s*1\.55rem/);
  assert.match(css, /h2\s*\{[^}]*font-weight:\s*800/);
  assert.match(css, /h2\s*\{[^}]*line-height:\s*1\.4/);
  assert.match(css, /h2\s*\{[^}]*margin:\s*20px 0 12px 0/);

  assert.match(css, /h3\s*\{[^}]*color:\s*var\(--mk-h3\)/);
  assert.match(css, /h3\s*\{[^}]*font-size:\s*1\.35rem/);
  assert.match(css, /h3\s*\{[^}]*font-weight:\s*700/);
  assert.match(css, /h3\s*\{[^}]*line-height:\s*1\.45/);
  assert.match(css, /h3\s*\{[^}]*margin:\s*18px 0 10px 0/);

  assert.match(css, /h4\s*\{[^}]*color:\s*var\(--mk-h4\)/);
  assert.match(css, /h4\s*\{[^}]*font-size:\s*1\.2rem/);
  assert.match(css, /h4\s*\{[^}]*font-weight:\s*700/);
  assert.match(css, /h4\s*\{[^}]*line-height:\s*1\.5/);
  assert.match(css, /h4\s*\{[^}]*margin:\s*16px 0 8px 0/);

  assert.match(css, /h5\s*\{[^}]*color:\s*var\(--mk-h5\)/);
  assert.match(css, /h5\s*\{[^}]*font-size:\s*1\.1rem/);
  assert.match(css, /h5\s*\{[^}]*font-weight:\s*600/);
  assert.match(css, /h5\s*\{[^}]*line-height:\s*1\.55/);
  assert.match(css, /h5\s*\{[^}]*margin:\s*14px 0 6px 0/);

  assert.match(css, /h6\s*\{[^}]*color:\s*var\(--mk-h6\)/);
  assert.match(css, /h6\s*\{[^}]*font-size:\s*1\.0rem/);
  assert.match(css, /h6\s*\{[^}]*font-weight:\s*600/);
  assert.match(css, /h6\s*\{[^}]*line-height:\s*1\.6/);
  assert.match(css, /h6\s*\{[^}]*margin:\s*12px 0 6px 0/);

  // Paragraph
  assert.match(css, /p\s*\{[^}]*font-family:\s*"Vazirmatn"/);
  assert.match(css, /p\s*\{[^}]*line-height:\s*1\.85/);
  assert.match(css, /p\s*\{[^}]*direction:\s*rtl/);

  // Inline Code
  assert.match(css, /code\s*\{[^}]*color:\s*var\(--mk-inline-code-text\)/);
  assert.match(css, /code\s*\{[^}]*background-color:\s*var\(--mk-inline-code-bg\)/);
  assert.match(css, /code\s*\{[^}]*padding:\s*2px 7px/);
  assert.match(css, /code\s*\{[^}]*border-radius:\s*6px/);
  assert.match(css, /code\s*\{[^}]*font-family:\s*JetBrains Mono/);
  assert.match(css, /code\s*\{[^}]*direction:\s*ltr\s*!important/);

  // Blockquote
  assert.match(css, /blockquote\s*\{[^}]*border-right:\s*4px solid var\(--mk-blockquote\)/);
  assert.match(css, /blockquote\s*\{[^}]*background-color:\s*var\(--mk-blockquote-bg/);
  assert.match(css, /blockquote\s*\{[^}]*padding-right:\s*1rem/);
  assert.match(css, /blockquote\s*\{[^}]*border-radius:\s*4px/);

  // Lists
  assert.match(css, /li::marker[^}]*color:\s*var\(--mk-h3\)/);
  assert.match(css, /ul\s*\{[^}]*margin:\s*15px 15px 0 8px/);
});

test("patcher buildBlocks() emits Monokai tokens and typography in rtlAppendBlock", () => {
  const blocks = buildBlocks();
  const css = blocks.rtlAppendBlock;

  for (const [token, hex] of Object.entries(TOKENS_LIGHT)) {
    const regex = new RegExp(`${token}:\\s*${hex}`, "i");
    assert.match(css, regex, `Patcher light token ${token} should be ${hex}`);
  }

  for (const [token, hex] of Object.entries(TOKENS_DARK)) {
    const regex = new RegExp(`${token}:\\s*${hex}`, "i");
    assert.match(css, regex, `Patcher dark token ${token} should be ${hex}`);
  }

  // Heading styles
  assert.match(css, /color:\s*var\(--mk-h1\)/);
  assert.match(css, /font-size:\s*1\.85rem/);
  assert.match(css, /color:\s*var\(--mk-h2\)/);
  assert.match(css, /font-size:\s*1\.55rem/);
  assert.match(css, /color:\s*var\(--mk-h3\)/);
  assert.match(css, /font-size:\s*1\.35rem/);
  assert.match(css, /color:\s*var\(--mk-h4\)/);
  assert.match(css, /font-size:\s*1\.2rem/);
  assert.match(css, /color:\s*var\(--mk-h5\)/);
  assert.match(css, /font-size:\s*1\.1rem/);
  assert.match(css, /color:\s*var\(--mk-h6\)/);
  assert.match(css, /font-size:\s*1\.0rem/);

  // Inline code, blockquote, lists, mark
  assert.match(css, /color:\s*var\(--mk-inline-code-text\)/);
  assert.match(css, /background-color:\s*var\(--mk-inline-code-bg\)/);
  assert.match(css, /padding:\s*2px 7px/);
  assert.match(css, /border-right:\s*4px solid var\(--mk-blockquote\)/);
  assert.match(css, /margin-left:\s*8px/);
  assert.match(css, /color:\s*var\(--mk-highlight\)/);
});

test("patcher buildWorkbenchUiCss() emits Monokai tokens and markdown styling", () => {
  const css = buildWorkbenchUiCss("'Vazirmatn', sans-serif", "./Vazir.woff", 0);

  for (const [token, hex] of Object.entries(TOKENS_LIGHT)) {
    const regex = new RegExp(`${token}:\\s*${hex}`, "i");
    assert.match(css, regex, `Workbench light token ${token} should be ${hex}`);
  }

  for (const [token, hex] of Object.entries(TOKENS_DARK)) {
    const regex = new RegExp(`${token}:\\s*${hex}`, "i");
    assert.match(css, regex, `Workbench dark token ${token} should be ${hex}`);
  }

  assert.match(css, /\.rendered-markdown h1/);
  assert.match(css, /color:\s*var\(--mk-h1\)/);
  assert.match(css, /\.rendered-markdown h2/);
  assert.match(css, /color:\s*var\(--mk-h2\)/);
  assert.match(css, /\.rendered-markdown h3/);
  assert.match(css, /color:\s*var\(--mk-h3\)/);
  assert.match(css, /border-right:\s*4px solid var\(--mk-blockquote\)/);
});
