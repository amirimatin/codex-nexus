const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const {
  applyPatchToTarget,
  buildBlocks,
  countManagedBlocks,
  createTargetPaths,
  restoreTarget,
} = require('../patch-core');

function fixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'codex-persian-rtl-'));
  const extensionPath = path.join(root, 'openai.chatgpt-26.707.41301');
  const assets = path.join(extensionPath, 'webview', 'assets');
  fs.mkdirSync(assets, { recursive: true });
  fs.writeFileSync(
    path.join(extensionPath, 'webview', 'index.html'),
    '<!doctype html><html><head></head><body><div id="root"></div></body></html>\n',
  );
  fs.writeFileSync(
    path.join(assets, 'index-fixture.js'),
    'const hooks = "data-codex-composer ProseMirror data-thread-find-target";\n',
  );
  fs.writeFileSync(
    path.join(assets, 'use-model-settings-fixture.js'),
    'let e=le({userSavedModelString:M?null:k,userSavedReasoningEffort:A});\n',
  );
  const fontSource = path.join(__dirname, '..', 'assets', 'Vazir.woff');
  return { root, target: createTargetPaths(extensionPath, fontSource) };
}

function runToggleScriptWithParagraph(initialText, { technical = false } = {}) {
  const blocks = buildBlocks();
  let observerCallback;

  class FakeElement {
    constructor(kind, text = '', parent = null) {
      this.kind = kind;
      this.nodeType = 1;
      this.textContent = text;
      this.parentElement = parent;
      this.attributes = new Map();
      this.style = { setProperty() {} };
    }

    matches(selector) {
      return this.kind === 'container' && selector.includes('.vscode-markdown');
    }

    closest(selector) {
      if (selector.includes('pre') && technical) return this.kind === 'technical' ? this : this.parentElement;
      if (selector === 'p,li,blockquote,h1,h2,h3,h4,h5,h6') {
        return this.kind === 'paragraph' ? this : null;
      }
      if (selector.includes('.vscode-markdown')) {
        if (this.kind === 'container') return this;
        return container;
      }
      return null;
    }

    contains(node) {
      return node === this || node.parentElement === this;
    }

    querySelectorAll(selector) {
      if (this.kind === 'body' && selector.includes('.vscode-markdown')) return [container];
      if (this.kind === 'container' && selector === 'p,li,blockquote,h1,h2,h3,h4,h5,h6') {
        return [paragraph];
      }
      return [];
    }

    querySelector() { return null; }
    getAttribute(name) { return this.attributes.get(name) ?? null; }
    setAttribute(name, value) { this.attributes.set(name, String(value)); }
    removeAttribute(name) { this.attributes.delete(name); }
  }

  const body = new FakeElement('body');
  const container = new FakeElement('container', initialText, body);
  const paragraphParent = technical ? new FakeElement('technical', initialText, container) : container;
  const paragraph = new FakeElement('paragraph', initialText, paragraphParent);
  const textNode = { nodeType: 3, data: initialText, parentElement: paragraph };
  const document = {
    body,
    documentElement: new FakeElement('html'),
    readyState: 'complete',
    querySelector() { return null; },
    querySelectorAll() { return []; },
    addEventListener() {},
  };

  class FakeMutationObserver {
    constructor(callback) { observerCallback = callback; }
    observe() {}
  }

  vm.runInNewContext(blocks.toggleJs, {
    document,
    MutationObserver: FakeMutationObserver,
    setTimeout() {},
    requestAnimationFrame() {},
    localStorage: { getItem() { return null; }, setItem() {} },
  });

  return {
    paragraph,
    stream(nextCompleteText, appendedFragment) {
      paragraph.textContent = nextCompleteText;
      container.textContent = nextCompleteText;
      textNode.data = appendedFragment;
      observerCallback([{ type: 'characterData', target: textNode, addedNodes: [] }]);
    },
  };
}

test('external stylesheet includes scoped RTL rules and the index block stays small', () => {
  const blocks = buildBlocks();
  assert.match(blocks.rtlAppendBlock, /font-family: "Vazirmatn"/);
  assert.match(blocks.indexInlineBlock, /href="\.\/assets\/codex-rtl\.css"/);
  assert.doesNotMatch(blocks.indexInlineBlock, /<style/);
  assert.match(blocks.indexInlineBlock, /codex-vazirmatn-toggle\.js/);
  assert.match(blocks.toggleJs, /data-vazirmatn-toggle/);
  assert.match(blocks.toggleJs, /data-codex-composer-root/);
  assert.match(blocks.toggleJs, /isSafeButtonHost/);
  assert.match(blocks.toggleJs, /_btn\.textContent = isRtl \? "فا" : "EN"/);
  assert.doesNotMatch(blocks.toggleJs, /else host\.appendChild\(_btn\)/);
  assert.match(blocks.toggleJs, /characterData: true/);
  assert.match(blocks.toggleJs, /data-selected-text-overlay-target/);
  assert.match(blocks.toggleJs, /_markdownContent_/);
  assert.match(
    blocks.toggleJs,
    /record\.type === "characterData"[\s\S]*?markNearestFlow\(record\.target\)/,
  );
  assert.match(
    blocks.toggleJs,
    /root && root\.nodeType === 1 \? root\.textContent : null/,
  );
  assert.doesNotMatch(blocks.toggleJs, /scheduleFlowScan/);
  assert.match(blocks.rtlAppendBlock, /data-selected-text-overlay-target/);
  assert.match(blocks.rtlAppendBlock, /data-selected-text-overlay-target\] \*/);
  assert.match(blocks.rtlAppendBlock, /data-thread-find-target="conversation"\] \*/);
  assert.match(blocks.rtlAppendBlock, /data-content-search-turn-key\] \*/);
  assert.match(blocks.rtlAppendBlock, /data-content-search-unit-key\] \*/);
  assert.match(blocks.rtlAppendBlock, /chat-view/);
  assert.match(blocks.rtlAppendBlock, /agent-view/);
  assert.match(blocks.rtlAppendBlock, /chat-input/);
  assert.match(blocks.rtlAppendBlock, /data-chat-session-id/);
  assert.match(blocks.rtlAppendBlock, /_markdownRoot_.*_fadeIn_/s);
  assert.match(blocks.rtlAppendBlock, /unicode-bidi: normal !important/);
  assert.match(blocks.toggleJs, /setAttribute\("dir", dir\)/);
  assert.match(blocks.toggleJs, /exploration-accordion-body/);
  assert.match(blocks.toggleJs, /data-vazirmatn-flow/);
  assert.match(blocks.toggleJs, /PROSE_BLOCK_SELECTOR/);
  assert.match(blocks.toggleJs, /detectFlowDir\(el\.textContent\) \|\| hintedDir/);
  assert.match(blocks.rtlAppendBlock, /data-vazirmatn-flow="ltr"/);
  assert.match(
    blocks.rtlAppendBlock,
    /data-vazirmatn-flow="rtl"[\s\S]*?unicode-bidi: isolate !important/,
  );
  assert.match(blocks.rtlAppendBlock, /diffs-container/);
  assert.match(blocks.rtlAppendBlock, /data-thread-find-target="review"/);
  assert.match(blocks.rtlAppendBlock, /codex-review-diff-card/);
  assert.match(blocks.rtlAppendBlock, /body \[data-line-type\]/);
  assert.match(blocks.rtlAppendBlock, /body \[class\*="diffs-"\]/);
  assert.match(blocks.rtlAppendBlock, /body \[data-app-action-review-file-expanded\]/);
  assert.match(blocks.rtlAppendBlock, /body \[data-markdown-copy="code-block"\]/);
  assert.match(blocks.rtlAppendBlock, /body \[class\*="_codeBlock_"\]/);
  assert.match(
    blocks.rtlAppendBlock,
    /\[role="listbox"\] \*[\s\S]*?unicode-bidi: normal !important/,
  );
  assert.match(
    blocks.rtlAppendBlock,
    /\[role="listbox"\][,\s\S]*?unicode-bidi: isolate !important/,
  );
  assert.match(blocks.rtlAppendBlock, /\[data-diff\]/);
  assert.match(blocks.rtlAppendBlock, /data-markdown-copy="code-block"/);
  assert.match(blocks.rtlAppendBlock, /_codeBlock_/);
  assert.doesNotMatch(blocks.rtlAppendBlock, /request-input-panel__inline-freeform/);
  assert.doesNotThrow(() => new vm.Script(blocks.toggleJs));
});

test('composer badge is emitted only for an active custom-provider model', () => {
  const custom = buildBlocks({ customModel: 'cx/gpt-5.6-sol', customProvider: '9Router' });
  const native = buildBlocks();

  assert.match(custom.toggleJs, /vazirmatn-custom-model/);
  assert.match(custom.toggleJs, /cx\/gpt-5\.6-sol/);
  assert.match(custom.toggleJs, /9Router/);
  assert.match(custom.toggleJs, /Active provider model:/);
  assert.match(native.toggleJs, /var CUSTOM_MODEL = ""/);
});

test('patch preserves unknown custom model names in Codex model settings bundle', () => {
  const { target } = fixture();
  const result = applyPatchToTarget(target);
  const modelSettings = fs.readFileSync(target.modelSettingsJsTarget, 'utf8');

  assert.equal(result.actions.modelSettingsPatched.changed, true);
  assert.match(modelSettings, /userSavedModelString:k/);
  assert.doesNotMatch(modelSettings, /userSavedModelString:M\?null:k/);
});

test('mixed prose becomes RTL as soon as any Persian character is streamed', () => {
  const rendered = runToggleScriptWithParagraph('English only');
  assert.equal(rendered.paragraph.getAttribute('data-vazirmatn-flow'), 'ltr');
  assert.equal(rendered.paragraph.getAttribute('dir'), 'ltr');

  rendered.stream('English first، سپس متن فارسی', ' فارسی');
  assert.equal(rendered.paragraph.getAttribute('data-vazirmatn-flow'), 'rtl');
  assert.equal(rendered.paragraph.getAttribute('dir'), 'rtl');
});

test('entirely non-Persian prose stays LTR and technical surfaces are unclassified', () => {
  const english = runToggleScriptWithParagraph('This paragraph is entirely English.');
  assert.equal(english.paragraph.getAttribute('data-vazirmatn-flow'), 'ltr');

  const technical = runToggleScriptWithParagraph('const پیام = true;', { technical: true });
  assert.equal(technical.paragraph.getAttribute('data-vazirmatn-flow'), null);
  assert.equal(technical.paragraph.getAttribute('dir'), null);
});

test('font size is opt-in, bounded, and scoped away from technical surfaces', () => {
  const defaults = buildBlocks();
  const custom = buildBlocks({ fontSize: 15 });
  const invalid = buildBlocks({ fontSize: 9 });

  assert.doesNotMatch(defaults.rtlAppendBlock, /font-size: 0px/);
  assert.match(custom.rtlAppendBlock, /font-size: 15px !important/);
  assert.match(custom.rtlAppendBlock, /--codex-chat-font-size: 15px !important/);
  assert.match(custom.rtlAppendBlock, /--markdown-font-size: 15px !important/);
  assert.match(custom.rtlAppendBlock, /\.ProseMirror/);
  assert.doesNotMatch(invalid.rtlAppendBlock, /font-size: 9px/);

  const broadRtl = custom.rtlAppendBlock.indexOf(
    '[data-thread-find-target="conversation"] *',
  );
  const technicalLtr = custom.rtlAppendBlock.indexOf(
    '[data-markdown-copy="code-block"]',
  );
  const portalLtr = custom.rtlAppendBlock.indexOf(
    'body [data-app-action-review-file-expanded]',
  );
  assert.ok(broadRtl >= 0 && technicalLtr > broadRtl && portalLtr > technicalLtr);
});

test('apply is idempotent and restore removes every managed artifact', (t) => {
  const { root, target } = fixture();
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));

  const first = applyPatchToTarget(target);
  assert.equal(first.changed, true);

  const indexAfterFirstApply = fs.readFileSync(target.indexFile, 'utf8');
  assert.equal(countManagedBlocks(indexAfterFirstApply, 'codex-vazirmatn-font'), 1);
  assert.match(indexAfterFirstApply, /codex-rtl\.css/);
  assert.match(fs.readFileSync(target.rtlCssFile, 'utf8'), /data-thread-find-target="review"/);
  assert.equal(fs.existsSync(target.fontTarget), true);
  assert.equal(fs.existsSync(target.toggleJsTarget), true);

  const second = applyPatchToTarget(target);
  assert.equal(second.changed, false);
  assert.equal(
    countManagedBlocks(fs.readFileSync(target.indexFile, 'utf8'), 'codex-vazirmatn-font'),
    1,
  );

  const restored = restoreTarget(target);
  assert.equal(restored.changed, true);
  const restoredIndex = fs.readFileSync(target.indexFile, 'utf8');
  assert.equal(countManagedBlocks(restoredIndex, 'codex-vazirmatn-font'), 0);
  assert.doesNotMatch(restoredIndex, /--md-heading-1/);
  assert.equal(fs.existsSync(target.rtlCssFile), false);
  assert.equal(fs.existsSync(target.toggleJsTarget), false);
});
