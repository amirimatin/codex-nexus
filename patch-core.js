const crypto = require("crypto");
const fs = require("fs");
const os = require("os");
const path = require("path");

const TARGET_EXTENSION_ID = "openai.chatgpt";
const TARGET_PREFIX = "openai.chatgpt-";
const PATCH_MARKER = "codex-vazirmatn-font";
const FONT_FILENAME = "Vazir.woff";
const PERSIAN_UI_CSS_FILENAME = "persian-ui.css";
const TOGGLE_JS_FILENAME = "codex-vazirmatn-toggle.js";
const WORKBENCH_STYLE_ID = "codex-persian-workbench-style";
const USE_MODEL_SETTINGS_PREFIX = "use-model-settings-";
const UNKNOWN_MODEL_FALLBACK_PATTERN = "userSavedModelString:M?null:k";
const UNKNOWN_MODEL_FALLBACK_PATCH = "userSavedModelString:k";
const LEGACY_ARTIFACT_FILENAMES = ["codex-vazirmatn-bootstrap.js"];
const INDEX_INSERTION_PATTERNS = [/<\/body>/i, /<\/head>/i];
const CONFIG_SECTION = "codexNexus";
const LEGACY_CONFIG_SECTION = "codexVazirmatnFont";
const DEFAULT_CONFIG = {
  enabled: true,
  patchOnStartup: true,
  showReloadPrompt: true,
  preferredFontFamily: "Vazirmatn",
  fontSize: 0
};
function normalizeConfig(config = {}) {
  const requestedFontSize = Number(config.fontSize);
  const normalized = {
    enabled: config.enabled !== false,
    patchOnStartup: config.patchOnStartup !== false,
    showReloadPrompt: config.showReloadPrompt !== false,
    preferredFontFamily:
      typeof config.preferredFontFamily === "string" && isSafeFontFamily(config.preferredFontFamily)
        ? config.preferredFontFamily.trim()
        : DEFAULT_CONFIG.preferredFontFamily,
    fontSize:
      requestedFontSize === 0 || (Number.isFinite(requestedFontSize) && requestedFontSize >= 10 && requestedFontSize <= 24)
        ? requestedFontSize
        : DEFAULT_CONFIG.fontSize,
    customModel:
      typeof config.customModel === "string" && config.customModel.trim()
        ? config.customModel.trim()
        : "",
    customProvider:
      typeof config.customProvider === "string" && config.customProvider.trim()
        ? config.customProvider.trim()
        : ""
  };

  if (!normalized.preferredFontFamily) {
    normalized.preferredFontFamily = DEFAULT_CONFIG.preferredFontFamily;
  }

  return normalized;
}

function buildBlocks(config = {}) {
  const normalized = normalizeConfig(config);
  const fontStack = buildFontStack(normalized.preferredFontFamily);
  const rtlUiCss = buildUiCss(fontStack, `./${FONT_FILENAME}`, normalized.fontSize);

  return {
    indexInlineBlock: `
<!-- ${PATCH_MARKER}:start -->
<link rel="stylesheet" href="./assets/codex-rtl.css" id="${PATCH_MARKER}-style">
<script defer src="./assets/${TOGGLE_JS_FILENAME}" id="${PATCH_MARKER}-toggle"></script>
<!-- ${PATCH_MARKER}:end -->
`.trim(),
    rtlAppendBlock: `
/* ${PATCH_MARKER}:start */
${rtlUiCss}
/* ${PATCH_MARKER}:end */
`.trim(),
    toggleJs: buildToggleJs(normalized.customModel, normalized.customProvider)
  };
}

function buildUiCss(fontStack, fontUrl, fontSize = 0) {
  // Use html[lang="fa"] — Codex sets this automatically when localeOverride is "fa".
  // This avoids any dependency on inline JavaScript (which VSCode webview CSP blocks).
  // Activation: our toggle button sets data-vazirmatn="rtl" on <html>.
  // We deliberately do NOT switch html[lang] because Codex uses `lang` to
  // select the UI language — changing it would translate the whole menu.
  const R = ":is(html[data-vazirmatn=\"rtl\"], html[lang^=\"fa\"])";
  const fontSizeCss = fontSize > 0
    ? `
/* Optional user typography override. Technical surfaces inherit their own
   native/monospace sizing and are intentionally excluded. */
${R} #root [data-thread-find-target="conversation"],
${R} #root [data-content-search-turn-key],
${R} #root [data-content-search-unit-key],
${R} #root [data-selected-text-overlay-target],
${R} #root [class*="_markdownContent_"],
${R} #root .vscode-markdown,
${R} #root .markdown-body,
${R} #root .ProseMirror,
${R} #root [data-codex-composer="true"] {
  --codex-chat-font-size: ${fontSize}px !important;
  --markdown-font-size: ${fontSize}px !important;
  font-size: ${fontSize}px !important;
}

${R} #root [data-thread-find-target="conversation"] :is(p, li, blockquote, h1, h2, h3, h4, h5, h6),
${R} #root [data-thread-find-target="conversation"] :is(p, li, blockquote, h1, h2, h3, h4, h5, h6) *:not(pre):not(code):not(.hljs):not(.hljs *),
${R} #root [data-content-search-turn-key] :is(p, li, blockquote, h1, h2, h3, h4, h5, h6),
${R} #root [data-content-search-turn-key] :is(p, li, blockquote, h1, h2, h3, h4, h5, h6) *:not(pre):not(code):not(.hljs):not(.hljs *),
${R} #root [data-content-search-unit-key] :is(p, li, blockquote, h1, h2, h3, h4, h5, h6),
${R} #root [data-content-search-unit-key] :is(p, li, blockquote, h1, h2, h3, h4, h5, h6) *:not(pre):not(code):not(.hljs):not(.hljs *) {
  font-size: ${fontSize}px !important;
}
`
    : "";
  return `
@font-face {
  font-family: "CodexPersian";
  src: url("${fontUrl}") format("woff");
  font-style: normal;
  font-weight: 100 900;
  font-display: swap;
}

@font-face {
  font-family: "Vazirmatn";
  src: url("${fontUrl}") format("woff");
  font-style: normal;
  font-weight: 100 900;
  font-display: swap;
}

/* ── Font variable ── */
${R} {
  --vscode-font-family: ${fontStack};
}

/* ── Base direction ── */
${R},
${R} body,
${R} #root {
  direction: rtl;
}

/* ── Font application (excludes code/icons/SVG) ── */
${R} body,
${R} #root,
${R} #root *:not(pre):not(code):not(.hljs):not(.hljs *):not(.xterm):not(.xterm *):not(svg):not(svg *):not(canvas):not(.codicon):not(.codicon *) {
  font-family: var(--vscode-font-family) !important;
}

/* ── Text elements ── */
${R} body,
${R} .ProseMirror,
${R} textarea,
${R} input:not([type="checkbox"]):not([type="radio"]),
${R} [contenteditable="true"],
${R} .vscode-markdown,
${R} .vscode-markdown p,
${R} .vscode-markdown li,
${R} .vscode-markdown blockquote,
${R} .vscode-markdown h1,
${R} .vscode-markdown h2,
${R} .vscode-markdown h3,
${R} .vscode-markdown h4,
${R} .vscode-markdown h5,
${R} .vscode-markdown h6,
${R} #root p,
${R} #root li,
${R} #root ul,
${R} #root ol,
${R} #root h1,
${R} #root h2,
${R} #root h3,
${R} #root h4,
${R} #root h5,
${R} #root h6,
${R} #root blockquote,
${R} #root label,
${R} #root [class*="markdown"],
${R} #root [class*="prose"] {
  direction: rtl !important;
  text-align: right !important;
  unicode-bidi: isolate !important;
}

/* ── Conversation and composer sections (strong RTL) ──
   Streaming text briefly lives in anonymous wrappers before Codex mounts the
   final Markdown DOM. Cover the stable conversation/turn/unit roots so those
   temporary descendants are RTL from their first paint. The technical LTR
   authority at the end of this stylesheet still wins for code and diffs. */
${R} #root [data-thread-find-target="conversation"],
${R} #root [data-content-search-turn-key],
${R} #root [data-content-search-unit-key],
${R} #root [data-thread-find-composer="true"],
${R} #root [data-codex-composer="true"],
${R} #root [data-codex-composer="true"] {
  direction: rtl !important;
  text-align: right !important;
  unicode-bidi: isolate !important;
  font-family: var(--vscode-font-family) !important;
}

${R} #root [data-thread-find-target="conversation"] *,
${R} #root [data-content-search-turn-key] *,
${R} #root [data-content-search-unit-key] *,
${R} #root [data-thread-find-composer="true"] *:not(pre):not(code):not(.hljs):not(.hljs *),
${R} #root [data-codex-composer="true"] *:not(pre):not(code):not(.hljs):not(.hljs *) {
  direction: rtl !important;
  text-align: right !important;
  font-family: var(--vscode-font-family) !important;
}

/* ── VS Code AI Chat / Agent surfaces (built-in workbench surfaces) ──
   These views are not part of Codex's webview, so they need the same RTL
   treatment as the conversation roots in the extension itself. */
${R} .chat-view,
${R} .chat-view *,
${R} [class*="chat-view"],
${R} [class*="chat-view"] *,
${R} .agent-view,
${R} .agent-view *,
${R} [class*="agent-view"],
${R} [class*="agent-view"] *,
${R} .chat-input,
${R} .chat-input *,
${R} [class*="chat-input"],
${R} [class*="chat-input"] *,
${R} .agent-input,
${R} .agent-input *,
${R} [class*="agent-input"],
${R} [class*="agent-input"] *,
${R} .chat-message,
${R} .chat-message *,
${R} [class*="chat-message"],
${R} [class*="chat-message"] *,
${R} .agent-message,
${R} .agent-message *,
${R} [class*="agent-message"],
${R} [class*="agent-message"] *,
${R} [data-chat-session-id],
${R} [data-chat-session-id] *,
${R} [data-agent-session-id],
${R} [data-agent-session-id] *,
${R} [data-testid*="chat"],
${R} [data-testid*="chat"] *,
${R} [data-testid*="agent"],
${R} [data-testid*="agent"] * {
  direction: rtl !important;
  text-align: right !important;
  unicode-bidi: isolate !important;
  font-family: var(--vscode-font-family) !important;
}

/* ── ProseMirror placeholder ── */
${R} .ProseMirror .placeholder:after {
  left: auto;
  right: 0;
  text-align: right !important;
}

/* ── Tailwind LTR overrides ── */
${R} .text-left,
${R} [class~="text-left"],
${R} [class*=" text-left"],
${R} [class^="text-left"] {
  text-align: right !important;
}

${R} .items-start,
${R} [class~="items-start"],
${R} [class*=" items-start"] {
  align-items: flex-end !important;
}

${R} .justify-start,
${R} [class~="justify-start"],
${R} [class*=" justify-start"] {
  justify-content: flex-end !important;
}

${R} .mr-auto,
${R} [class~="mr-auto"],
${R} [class*=" mr-auto"] {
  margin-right: 0 !important;
  margin-left: auto !important;
}

${R} .ml-auto,
${R} [class~="ml-auto"],
${R} [class*=" ml-auto"] {
  margin-left: 0 !important;
  margin-right: auto !important;
}

${R} #root .self-start,
${R} #root [class~="self-start"],
${R} #root [class*=" self-start"] {
  align-self: flex-end !important;
}

${R} #root .self-end,
${R} #root [class~="self-end"],
${R} #root [class*=" self-end"] {
  align-self: flex-start !important;
}

/* ── Input text direction ── */
${R} .composer-input,
${R} .ProseMirror {
  text-align: right !important;
  direction: rtl !important;
  unicode-bidi: isolate !important;
}

/* ── Explicit LTR override (must come after RTL rules) ── */
${R} #root [dir="ltr"],
${R} #root [dir="ltr"] * {
  direction: ltr !important;
  text-align: left !important;
  unicode-bidi: isolate !important;
}

/* ── Code blocks stay LTR ── */
${R} pre,
${R} code,
${R} code[class*="language-"],
${R} pre[class*="language-"],
${R} .hljs,
${R} .hljs *,
${R} .xterm,
${R} .xterm *,
${R} .vscode-markdown pre,
${R} .vscode-markdown code {
  direction: ltr !important;
  text-align: left !important;
  unicode-bidi: isolate !important;
  font-family: var(--vscode-editor-font-family), var(--font-mono), Consolas, monospace !important;
}

/* ── Lists and blockquote mirroring ── */
${R} ul,
${R} ol {
  padding-left: 0;
  padding-right: 1.5rem;
}

${R} blockquote {
  border-left: 0 !important;
  border-right: 3px solid var(--color-token-border);
  padding-left: 0 !important;
  padding-right: 1rem;
}

/* ── Input panel font ── */
${R} .composer-input,
${R} .ProseMirror {
  font-family: var(--vscode-font-family) !important;
}

/* ── Radix UI popper and popover (only when RTL active).
   Codex renders dropdowns, popovers, and menus OUTSIDE #root (portal), so we
   match them via the body selector. All of these need RTL alignment. ── */
${R} body [data-radix-popper-content-wrapper],
${R} body [role="menu"],
${R} body [role="listbox"],
${R} body [role="dialog"],
${R} body [role="tooltip"],
${R} body [data-slot="popover-content"],
${R} body [class*="_content_"],
${R} body [class*="popover-"],
${R} body [class*="dropdown-"],
${R} body [class*="menu-dialog"] {
  direction: rtl !important;
  text-align: right !important;
  unicode-bidi: isolate !important;
  font-family: var(--vscode-font-family) !important;
}

/* Slash-command titles are split into one span per highlighted character.
   Those spans must stay in one bidi run; isolating/plaintext on each span
   renders Persian labels in reverse character order. */
${R} body [data-radix-popper-content-wrapper] *,
${R} body [role="menu"] *,
${R} body [role="listbox"] *,
${R} body [role="dialog"] *,
${R} body [role="tooltip"] *,
${R} body [data-slot="popover-content"] *,
${R} body [class*="_content_"] *,
${R} body [class*="popover-"] *,
${R} body [class*="dropdown-"] *,
${R} body [class*="menu-dialog"] * {
  direction: inherit !important;
  text-align: inherit !important;
  unicode-bidi: normal !important;
  font-family: var(--vscode-font-family) !important;
}

/* Icons/SVG inside menus keep their intrinsic direction so they don't flip. */
${R} body [role="menu"] svg,
${R} body [role="listbox"] svg,
${R} body [data-radix-popper-content-wrapper] svg,
${R} body [class*="popover-"] svg,
${R} body [class*="dropdown-"] svg {
  direction: ltr !important;
}

${R} body [data-radix-popper-content-wrapper] [role="menuitem"] > *,
${R} body [data-radix-popper-content-wrapper] [role="menuitemcheckbox"] > *,
${R} body [data-radix-popper-content-wrapper] [role="menuitemradio"] > *,
${R} body [data-slot="popover-content"] > * {
  direction: rtl !important;
  text-align: right !important;
}

${R} body [data-radix-popper-content-wrapper] [class~="text-left"],
${R} body [data-radix-popper-content-wrapper] [class*=" text-left"],
${R} body [data-radix-popper-content-wrapper] [class^="text-left"],
${R} body [data-slot="popover-content"] [class~="text-left"],
${R} body [data-slot="popover-content"] [class*=" text-left"],
${R} body [data-slot="popover-content"] [class^="text-left"] {
  text-align: right !important;
}

${R} body [data-radix-popper-content-wrapper] [class~="ml-2"],
${R} body [data-radix-popper-content-wrapper] [class*=" ml-2"],
${R} body [data-slot="popover-content"] [class~="ml-2"],
${R} body [data-slot="popover-content"] [class*=" ml-2"] {
  margin-left: 0 !important;
  margin-right: 0.5rem !important;
}

/* ── Code inside popper stays LTR ── */
${R} body [data-radix-popper-content-wrapper] pre,
${R} body [data-radix-popper-content-wrapper] code,
${R} body [data-radix-popper-content-wrapper] .hljs,
${R} body [data-radix-popper-content-wrapper] .hljs *,
${R} body [data-radix-popper-content-wrapper] .xterm,
${R} body [data-radix-popper-content-wrapper] .xterm *,
${R} body [data-slot="popover-content"] pre,
${R} body [data-slot="popover-content"] code,
${R} body [data-slot="popover-content"] .hljs,
${R} body [data-slot="popover-content"] .hljs *,
${R} body [data-slot="popover-content"] .xterm,
${R} body [data-slot="popover-content"] .xterm * {
  direction: ltr !important;
  text-align: left !important;
  unicode-bidi: isolate !important;
  font-family: var(--vscode-editor-font-family), var(--font-mono), Consolas, monospace !important;
}

/* ── Manual direction override via toggle button (works regardless of locale).
   The toggle button sets data-vazirmatn-dir on the input and its wrappers. ── */
#root [data-vazirmatn-dir="rtl"],
#root [data-vazirmatn-dir="rtl"] * {
  direction: rtl !important;
  text-align: right !important;
  unicode-bidi: isolate !important;
}

#root [data-vazirmatn-dir="ltr"],
#root [data-vazirmatn-dir="ltr"] * {
  direction: ltr !important;
  text-align: left !important;
  unicode-bidi: isolate !important;
}

/* ── Streaming prose direction ──
   The companion script updates data-vazirmatn-flow whenever React appends a
   text node during streaming. The explicit attribute wins over Codex's
   temporary text-left/dir=ltr wrappers without affecting nested code. */
${R} #root [data-selected-text-overlay-target],
${R} #root [class*="_markdownContent_"],
${R} #root .vscode-markdown,
${R} #root .markdown-body,
${R} #root .markdown-body {
  direction: rtl !important;
  text-align: right !important;
  unicode-bidi: isolate !important;
}

${R} #root [data-selected-text-overlay-target] *,
${R} #root [class*="_markdownContent_"] *,
${R} #root .vscode-markdown *,
${R} #root .markdown-body * {
  direction: rtl !important;
  text-align: right !important;
}

/* StreamingMarkdown wraps every arriving word in a _fadeIn_ span. Each span
   must participate in the parent's single bidi paragraph; plaintext/isolate
   here would turn every streamed word into a separate directional run. */
${R} #root [class*="_markdownRoot_"] [class*="_fadeIn_"],
${R} #root [data-selected-text-overlay-target] [class*="_fadeIn_"] {
  direction: inherit !important;
  text-align: inherit !important;
  unicode-bidi: normal !important;
}

${R} #root [data-testid="exploration-accordion-body"] {
  direction: rtl !important;
  text-align: right !important;
  unicode-bidi: plaintext !important;
}

/* Descendants inherit the direction of their nearest classified prose block.
   A nested paragraph can therefore override an RTL answer root when that
   particular paragraph is entirely English, and vice versa. */
${R} #root [data-vazirmatn-flow] * {
  direction: inherit !important;
  text-align: inherit !important;
}

${R} #root [data-vazirmatn-flow="rtl"] {
  direction: rtl !important;
  text-align: right !important;
  unicode-bidi: isolate !important;
}

${R} #root [data-vazirmatn-flow="ltr"] {
  direction: ltr !important;
  text-align: left !important;
  unicode-bidi: isolate !important;
}

/* ── Technical surfaces are the final direction authority ──
   Codex's diff renderer uses data-diff/data-file/data-code attributes and a
   diffs-container custom element. These rules intentionally come after every
   prose and streaming override. */
${R} #root pre,
${R} #root pre *,
${R} #root code,
${R} #root code *,
${R} #root [data-markdown-copy="code-block"],
${R} #root [data-markdown-copy="code-block"] *,
${R} #root [data-markdown-copy="inline-code"],
${R} #root [data-markdown-copy="inline-code"] *,
${R} #root [class*="_codeBlock_"],
${R} #root [class*="_codeBlock_"] *,
${R} #root [class*="_codeBlockPlaceholder_"],
${R} #root [class*="_codeBlockPlaceholder_"] *,
${R} #root [class*="code-block"],
${R} #root [class*="code-block"] *,
${R} #root [class*="codeBlock"],
${R} #root [class*="codeBlock"] *,
${R} #root [class*="language-"],
${R} #root [class*="language-"] *,
${R} #root kbd,
${R} #root samp,
${R} #root tt,
${R} #root .hljs,
${R} #root .hljs *,
${R} #root .token,
${R} #root .monaco-editor,
${R} #root .monaco-editor *,
${R} #root .cm-editor,
${R} #root .cm-editor *,
${R} #root .xterm,
${R} #root .xterm *,
${R} #root diffs-container,
${R} #root diffs-container *,
${R} #root [data-diff],
${R} #root [data-diff] *,
${R} #root [data-file][data-diff-type],
${R} #root [data-file][data-diff-type] *,
${R} #root [data-code],
${R} #root [data-code] *,
${R} #root [data-line-index],
${R} #root [data-line-index] *,
${R} #root [data-codex-terminal],
${R} #root [data-codex-terminal] *,
${R} #root [class*="code-snippet"],
${R} #root [class*="code-snippet"] *,
${R} #root [class*="code-editor"],
${R} #root [class*="code-editor"] *,
${R} #root [class*="diff_"],
${R} #root [class*="diff_"] *,
${R} #root [class*="diff-view"],
${R} #root [class*="diff-view"] *,
${R} #root [class*="patch-view"],
${R} #root [class*="patch-view"] *,
${R} #root [data-thread-find-target="review"],
${R} #root [data-thread-find-target="review"] *,
${R} #root [data-review-path],
${R} #root [data-review-path] *,
${R} #root .codex-review-diff-card,
${R} #root .codex-review-diff-card *,
${R} #root [data-diffs-header],
${R} #root [data-diffs-header] *,
${R} #root [data-line-type],
${R} #root [data-line-type] *,
${R} #root [data-line-number-content],
${R} #root [data-line-number-content] *,
${R} #root [class*="diffs-"],
${R} #root [class*="diffs-"] * {
  direction: ltr !important;
  text-align: left !important;
  unicode-bidi: isolate !important;
  font-family: var(--vscode-editor-font-family), var(--font-mono), Consolas, monospace !important;
}

/* Deliberately outrank classified prose inheritance. Repeating the stable
   #root id raises specificity without depending on Codex's generated class
   names, so technical content remains LTR inside an RTL prose block. */
${R} #root#root :is(
  pre, pre *, code, code *, kbd, samp, tt,
  .hljs, .hljs *, .token, .monaco-editor, .monaco-editor *,
  .cm-editor, .cm-editor *, .xterm, .xterm *,
  diffs-container, diffs-container *,
  [data-markdown-copy="code-block"], [data-markdown-copy="code-block"] *,
  [data-markdown-copy="inline-code"], [data-markdown-copy="inline-code"] *,
  [data-diff], [data-diff] *, [data-file][data-diff-type], [data-file][data-diff-type] *,
  [data-code], [data-code] *, [data-line-index], [data-line-index] *,
  [data-codex-terminal], [data-codex-terminal] *,
  [data-thread-find-target="review"], [data-thread-find-target="review"] *,
  [data-review-path], [data-review-path] *, [data-diffs-header], [data-diffs-header] *,
  [data-line-type], [data-line-type] *, [data-line-number-content], [data-line-number-content] *,
  [class*="_codeBlock_"], [class*="_codeBlock_"] *,
  [class*="code-block"], [class*="code-block"] *,
  [class*="codeBlock"], [class*="codeBlock"] *,
  [class*="code-snippet"], [class*="code-snippet"] *,
  [class*="code-editor"], [class*="code-editor"] *,
  [class*="diff_"], [class*="diff_"] *,
  [class*="diff-view"], [class*="diff-view"] *,
  [class*="patch-view"], [class*="patch-view"] *,
  [class*="diffs-"], [class*="diffs-"] *
) {
  direction: ltr !important;
  text-align: left !important;
  unicode-bidi: isolate !important;
  font-family: var(--vscode-editor-font-family), var(--font-mono), Consolas, monospace !important;
}

/* Diff previews can be rendered in a portal outside #root. Keep every known
   diff/code-line surface LTR regardless of whether it lives in a dialog,
   popover, or the main review tree. */
${R} body [data-markdown-copy="code-block"],
${R} body [data-markdown-copy="code-block"] *,
${R} body [data-markdown-copy="inline-code"],
${R} body [data-markdown-copy="inline-code"] *,
${R} body [class*="_codeBlock_"],
${R} body [class*="_codeBlock_"] *,
${R} body [class*="_codeBlockPlaceholder_"],
${R} body [class*="_codeBlockPlaceholder_"] *,
${R} body [class*="code-block"],
${R} body [class*="code-block"] *,
${R} body [class*="codeBlock"],
${R} body [class*="codeBlock"] *,
${R} body [class*="language-"],
${R} body [class*="language-"] *,
${R} body diffs-container,
${R} body diffs-container *,
${R} body [data-app-action-review-file-expanded],
${R} body [data-app-action-review-file-expanded] *,
${R} body [data-diff],
${R} body [data-diff] *,
${R} body [data-file][data-diff-type],
${R} body [data-file][data-diff-type] *,
${R} body [data-code],
${R} body [data-code] *,
${R} body [data-line-index],
${R} body [data-line-index] *,
${R} body [data-line-type],
${R} body [data-line-type] *,
${R} body [data-line-number-content],
${R} body [data-line-number-content] *,
${R} body [data-diffs-header],
${R} body [data-diffs-header] *,
${R} body [data-review-path],
${R} body [data-review-path] *,
${R} body .codex-review-diff-card,
${R} body .codex-review-diff-card *,
${R} body [class*="diffs-"],
${R} body [class*="diffs-"] *,
${R} body [class*="diff-view"],
${R} body [class*="diff-view"] *,
${R} body [class*="patch-view"],
${R} body [class*="patch-view"] * {
  direction: ltr !important;
  text-align: left !important;
  unicode-bidi: isolate !important;
  font-family: var(--vscode-editor-font-family), var(--font-mono), Consolas, monospace !important;
}
${fontSizeCss}
`.trim();
}

function buildAlwaysOnFontCss(fontStack, fontUrl) {
  return `
@font-face {
  font-family: "CodexPersian";
  src: url("${fontUrl}") format("woff");
  font-style: normal;
  font-weight: 100 900;
  font-display: swap;
}

@font-face {
  font-family: "Vazirmatn";
  src: url("${fontUrl}") format("woff");
  font-style: normal;
  font-weight: 100 900;
  font-display: swap;
}

html, body, #root {
  --vscode-font-family: ${fontStack};
}

body,
#root,
#root *:not(pre):not(code):not(.hljs):not(.hljs *):not(.xterm):not(.xterm *):not(svg):not(svg *):not(canvas):not(.codicon):not(.codicon *) {
  font-family: ${fontStack} !important;
}

pre, code,
code[class*="language-"], pre[class*="language-"],
.hljs, .hljs *, .xterm, .xterm *,
.vscode-markdown pre, .vscode-markdown code,
[class*="code-snippet"], [class*="code-editor"],
[data-codex-terminal], [data-codex-terminal] * {
  font-family: var(--vscode-editor-font-family), var(--font-mono), Consolas, monospace !important;
}
`.trim();
}

function buildToggleJs(customModel, customProvider) {
  const customModelLiteral = JSON.stringify(
    typeof customModel === "string" && customModel.trim() ? customModel.trim() : ""
  );
  const customProviderLiteral = JSON.stringify(
    typeof customProvider === "string" && customProvider.trim() ? customProvider.trim() : ""
  );
  return `
/* ${PATCH_MARKER} — floating RTL/LTR toggle for the composer input. */
(function () {
  var BUTTON_ID = "vazirmatn-dir-toggle";
  var MODEL_BADGE_ID = "vazirmatn-custom-model";
  var CUSTOM_MODEL = ${customModelLiteral};
  var CUSTOM_PROVIDER = ${customProviderLiteral};
  var ATTR = "data-vazirmatn-dir";
  var FLOW_ATTR = "data-vazirmatn-flow";
  var STORAGE_KEY = "vazirmatn-input-dir";
  var FLOW_SELECTOR = [
    '[data-testid="exploration-accordion-body"]',
    '[data-selected-text-overlay-target]',
    '.vscode-markdown',
    '.markdown-body',
    '[class*="markdown-surface"]',
    '[class*="_markdownContent_"]'
  ].join(',');
  var PROSE_BLOCK_SELECTOR = 'p,li,blockquote,h1,h2,h3,h4,h5,h6';
  var TECHNICAL_SELECTOR = [
    'pre', 'code', 'kbd', 'samp', 'tt', '.hljs', '.xterm',
    '[data-markdown-copy="code-block"]', '[data-markdown-copy="inline-code"]',
    '[class*="_codeBlock_"]', '[class*="_codeBlockPlaceholder_"]',
    '[class*="code-block"]', '[class*="codeBlock"]', '[class*="language-"]',
    '.monaco-editor', '.cm-editor', 'diffs-container', '[data-diff]',
    '[data-file][data-diff-type]', '[data-code]', '[data-line-index]',
    '[data-codex-terminal]', '[class*="code-snippet"]',
    '[class*="code-editor"]', '[class*="diff_"]',
    '[class*="diff-view"]', '[class*="patch-view"]'
  ].join(',');
  var PERSIAN_RE = /[\u0600-\u06FF\u0750-\u077F\u08A0-\u08FF\uFB50-\uFDFF\uFE70-\uFEFF]/;

  function getSavedDir() {
    try { return localStorage.getItem(STORAGE_KEY) || "rtl"; } catch (e) { return "rtl"; }
  }
  function saveDir(dir) {
    try { localStorage.setItem(STORAGE_KEY, dir); } catch (e) {}
  }

  function findInputEl() {
    return (
      document.querySelector('[data-codex-composer-root] [data-codex-composer] [contenteditable="true"]') ||
      document.querySelector('[data-codex-composer-root] [data-codex-composer][contenteditable="true"]') ||
      document.querySelector('[data-codex-composer-root] .ProseMirror[contenteditable="true"]') ||
      document.querySelector('[data-codex-composer-root] textarea') ||
      document.querySelector('[data-codex-composer="true"] [contenteditable="true"]') ||
      document.querySelector('.ProseMirror[contenteditable="true"]') ||
      document.querySelector('[contenteditable="true"]') ||
      document.querySelector("textarea")
    );
  }

  var ORIGINAL_LANG = null;
  function applyGlobalRtl(enable) {
    var html = document.documentElement;
    if (ORIGINAL_LANG === null) {
      var cur = html.getAttribute("lang");
      ORIGINAL_LANG = (cur && cur !== "fa") ? cur : "en";
    }
    if (enable) {
      html.setAttribute("data-vazirmatn", "rtl");
      html.setAttribute("lang", "fa");
    } else {
      html.removeAttribute("data-vazirmatn");
      html.setAttribute("lang", ORIGINAL_LANG);
    }
  }

  function applyDir(inputEl, dir) {
    applyGlobalRtl(dir === "rtl");
    if (!inputEl) return;
    var textAlign = dir === "rtl" ? "right" : "left";
    var targets = [inputEl];
    var composer = inputEl.closest('[data-codex-composer="true"],[data-thread-find-composer="true"],.composer-input,.ProseMirror');
    if (composer && composer !== inputEl) targets.push(composer);
    var parent = inputEl.parentElement;
    for (var depth = 0; depth < 3 && parent && parent !== composer && parent !== document.body; depth++) {
      targets.push(parent);
      parent = parent.parentElement;
    }
    for (var i = 0; i < targets.length; i++) {
      targets[i].setAttribute(ATTR, dir);
      targets[i].style.setProperty("direction", dir, "important");
      targets[i].style.setProperty("text-align", textAlign, "important");
      targets[i].style.setProperty("unicode-bidi", "plaintext", "important");
    }
  }

  function isEditableSurface(el) {
    return !!(
      el &&
      (
        (el.matches && el.matches('input,textarea,[contenteditable="true"]')) ||
        (el.closest && el.closest('input,textarea,[contenteditable="true"]'))
      )
    );
  }

  function getComposerBox() {
    var input = findInputEl();
    var root = input && input.closest ? input.closest('[data-codex-composer-root]') : null;
    if (!root) root = document.querySelector('[data-codex-composer-root]');
    if (root && !isEditableSurface(root)) return root;

    var base = document.querySelector('[data-codex-composer="true"]') ||
               document.querySelector('[data-codex-composer]') ||
               document.querySelector('[data-thread-find-composer="true"]') ||
               document.querySelector('.composer-input');
    if (!base) return null;
    var node = base;
    for (var i = 0; i < 4 && node.parentElement; i++) {
      if (!isEditableSurface(node) && node.querySelector('button')) return node;
      node = node.parentElement;
    }
    return null;
  }

  function findScrollableEls() {
    var all = document.querySelectorAll("*");
    var list = [];
    for (var i = 0; i < all.length; i++) {
      var el = all[i];
      if (el.scrollHeight > el.clientHeight + 4 && el.clientHeight > 0) {
        var style = getComputedStyle(el);
        if (style.overflowY === "auto" || style.overflowY === "scroll") list.push(el);
      }
    }
    return list;
  }

  function captureScroll() {
    var els = findScrollableEls();
    var snapshot = [];
    for (var i = 0; i < els.length; i++) {
      var el = els[i];
      var atBottom = (el.scrollHeight - el.scrollTop - el.clientHeight) < 8;
      snapshot.push({ el: el, top: el.scrollTop, atBottom: atBottom });
    }
    return snapshot;
  }

  function restoreScroll(snapshot) {
    var restore = function () {
      for (var i = 0; i < snapshot.length; i++) {
        var s = snapshot[i];
        if (s.atBottom) s.el.scrollTop = s.el.scrollHeight;
        else s.el.scrollTop = s.top;
      }
    };
    restore();
    requestAnimationFrame(restore);
    setTimeout(restore, 30);
    setTimeout(restore, 120);
  }

  var _btn = null;
  var _modelBadge = null;

  function styleButton(dir) {
    if (!_btn) return;
    var isRtl = dir === "rtl";
    _btn.textContent = isRtl ? "\u0641\u0627" : "EN";
    _btn.title = isRtl
      ? "\u062C\u0647\u062A \u0646\u0648\u0634\u062A\u0627\u0631: \u0631\u0627\u0633\u062A \u0628\u0647 \u0686\u067E \u2014 \u06A9\u0644\u06CC\u06A9 \u0628\u0631\u0627\u06CC \u0686\u067E \u0628\u0647 \u0631\u0627\u0633\u062A"
      : "Direction: Left to Right \u2014 click for RTL";
    var accent = "var(--color-accent-green,#10a37f)";
    var mutedBorder = "var(--vscode-input-border,rgba(255,255,255,0.18))";
    var mutedFg = "var(--vscode-foreground,#ccc)";
    _btn.style.cssText = [
      "display:inline-flex",
      "align-items:center",
      "justify-content:center",
      "height:26px",
      "min-width:34px",
      "padding:0 9px",
      "margin-inline:6px",
      "box-sizing:border-box",
      "border-radius:6px",
      "border:1px solid " + (isRtl ? accent : mutedBorder),
      "background:" + (isRtl ? "color-mix(in srgb," + accent + " 16%, var(--vscode-editor-background,#1e1e1e))" : "transparent"),
      "color:" + (isRtl ? accent : mutedFg),
      "font-size:11px",
      "line-height:1",
      "font-weight:700",
      "letter-spacing:0",
      "cursor:pointer",
      "flex:0 0 auto",
      "align-self:center",
      "opacity:" + (isRtl ? "1" : "0.85"),
      "transition:opacity 0.15s,background 0.15s,border-color 0.15s,color 0.15s",
      "font-family:" + (isRtl ? '"Vazirmatn","CodexPersian",sans-serif' : "monospace"),
      "direction:" + (isRtl ? "rtl" : "ltr") + "!important",
      "text-align:center!important",
      "unicode-bidi:isolate!important"
    ].join(";");
  }

  function styleModelBadge() {
    if (!_modelBadge) return;
    _modelBadge.textContent = CUSTOM_MODEL;
    var label = (CUSTOM_PROVIDER ? "Active provider: " + CUSTOM_PROVIDER + " — " : "Active provider model: ") + CUSTOM_MODEL;
    _modelBadge.title = label;
    _modelBadge.setAttribute("aria-label", label);
    _modelBadge.style.cssText = [
      "display:inline-flex",
      "align-items:center",
      "height:26px",
      "max-width:170px",
      "padding:0 8px",
      "box-sizing:border-box",
      "border:1px solid var(--vscode-input-border,rgba(127,127,127,0.35))",
      "border-radius:6px",
      "background:var(--vscode-input-background,rgba(127,127,127,0.10))",
      "color:var(--vscode-descriptionForeground,#8b8b8b)",
      "font-family:var(--vscode-editor-font-family,monospace)",
      "font-size:11px",
      "font-weight:600",
      "line-height:1",
      "white-space:nowrap",
      "overflow:hidden",
      "text-overflow:ellipsis",
      "direction:ltr",
      "unicode-bidi:isolate",
      "flex:0 1 auto",
      "align-self:center",
      "cursor:default"
    ].join(";");
  }

  // The send button: an action button outside the text area with an icon and no
  // text label. It always lives in the corner Codex mirrors on direction flip.
  function findSendButton(box) {
    var btns = box.querySelectorAll('button');
    var candidate = null;
    for (var i = 0; i < btns.length; i++) {
      var b = btns[i];
      if (b === _btn) continue;
      if (isEditableSurface(b)) continue;
      var r = b.getBoundingClientRect();
      if (r.width === 0 || r.height === 0) continue;
      var label = [
        b.getAttribute("aria-label") || "",
        b.getAttribute("title") || "",
        b.getAttribute("data-testid") || ""
      ].join(" ").toLowerCase();
      if (
        label.indexOf("send") !== -1 ||
        label.indexOf("submit") !== -1 ||
        label.indexOf("stop") !== -1 ||
        label.indexOf("\u0627\u0631\u0633\u0627\u0644") !== -1
      ) return b;
      if (!(b.textContent || "").trim() && b.querySelector('svg')) candidate = b;
    }
    return candidate;
  }

  function isSafeButtonHost(host, box) {
    return !!(
      host &&
      box &&
      box.contains(host) &&
      !isEditableSurface(host)
    );
  }

  function ensureModelBadge(host, box, send) {
    if (!CUSTOM_MODEL || !isSafeButtonHost(host, box)) {
      if (_modelBadge) _modelBadge.style.display = "none";
      return;
    }

    if (!_modelBadge || _modelBadge.parentNode !== host) {
      var old = document.querySelectorAll('#' + MODEL_BADGE_ID + ', [data-vazirmatn-custom-model="1"]');
      for (var i = 0; i < old.length; i++) {
        if (old[i].parentNode) old[i].parentNode.removeChild(old[i]);
      }
      _modelBadge = document.createElement("span");
      _modelBadge.id = MODEL_BADGE_ID;
      _modelBadge.setAttribute("data-vazirmatn-custom-model", "1");
      _modelBadge.setAttribute("role", "status");
      host.insertBefore(_modelBadge, send);
    }

    _modelBadge.style.display = "inline-flex";
    styleModelBadge();
  }

  // Place the toggle next to the send button as a sibling so Codex's own flex
  // row positions and mirrors it. If no safe action row exists, keep it hidden.
  function ensureButton() {
    var box = getComposerBox();
    if (!box) { if (_btn) _btn.style.display = "none"; return; }

    var send = findSendButton(box);
    var host = send && send.parentElement;
    if (!isSafeButtonHost(host, box)) {
      if (_btn) _btn.style.display = "none";
      return;
    }

    ensureModelBadge(host, box, send);

    if (_btn && _btn.parentNode === host) { _btn.style.display = "inline-flex"; return; }

    var old = document.querySelectorAll('#' + BUTTON_ID + ', [data-vazirmatn-toggle="1"]');
    for (var i = 0; i < old.length; i++) {
      if (old[i].parentNode) old[i].parentNode.removeChild(old[i]);
    }

    _btn = document.createElement("button");
    _btn.id = BUTTON_ID;
    _btn.type = "button";
    _btn.setAttribute("data-vazirmatn-toggle", "1");
    _btn.setAttribute("aria-label", "Toggle text direction (RTL/LTR)");

    _btn.addEventListener("mouseenter", function () {
      _btn.style.opacity = "1";
    });
    _btn.addEventListener("mouseleave", function () {
      styleButton(currentDir());
    });
    _btn.addEventListener("click", function (e) {
      e.preventDefault();
      e.stopPropagation();
      var inp = findInputEl();
      var dir = currentDir() === "rtl" ? "ltr" : "rtl";
      var snapshot = captureScroll();
      applyDir(inp, dir);
      saveDir(dir);
      styleButton(dir);
      restoreScroll(snapshot);
      if (inp) { try { inp.focus({ preventScroll: true }); } catch (e) { inp.focus(); } }
    });

    host.insertBefore(_btn, send);
    styleButton(currentDir());
  }

  function currentDir() {
    var inp = findInputEl();
    return (inp && inp.getAttribute(ATTR)) || getSavedDir();
  }

  function ensureDirOnInput() {
    var inp = findInputEl();
    if (!inp) return;
    if (inp.getAttribute(ATTR) === getSavedDir()) return;
    applyDir(inp, getSavedDir());
  }

  function isTechnicalSurface(el) {
    return !!(el && el.closest && el.closest(TECHNICAL_SELECTOR));
  }

  function detectFlowDir(text) {
    var value = (text || "").trim();
    if (!value) return null;
    return PERSIAN_RE.test(value) ? "rtl" : "ltr";
  }

  function markFlow(el, textHint) {
    if (!el || el.nodeType !== 1 || isTechnicalSurface(el)) return;
    var hintedDir = detectFlowDir(textHint);
    // Always inspect the complete block before trusting the latest streamed
    // fragment. A new English fragment may belong to a paragraph that already
    // contains Persian and must therefore remain RTL.
    var dir = detectFlowDir(el.textContent) || hintedDir;
    if (!dir) return;
    if (el.getAttribute(FLOW_ATTR) !== dir) el.setAttribute(FLOW_ATTR, dir);
    // A native dir attribute participates in bidi layout before the next
    // stylesheet/layout pass, which matters while React appends fade spans.
    if (el.getAttribute("dir") !== dir) el.setAttribute("dir", dir);
  }

  function markNearestFlow(root) {
    var el = root && root.nodeType === 3 ? root.parentElement : root;
    if (!el || el.nodeType !== 1) return;
    var textHint = root && root.nodeType === 3
      ? root.data
      : (root && root.nodeType === 1 ? root.textContent : null);
    var container = el.matches && el.matches(FLOW_SELECTOR)
      ? el
      : (el.closest ? el.closest(FLOW_SELECTOR) : null);
    if (!container) return;
    var block = el.closest ? el.closest(PROSE_BLOCK_SELECTOR) : null;
    if (block && container.contains(block) && !isTechnicalSurface(block)) {
      markFlow(block, textHint);
    }
    markFlow(container, textHint);
  }

  function scanConversationFlow(root) {
    var scope = root && root.nodeType === 1 ? root : document;
    markNearestFlow(scope);
    if (!scope.querySelectorAll) return;
    var nodes = scope.querySelectorAll(FLOW_SELECTOR);
    for (var i = 0; i < nodes.length; i++) {
      markFlow(nodes[i]);
      var blocks = nodes[i].querySelectorAll(PROSE_BLOCK_SELECTOR);
      for (var j = 0; j < blocks.length; j++) markFlow(blocks[j]);
    }
  }

  var _scheduled = false;
  function tick() {
    if (_scheduled) return;
    _scheduled = true;
    setTimeout(function () {
      _scheduled = false;
      ensureButton();
      ensureDirOnInput();
    }, 120);
  }

  function init() {
    ensureButton();
    ensureDirOnInput();
    scanConversationFlow(document.body);
    var observer = new MutationObserver(function (records) {
      var needsComposerTick = false;
      for (var i = 0; i < records.length; i++) {
        var record = records[i];
        if (record.type === "characterData") {
          // Apply direction synchronously. Waiting for requestAnimationFrame
          // leaves streamed Persian words visibly growing from the left.
          markNearestFlow(record.target);
          continue;
        }
        markNearestFlow(record.target);
        for (var j = 0; j < record.addedNodes.length; j++) {
          markNearestFlow(record.addedNodes[j]);
          var added = record.addedNodes[j];
          if (added.nodeType === 1 && added.querySelectorAll) {
            var flows = added.matches && added.matches(FLOW_SELECTOR)
              ? [added]
              : added.querySelectorAll(FLOW_SELECTOR);
            for (var k = 0; k < flows.length; k++) markFlow(flows[k]);
          }
          if (
            added.nodeType === 1 &&
            ((added.matches && added.matches('[data-codex-composer-root],[data-codex-composer="true"],.ProseMirror,[contenteditable="true"]')) ||
             (added.querySelector && added.querySelector('[data-codex-composer-root],[data-codex-composer="true"],.ProseMirror,[contenteditable="true"]')))
          ) needsComposerTick = true;
        }
      }
      if (needsComposerTick) tick();
    });
    observer.observe(document.body, { childList: true, subtree: true, characterData: true });
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
`.trim();
}

function buildFontStack(preferredFontFamily) {
  const orderedFamilies = [
    preferredFontFamily,
    "CodexPersian",
    "Vazirmatn",
    "Vazir Text",
    "Vazir",
    "Segoe UI",
    "sans-serif"
  ];
  const uniqueFamilies = [];

  for (const family of orderedFamilies) {
    if (!family || uniqueFamilies.includes(family)) {
      continue;
    }
    uniqueFamilies.push(family);
  }

  return uniqueFamilies
    .map((family) => (family === "sans-serif" ? family : `"${family.replace(/"/g, '\\"')}"`))
    .join(", ");
}

// ── Structural signal scanner ────────────────────────────────────────────────
// Scans the Codex webview bundle for the identifiers the patch relies on.
// Tier 1 (core) signals are required; a miss means the patch can't work. Tier 2
// (feature) signals only affect a single surface and stay advisory.

// Core identifiers — each must be present or the patch is effectively broken.
const CORE_SIGNALS = [
  {
    id: "insertionPoint",
    category: "HTML hook",
    scope: "index",
    why: "Patch needs </head> or </body> in index.html to inject the inline block. Without an insertion point the patch cannot be installed at all.",
    check: ({ indexHtml }) => /<\/head>/i.test(indexHtml) || /<\/body>/i.test(indexHtml)
  },
  {
    id: "data-codex-composer",
    category: "DOM attribute",
    scope: "js",
    why: "Composer input signal. The toggle supports both the legacy [data-codex-composer=\"true\"] container and the current [data-codex-composer-root] structure.",
    check: ({ jsBundle }) => jsBundle.has("data-codex-composer")
  },
  {
    id: "ProseMirror",
    category: "CSS class",
    scope: "js+css",
    why: "Rich-text input element. The toggle finds the input via .ProseMirror[contenteditable=\"true\"].",
    check: ({ jsBundle, cssBundle }) => jsBundle.has("ProseMirror") || cssBundle.has("ProseMirror")
  }
];

// Feature identifiers, grouped by the UI surface they affect. Each entry
// names the feature so the dashboard can show "Tool activity styling" instead
// of the raw token. Tokens must be present in at least one of the declared
// scopes to pass.
const FEATURE_SIGNALS = [
  { id: "data-thread-find-target",        scope: "js",      category: "DOM attribute", feature: "Conversation panel targeting" },
  { id: "data-thread-find-composer",      scope: "js",      category: "DOM attribute", feature: "Composer fallback targeting" },
  { id: "data-content-search-turn-key",   scope: "js",      category: "DOM attribute", feature: "Conversation turn identifier" },
  { id: "data-content-search-unit-key",   scope: "js",      category: "DOM attribute", feature: "Conversation unit identifier" },
  { id: "data-radix-popper-content-wrapper", scope: "js",   category: "DOM attribute", feature: "Radix popovers and menus" },
  { id: "data-codex-terminal",            scope: "js",      category: "DOM attribute", feature: "Terminal LTR guard" },
  { id: "data-testid",                    scope: "js",      category: "DOM attribute", feature: "Test-id hooks used for UI targeting" },
  { id: "composer-input",                 scope: "js+css",  category: "CSS class",     feature: "Composer input panel surface" },
  { id: "tool-activity",                  scope: "js+css",  category: "CSS class",     feature: "Tool-activity blocks (LTR-forced)" },
  { id: "tool-outputs",                   scope: "js",      category: "CSS class",     feature: "Tool-output blocks (LTR-forced)" },
  { id: "code-snippet",                   scope: "js",      category: "CSS class",     feature: "Code snippet blocks (LTR-forced)" },
  { id: "code-editor",                    scope: "js+css",  category: "CSS class",     feature: "Embedded code editor (LTR-forced)" },
  { id: "diff_",                          scope: "js",      category: "CSS class",     feature: "Diff view blocks (LTR-forced)" },
  { id: "popover-",                       scope: "js+css",  category: "CSS prefix",    feature: "Popover panels" },
  { id: "dropdown-",                      scope: "js+css",  category: "CSS prefix",    feature: "Dropdown panels" },
  { id: "menu-dialog",                    scope: "js+css",  category: "CSS prefix",    feature: "Menu-dialog panels" },
  { id: "_content_",                      scope: "js+css",  category: "CSS fragment",  feature: "Portal content classes" },
  { id: "text-left",                      scope: "js",      category: "Tailwind utility", feature: "Tailwind text-align-left (RTL mirrors)" },
  { id: "items-start",                    scope: "js",      category: "Tailwind utility", feature: "Tailwind items-start (RTL mirrors)" },
  { id: "justify-start",                  scope: "js",      category: "Tailwind utility", feature: "Tailwind justify-start (RTL mirrors)" },
  { id: "ml-auto",                        scope: "js",      category: "Tailwind utility", feature: "Tailwind ml-auto (RTL mirrors)" },
  { id: "self-start",                     scope: "js",      category: "Tailwind utility", feature: "Tailwind self-start (RTL mirrors)" },
  { id: "self-end",                       scope: "js",      category: "Tailwind utility", feature: "Tailwind self-end (RTL mirrors)" },
  { id: "ml-2",                           scope: "js",      category: "Tailwind utility", feature: "Tailwind ml-2 in popovers (RTL mirrors)" }
];

// Fast haystack wrapper: scans a concatenated corpus once and answers has()
// in O(length) per lookup via a single indexOf call. This avoids quadratic
// behavior when scanning hundreds of entries against many megabytes of JS.
function makeHaystack(content) {
  return { has: (needle) => content.indexOf(needle) !== -1 };
}

// Build the corpora the scanner inspects. `jsBundle` is the concatenation of
// every JS asset under webview/assets (Codex is code-split, not a single
// bundle), `cssBundle` likewise. Files above 10 MB are skipped to protect
// against pathological future growth; the largest Codex asset today is ~1 MB.
function loadScanSources(target) {
  const webviewDir = path.dirname(target.indexFile);
  const assetsDir = path.join(webviewDir, "assets");
  let indexHtml = "";
  let jsConcat = "";
  let cssConcat = "";
  if (fs.existsSync(target.indexFile)) {
    indexHtml = fs.readFileSync(target.indexFile, "utf8");
  }
  if (fs.existsSync(assetsDir)) {
    const entries = fs.readdirSync(assetsDir);
    for (const name of entries) {
      if (!name.endsWith(".js") && !name.endsWith(".css")) continue;
      if (name === FONT_FILENAME || name === TOGGLE_JS_FILENAME) continue;
      const filePath = path.join(assetsDir, name);
      let stat;
      try { stat = fs.statSync(filePath); } catch { continue; }
      if (!stat.isFile() || stat.size > 10 * 1024 * 1024) continue;
      let content;
      try { content = fs.readFileSync(filePath, "utf8"); } catch { continue; }
      if (name.endsWith(".js")) jsConcat += content + "\n";
      else cssConcat += content + "\n";
    }
  }
  return {
    indexHtml,
    jsBundle: makeHaystack(jsConcat),
    cssBundle: makeHaystack(cssConcat),
    jsConcatLength: jsConcat.length,
    cssConcatLength: cssConcat.length
  };
}

// Given the preloaded corpora, test a feature signal. A signal passes if its
// identifier appears in at least one of the scopes it declares. Scope strings
// are simple unions joined by '+' so we can extend them later (e.g. "js+css").
function testFeatureSignal(signal, sources) {
  const scopes = String(signal.scope || "").split("+");
  for (const scope of scopes) {
    if (scope === "js" && sources.jsBundle.has(signal.id)) return true;
    if (scope === "css" && sources.cssBundle.has(signal.id)) return true;
    if (scope === "index" && sources.indexHtml.indexOf(signal.id) !== -1) return true;
  }
  return false;
}

// Main entrypoint. Returns a flat list of `{ tier, id, label, category,
// scope, ok, why, feature? }` records the UI layer can render directly.
function scanStructuralSignalsDetailed(target) {
  if (!target) return [];
  const sources = loadScanSources(target);
  const results = [];

  for (const s of CORE_SIGNALS) {
    let ok = false;
    try { ok = !!s.check(sources); } catch { ok = false; }
    results.push({
      tier: 1,
      id: s.id,
      label: s.id,
      category: s.category,
      scope: s.scope,
      ok,
      why: s.why
    });
  }

  for (const s of FEATURE_SIGNALS) {
    const ok = testFeatureSignal(s, sources);
    results.push({
      tier: 2,
      id: s.id,
      label: s.id,
      category: s.category,
      scope: s.scope,
      ok,
      why: s.feature
    });
  }

  return results;
}

// Back-compat adapter — returns Tier-1 failures as human-readable strings.
// Tier-2 advisories are never surfaced here; they flow through the detailed
// list to the dashboard instead.
function scanStructuralSignals(target) {
  const detailed = scanStructuralSignalsDetailed(target);
  const warnings = [];
  for (const r of detailed) {
    if (r.ok) continue;
    if (r.tier !== 1) continue;
    warnings.push(`${r.category} signal missing: "${r.label}" — ${r.why}`);
  }
  return warnings;
}

function inspectTargetCompatibility(target, config = {}) {
  const normalized = normalizeConfig(config);
  if (!target) {
    return {
      ok: false,
      foundTarget: false,
      reasons: ["OpenAI Codex extension was not found."],
      checks: []
    };
  }

  const checks = [];
  const rtlStylesheetExists = fs.existsSync(target.rtlCssFile);
  const compatibility = {
    ok: true,
    foundTarget: true,
    reasons: [],
    checks,
    target
  };

  addCheck(checks, "Target extension folder", target.extensionPath, fs.existsSync(target.extensionPath));
  addCheck(checks, "Bundled font file", target.fontSource, fs.existsSync(target.fontSource));
  addCheck(checks, "Codex index file", target.indexFile, fs.existsSync(target.indexFile));
  addCheck(
    checks,
    "Codex RTL stylesheet",
    target.rtlCssFile,
    true,
    rtlStylesheetExists
      ? "External stylesheet will be patched when available."
      : "Optional file not found. Inline index.html fallback will be used."
  );

  const requiredChecks = checks.filter((check) => check.name !== "Codex RTL stylesheet");
  if (!requiredChecks.every((check) => check.ok)) {
    compatibility.ok = false;
    compatibility.reasons = requiredChecks.filter((check) => !check.ok).map((check) => `${check.name} is missing.`);
    return compatibility;
  }

  const indexContents = fs.readFileSync(target.indexFile, "utf8");
  const rtlContents = rtlStylesheetExists ? fs.readFileSync(target.rtlCssFile, "utf8") : "";
  const indexInsertionPoint = resolveIndexInsertionPoint(indexContents);
  const indexHasInsertionPoint = Boolean(indexInsertionPoint);
  const indexManagedBlockExists = createManagedBlockPattern(PATCH_MARKER).test(indexContents);
  const rtlManagedBlockExists = createManagedBlockPattern(PATCH_MARKER).test(rtlContents);
  compatibility.indexInsertionPoint = indexInsertionPoint;

  addCheck(
    checks,
    "Index insertion point",
    indexInsertionPoint ?? "No supported closing tag found",
    indexHasInsertionPoint,
    "Supports </head> first, then falls back to </body>."
  );
  addCheck(
    checks,
    "Managed block in index",
    "Optional existing managed block",
    true,
    indexManagedBlockExists ? "Existing block will be updated." : "Patch will be inserted."
  );
  addCheck(
    checks,
    "Managed block in RTL CSS",
    "Optional existing managed block",
    true,
    rtlStylesheetExists
      ? rtlManagedBlockExists
        ? "Existing block will be updated."
        : "Patch will be appended."
      : "Skipped because the optional stylesheet file is not present."
  );
  addCheck(
    checks,
    "Preferred font family",
    normalized.preferredFontFamily,
    isSafeFontFamily(normalized.preferredFontFamily),
    "Unsafe values fall back to Vazirmatn."
  );
  if (!indexHasInsertionPoint && !indexManagedBlockExists) {
    compatibility.ok = false;
    compatibility.reasons.push(
      `Could not find a supported insertion point (</head> or </body>) in ${target.indexFile}`
    );
  }

  // Phase 2: structural signal scan. Heuristic, does NOT block patching —
  // warnings surface through the dashboard and the Output channel so the user
  // knows whether their installed Codex still matches what the patch expects.
  const detailedSignals = scanStructuralSignalsDetailed(target);
  const structuralWarnings = [];
  for (const r of detailedSignals) {
    if (r.ok) continue;
    if (r.tier !== 1) continue;
    structuralWarnings.push(`${r.category} signal missing: "${r.label}" — ${r.why}`);
  }
  compatibility.structuralSignals = detailedSignals;
  compatibility.structuralWarnings = structuralWarnings;

  // Phase 3: orphan artifact detection. Any <link>/<script>/file left on
  // disk by a previous version of this extension that the current managed
  // block no longer wraps. These cause the "Vazirmatn still active even
  // after uninstall" symptom and need to be cleaned up explicitly.
  compatibility.orphans = detectOrphanArtifacts(target);

  return compatibility;
}

function applyPatchToTarget(target, config = {}, logger = createNoopLogger()) {
  const normalized = normalizeConfig(config);
  if (!normalized.enabled) {
    logger.info("Patch skipped because the extension is disabled in settings.");
    return { changed: false, foundTarget: true, skipped: true, reason: "disabled" };
  }

  const compatibility = inspectTargetCompatibility(target, normalized);
  logCompatibility(logger, compatibility);
  if (!compatibility.foundTarget) {
    return { changed: false, foundTarget: false, compatibility };
  }
  if (!compatibility.ok) {
    throw new Error(compatibility.reasons.join(" "));
  }

  const blocks = buildBlocks(normalized);
  let changed = false;
  const indexInsertionPoint = compatibility.indexInsertionPoint ?? null;

  const fontCopied = copyFileIfDifferent(target.fontSource, target.fontTarget);
  logger.info(fontCopied.changed ? `Font copied to ${target.fontTarget}` : `Font already up to date at ${target.fontTarget}`);
  changed = fontCopied.changed || changed;

  const toggleJsWritten = writeFileIfDifferent(target.toggleJsTarget, blocks.toggleJs);
  logger.info(
    toggleJsWritten.changed
      ? `Toggle script written to ${target.toggleJsTarget}`
      : `Toggle script already up to date at ${target.toggleJsTarget}`
  );
  changed = toggleJsWritten.changed || changed;

  const modelSettingsPatched = patchUnknownModelFallback(target.modelSettingsJsTarget, logger);
  changed = modelSettingsPatched.changed || changed;

  const indexPatched = patchTextFile(target.indexFile, blocks.indexInlineBlock, {
    marker: PATCH_MARKER,
    insertBefore: indexInsertionPoint
  });
  logger.info(describeTextPatchResult("index.html", indexPatched));
  changed = indexPatched.changed || changed;

  let rtlPatched = { changed: false, mode: "unchanged" };
  if (fs.existsSync(target.rtlCssFile)) {
    rtlPatched = patchTextFile(target.rtlCssFile, blocks.rtlAppendBlock, {
      marker: PATCH_MARKER,
      append: true
    });
  } else {
    const written = writeFileIfDifferent(target.rtlCssFile, `${blocks.rtlAppendBlock}\n`);
    rtlPatched = { changed: written.changed, mode: written.changed ? "created" : "unchanged" };
  }
  logger.info(describeTextPatchResult("codex-rtl.css", rtlPatched));
  changed = rtlPatched.changed || changed;

  logger.info(
    changed ? `Patch applied in ${target.extensionPath}` : `Patch already up to date in ${target.extensionPath}`
  );

  return {
    changed,
    foundTarget: true,
    skipped: false,
    compatibility,
    structuralWarnings: compatibility.structuralWarnings ?? [],
    structuralSignals: compatibility.structuralSignals ?? [],
    actions: {
      fontCopied,
      toggleJsWritten,
      modelSettingsPatched,
      indexPatched,
      rtlPatched
    }
  };
}

function patchUnknownModelFallback(filePath, logger = createNoopLogger()) {
  if (!filePath || !fs.existsSync(filePath)) {
    logger.info("Custom model display patch skipped because use-model-settings bundle was not found.");
    return { changed: false, found: false, reason: "missing" };
  }

  ensureBackup(filePath);
  const original = fs.readFileSync(filePath, "utf8");
  if (original.includes(UNKNOWN_MODEL_FALLBACK_PATCH)) {
    logger.info(`Custom model display patch already up to date in ${filePath}`);
    return { changed: false, found: true };
  }
  if (!original.includes(UNKNOWN_MODEL_FALLBACK_PATTERN)) {
    logger.info(`Custom model display patch skipped because expected fallback pattern was not found in ${filePath}`);
    return { changed: false, found: true, reason: "patternMissing" };
  }

  fs.writeFileSync(filePath, original.replace(UNKNOWN_MODEL_FALLBACK_PATTERN, UNKNOWN_MODEL_FALLBACK_PATCH), "utf8");
  logger.info(`Custom model display patch written to ${filePath}`);
  return { changed: true, found: true };
}

function writeFileIfDifferent(targetPath, content) {
  if (fs.existsSync(targetPath)) {
    const existing = fs.readFileSync(targetPath, "utf8");
    if (existing === content) return { changed: false };
  }
  fs.mkdirSync(path.dirname(targetPath), { recursive: true });
  fs.writeFileSync(targetPath, content, "utf8");
  return { changed: true };
}

function restoreTarget(target, logger = createNoopLogger()) {
  if (!target) {
    logger.info("OpenAI Codex extension was not found.");
    return { changed: false, foundTarget: false };
  }

  const hasAnyTargetArtifact = [
    target.extensionPath,
    target.indexFile,
    target.rtlCssFile,
    target.fontTarget,
    target.toggleJsTarget,
    target.modelSettingsJsTarget,
    backupPath(target.indexFile),
    backupPath(target.rtlCssFile),
    backupPath(target.fontTarget),
    target.modelSettingsJsTarget ? backupPath(target.modelSettingsJsTarget) : null
  ].some((filePath) => filePath && fs.existsSync(filePath));
  if (!hasAnyTargetArtifact) {
    logger.info(`Codex target artifacts were not found at ${target.extensionPath}`);
    return { changed: false, foundTarget: false };
  }

  let changed = false;

  // ── index.html: backup-aware restore + always-on managed-artifact strip ──
  // Two-step recovery so a missing/stale backup never leaves orphan patch
  // bytes on disk. safeRestoreBackup adds a stale-backup heuristic on top of
  // the original restoreBackup: if the live file has grown well beyond the
  // backup size minus our managed contributions, the backup is treated as
  // stale (Codex was updated in place) and the strip path takes over. Older
  // versions of this extension also injected raw <link href="./assets/
  // codex-rtl.css"> tags directly into <head>, which the managed-block
  // pattern alone would never see — stripManagedArtifactsFromIndex catches
  // those too.
  const restoredIndex = safeRestoreBackup(target.indexFile, logger);
  if (restoredIndex.changed) {
    changed = true;
  } else if (restoredIndex.reason === "noBackup") {
    logger.info(`No backup found for ${target.indexFile}`);
  }
  const strippedIndex = stripManagedArtifactsFromIndex(target.indexFile);
  if (strippedIndex.changed) {
    logger.info(
      `Stripped orphan patch artifacts from ${target.indexFile}` +
      (strippedIndex.removed.length > 0 ? ` (${strippedIndex.removed.join(", ")})` : "")
    );
    changed = true;
  }

  // ── codex-rtl.css: backup-aware restore, otherwise remove if we own it ──
  // Codex vanilla ships NO codex-rtl.css. That file is created entirely by
  // this extension. If there's no backup it means the file didn't exist
  // before we patched — safe to delete outright so the user stops seeing
  // the Vazirmatn override after restore.
  const restoredRtl = safeRestoreBackup(target.rtlCssFile, logger);
  if (restoredRtl.changed) {
    changed = true;
  } else if (fs.existsSync(target.rtlCssFile)) {
    try {
      fs.unlinkSync(target.rtlCssFile);
      logger.info(`Removed orphan stylesheet ${target.rtlCssFile} (no backup available)`);
      changed = true;
    } catch (error) {
      logger.info(`Could not remove orphan stylesheet ${target.rtlCssFile}: ${error && error.message ? error.message : String(error)}`);
    }
  } else {
    logger.info(`No optional RTL stylesheet present at ${target.rtlCssFile}`);
  }

  // ── Font: prefer backup, otherwise remove our copy ──
  const fontBackup = backupPath(target.fontTarget);
  if (fs.existsSync(fontBackup)) {
    fs.copyFileSync(fontBackup, target.fontTarget);
    logger.info(`Restored backup for ${target.fontTarget}`);
    changed = true;
  } else if (fs.existsSync(target.fontTarget)) {
    fs.unlinkSync(target.fontTarget);
    logger.info(`Removed patched font ${target.fontTarget}`);
    changed = true;
  } else {
    logger.info(`No patched font to restore for ${target.fontTarget}`);
  }

  // ── Toggle script: always a product of this extension, never ships with Codex ──
  if (target.toggleJsTarget) {
    const removedToggle = removeFileIfPresent(target.toggleJsTarget);
    if (removedToggle) {
      logger.info(`Removed toggle script ${target.toggleJsTarget}`);
      changed = true;
    }
  }

  if (target.modelSettingsJsTarget) {
    const restoredModelSettings = safeRestoreBackup(target.modelSettingsJsTarget, logger);
    if (restoredModelSettings.changed) {
      changed = true;
    } else if (restoredModelSettings.reason === "noBackup") {
      logger.info(`No backup found for ${target.modelSettingsJsTarget}`);
    }
  }

  for (const artifactPath of target.legacyArtifacts ?? []) {
    const removedArtifact = removeFileIfPresent(artifactPath);
    const removedArtifactBackup = removeFileIfPresent(backupPath(artifactPath));
    if (removedArtifact || removedArtifactBackup) {
      logger.info(`Removed legacy artifact ${artifactPath}`);
      changed = true;
    }
  }

  for (const backupFilePath of [
    backupPath(target.indexFile),
    backupPath(target.rtlCssFile),
    backupPath(target.fontTarget),
    target.modelSettingsJsTarget ? backupPath(target.modelSettingsJsTarget) : null
  ]) {
    if (!backupFilePath) continue;
    if (removeFileIfPresent(backupFilePath)) {
      logger.info(`Removed cleanup backup ${backupFilePath}`);
      changed = true;
    }
  }

  logger.info(
    changed ? `Backups restored in ${target.extensionPath}` : `No backup files found in ${target.extensionPath}`
  );

  return { changed, foundTarget: true };
}

// Scans an index.html file and removes any artifact this extension has ever
// inserted — the managed block, direct <link rel="stylesheet"> tags to our
// companion stylesheet, and direct <script> tags to our toggle script.
//
// Designed to be safe to run on any file: if no matches are found it leaves
// the file untouched and reports `{ changed: false, removed: [] }`. This is
// what lets us recover files that were patched by an older version of the
// extension which did not create a backup, without the user having to
// manually edit the HTML.
function stripManagedArtifactsFromIndex(indexFilePath) {
  if (!fs.existsSync(indexFilePath)) {
    return { changed: false, removed: [] };
  }
  const original = fs.readFileSync(indexFilePath, "utf8");
  let updated = original;
  const removed = [];

  // 1) Managed block (preferred removal, wraps the modern inline patch).
  const managedRe = createManagedBlockPattern(PATCH_MARKER);
  if (managedRe.test(updated)) {
    updated = updated.replace(managedRe, "");
    removed.push("managed block");
  }

  // 2) Any stray <link> to codex-rtl.css — older versions of the extension
  //    injected this directly into <head> instead of wrapping it in a
  //    managed block, so the block-pattern above would miss it. Match the
  //    whole line plus its leading whitespace and trailing newline so we
  //    don't leave a blank line behind.
  const linkRe = /[ \t]*<link\b[^>]*\bhref\s*=\s*["'][^"']*codex-rtl\.css["'][^>]*>\s*\n?/gi;
  if (linkRe.test(updated)) {
    updated = updated.replace(linkRe, "");
    removed.push("codex-rtl.css <link>");
  }

  // 3) Any stray <script> pointing at our toggle script, for the same
  //    historical reason as the <link> above.
  const scriptRe = new RegExp(
    `[ \\t]*<script\\b[^>]*\\bsrc\\s*=\\s*["'][^"']*${escapeRegExp(TOGGLE_JS_FILENAME)}["'][^>]*>[\\s\\S]*?<\\/script>\\s*\\n?`,
    "gi"
  );
  if (scriptRe.test(updated)) {
    updated = updated.replace(scriptRe, "");
    removed.push(`${TOGGLE_JS_FILENAME} <script>`);
  }

  // 4) Legacy bootstrap/toggle artifacts, same shape.
  for (const legacyName of LEGACY_ARTIFACT_FILENAMES) {
    const legacyRe = new RegExp(
      `[ \\t]*<script\\b[^>]*\\bsrc\\s*=\\s*["'][^"']*${escapeRegExp(legacyName)}["'][^>]*>[\\s\\S]*?<\\/script>\\s*\\n?`,
      "gi"
    );
    if (legacyRe.test(updated)) {
      updated = updated.replace(legacyRe, "");
      removed.push(`${legacyName} <script>`);
    }
  }

  if (updated === original) return { changed: false, removed: [] };
  fs.writeFileSync(indexFilePath, updated, "utf8");
  return { changed: true, removed };
}

// Detects whether the target has orphan artifacts left behind by a previous
// install — either the managed block is gone but the raw <link>/<script>
// tags remain, or the companion CSS/JS files exist on disk without the
// managed block referencing them. Used by the UI to warn the user that a
// stale patch is still active even without this extension being installed.
function detectOrphanArtifacts(target) {
  const orphans = [];
  if (!target) return { hasOrphans: false, orphans };

  let indexHtml = "";
  if (fs.existsSync(target.indexFile)) {
    try { indexHtml = fs.readFileSync(target.indexFile, "utf8"); } catch {}
  }
  const hasManagedBlock = createManagedBlockPattern(PATCH_MARKER).test(indexHtml);

  // <link> to our stylesheet present but outside any managed block
  const hasRawLink = /<link\b[^>]*\bhref\s*=\s*["'][^"']*codex-rtl\.css["'][^>]*>/i.test(indexHtml);
  if (hasRawLink && !hasManagedBlock) {
    orphans.push({
      type: "indexLink",
      label: `<link href="./assets/codex-rtl.css"> in index.html without a managed block`,
      path: target.indexFile
    });
  }

  // <script> to our toggle script outside a managed block
  const hasRawToggleScript = new RegExp(
    `<script\\b[^>]*\\bsrc\\s*=\\s*["'][^"']*${escapeRegExp(TOGGLE_JS_FILENAME)}["'][^>]*>`,
    "i"
  ).test(indexHtml);
  if (hasRawToggleScript && !hasManagedBlock) {
    orphans.push({
      type: "indexScript",
      label: `<script src="./assets/${TOGGLE_JS_FILENAME}"> in index.html without a managed block`,
      path: target.indexFile
    });
  }

  // The stylesheet file itself — Codex vanilla doesn't ship it, so the only
  // reason it could exist on disk is if we (or a prior version of us) put
  // it there. If it exists but there's no managed block in index.html, it
  // is by definition an orphan.
  if (fs.existsSync(target.rtlCssFile) && !hasManagedBlock) {
    orphans.push({
      type: "rtlCssFile",
      label: `${path.basename(target.rtlCssFile)} exists in webview/assets without a managed block`,
      path: target.rtlCssFile
    });
  }

  // Toggle script file on disk without a managed block
  if (target.toggleJsTarget && fs.existsSync(target.toggleJsTarget) && !hasManagedBlock) {
    orphans.push({
      type: "toggleJsFile",
      label: `${path.basename(target.toggleJsTarget)} exists in webview/assets without a managed block`,
      path: target.toggleJsTarget
    });
  }

  // Legacy artifacts — any version of these files on disk is an orphan.
  for (const legacyPath of target.legacyArtifacts ?? []) {
    if (fs.existsSync(legacyPath)) {
      orphans.push({
        type: "legacyArtifact",
        label: `Legacy artifact ${path.basename(legacyPath)} in webview/assets`,
        path: legacyPath
      });
    }
  }

  return { hasOrphans: orphans.length > 0, orphans };
}

function patchTextFile(filePath, block, options) {
  ensureBackup(filePath);
  const original = fs.readFileSync(filePath, "utf8");
  // Single-instance pattern (anchor for the "managed block exists" test) and
  // a global pattern (used for hygiene). Older versions of this extension
  // that crashed mid-write or were applied twice could leave more than one
  // block in the file; without the global sweep below, regex.replace would
  // only fix the first one and orphan the rest, growing the file every apply.
  const singlePattern = createManagedBlockPattern(options.marker);
  const globalPattern = createManagedBlockPattern(options.marker, { global: true });

  let updated = original;
  let mode = "unchanged";

  // Hygiene sweep: count how many managed blocks exist BEFORE we touch the
  // file. If there is more than one, strip them all and treat the result as
  // a fresh file — the new block will be re-inserted/appended once, cleanly.
  const existingCount = countManagedBlocks(original, options.marker);
  if (existingCount > 1) {
    updated = updated.replace(globalPattern, "").replace(/\n{3,}/g, "\n\n").trimEnd() + "\n";
    mode = "deduplicated";
  }

  // Recovery for half-blocks (start without end, or end without start) left
  // by a previous run that crashed between writes.
  const recovered = stripCorruptManagedFragments(updated, options.marker);
  if (recovered !== updated) {
    updated = recovered;
    if (mode === "unchanged") mode = "deduplicated";
  }

  if (singlePattern.test(updated)) {
    // Exactly one managed block remains (either always was one, or we just
    // collapsed several into one) — replace it in place.
    updated = updated.replace(singlePattern, block);
    if (mode === "unchanged") mode = "updated";
  } else if (options.insertBefore) {
    if (!updated.includes(options.insertBefore)) {
      throw new Error(`Could not find insertion point "${options.insertBefore}" in ${filePath}`);
    }
    updated = updated.replace(options.insertBefore, `${block}\n  ${options.insertBefore}`);
    if (mode === "unchanged") mode = "inserted";
    else if (mode === "deduplicated") mode = "insertedAfterRecovery";
  } else if (options.append) {
    updated = `${updated.trimEnd()}\n\n${block}\n`;
    if (mode === "unchanged") mode = "appended";
    else if (mode === "deduplicated") mode = "appendedAfterRecovery";
  } else {
    throw new Error(`Unsupported patch strategy for ${filePath}`);
  }

  if (updated === original) {
    return { changed: false, mode: "unchanged" };
  }

  fs.writeFileSync(filePath, updated, "utf8");
  return { changed: true, mode };
}

// Build a regex that matches a managed block delimited by either an HTML or
// CSS/JS comment marker. Supports both single-match (for "exists?" tests and
// in-place replace) and global (for full-file sweep).
function createManagedBlockPattern(marker, options = {}) {
  const escapedMarker = escapeRegExp(marker);
  const flags = options.global ? "gm" : "m";
  return new RegExp(
    `(?:<!--|/\\*)\\s*${escapedMarker}:start\\s*(?:-->|\\*/)[\\s\\S]*?(?:<!--|/\\*)\\s*${escapedMarker}:end\\s*(?:-->|\\*/)`,
    flags
  );
}

// Counts how many complete managed blocks are present in the given text.
// Used for the duplicate-detection branch of patchTextFile.
function countManagedBlocks(text, marker) {
  const pattern = createManagedBlockPattern(marker, { global: true });
  let count = 0;
  for (const _ of text.matchAll(pattern)) count += 1;
  return count;
}

// Removes orphan ":start" or ":end" comment lines that have no matching
// counterpart anywhere else in the file. Defends against the case where a
// previous patch process crashed between writing the start marker and the end
// marker, leaving the file with a permanent half-block that would otherwise
// cause every subsequent apply to append a new block on top.
function stripCorruptManagedFragments(text, marker) {
  const startToken = new RegExp(
    `[ \\t]*(?:<!--|/\\*)\\s*${escapeRegExp(marker)}:start\\s*(?:-->|\\*/)\\s*\\n?`,
    "g"
  );
  const endToken = new RegExp(
    `[ \\t]*(?:<!--|/\\*)\\s*${escapeRegExp(marker)}:end\\s*(?:-->|\\*/)\\s*\\n?`,
    "g"
  );
  const starts = (text.match(startToken) || []).length;
  const ends = (text.match(endToken) || []).length;
  if (starts === ends) return text;
  return text.replace(startToken, "").replace(endToken, "");
}

// Removes ALL managed blocks (and any orphan half-blocks left by a crashed
// previous run) from a target file. Returns counts so the caller can log
// what happened. Safe on a clean file: returns { changed: false, ... }.
function stripManagedBlocksFromFile(filePath, marker) {
  if (!fs.existsSync(filePath)) {
    return { changed: false, removedCount: 0 };
  }
  let original;
  try {
    original = fs.readFileSync(filePath, "utf8");
  } catch {
    return { changed: false, removedCount: 0 };
  }

  const removedCount = countManagedBlocks(original, marker);
  let updated = original;
  if (removedCount > 0) {
    updated = updated.replace(createManagedBlockPattern(marker, { global: true }), "");
  }
  updated = stripCorruptManagedFragments(updated, marker);
  // Collapse runaway whitespace caused by removing blocks.
  updated = updated.replace(/\n{3,}/g, "\n\n");

  if (updated === original) {
    return { changed: false, removedCount: 0 };
  }
  fs.writeFileSync(filePath, updated, "utf8");
  return { changed: true, removedCount };
}

// Safely restore a backup over its live file. "Safe" means: if the live file
// is currently larger than backup + (size of one of our managed blocks), we
// suspect the target has been updated in place and our backup is stale —
// overwriting would corrupt the new install. In that case we leave the live
// file alone and let the managed-block strip handle the patch removal instead.
function safeRestoreBackup(filePath, logger) {
  const backup = backupPath(filePath);
  if (!fs.existsSync(backup)) {
    return { changed: false, reason: "noBackup" };
  }
  if (!fs.existsSync(filePath)) {
    fs.copyFileSync(backup, filePath);
    logger.info(`Restored backup for ${filePath} (live file was missing)`);
    return { changed: true, reason: "liveMissing" };
  }
  try {
    const live = fs.readFileSync(filePath, "utf8");
    const backed = fs.readFileSync(backup, "utf8");
    if (live === backed) {
      return { changed: false, reason: "alreadyEqual" };
    }
    const liveWithoutManaged = live.replace(
      createManagedBlockPattern(PATCH_MARKER, { global: true }),
      ""
    );
    if (liveWithoutManaged.length > backed.length + 256) {
      logger.info(
        `Backup ${backup} appears stale relative to ${filePath} ` +
        `(live ${live.length}b, live-without-patch ${liveWithoutManaged.length}b, backup ${backed.length}b). ` +
        `Skipping restore; managed-block strip will run instead.`
      );
      return { changed: false, reason: "staleBackup" };
    }
    fs.copyFileSync(backup, filePath);
    logger.info(`Restored backup for ${filePath}`);
    return { changed: true, reason: "ok" };
  } catch (error) {
    logger.info(
      `Backup restore for ${filePath} failed: ${error && error.message ? error.message : String(error)}. ` +
      `Falling back to managed-block strip.`
    );
    return { changed: false, reason: "error", error };
  }
}

function copyFileIfDifferent(source, target) {
  ensureBackup(target, { optional: true });
  const sourceBuffer = fs.readFileSync(source);
  if (fs.existsSync(target)) {
    const targetBuffer = fs.readFileSync(target);
    if (Buffer.compare(sourceBuffer, targetBuffer) === 0) {
      return { changed: false };
    }
  }
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.copyFileSync(source, target);
  return { changed: true };
}

function ensureBackup(filePath, options = {}) {
  const backup = backupPath(filePath);
  if (fs.existsSync(backup)) {
    return;
  }
  if (!fs.existsSync(filePath)) {
    if (options.optional) {
      return;
    }
    throw new Error(`File not found: ${filePath}`);
  }
  fs.copyFileSync(filePath, backup);
}

function restoreBackup(filePath) {
  const backup = backupPath(filePath);
  if (!fs.existsSync(backup)) {
    return { changed: false };
  }
  fs.copyFileSync(backup, filePath);
  return { changed: true };
}

function backupPath(filePath) {
  return `${filePath}.${PATCH_MARKER}.bak`;
}

function removeFileIfPresent(filePath) {
  if (!fs.existsSync(filePath)) {
    return false;
  }

  fs.unlinkSync(filePath);
  return true;
}

function compareVersionLikeStrings(leftName, rightName) {
  const leftParts = leftName
    .slice(TARGET_PREFIX.length)
    .split(/[^0-9]+/)
    .filter(Boolean)
    .map((value) => Number.parseInt(value, 10));
  const rightParts = rightName
    .slice(TARGET_PREFIX.length)
    .split(/[^0-9]+/)
    .filter(Boolean)
    .map((value) => Number.parseInt(value, 10));
  const maxLength = Math.max(leftParts.length, rightParts.length);

  for (let index = 0; index < maxLength; index += 1) {
    const leftValue = leftParts[index] ?? 0;
    const rightValue = rightParts[index] ?? 0;
    if (leftValue !== rightValue) {
      return leftValue - rightValue;
    }
  }

  return 0;
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function findLatestInstalledTarget(extensionsDir, fontSource) {
  if (!fs.existsSync(extensionsDir)) {
    return null;
  }

  const candidates = fs
    .readdirSync(extensionsDir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && entry.name.startsWith(TARGET_PREFIX))
    .sort((a, b) => compareVersionLikeStrings(a.name, b.name) || a.name.localeCompare(b.name))
    .map((entry) => path.join(extensionsDir, entry.name));

  const extensionPath = candidates.at(-1);
  if (!extensionPath) {
    return null;
  }

  return createTargetPaths(extensionPath, fontSource);
}

function createTargetPaths(extensionPath, fontSource) {
  const assetsDir = path.join(extensionPath, "webview", "assets");
  return {
    extensionPath,
    indexFile: path.join(extensionPath, "webview", "index.html"),
    rtlCssFile: path.join(assetsDir, "codex-rtl.css"),
    fontTarget: path.join(assetsDir, FONT_FILENAME),
    toggleJsTarget: path.join(assetsDir, TOGGLE_JS_FILENAME),
    modelSettingsJsTarget: findAssetByPrefix(assetsDir, USE_MODEL_SETTINGS_PREFIX),
    legacyArtifacts: LEGACY_ARTIFACT_FILENAMES.map((filename) =>
      path.join(assetsDir, filename)
    ),
    fontSource
  };
}

function findAssetByPrefix(assetsDir, prefix) {
  if (!fs.existsSync(assetsDir)) return null;
  const matches = fs
    .readdirSync(assetsDir)
    .filter((name) => name.startsWith(prefix) && name.endsWith(".js"))
    .sort();
  return matches.length > 0 ? path.join(assetsDir, matches.at(-1)) : null;
}

function createLogger(writeLine) {
  return {
    info(message) {
      writeLine(`[Codex Nexus] ${message}`);
    },
    section(title) {
      writeLine(`[Codex Nexus] ${title}`);
    }
  };
}

function createNoopLogger() {
  return {
    info() {},
    section() {}
  };
}

function addCheck(checks, name, value, ok, details = "") {
  checks.push({ name, value, ok, details });
}

function logCompatibility(logger, compatibility) {
  if (!compatibility || !compatibility.foundTarget) {
    logger.info("Compatibility check failed because the Codex extension was not found.");
    return;
  }

  logger.section("Compatibility check");
  for (const check of compatibility.checks) {
    const state = check.ok ? "OK" : "FAIL";
    const suffix = check.details ? ` (${check.details})` : "";
    logger.info(`${state} ${check.name}: ${check.value}${suffix}`);
  }
}

function describeTextPatchResult(label, result) {
  if (!result.changed) {
    if (result.mode === "skipped") {
      return `${label} was skipped because this version does not expose that file.`;
    }
    return `${label} is already up to date.`;
  }
  if (result.mode === "updated") {
    return `${label} existing managed block updated.`;
  }
  if (result.mode === "inserted") {
    return `${label} patch inserted.`;
  }
  if (result.mode === "appended") {
    return `${label} patch appended.`;
  }
  return `${label} changed.`;
}

function resolveIndexInsertionPoint(contents) {
  for (const pattern of INDEX_INSERTION_PATTERNS) {
    const match = contents.match(pattern);
    if (match?.[0]) {
      return match[0];
    }
  }
  return null;
}

function isSafeFontFamily(value) {
  if (typeof value !== "string") {
    return false;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 && /^[\w][\w\s-]{0,58}[\w]$|^[\w]{1}$/u.test(trimmed);
}


function computeFileChecksum(filePath) {
  if (!fs.existsSync(filePath)) {
    return null;
  }
  const content = fs.readFileSync(filePath);
  return crypto.createHash("sha256").update(content).digest("base64").replace(/=+$/, "");
}

function findDefaultAppRoot() {
  if (process.platform === "win32") {
    const localBase = path.join(os.homedir(), "AppData", "Local", "Programs", "Microsoft VS Code", "resources", "app");
    if (fs.existsSync(localBase)) return localBase;
    const progBase = path.join(process.env["ProgramFiles"] || "C:\\Program Files", "Microsoft VS Code", "resources", "app");
    if (fs.existsSync(progBase)) return progBase;
  } else if (process.platform === "darwin") {
    const macBase = "/Applications/Visual Studio Code.app/Contents/Resources/app";
    if (fs.existsSync(macBase)) return macBase;
  } else {
    const linuxCandidates = [
      "/usr/share/code/resources/app",
      "/usr/lib/code/resources/app",
      "/opt/visual-studio-code/resources/app"
    ];
    for (const candidate of linuxCandidates) {
      if (fs.existsSync(candidate)) return candidate;
    }
  }
  return null;
}

function findInstalledWorkbenchTarget(appRoot, fontSource) {
  const resolvedAppRoot = appRoot || (typeof vscode !== "undefined" && vscode.env?.appRoot) || findDefaultAppRoot();
  if (!resolvedAppRoot || !fs.existsSync(resolvedAppRoot)) {
    return null;
  }

  const productJson = path.join(resolvedAppRoot, "product.json");
  if (!fs.existsSync(productJson)) {
    return null;
  }

  const candidates = [
    path.join(resolvedAppRoot, "out", "vs", "code", "electron-sandbox", "workbench", "workbench.html"),
    path.join(resolvedAppRoot, "out", "vs", "code", "electron-browser", "workbench", "workbench.html"),
    path.join(resolvedAppRoot, "out", "vs", "code", "browser", "workbench", "workbench.html")
  ];
  const workbenchHtml = candidates.find((candidate) => fs.existsSync(candidate));
  if (!workbenchHtml) {
    return null;
  }

  const workbenchDir = path.dirname(workbenchHtml);
  const resolvedFontSource = fontSource || path.join(__dirname, "assets", FONT_FILENAME);
  const fontTarget = path.join(workbenchDir, FONT_FILENAME);
  const outDir = path.join(resolvedAppRoot, "out");
  const checksumKey = path.relative(outDir, workbenchHtml).replace(/\\/g, "/");

  return {
    appRoot: resolvedAppRoot,
    productJson,
    workbenchHtml,
    workbenchDir,
    checksumKey,
    fontSource: resolvedFontSource,
    fontTarget
  };
}

function buildWorkbenchUiCss(fontStack, fontUrl, fontSize = 0) {
  const fontSizeCss = fontSize > 0
    ? `
/* Optional user typography override for AI Chat */
.interactive-session .rendered-markdown,
.interactive-session-container .rendered-markdown,
.interactive-item-container .rendered-markdown,
.chat-widget .rendered-markdown,
.chat-widget-container .rendered-markdown,
.chat-list-container .rendered-markdown,
.chat-markdown-part,
.chat-markdown-part :is(p, li, blockquote, h1, h2, h3, h4, h5, h6),
.rendered-markdown :is(p, li, blockquote, h1, h2, h3, h4, h5, h6),
.interactive-item-container .value,
.chat-item .value {
  --codex-chat-font-size: ${fontSize}px !important;
  font-size: ${fontSize}px !important;
}
`
    : "";

  return `
@font-face {
  font-family: "CodexPersian";
  src: url("${fontUrl}") format("woff");
  font-style: normal;
  font-weight: 100 900;
  font-display: swap;
}

@font-face {
  font-family: "Vazirmatn";
  src: url("${fontUrl}") format("woff");
  font-style: normal;
  font-weight: 100 900;
  font-display: swap;
}

:root {
  --codex-persian-font-family: ${fontStack};
}

/* ── VS Code AI Chat & Copilot Chat Markdown & Text Content ── */
.interactive-session .rendered-markdown,
.interactive-session-container .rendered-markdown,
.interactive-item-container .rendered-markdown,
.chat-widget .rendered-markdown,
.chat-widget-container .rendered-markdown,
.chat-list-container .rendered-markdown,
.chat-markdown-part,
.chat-markdown-part p,
.chat-markdown-part li,
.chat-markdown-part h1,
.chat-markdown-part h2,
.chat-markdown-part h3,
.chat-markdown-part h4,
.chat-markdown-part h5,
.chat-markdown-part h6,
.chat-markdown-part blockquote,
.chat-markdown-part td,
.chat-markdown-part th,
.chat-markdown-part dt,
.chat-markdown-part dd,
.rendered-markdown p,
.rendered-markdown li,
.rendered-markdown h1,
.rendered-markdown h2,
.rendered-markdown h3,
.rendered-markdown h4,
.rendered-markdown h5,
.rendered-markdown h6,
.rendered-markdown blockquote,
.rendered-markdown td,
.rendered-markdown th,
.rendered-markdown dt,
.rendered-markdown dd,
.interactive-item-container .value,
.chat-item .value,
.chat-response,
.interactive-response,
.chat-request,
.interactive-request,
.chat-used-context,
.chat-subtitle,
.monaco-highlighted-label,
.chat-item-container .header,
.interactive-item-container .header {
  unicode-bidi: plaintext !important;
  text-align: start !important;
  font-family: var(--codex-persian-font-family), -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif !important;
  line-height: 1.8 !important;
}

/* ── Lists and blockquotes mirroring in AI Chat ── */
.interactive-session .rendered-markdown ol,
.interactive-session .rendered-markdown ul,
.interactive-session-container .rendered-markdown ol,
.interactive-session-container .rendered-markdown ul,
.chat-widget .rendered-markdown ol,
.chat-widget .rendered-markdown ul,
.chat-markdown-part ol,
.chat-markdown-part ul,
.rendered-markdown ol,
.rendered-markdown ul {
  padding-inline-start: 24px;
  padding-inline-end: 0;
  margin-inline-start: 0;
}

.interactive-session .rendered-markdown blockquote,
.chat-widget .rendered-markdown blockquote,
.chat-markdown-part blockquote,
.rendered-markdown blockquote {
  border-inline-start: 3px solid var(--vscode-textBlockQuote-border, #007acc) !important;
  padding-inline-start: 1rem !important;
  padding-inline-end: 0 !important;
}

/* ── AI Chat Composer & Monaco Input View Lines ── */
.interactive-input-editor .view-line,
.chat-input-part .monaco-editor .view-line,
.interactive-input-part .monaco-editor .view-line,
.chat-editor .view-line,
.interactive-session textarea,
.chat-widget textarea,
.chat-input-part textarea {
  unicode-bidi: plaintext !important;
  text-align: start !important;
  font-family: var(--codex-persian-font-family), -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif !important;
}

.interactive-input-editor .view-line > span,
.chat-input-part .monaco-editor .view-line > span,
.interactive-input-part .monaco-editor .view-line > span,
.chat-editor .view-line > span {
  width: 100%;
}

/* ── AI Chat Followup Suggestions ── */
.chat-followups,
.chat-followup-button,
.interactive-item-container .chat-followup-button,
.chat-widget .followup-item {
  unicode-bidi: plaintext !important;
  text-align: start !important;
  font-family: var(--codex-persian-font-family), -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif !important;
}

/* ── Code blocks, Inline Code, Diffs, and Monaco Editors MUST REMAIN LTR ── */
.interactive-session .rendered-markdown pre,
.interactive-session .rendered-markdown code,
.interactive-session .rendered-markdown pre *,
.interactive-session .rendered-markdown code *,
.chat-widget .rendered-markdown pre,
.chat-widget .rendered-markdown code,
.chat-widget .rendered-markdown pre *,
.chat-widget .rendered-markdown code *,
.chat-markdown-part pre,
.chat-markdown-part code,
.chat-markdown-part pre *,
.chat-markdown-part code *,
.rendered-markdown pre,
.rendered-markdown code,
.rendered-markdown pre *,
.rendered-markdown code *,
.chat-code-block,
.chat-code-block *,
[data-chat-part-type="codeBlock"],
[data-chat-part-type="codeBlock"] *,
[data-chat-part-type="diff"],
[data-chat-part-type="diff"] *,
.chat-item pre,
.chat-item code,
.chat-item pre *,
.chat-item code *,
.interactive-item-container pre,
.interactive-item-container code,
.interactive-item-container pre *,
.interactive-item-container code *,
.interactive-session .monaco-editor:not(.interactive-input-editor),
.interactive-session .monaco-editor:not(.interactive-input-editor) *,
.chat-widget .monaco-editor,
.chat-widget .monaco-editor *,
.xterm,
.xterm * {
  direction: ltr !important;
  text-align: left !important;
  unicode-bidi: isolate !important;
  font-family: var(--vscode-editor-font-family, Consolas, "Courier New", monospace) !important;
}
${fontSizeCss}
`.trim();
}

function buildWorkbenchBlocks(config = {}) {
  const normalized = normalizeConfig(config);
  const fontStack = buildFontStack(normalized.preferredFontFamily);
  const workbenchUiCss = buildWorkbenchUiCss(fontStack, `./${FONT_FILENAME}`, normalized.fontSize);

  return {
    workbenchInlineBlock: `
<!-- ${PATCH_MARKER}:start -->
<style id="${WORKBENCH_STYLE_ID}">
${workbenchUiCss}
</style>
<!-- ${PATCH_MARKER}:end -->
`.trim(),
    css: workbenchUiCss
  };
}

function inspectWorkbenchCompatibility(target, config = {}) {
  const normalized = normalizeConfig(config);
  if (!target) {
    return {
      ok: false,
      foundTarget: false,
      reasons: ["VS Code Workbench installation was not found."],
      checks: []
    };
  }

  const checks = [];
  const compatibility = {
    ok: true,
    foundTarget: true,
    reasons: [],
    checks,
    target,
    permissionDenied: false
  };

  const htmlExists = fs.existsSync(target.workbenchHtml);
  const productExists = fs.existsSync(target.productJson);
  const fontExists = fs.existsSync(target.fontSource);

  addCheck(checks, "VS Code Workbench HTML", target.workbenchHtml, htmlExists);
  addCheck(checks, "VS Code product.json", target.productJson, productExists);
  addCheck(checks, "Bundled font file", target.fontSource, fontExists);

  if (!htmlExists || !productExists || !fontExists) {
    compatibility.ok = false;
    compatibility.reasons = checks.filter((c) => !c.ok).map((c) => `${c.name} is missing.`);
    return compatibility;
  }

  let canWriteHtml = false;
  let canWriteProduct = false;
  try {
    fs.accessSync(target.workbenchHtml, fs.constants.W_OK);
    canWriteHtml = true;
  } catch {}
  try {
    fs.accessSync(target.productJson, fs.constants.W_OK);
    canWriteProduct = true;
  } catch {}

  addCheck(
    checks,
    "Workbench write permissions",
    canWriteHtml && canWriteProduct ? "Writable" : "Read-only",
    canWriteHtml && canWriteProduct,
    canWriteHtml && canWriteProduct
      ? "Workbench files are writable."
      : "Elevated permissions may be needed to patch VS Code workbench directly on this machine."
  );

  if (!canWriteHtml || !canWriteProduct) {
    compatibility.ok = false;
    compatibility.permissionDenied = true;
    compatibility.reasons.push("VS Code installation directory is read-only for the current process.");
    return compatibility;
  }

  const htmlContents = fs.readFileSync(target.workbenchHtml, "utf8");
  const insertionPoint = resolveIndexInsertionPoint(htmlContents);
  const hasInsertionPoint = Boolean(insertionPoint);
  const managedBlockExists = createManagedBlockPattern(PATCH_MARKER).test(htmlContents);
  compatibility.insertionPoint = insertionPoint;

  addCheck(
    checks,
    "Workbench insertion point",
    insertionPoint ?? "No supported closing tag found",
    hasInsertionPoint || managedBlockExists,
    "Supports </head> first, then falls back to </body> or </html>."
  );

  addCheck(
    checks,
    "Preferred font family",
    normalized.preferredFontFamily,
    isSafeFontFamily(normalized.preferredFontFamily),
    "Unsafe values fall back to Vazirmatn."
  );

  if (!hasInsertionPoint && !managedBlockExists) {
    compatibility.ok = false;
    compatibility.reasons.push(`Could not find a supported insertion point in ${target.workbenchHtml}`);
  }

  return compatibility;
}

function updateProductChecksum(productJsonPath, checksumKey, newChecksum, logger = createNoopLogger()) {
  if (!productJsonPath || !fs.existsSync(productJsonPath)) {
    return { changed: false, reason: "missing" };
  }
  try {
    ensureBackup(productJsonPath);
    const content = fs.readFileSync(productJsonPath, "utf8");
    const parsed = JSON.parse(content);
    if (!parsed.checksums || typeof parsed.checksums !== "object") {
      return { changed: false, reason: "noChecksumsField" };
    }
    if (checksumKey && parsed.checksums[checksumKey] === newChecksum) {
      return { changed: false, reason: "alreadyCurrent" };
    }
    if (checksumKey) {
      parsed.checksums[checksumKey] = newChecksum;
      fs.writeFileSync(productJsonPath, JSON.stringify(parsed, null, "\t") + "\n", "utf8");
      logger.info(`Updated product.json checksum for ${checksumKey}`);
      return { changed: true };
    }
    return { changed: false };
  } catch (error) {
    logger.info(`Could not update product.json checksum: ${error && error.message ? error.message : String(error)}`);
    return { changed: false, error };
  }
}

function applyPatchToWorkbench(target, config = {}, logger = createNoopLogger()) {
  const normalized = normalizeConfig(config);
  if (!normalized.enabled) {
    logger.info("Workbench AI Chat patch skipped because the extension is disabled in settings.");
    return { changed: false, foundTarget: true, skipped: true, reason: "disabled" };
  }

  const compatibility = inspectWorkbenchCompatibility(target, normalized);
  logCompatibility(logger, compatibility);
  if (!compatibility.foundTarget) {
    return { changed: false, foundTarget: false, compatibility };
  }
  if (!compatibility.ok) {
    if (compatibility.permissionDenied) {
      logger.info(`VS Code Workbench patch skipped: write permission denied for ${target.workbenchHtml}.`);
      return { changed: false, foundTarget: true, skipped: true, reason: "permissionDenied", compatibility };
    }
    throw new Error(compatibility.reasons.join(" "));
  }

  const blocks = buildWorkbenchBlocks(normalized);
  let changed = false;
  const insertionPoint = compatibility.insertionPoint ?? null;

  const fontCopied = copyFileIfDifferent(target.fontSource, target.fontTarget);
  logger.info(fontCopied.changed ? `Font copied to ${target.fontTarget}` : `Font already up to date at ${target.fontTarget}`);
  changed = fontCopied.changed || changed;

  const htmlPatched = patchTextFile(target.workbenchHtml, blocks.workbenchInlineBlock, {
    marker: PATCH_MARKER,
    insertBefore: insertionPoint
  });
  logger.info(describeTextPatchResult("workbench.html", htmlPatched));
  changed = htmlPatched.changed || changed;

  const newChecksum = computeFileChecksum(target.workbenchHtml);
  let checksumUpdated = { changed: false };
  if (newChecksum && target.productJson && fs.existsSync(target.productJson)) {
    checksumUpdated = updateProductChecksum(target.productJson, target.checksumKey, newChecksum, logger);
    changed = checksumUpdated.changed || changed;
  }

  logger.info(
    changed ? `VS Code AI Chat patch applied to Workbench at ${target.workbenchHtml}` : `VS Code AI Chat patch already up to date at ${target.workbenchHtml}`
  );

  return {
    changed,
    foundTarget: true,
    skipped: false,
    compatibility,
    actions: {
      fontCopied,
      htmlPatched,
      checksumUpdated
    }
  };
}

function restoreWorkbenchTarget(target, logger = createNoopLogger()) {
  if (!target) {
    logger.info("VS Code Workbench was not found.");
    return { changed: false, foundTarget: false };
  }

  const hasAnyArtifact = [
    target.workbenchHtml,
    target.fontTarget,
    backupPath(target.workbenchHtml),
    target.productJson ? backupPath(target.productJson) : null
  ].some((p) => p && fs.existsSync(p));

  if (!hasAnyArtifact) {
    logger.info(`No Workbench patch artifacts found at ${target.appRoot}`);
    return { changed: false, foundTarget: false };
  }

  let changed = false;

  const restoredHtml = safeRestoreBackup(target.workbenchHtml, logger);
  if (restoredHtml.changed) {
    changed = true;
  }
  const strippedHtml = stripManagedBlocksFromFile(target.workbenchHtml, PATCH_MARKER);
  if (strippedHtml.changed) {
    logger.info(`Stripped managed blocks from ${target.workbenchHtml}`);
    changed = true;
  }

  if (target.productJson && fs.existsSync(target.productJson)) {
    const restoredProduct = safeRestoreBackup(target.productJson, logger);
    if (restoredProduct.changed) {
      changed = true;
    } else if (target.checksumKey) {
      const currentChecksum = computeFileChecksum(target.workbenchHtml);
      if (currentChecksum) {
        try {
          const content = fs.readFileSync(target.productJson, "utf8");
          const parsed = JSON.parse(content);
          if (parsed.checksums && parsed.checksums[target.checksumKey] && parsed.checksums[target.checksumKey] !== currentChecksum) {
            parsed.checksums[target.checksumKey] = currentChecksum;
            fs.writeFileSync(target.productJson, JSON.stringify(parsed, null, "\t") + "\n", "utf8");
            changed = true;
          }
        } catch {}
      }
    }
  }

  const fontBackup = backupPath(target.fontTarget);
  if (fs.existsSync(fontBackup)) {
    fs.copyFileSync(fontBackup, target.fontTarget);
    logger.info(`Restored backup for ${target.fontTarget}`);
    changed = true;
  } else if (fs.existsSync(target.fontTarget)) {
    try {
      fs.unlinkSync(target.fontTarget);
      logger.info(`Removed patched font ${target.fontTarget}`);
      changed = true;
    } catch {}
  }

  for (const backupFilePath of [
    backupPath(target.workbenchHtml),
    target.productJson ? backupPath(target.productJson) : null,
    backupPath(target.fontTarget)
  ]) {
    if (backupFilePath && removeFileIfPresent(backupFilePath)) {
      logger.info(`Removed cleanup backup ${backupFilePath}`);
      changed = true;
    }
  }

  logger.info(
    changed ? `Backups restored for VS Code Workbench` : `No Workbench backup files found to restore`
  );

  return { changed, foundTarget: true };
}

module.exports = {
  buildFontStack,
  WORKBENCH_STYLE_ID,
  applyPatchToWorkbench,
  buildWorkbenchBlocks,
  buildWorkbenchUiCss,
  computeFileChecksum,
  findDefaultAppRoot,
  findInstalledWorkbenchTarget,
  inspectWorkbenchCompatibility,
  restoreWorkbenchTarget,
  updateProductChecksum,
  CONFIG_SECTION,
  LEGACY_CONFIG_SECTION,
  DEFAULT_CONFIG,
  FONT_FILENAME,
  PERSIAN_UI_CSS_FILENAME,
  PATCH_MARKER,
  TARGET_EXTENSION_ID,
  TARGET_PREFIX,
  applyPatchToTarget,
  buildBlocks,
  countManagedBlocks,
  createLogger,
  createTargetPaths,
  detectOrphanArtifacts,
  findLatestInstalledTarget,
  inspectTargetCompatibility,
  normalizeConfig,
  restoreTarget,
  scanStructuralSignals,
  scanStructuralSignalsDetailed,
  stripCorruptManagedFragments,
  stripManagedArtifactsFromIndex,
  stripManagedBlocksFromFile
};
