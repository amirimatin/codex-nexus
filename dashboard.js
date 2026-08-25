const vscode = require("vscode");

class DashboardProvider {
  constructor(
    extensionUri,
    getState,
    updateSetting,
    updateCodexModel,
    refreshCodexProviderModels,
    switchActiveProvider,
    saveCustomProvider,
    deleteCustomProvider
  ) {
    this._extensionUri = extensionUri;
    this._getState = getState;
    this._updateSetting = updateSetting;
    this._updateCodexModel = updateCodexModel;
    this._refreshCodexProviderModels = refreshCodexProviderModels;
    this._switchActiveProvider = switchActiveProvider;
    this._saveCustomProvider = saveCustomProvider;
    this._deleteCustomProvider = deleteCustomProvider;
    this._view = null;
  }

  resolveWebviewView(webviewView) {
    this._view = webviewView;
    webviewView.webview.options = {
      enableScripts: true,
      localResourceRoots: [this._extensionUri]
    };
    webviewView.webview.html = this._getHtml(webviewView.webview);

    webviewView.webview.onDidReceiveMessage(async (message) => {
      if (!message || !message.type) return;
      switch (message.type) {
        case "action":
          try {
            await vscode.commands.executeCommand(message.command);
          } catch (error) {
            vscode.window.showErrorMessage(
              `Action failed: ${error instanceof Error ? error.message : String(error)}`
            );
          }
          break;
        case "ready":
        case "refresh":
          this.refresh();
          break;
        case "setting":
          try {
            await this._updateSetting(message.key, message.value);
          } catch (error) {
            vscode.window.showErrorMessage(
              `Could not save setting: ${error instanceof Error ? error.message : String(error)}`
            );
          } finally {
            this.refresh();
          }
          break;
        case "codexModel":
          try {
            await this._updateCodexModel(message.model);
          } catch (error) {
            vscode.window.showErrorMessage(
              `Could not save Codex model: ${error instanceof Error ? error.message : String(error)}`
            );
          } finally {
            this.refresh();
          }
          break;
        case "codexModelsRefresh":
          try {
            if (this._refreshCodexProviderModels) {
              await this._refreshCodexProviderModels();
            }
          } catch (error) {
            vscode.window.showErrorMessage(
              `Could not load provider models: ${error instanceof Error ? error.message : String(error)}`
            );
          } finally {
            this.refresh();
          }
          break;
        case "switchActiveProvider":
          try {
            if (this._switchActiveProvider) {
              await this._switchActiveProvider(message.providerId);
            }
          } catch (error) {
            vscode.window.showErrorMessage(
              `Could not switch provider: ${error instanceof Error ? error.message : String(error)}`
            );
          } finally {
            this.refresh();
          }
          break;
        case "saveCustomProvider":
          try {
            if (this._saveCustomProvider) {
              await this._saveCustomProvider(message.providerId, message.data);
            }
          } catch (error) {
            vscode.window.showErrorMessage(
              `Could not save provider: ${error instanceof Error ? error.message : String(error)}`
            );
          } finally {
            this.refresh();
          }
          break;
        case "deleteCustomProvider":
          try {
            if (this._deleteCustomProvider) {
              await this._deleteCustomProvider(message.providerId);
            }
          } catch (error) {
            vscode.window.showErrorMessage(
              `Could not delete provider: ${error instanceof Error ? error.message : String(error)}`
            );
          } finally {
            this.refresh();
          }
          break;
      }
    });

    webviewView.onDidChangeVisibility(() => {
      if (webviewView.visible) {
        this.refresh();
      }
    });

    this.refresh();
  }

  refresh() {
    if (!this._view) return;
    try {
      const state = this._getState();
      this._view.webview.postMessage({ type: "state", state });
    } catch {
      /* passive UI — swallow */
    }
  }

  _getHtml(webview) {
    const nonce = createNonce();
    const cspSource = webview.cspSource;
    return `<!DOCTYPE html>
<html lang="en" dir="ltr">
<head>
<meta charset="UTF-8" />
<meta http-equiv="Content-Security-Policy"
      content="default-src 'none'; style-src ${cspSource} 'unsafe-inline'; script-src 'nonce-${nonce}';" />
<meta name="viewport" content="width=device-width, initial-scale=1.0" />
<title>Codex Nexus</title>
<style>
  /* ══════════════════════════════════════════════════════════════════
     GOOGLE MATERIAL DESIGN 3 (M3) DESIGN TOKENS FOR VS CODE THEMES
     ══════════════════════════════════════════════════════════════════ */
  :root {
    --md-sys-font: var(--vscode-font-family, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif);
    --md-sys-font-mono: var(--vscode-editor-font-family, Menlo, Monaco, "Courier New", monospace);

    /* Dynamic M3 Surface & Background (Theme Dependent) */
    --md-sys-color-background: var(--vscode-sideBar-background, var(--vscode-editor-background, #141218));
    --md-sys-color-on-background: var(--vscode-sideBar-foreground, var(--vscode-foreground, #e6e1e5));

    /* Material 3 Surface Containers with guaranteed background fill */
    --md-sys-color-surface-container: var(--vscode-editorWidget-background, #1e1e1e);
    --md-sys-color-surface-container-high: color-mix(in srgb, var(--md-sys-color-surface-container) 80%, var(--vscode-sideBarSectionHeader-background, rgba(255, 255, 255, 0.08)) 20%);
    --md-sys-color-surface-container-highest: color-mix(in srgb, var(--md-sys-color-surface-container) 65%, var(--vscode-sideBarSectionHeader-background, rgba(255, 255, 255, 0.15)) 35%);
    --md-sys-color-surface-container-low: color-mix(in srgb, var(--md-sys-color-surface-container) 85%, var(--md-sys-color-background) 15%);

    /* Outlines & Borders */
    --md-sys-color-outline: var(--vscode-widget-border, color-mix(in srgb, var(--vscode-foreground, #888) 18%, transparent));
    --md-sys-color-outline-variant: color-mix(in srgb, var(--vscode-foreground, #888) 10%, transparent);

    /* Text Hierarchy */
    --md-sys-color-on-surface: var(--vscode-sideBar-foreground, var(--vscode-foreground, #e6e1e5));
    --md-sys-color-on-surface-variant: var(--vscode-descriptionForeground, #9e9e9e);

    /* Primary Tonal Accents */
    --md-sys-color-primary: var(--vscode-button-background, #0078d4);
    --md-sys-color-primary-hover: var(--vscode-button-hoverBackground, #0062a3);
    --md-sys-color-on-primary: var(--vscode-button-foreground, #ffffff);
    --md-sys-color-primary-container: color-mix(in srgb, var(--md-sys-color-primary) 18%, transparent);
    
    /* Secondary & Control Tones */
    --md-sys-color-secondary-container: var(--vscode-button-secondaryBackground, rgba(255, 255, 255, 0.07));
    --md-sys-color-secondary-hover: var(--vscode-button-secondaryHoverBackground, rgba(255, 255, 255, 0.12));
    --md-sys-color-on-secondary: var(--vscode-button-secondaryForeground, var(--md-sys-color-on-surface));
    --md-sys-color-input-bg: var(--vscode-input-background, #202020);
    --md-sys-color-input-border: var(--vscode-input-border, rgba(255, 255, 255, 0.16));
    --md-sys-color-focus: var(--vscode-focusBorder, #0078d4);

    /* State / Feedback */
    --md-sys-color-success: var(--vscode-testing-iconPassed, #73c991);
    --md-sys-color-warning: var(--vscode-problemsWarningIcon-foreground, #e5b530);
    --md-sys-color-error: var(--vscode-errorForeground, #f48771);
    --md-sys-color-error-container: rgba(244, 135, 113, 0.14);

    /* Material 3 Shapes */
    --md-shape-xs: 4px;
    --md-shape-sm: 8px;
    --md-shape-md: 12px;
    --md-shape-lg: 16px;
    --md-shape-full: 9999px;

    /* Material 3 Elevations */
    --md-elevation-1: 0 1px 3px rgba(0, 0, 0, 0.16), 0 1px 2px rgba(0, 0, 0, 0.24);
    --md-elevation-2: 0 3px 6px rgba(0, 0, 0, 0.2), 0 2px 4px rgba(0, 0, 0, 0.28);
    --md-elevation-3: 0 6px 14px rgba(0, 0, 0, 0.28), 0 4px 8px rgba(0, 0, 0, 0.32);
    
    /* Control Sizing */
    --md-control-h: 30px;
  }

  *, *::before, *::after {
    box-sizing: border-box;
    margin: 0;
    padding: 0;
  }

  body {
    font-family: var(--md-sys-font);
    font-size: 12px;
    line-height: 1.5;
    color: var(--md-sys-color-on-surface);
    background-color: var(--md-sys-color-background);
    padding: 10px;
    user-select: none;
    -webkit-user-select: none;
    overflow-x: hidden;
  }

  /* ══════════════════════════════════════════════════════════════════
     MATERIAL 3 SURFACES & CARDS
     ══════════════════════════════════════════════════════════════════ */
  .hero-card, .section-card, .details-card {
    background-color: var(--md-sys-color-surface-container);
    border: 1px solid var(--md-sys-color-outline);
    border-radius: var(--md-shape-md);
    padding: 12px 14px;
    margin-bottom: 12px;
    box-shadow: var(--md-elevation-1);
    position: relative;
    transition: box-shadow 0.2s cubic-bezier(0.2, 0, 0, 1), border-color 0.2s ease;
  }

  .hero-card {
    background: linear-gradient(150deg, var(--md-sys-color-surface-container) 0%, color-mix(in srgb, var(--md-sys-color-primary) 12%, var(--md-sys-color-surface-container)) 100%);
    border-color: color-mix(in srgb, var(--md-sys-color-primary) 30%, var(--md-sys-color-outline));
  }

  .hero-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 8px;
    margin-bottom: 6px;
  }

  .hero-title-group {
    display: flex;
    align-items: center;
    gap: 8px;
  }

  .hero-title {
    font-size: 13.5px;
    font-weight: 700;
    letter-spacing: 0.15px;
  }

  .hero-subtitle {
    font-size: 11px;
    color: var(--md-sys-color-on-surface-variant);
    margin-top: 1px;
  }

  .status-indicator {
    width: 10px;
    height: 10px;
    border-radius: var(--md-shape-full);
    background-color: var(--md-sys-color-on-surface-variant);
    flex-shrink: 0;
    transition: all 0.2s ease;
  }

  .status-indicator.ready {
    background-color: var(--md-sys-color-success);
    box-shadow: 0 0 8px var(--md-sys-color-success);
  }

  .status-indicator.needs-patch {
    background-color: var(--md-sys-color-warning);
    box-shadow: 0 0 8px var(--md-sys-color-warning);
  }

  .status-indicator.scanning {
    background-color: var(--md-sys-color-primary);
    animation: pulse 1.5s infinite;
  }

  @keyframes pulse {
    0%, 100% { opacity: 1; transform: scale(1); }
    50% { opacity: 0.3; transform: scale(1.25); }
  }

  .badge {
    background: var(--md-sys-color-surface-container-highest);
    border: 1px solid var(--md-sys-color-outline-variant);
    padding: 2px 8px;
    border-radius: var(--md-shape-full);
    font-family: var(--md-sys-font-mono);
    font-size: 10px;
    color: var(--md-sys-color-on-surface-variant);
    font-weight: 500;
  }

  .hero-actions {
    display: flex;
    gap: 8px;
    margin-top: 10px;
  }

  .hero-actions .btn {
    flex: 1;
  }

  /* ══════════════════════════════════════════════════════════════════
     SECTION HEADERS & LABELS
     ══════════════════════════════════════════════════════════════════ */
  .section-title {
    font-size: 11px;
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 0.5px;
    color: var(--md-sys-color-on-surface-variant);
    margin-bottom: 10px;
    display: flex;
    align-items: center;
    justify-content: space-between;
  }

  /* ══════════════════════════════════════════════════════════════════
     MATERIAL 3 BUTTONS & ICONS
     ══════════════════════════════════════════════════════════════════ */
  .btn {
    height: var(--md-control-h);
    background-color: var(--md-sys-color-secondary-container);
    border: 1px solid var(--md-sys-color-outline-variant);
    color: var(--md-sys-color-on-secondary);
    padding: 0 12px;
    border-radius: var(--md-shape-sm);
    font-family: inherit;
    font-size: 11.5px;
    font-weight: 500;
    cursor: pointer;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    gap: 6px;
    transition: all 0.15s cubic-bezier(0.2, 0, 0, 1);
    white-space: nowrap;
  }

  .btn:hover {
    background-color: var(--md-sys-color-secondary-hover);
    border-color: var(--md-sys-color-outline);
    box-shadow: 0 1px 3px rgba(0, 0, 0, 0.1);
  }

  .btn:active {
    transform: scale(0.98);
  }

  .btn-primary {
    background-color: var(--md-sys-color-primary);
    color: var(--md-sys-color-on-primary);
    border-color: transparent;
    font-weight: 600;
  }

  .btn-primary:hover {
    background-color: var(--md-sys-color-primary-hover);
    box-shadow: var(--md-elevation-1);
  }

  .btn-sm {
    height: 24px;
    padding: 0 8px;
    font-size: 10.5px;
    border-radius: var(--md-shape-xs);
  }

  .btn-danger {
    color: var(--md-sys-color-error);
    background-color: transparent;
    border-color: color-mix(in srgb, var(--md-sys-color-error) 30%, transparent);
  }

  .btn-danger:hover {
    background-color: var(--md-sys-color-error-container);
    border-color: var(--md-sys-color-error);
  }

  .icon-btn {
    background: transparent;
    border: none;
    color: var(--md-sys-color-on-surface-variant);
    cursor: pointer;
    width: 26px;
    height: 26px;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    border-radius: var(--md-shape-sm);
    transition: all 0.15s ease;
  }

  .icon-btn:hover {
    color: var(--md-sys-color-on-surface);
    background: var(--md-sys-color-surface-container-highest);
  }

  .icon-btn.spinning {
    animation: spin 0.8s linear infinite;
  }

  @keyframes spin {
    100% { transform: rotate(360deg); }
  }

  /* ══════════════════════════════════════════════════════════════════
     FORM CONTROLS & SETTING ROWS
     ══════════════════════════════════════════════════════════════════ */
  .setting-row {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 10px;
    padding: 8px 0;
    border-bottom: 1px solid var(--md-sys-color-outline-variant);
  }

  .setting-row:last-child {
    border-bottom: none;
    padding-bottom: 0;
  }

  .setting-row:first-child {
    padding-top: 0;
  }

  .setting-info {
    flex: 1;
    min-width: 0;
  }

  .setting-label {
    font-weight: 500;
    font-size: 11.5px;
    display: block;
  }

  .setting-desc {
    font-size: 10.5px;
    color: var(--md-sys-color-on-surface-variant);
    line-height: 1.35;
    margin-top: 1px;
  }

  .input-field, .select-field {
    height: var(--md-control-h);
    background-color: var(--md-sys-color-input-bg);
    border: 1px solid var(--md-sys-color-input-border);
    color: var(--md-sys-color-on-surface);
    padding: 0 10px;
    border-radius: var(--md-shape-sm);
    font-family: inherit;
    font-size: 11.5px;
    outline: none;
    transition: border-color 0.15s ease, box-shadow 0.15s ease;
  }

  .input-field:focus, .select-field:focus {
    border-color: var(--md-sys-color-focus);
    box-shadow: 0 0 0 1px var(--md-sys-color-focus);
  }

  .select-field {
    cursor: pointer;
  }

  /* ══════════════════════════════════════════════════════════════════
     MATERIAL 3 SWITCHES
     ══════════════════════════════════════════════════════════════════ */
  .toggle-switch {
    position: relative;
    display: inline-block;
    width: 36px;
    height: 20px;
    flex-shrink: 0;
  }

  .toggle-switch input {
    opacity: 0;
    width: 0;
    height: 0;
    position: absolute;
  }

  .toggle-slider {
    position: absolute;
    cursor: pointer;
    inset: 0;
    background-color: var(--md-sys-color-surface-container-highest);
    border: 1px solid var(--md-sys-color-outline);
    border-radius: var(--md-shape-full);
    transition: background-color 0.2s cubic-bezier(0.2, 0, 0, 1), border-color 0.2s ease;
  }

  .toggle-slider::before {
    position: absolute;
    content: "";
    height: 14px;
    width: 14px;
    left: 2px;
    bottom: 2px;
    background-color: var(--md-sys-color-on-surface-variant);
    border-radius: var(--md-shape-full);
    transition: transform 0.2s cubic-bezier(0.2, 0, 0, 1), background-color 0.2s ease;
  }

  html[dir="rtl"] .toggle-slider::before {
    left: auto;
    right: 2px;
  }

  .toggle-switch input:checked + .toggle-slider {
    background-color: var(--md-sys-color-primary);
    border-color: var(--md-sys-color-primary);
  }

  .toggle-switch input:checked + .toggle-slider::before {
    transform: translateX(16px);
    background-color: var(--md-sys-color-on-primary);
  }

  html[dir="rtl"] .toggle-switch input:checked + .toggle-slider::before {
    transform: translateX(-16px);
  }

  /* ══════════════════════════════════════════════════════════════════
     MATERIAL 3 SEGMENTED BUTTON GROUPS
     ══════════════════════════════════════════════════════════════════ */
  .segmented-group {
    display: inline-flex;
    background: var(--md-sys-color-input-bg);
    border: 1px solid var(--md-sys-color-input-border);
    border-radius: var(--md-shape-full);
    padding: 2px;
    gap: 2px;
  }

  .segmented-btn {
    height: 24px;
    background: transparent;
    border: none;
    color: var(--md-sys-color-on-surface-variant);
    padding: 0 10px;
    border-radius: var(--md-shape-full);
    font-size: 11px;
    font-weight: 500;
    cursor: pointer;
    transition: all 0.15s ease;
    display: inline-flex;
    align-items: center;
    justify-content: center;
  }

  .segmented-btn:hover {
    color: var(--md-sys-color-on-surface);
  }

  .segmented-btn.active {
    background: var(--md-sys-color-primary);
    color: var(--md-sys-color-on-primary);
    font-weight: 600;
    box-shadow: 0 1px 3px rgba(0,0,0,0.2);
  }

  /* ══════════════════════════════════════════════════════════════════
     PROVIDER BAR & DRAWER
     ══════════════════════════════════════════════════════════════════ */
  .provider-bar {
    display: flex;
    align-items: center;
    justify-content: space-between;
    background: var(--md-sys-color-surface-container-high);
    border: 1px solid var(--md-sys-color-outline-variant);
    padding: 6px 10px;
    border-radius: var(--md-shape-sm);
    margin-bottom: 10px;
  }

  .provider-badge {
    font-size: 11px;
    font-weight: 600;
    color: var(--md-sys-color-success);
    font-family: var(--md-sys-font-mono);
  }

  .provider-drawer {
    background: var(--md-sys-color-surface-container-high);
    border: 1px solid var(--md-sys-color-outline-variant);
    border-radius: var(--md-shape-sm);
    padding: 10px;
    margin-bottom: 10px;
    display: flex;
    flex-direction: column;
    gap: 8px;
  }

  .provider-item {
    display: flex;
    flex-direction: column;
    gap: 6px;
    padding: 8px 10px;
    border-radius: var(--md-shape-xs);
    background: var(--md-sys-color-surface-container);
    border: 1px solid var(--md-sys-color-outline-variant);
    font-size: 11px;
    transition: all 0.2s ease;
  }

  .provider-item:hover {
    border-color: var(--md-sys-color-outline);
  }

  .provider-item.active {
    border-color: var(--md-sys-color-success);
    background: color-mix(in srgb, var(--md-sys-color-success) 10%, var(--md-sys-color-surface-container));
  }

  .provider-item-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 6px;
  }

  .provider-item-meta {
    font-size: 10px;
    color: var(--md-sys-color-on-surface-variant);
    font-family: var(--md-sys-font-mono);
    word-break: break-all;
    direction: ltr;
    text-align: left;
  }

  .provider-item-actions {
    display: flex;
    align-items: center;
    justify-content: flex-end;
    gap: 4px;
    margin-top: 2px;
  }

  /* ══════════════════════════════════════════════════════════════════
     AUTO-FETCHING MODEL COMBOBOX
     ══════════════════════════════════════════════════════════════════ */
  .combobox-wrapper {
    position: relative;
    width: 100%;
  }

  .combobox-input-group {
    display: flex;
    gap: 6px;
    align-items: center;
    position: relative;
  }

  .m3-input-box {
    position: relative;
    flex: 1;
    display: flex;
    align-items: center;
  }

  .combobox-input {
    width: 100%;
    padding-inline-end: 56px;
    font-family: var(--md-sys-font-mono);
  }

  .combobox-actions-group {
    position: absolute;
    inset-inline-end: 4px;
    display: flex;
    align-items: center;
    gap: 2px;
  }

  .mini-btn {
    width: 22px;
    height: 22px;
    border-radius: var(--md-shape-xs);
    font-size: 11px;
  }

  .combobox-dropdown {
    position: absolute;
    top: calc(100% + 6px);
    left: 0;
    right: 0;
    z-index: 100;
    background: var(--md-sys-color-surface-container);
    border: 1px solid var(--md-sys-color-outline);
    border-radius: var(--md-shape-md);
    box-shadow: var(--md-elevation-3);
    max-height: 220px;
    overflow: hidden;
    display: flex;
    flex-direction: column;
  }

  .combobox-search-box {
    padding: 8px;
    border-bottom: 1px solid var(--md-sys-color-outline-variant);
    background: var(--md-sys-color-surface-container-high);
  }

  .combobox-search-box input {
    width: 100%;
    height: 26px;
    font-size: 11px;
  }

  .dropdown-status-bar {
    margin-top: 5px;
    display: flex;
    justify-content: space-between;
    align-items: center;
    font-size: 10px;
    color: var(--md-sys-color-on-surface-variant);
  }

  .combobox-options-list {
    overflow-y: auto;
    padding: 4px 0;
  }

  .combobox-option {
    min-height: 28px;
    flex: 0 0 auto;
    padding: 6px 12px;
    cursor: pointer;
    font-family: var(--md-sys-font-mono);
    font-size: 11px;
    display: flex;
    align-items: center;
    justify-content: space-between;
    transition: background 0.1s ease;
  }

  .combobox-option:hover {
    background: var(--md-sys-color-surface-container-highest);
  }

  .combobox-option.selected {
    background: var(--md-sys-color-primary);
    color: var(--md-sys-color-on-primary);
    font-weight: 600;
  }

  .combobox-empty {
    padding: 12px;
    color: var(--md-sys-color-on-surface-variant);
    font-size: 11px;
    text-align: center;
  }

  /* ══════════════════════════════════════════════════════════════════
     SPINNER & ERROR BOX
     ══════════════════════════════════════════════════════════════════ */
  .spinner {
    width: 12px;
    height: 12px;
    border: 2px solid rgba(255, 255, 255, 0.2);
    border-top-color: var(--md-sys-color-on-surface);
    border-radius: var(--md-shape-full);
    animation: spin 0.8s linear infinite;
    display: inline-block;
  }

  .error-box {
    background-color: var(--md-sys-color-error-container);
    border: 1px solid color-mix(in srgb, var(--md-sys-color-error) 40%, transparent);
    color: var(--md-sys-color-error);
    padding: 8px 10px;
    border-radius: var(--md-shape-sm);
    font-size: 11px;
    margin-top: 8px;
  }

  /* ══════════════════════════════════════════════════════════════════
     DIAGNOSTICS & DETAILS ACCORDION
     ══════════════════════════════════════════════════════════════════ */
  .details-card {
    cursor: pointer;
  }

  .details-summary {
    display: flex;
    align-items: center;
    justify-content: space-between;
    font-weight: 600;
    font-size: 11.5px;
    outline: none;
    list-style: none;
  }

  .details-summary::-webkit-details-marker {
    display: none;
  }

  .signals-list {
    margin-top: 10px;
    padding-top: 8px;
    border-top: 1px solid var(--md-sys-color-outline-variant);
    display: flex;
    flex-direction: column;
    gap: 6px;
  }

  .signal-item {
    display: flex;
    align-items: center;
    gap: 8px;
    font-size: 10.5px;
  }

  .signal-dot {
    width: 6px;
    height: 6px;
    border-radius: var(--md-shape-full);
    flex-shrink: 0;
  }

  .signal-dot.ok { background-color: var(--md-sys-color-success); }
  .signal-dot.warn { background-color: var(--md-sys-color-warning); }
  .signal-dot.err { background-color: var(--md-sys-color-error); }

  /* ══════════════════════════════════════════════════════════════════
     TOOLBAR GRID
     ══════════════════════════════════════════════════════════════════ */
  .toolbar-grid {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 8px;
  }

  .hidden {
    display: none !important;
  }
</style>
</head>
<body>

  <!-- HERO CARD -->
  <div class="hero-card" id="hero-card">
    <div class="hero-header">
      <div class="hero-title-group">
        <div class="status-indicator" id="status-dot"></div>
        <div>
          <span class="hero-title">Codex Nexus</span>
          <div class="hero-subtitle" id="status-text">Scanning Status...</div>
        </div>
      </div>
      <span class="badge" id="compat-ver">v1.0.2</span>
    </div>
    <div class="hero-actions">
      <button type="button" class="btn btn-primary" id="btn-apply-patch" data-cmd="codexNexus.applyPatch">
        <span id="txt-apply-patch">Apply Patch</span>
      </button>
      <button type="button" class="btn" id="btn-check-compat" data-cmd="codexNexus.checkCompatibility">
        <span id="txt-rescan">Check Status</span>
      </button>
    </div>
  </div>

  <!-- CODEX AI MODEL & CUSTOM PROVIDERS -->
  <div class="section-card" id="card-model-providers">
    <div class="section-title">
      <span id="txt-section-model">Codex AI Model & Providers</span>
    </div>

    <!-- Active Provider Status & Quick Switcher -->
    <div class="provider-bar">
      <div style="display:flex; align-items:center; gap:6px;">
        <span style="color:var(--md-sys-color-on-surface-variant); font-size:10.5px;" id="txt-active-provider-lbl">Active Provider:</span>
        <span class="provider-badge" id="active-provider-name">OpenAI</span>
      </div>
      <button type="button" class="btn btn-sm" id="btn-toggle-provider-mgr">
        <span id="txt-manage-providers">Manage</span>
      </button>
    </div>

    <!-- Multi-Provider Drawer/Form -->
    <div class="provider-drawer hidden" id="provider-manager">
      <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:4px;">
        <span style="font-weight:600; font-size:11px;" id="txt-providers-list">Configured Providers</span>
        <div style="display:flex; gap:4px;">
          <button type="button" class="btn btn-sm btn-primary" id="btn-new-provider">+ New</button>
          <button type="button" class="btn btn-sm" id="btn-close-provider-mgr">✕ Close</button>
        </div>
      </div>
      
      <div id="providers-list-container"></div>

      <!-- Add/Edit Provider Subform -->
      <form id="form-provider-edit" class="hidden" style="display:flex; flex-direction:column; gap:6px; margin-top:6px; padding-top:6px; border-top:1px solid var(--md-sys-color-outline-variant);">
        <div style="font-weight:600; font-size:11px; color:var(--md-sys-color-primary);" id="txt-provider-form-title">Add New Provider</div>
        <input type="text" class="input-field" id="provider-input-id" placeholder="Provider ID (e.g. omni)" required />
        <input type="text" class="input-field" id="provider-input-name" placeholder="Display Name (e.g. Omni Route)" />
        <input type="url" class="input-field" id="provider-input-url" placeholder="https://api.example.com/v1" required />
        <input type="password" class="input-field" id="provider-input-key" placeholder="API Key / Bearer Token (optional)" autocomplete="off" />
        <input type="text" class="input-field" id="provider-input-env" placeholder="Environment variable name (default: OPENAI_API_KEY)" />
        <div style="display:flex; gap:6px; margin-top:4px;">
          <button type="submit" class="btn btn-sm btn-primary" id="btn-save-provider" style="flex:1;">Save & Activate</button>
          <button type="button" class="btn btn-sm" id="btn-cancel-provider">Cancel</button>
        </div>
      </form>
    </div>

    <!-- Active Model Combobox -->
    <div style="margin-top: 6px; margin-bottom: 4px;">
      <span class="setting-label" id="txt-model-label">Active Model Name</span>
    </div>
    
    <div class="combobox-wrapper" id="model-combobox-wrapper">
      <form id="codex-model-form" class="combobox-input-group">
        <div class="m3-input-box">
          <input type="text"
                 class="input-field combobox-input"
                 id="codex-model-input"
                 placeholder="Select or type model name..."
                 data-provider-model-input
                 autocomplete="off"
                 spellcheck="false" />
          <div class="combobox-actions-group">
            <button type="button" class="icon-btn mini-btn" id="btn-refresh-models" title="Refresh models" aria-label="Refresh models">
              <span>↻</span>
            </button>
            <button type="button" class="icon-btn mini-btn" id="btn-toggle-combobox" title="Models list" aria-label="Toggle model dropdown" aria-expanded="false">
              <span class="spinner hidden" id="combobox-spinner"></span>
              <span id="combobox-chevron">▼</span>
            </button>
          </div>
        </div>
        <button type="submit" class="btn btn-primary" id="btn-save-model" style="flex-shrink:0;">Save</button>
      </form>

      <!-- Dropdown Popup -->
      <div class="combobox-dropdown hidden" id="model-dropdown-menu" role="listbox">
        <div class="combobox-search-box">
          <input type="text" class="input-field" id="combobox-filter-input" placeholder="Filter models..." autocomplete="off" />
          <div class="dropdown-status-bar">
            <span id="txt-model-count">models</span>
            <span id="txt-models-status"></span>
          </div>
        </div>
        <div class="combobox-options-list" id="combobox-options-list"></div>
      </div>
    </div>

    <div class="error-box hidden" id="model-error-box"></div>
  </div>

  <!-- APPEARANCE & TYPOGRAPHY -->
  <div class="section-card">
    <div class="section-title" id="txt-section-appearance">Appearance & Typography</div>
    
    <!-- Font Selector -->
    <div class="setting-row">
      <div class="setting-info">
        <span class="setting-label" id="txt-font-family">Font Family</span>
        <span class="setting-desc" id="txt-font-family-desc">Select dedicated typography font</span>
      </div>
      <div style="display:flex; flex-direction:column; gap:4px; align-items:flex-end;">
        <select class="select-field" id="font-preset-select" style="min-width:130px;">
          <option value="Vazirmatn">Vazirmatn</option>
          <option value="Noto Sans Arabic">Noto Sans Arabic</option>
          <option value="Noto Sans Arabic UI">Noto Sans Arabic UI</option>
          <option value="Estedad">Estedad</option>
          <option value="IRANYekan">IRANYekan</option>
          <option value="Sahel">Sahel</option>
          <option value="Shabnam">Shabnam</option>
          <option value="Samim">Samim</option>
          <option value="Tanha">Tanha</option>
          <option value="__custom__">Custom Font...</option>
        </select>
        <input type="text" class="input-field hidden" id="font-custom-input" placeholder="Custom font family..." style="width:130px;" />
      </div>
    </div>

    <!-- Font Size -->
    <div class="setting-row">
      <div class="setting-info">
        <span class="setting-label" id="txt-font-size">Chat Font Size</span>
        <span class="setting-desc" id="txt-font-size-desc">Body font size in Codex conversations</span>
      </div>
      <select class="select-field" id="setting-font-size" data-setting="fontSize" style="min-width:90px;">
        <option value="0">Default</option>
        <option value="13">13 px</option>
        <option value="14">14 px</option>
        <option value="15">15 px</option>
        <option value="16">16 px</option>
        <option value="17">17 px</option>
        <option value="18">18 px</option>
      </select>
    </div>

    <!-- AI Chat RTL Toggle -->
    <div class="setting-row">
      <div class="setting-info">
        <span class="setting-label" id="txt-ai-chat-rtl">VS Code AI Chat RTL</span>
        <span class="setting-desc" id="txt-ai-chat-rtl-desc">Bidirectional RTL in VS Code AI Chat</span>
      </div>
      <label class="toggle-switch">
        <input type="checkbox" id="setting-patch-ai-chat" data-setting="patchAiChat" aria-label="Toggle VS Code AI Chat RTL" />
        <span class="toggle-slider"></span>
      </label>
    </div>
  </div>

  <!-- PREFERENCES & LANGUAGE -->
  <div class="section-card">
    <div class="section-title" id="txt-section-prefs">Preferences & Languages</div>

    <!-- Dashboard UI Language Selector -->
    <div class="setting-row">
      <div class="setting-info">
        <span class="setting-label" id="txt-dashboard-lang-lbl">Dashboard Language</span>
        <span class="setting-desc" id="txt-dashboard-lang-desc">Change the language of this extension panel (instant)</span>
      </div>
      <div class="segmented-group" id="dashboard-lang-switcher">
        <button type="button" class="segmented-btn" data-dashboard-lang="fa" aria-pressed="false">فارسی</button>
        <button type="button" class="segmented-btn" data-dashboard-lang="ar" aria-pressed="false">العربية</button>
        <button type="button" class="segmented-btn active" data-dashboard-lang="en" aria-pressed="true">English</button>
      </div>
    </div>

    <!-- Codex Language Selector -->
    <div class="setting-row">
      <div class="setting-info">
        <span class="setting-label" id="txt-codex-lang-lbl">Codex Extension Language</span>
        <span class="setting-desc" id="txt-codex-lang-desc">Override Codex internal language (requires reload)</span>
      </div>
      <div class="segmented-group" id="codex-lang-switcher">
        <button type="button" class="segmented-btn" data-codex-locale="fa" aria-pressed="false">فارسی</button>
        <button type="button" class="segmented-btn" data-codex-locale="ar" aria-pressed="false">العربية</button>
        <button type="button" class="segmented-btn" data-codex-locale="en" aria-pressed="false">English</button>
      </div>
    </div>

    <!-- Auto-patch Toggle -->
    <div class="setting-row">
      <div class="setting-info">
        <span class="setting-label" id="txt-autopatch">Auto-patch on Startup</span>
        <span class="setting-desc" id="txt-autopatch-desc">Automatically check & patch on launch</span>
      </div>
      <label class="toggle-switch">
        <input type="checkbox" id="setting-autopatch" data-setting="patchOnStartup" aria-label="Toggle auto patch on startup" />
        <span class="toggle-slider"></span>
      </label>
    </div>

    <!-- Reload Prompt Toggle -->
    <div class="setting-row">
      <div class="setting-info">
        <span class="setting-label" id="txt-reload-prompt">Show Reload Prompts</span>
        <span class="setting-desc" id="txt-reload-prompt-desc">Notify to reload after configuration updates</span>
      </div>
      <label class="toggle-switch">
        <input type="checkbox" id="setting-reload-prompt" data-setting="showReloadPrompt" aria-label="Toggle reload window prompt" />
        <span class="toggle-slider"></span>
      </label>
    </div>
  </div>

  <!-- DIAGNOSTICS & SIGNALS ACCORDION -->
  <details class="details-card" id="diagnostics-card">
    <summary class="details-summary">
      <span id="txt-diagnostics-title">Diagnostics & Signals</span>
      <span class="badge" id="signals-count">0/0</span>
    </summary>
    <div class="signals-list" id="signals-list"></div>
  </details>

  <!-- MAINTENANCE TOOLBAR -->
  <div class="section-card">
    <div class="section-title" id="txt-section-maintenance">Maintenance</div>
    <div class="toolbar-grid">
      <button type="button" class="btn" data-cmd="workbench.action.reloadWindow">
        <span id="txt-btn-reload">Reload Window</span>
      </button>
      <button type="button" class="btn" data-cmd="codexNexus.showLogs">
        <span id="txt-btn-logs">View Logs</span>
      </button>
      <button type="button" class="btn btn-danger" data-cmd="codexNexus.restorePatch">
        <span id="txt-btn-restore">Restore Files</span>
      </button>
      <button type="button" class="btn btn-danger" data-cmd="codexNexus.fullCleanup">
        <span id="txt-btn-cleanup">Full Cleanup</span>
      </button>
    </div>
  </div>

<script nonce="${nonce}">
(function() {
  const vscode = acquireVsCodeApi();
  let latestState = null;
  let providerModelsList = [];

  const I18N = {
    fa: {
      statusActive: "پچ فعال و پایدار",
      statusReady: "آماده اعمال پچ",
      statusNeedPatch: "نیاز به اعمال پچ",
      statusScanning: "در حال بررسی وضعیت...",
      applyPatch: "اعمال پچ",
      reapplyPatch: "اعمال مجدد پچ",
      rescan: "بررسی وضعیت",
      sectionModel: "مدل هوش مصنوعی و پروایدرها",
      activeProviderLbl: "پروایدر فعال:",
      manageProviders: "مدیریت",
      providersList: "پروایدرهای تعریف‌شده",
      providerOpenAiTitle: "OpenAI (پیش‌فرض سیستم)",
      noCustomProviders: "هیچ پروایدر سفارشی دیگری تعریف نشده است.",
      newProvider: "+ جدید",
      close: "✕ بستن",
      providerIdPlaceholder: "شناسه (مثال: omni)",
      providerNamePlaceholder: "نام نمایشی (مثال: Omni Route)",
      providerUrlPlaceholder: "https://api.example.com/v1",
      providerApiKeyPlaceholder: "کلید دسترسی / API Key (اختیاری)",
      providerEnvPlaceholder: "نام متغیر محیطی (پیش‌فرض: OPENAI_API_KEY)",
      providerFormNewTitle: "افزودن پروایدر جدید",
      providerFormEditTitle: "ویرایش پروایدر",
      providerKeyBadge: "دارای کلید",
      providerNoKeyBadge: "بدون کلید",
      edit: "ویرایش",
      saveChanges: "ذخیره تغییرات",
      saveAndActivate: "ذخیره و فعال‌سازی",
      activeBadge: "فعال",
      confirmDelete: "آیا از حذف پروایدر {id} اطمینان دارید؟",
      modelLabel: "نام مدل فعال",
      modelPlaceholder: "انتخاب یا تایپ مدل هوش مصنوعی...",
      filterPlaceholder: "فیلتر مدل‌ها...",
      noModelsFound: "هیچ مدلی یافت نشد",
      modelsCountSuffix: "مدل",
      refreshModels: "بروزرسانی مدل‌ها",
      modelsList: "لیست مدل‌ها",
      save: "ذخیره و فعال‌سازی",
      cancel: "انصراف",
      activate: "فعال",
      delete: "حذف",
      sectionAppearance: "تنظیمات ظاهر و تایپوگرافی",
      fontFamily: "قلم متن",
      fontFamilyDesc: "انتخاب قلم اختصاصی متن",
      fontSize: "اندازه قلم گفتگو",
      fontSizeDesc: "سایز قلم بدنه گفتگوی Codex",
      fontCustomPlaceholder: "نام فونت...",
      fontCustomOption: "قلم سفارشی...",
      inheritDefault: "پیش‌فرض",
      aiChatRtl: "VS Code AI Chat RTL",
      aiChatRtlDesc: "راست‌چین کردن پنل چت VS Code",
      sectionPrefs: "تنظیمات و زبان‌ها",
      dashboardLangLbl: "زبان پنل افزونه",
      dashboardLangDesc: "تغییر زبان محیط این داشبورد (آنی)",
      codexLangLbl: "زبان افزونه Codex",
      codexLangDesc: "تنظیم زبان منوهای Codex (نیازمند ریلود)",
      autopatch: "پچ خودکار در شروع",
      autopatchDesc: "بررسی و پچ خودکار هنگام اجرای VS Code",
      reloadPrompt: "یادآوری بارگذاری مجدد",
      reloadPromptDesc: "نمایش دکمه Reload بعد از تغییرات",
      diagnosticsTitle: "عیب‌یابی و سیگنال‌های فنی",
      sectionMaintenance: "عملیات و نگهداری",
      btnReload: "بارگذاری مجدد",
      btnLogs: "مشاهده لاگ‌ها",
      btnRestore: "بازیابی فایل‌ها",
      btnCleanup: "پاکسازی کامل",
      modelsLoading: "در حال دریافت مدل‌ها...",
      modelsReady: "مدل‌های آماده"
    },
    ar: {
      statusActive: "التصحيح نشط ومستقر",
      statusReady: "جاهز للتطبيق",
      statusNeedPatch: "يلزم تطبيق التصحيح",
      statusScanning: "جارٍ فحص الحالة...",
      applyPatch: "تطبيق التصحيح",
      reapplyPatch: "إعادة تطبيق التصحيح",
      rescan: "إعادة الفحص",
      sectionModel: "نموذج الذكاء الاصطناعي والمزودون",
      activeProviderLbl: "المزود النشط:",
      manageProviders: "إدارة",
      providersList: "المزودون المعرفون",
      providerOpenAiTitle: "OpenAI (افتراضي النظام)",
      noCustomProviders: "لم يتم تعريف أي مزود مخصص إضافي.",
      newProvider: "+ جديد",
      close: "✕ إغلاق",
      providerIdPlaceholder: "المعرف (مثال: omni)",
      providerNamePlaceholder: "الاسم المعروض (مثال: Omni Route)",
      providerUrlPlaceholder: "https://api.example.com/v1",
      providerApiKeyPlaceholder: "مفتاح الوصول / API Key (اختياري)",
      providerEnvPlaceholder: "اسم متغير البيئة (افتراضي: OPENAI_API_KEY)",
      providerFormNewTitle: "إضافة مزود جديد",
      providerFormEditTitle: "تعديل المزود",
      providerKeyBadge: "مفتاح مضبوط",
      providerNoKeyBadge: "بدون مفتاح",
      edit: "تعديل",
      saveChanges: "حفظ التعديلات",
      saveAndActivate: "حفظ وتفعيل",
      activeBadge: "نشط",
      confirmDelete: "هل أنت متأكد من حذف المزود {id}؟",
      modelLabel: "اسم النموذج النشط",
      modelPlaceholder: "اختر أو اكتب اسم النموذج...",
      filterPlaceholder: "تصفية النماذج...",
      noModelsFound: "لم يتم العثور على نماذج",
      modelsCountSuffix: "نماذج",
      refreshModels: "تحديث النماذج",
      modelsList: "قائمة النماذج",
      save: "حفظ وتفعيل",
      cancel: "إلغاء",
      activate: "تفعيل",
      delete: "حذف",
      sectionAppearance: "المظهر والخطوط",
      fontFamily: "خط النصوص",
      fontFamilyDesc: "اختيار الخط المخصص للنصوص",
      fontSize: "حجم خط المحادثة",
      fontSizeDesc: "حجم خط نصوص Codex",
      fontCustomPlaceholder: "اسم الخط المخصص...",
      fontCustomOption: "خط مخصص...",
      inheritDefault: "افتراضي",
      aiChatRtl: "VS Code AI Chat RTL",
      aiChatRtlDesc: "محاذاة المحادثة من اليمين إلى اليسار",
      sectionPrefs: "الإعدادات واللغات",
      dashboardLangLbl: "لغة لوحة التحكم",
      dashboardLangDesc: "تغيير لغة واجهة هذه اللوحة (فوري)",
      codexLangLbl: "لغة إضافة Codex",
      codexLangDesc: "تحديد لغة قوائم Codex (يتطلب إعادة التحميل)",
      autopatch: "تصحيح تلقائي عند البدء",
      autopatchDesc: "فحص وتطبيق التصحيح تلقائيًا عند تشغيل VS Code",
      reloadPrompt: "تنبيه إعادة التحميل",
      reloadPromptDesc: "إظهار زر إعادة التحميل بعد التعديلات",
      diagnosticsTitle: "التشخيص والإشارات الفنية",
      sectionMaintenance: "العمليات والصيانة",
      btnReload: "إعادة تحميل النافذة",
      btnLogs: "عرض السجلات",
      btnRestore: "استعادة الملفات الأصلية",
      btnCleanup: "تنظيف شامل",
      modelsLoading: "جارٍ تحميل النماذج...",
      modelsReady: "النماذج الجاهزة"
    },
    en: {
      statusActive: "Patch Active & Healthy",
      statusReady: "Ready to Apply",
      statusNeedPatch: "Patch Required",
      statusScanning: "Scanning Status...",
      applyPatch: "Apply Patch",
      reapplyPatch: "Re-apply Patch",
      rescan: "Check Status",
      sectionModel: "Codex AI Model & Providers",
      activeProviderLbl: "Active Provider:",
      manageProviders: "Manage",
      providersList: "Configured Providers",
      providerOpenAiTitle: "OpenAI (System Default)",
      noCustomProviders: "No additional custom providers configured.",
      newProvider: "+ New",
      close: "✕ Close",
      providerIdPlaceholder: "Provider ID (e.g. omni)",
      providerNamePlaceholder: "Display Name (e.g. Omni Route)",
      providerUrlPlaceholder: "https://api.example.com/v1",
      providerApiKeyPlaceholder: "API Key / Bearer Token (optional)",
      providerEnvPlaceholder: "Environment variable name (default: OPENAI_API_KEY)",
      providerFormNewTitle: "Add New Provider",
      providerFormEditTitle: "Edit Provider",
      providerKeyBadge: "Key Set",
      providerNoKeyBadge: "No Key",
      edit: "Edit",
      saveChanges: "Save Changes",
      saveAndActivate: "Save & Activate",
      activeBadge: "Active",
      confirmDelete: "Are you sure you want to delete provider {id}?",
      modelLabel: "Active Model Name",
      modelPlaceholder: "Select or type model name...",
      filterPlaceholder: "Filter models...",
      noModelsFound: "No models found",
      modelsCountSuffix: "models",
      refreshModels: "Refresh models",
      modelsList: "Models list",
      save: "Save & Activate",
      cancel: "Cancel",
      activate: "Activate",
      delete: "Delete",
      sectionAppearance: "Appearance & Typography",
      fontFamily: "Font Family",
      fontFamilyDesc: "Select dedicated typography font",
      fontSize: "Chat Font Size",
      fontSizeDesc: "Body font size in Codex conversations",
      fontCustomPlaceholder: "Custom font family...",
      fontCustomOption: "Custom Font...",
      inheritDefault: "Default",
      aiChatRtl: "VS Code AI Chat RTL",
      aiChatRtlDesc: "Bidirectional RTL in VS Code AI Chat",
      sectionPrefs: "Preferences & Languages",
      dashboardLangLbl: "Dashboard Language",
      dashboardLangDesc: "Change the language of this extension panel (instant)",
      codexLangLbl: "Codex Extension Language",
      codexLangDesc: "Override Codex internal language (requires reload)",
      autopatch: "Auto-patch on Startup",
      autopatchDesc: "Automatically check & patch on launch",
      reloadPrompt: "Show Reload Prompts",
      reloadPromptDesc: "Notify to reload after configuration updates",
      diagnosticsTitle: "Diagnostics & Signals",
      sectionMaintenance: "Maintenance",
      btnReload: "Reload Window",
      btnLogs: "View Logs",
      btnRestore: "Restore Files",
      btnCleanup: "Full Cleanup",
      modelsLoading: "Loading models...",
      modelsReady: "Models ready"
    }
  };

  function updateI18n(lang) {
    let resolved = "fa";
    if (lang === "ar") resolved = "ar";
    else if (lang === "en") resolved = "en";

    document.documentElement.lang = resolved;
    document.documentElement.dir = (resolved === "en" ? "ltr" : "rtl");

    const dict = I18N[resolved] || I18N.fa;
    document.getElementById("txt-section-model").textContent = dict.sectionModel;
    document.getElementById("txt-active-provider-lbl").textContent = dict.activeProviderLbl;
    document.getElementById("txt-manage-providers").textContent = dict.manageProviders;
    document.getElementById("txt-providers-list").textContent = dict.providersList;
    document.getElementById("btn-new-provider").textContent = dict.newProvider;
    document.getElementById("btn-close-provider-mgr").textContent = dict.close;
    document.getElementById("txt-model-label").textContent = dict.modelLabel;
    
    document.getElementById("codex-model-input").placeholder = dict.modelPlaceholder;
    document.getElementById("combobox-filter-input").placeholder = dict.filterPlaceholder;
    document.getElementById("provider-input-id").placeholder = dict.providerIdPlaceholder;
    document.getElementById("provider-input-name").placeholder = dict.providerNamePlaceholder;
    document.getElementById("provider-input-url").placeholder = dict.providerUrlPlaceholder;
    document.getElementById("provider-input-key").placeholder = dict.providerApiKeyPlaceholder;
    document.getElementById("provider-input-env").placeholder = dict.providerEnvPlaceholder;
    document.getElementById("font-custom-input").placeholder = dict.fontCustomPlaceholder;

    document.getElementById("btn-refresh-models").title = dict.refreshModels;
    document.getElementById("btn-toggle-combobox").title = dict.modelsList;

    document.getElementById("btn-save-model").textContent = dict.save;
    document.getElementById("btn-save-provider").textContent = dict.save;
    document.getElementById("btn-cancel-provider").textContent = dict.cancel;
    
    document.getElementById("txt-section-appearance").textContent = dict.sectionAppearance;
    document.getElementById("txt-font-family").textContent = dict.fontFamily;
    document.getElementById("txt-font-family-desc").textContent = dict.fontFamilyDesc;
    document.getElementById("txt-font-size").textContent = dict.fontSize;
    document.getElementById("txt-font-size-desc").textContent = dict.fontSizeDesc;

    const customFontOpt = document.querySelector("#font-preset-select option[value='__custom__']");
    if (customFontOpt) customFontOpt.textContent = dict.fontCustomOption;

    const defaultSizeOpt = document.querySelector("#setting-font-size option[value='0']");
    if (defaultSizeOpt) defaultSizeOpt.textContent = dict.inheritDefault;

    document.getElementById("txt-ai-chat-rtl").textContent = dict.aiChatRtl;
    document.getElementById("txt-ai-chat-rtl-desc").textContent = dict.aiChatRtlDesc;
    document.getElementById("txt-section-prefs").textContent = dict.sectionPrefs;
    document.getElementById("txt-dashboard-lang-lbl").textContent = dict.dashboardLangLbl;
    document.getElementById("txt-dashboard-lang-desc").textContent = dict.dashboardLangDesc;
    document.getElementById("txt-codex-lang-lbl").textContent = dict.codexLangLbl;
    document.getElementById("txt-codex-lang-desc").textContent = dict.codexLangDesc;
    document.getElementById("txt-autopatch").textContent = dict.autopatch;
    document.getElementById("txt-autopatch-desc").textContent = dict.autopatchDesc;
    document.getElementById("txt-reload-prompt").textContent = dict.reloadPrompt;
    document.getElementById("txt-reload-prompt-desc").textContent = dict.reloadPromptDesc;
    document.getElementById("txt-diagnostics-title").textContent = dict.diagnosticsTitle;
    document.getElementById("txt-section-maintenance").textContent = dict.sectionMaintenance;
    document.getElementById("txt-btn-reload").textContent = dict.btnReload;
    document.getElementById("txt-btn-logs").textContent = dict.btnLogs;
    document.getElementById("txt-btn-restore").textContent = dict.btnRestore;
    document.getElementById("txt-btn-cleanup").textContent = dict.btnCleanup;
    document.getElementById("txt-rescan").textContent = dict.rescan;

    const applyBtnTxt = document.getElementById("txt-apply-patch");
    const statusText = document.getElementById("status-text");
    if (latestState) {
      const isPatched = latestState.kind === "ok" || (latestState.inspection?.summary?.status === "patched");
      const isClean = latestState.kind === "idle" || (latestState.inspection?.summary?.status === "clean");
      const isScanning = latestState.kind === "scanning";

      if (isPatched) {
        statusText.textContent = dict.statusActive;
        applyBtnTxt.textContent = dict.reapplyPatch;
      } else if (isClean) {
        statusText.textContent = dict.statusReady;
        applyBtnTxt.textContent = dict.applyPatch;
      } else if (isScanning) {
        statusText.textContent = dict.statusScanning;
        applyBtnTxt.textContent = dict.applyPatch;
      } else {
        statusText.textContent = dict.statusNeedPatch;
        applyBtnTxt.textContent = dict.applyPatch;
      }

      if (latestState.codexModel) {
        renderProvidersList(latestState.codexModel.providers || [], latestState.codexModel.modelProvider);
      }
    } else {
      statusText.textContent = dict.statusScanning;
      applyBtnTxt.textContent = dict.applyPatch;
    }
  }

  // ── Render State ──
  function renderState(state) {
    if (!state) return;
    latestState = state;

    const dashboardLang = (state.settings && state.settings.dashboardLanguage) || "fa";
    updateI18n(dashboardLang);
    const dict = I18N[dashboardLang] || I18N.fa;

    // Status & Hero
    const statusDot = document.getElementById("status-dot");
    const statusText = document.getElementById("status-text");
    const applyBtnTxt = document.getElementById("txt-apply-patch");
    const compatVer = document.getElementById("compat-ver");

    const version = state.runtime?.extensionVersion || state.info?.ourVersion;
    if (version) {
      compatVer.textContent = "v" + version;
    }

    statusDot.className = "status-indicator";
    const isPatched = state.kind === "ok" || (state.inspection?.summary?.status === "patched");
    const isClean = state.kind === "idle" || (state.inspection?.summary?.status === "clean");
    const isScanning = state.kind === "scanning";

    if (isPatched) {
      statusDot.classList.add("ready");
      statusText.textContent = dict.statusActive;
      applyBtnTxt.textContent = dict.reapplyPatch;
    } else if (isClean) {
      statusDot.classList.add("needs-patch");
      statusText.textContent = dict.statusReady;
      applyBtnTxt.textContent = dict.applyPatch;
    } else if (isScanning) {
      statusDot.classList.add("scanning");
      statusText.textContent = dict.statusScanning;
      applyBtnTxt.textContent = dict.applyPatch;
    } else {
      statusDot.classList.add("needs-patch");
      statusText.textContent = dict.statusNeedPatch;
      applyBtnTxt.textContent = dict.applyPatch;
    }

    // Codex AI Model & Active Provider
    const modelInput = document.getElementById("codex-model-input");
    if (state.codexModel) {
      if (document.activeElement !== modelInput) {
        modelInput.value = state.codexModel.model || "";
      }
      const activeProviderName = document.getElementById("active-provider-name");
      if (state.codexModel.provider && state.codexModel.provider.name) {
        activeProviderName.textContent = state.codexModel.provider.name;
      } else if (state.codexModel.modelProvider) {
        activeProviderName.textContent = state.codexModel.modelProvider;
      } else {
        activeProviderName.textContent = "OpenAI";
      }

      // Render Providers List in Drawer
      renderProvidersList(state.codexModel.providers || [], state.codexModel.modelProvider);

      // Provider Models Combobox items
      if (state.codexModel.models) {
        const spinner = document.getElementById("combobox-spinner");
        const chevron = document.getElementById("combobox-chevron");
        const refreshBtn = document.getElementById("btn-refresh-models");
        const errBox = document.getElementById("model-error-box");
        const statusLabel = document.getElementById("txt-models-status");
        
        if (state.codexModel.models.status === "loading") {
          spinner.classList.remove("hidden");
          chevron.classList.add("hidden");
          refreshBtn.classList.add("spinning");
          if (statusLabel) statusLabel.textContent = dict.modelsLoading;
        } else {
          spinner.classList.add("hidden");
          chevron.classList.remove("hidden");
          refreshBtn.classList.remove("spinning");
          if (statusLabel) statusLabel.textContent = dict.modelsReady;
        }

        if (state.codexModel.models.status === "error" && state.codexModel.models.error) {
          errBox.textContent = state.codexModel.models.error;
          errBox.classList.remove("hidden");
        } else {
          errBox.classList.add("hidden");
        }

        if (Array.isArray(state.codexModel.models.models)) {
          providerModelsList = state.codexModel.models.models;
          renderComboboxOptions(providerModelsList, document.getElementById("combobox-filter-input").value);
        }
      }
    }

    // Settings
    if (state.settings) {
      document.getElementById("setting-autopatch").checked = state.settings.patchOnStartup !== false;
      document.getElementById("setting-reload-prompt").checked = state.settings.showReloadPrompt !== false;
      document.getElementById("setting-patch-ai-chat").checked = state.settings.patchAiChat !== false;

      const sizeSelect = document.getElementById("setting-font-size");
      sizeSelect.value = String(state.settings.fontSize || 0);

      // Font Family
      const fontPreset = document.getElementById("font-preset-select");
      const fontCustom = document.getElementById("font-custom-input");
      const currentFont = (state.settings.preferredFontFamily || "Vazirmatn").trim();
      
      const standardPresets = [
        "Vazirmatn",
        "Noto Sans Arabic",
        "Noto Sans Arabic UI",
        "Estedad",
        "IRANYekan",
        "Sahel",
        "Shabnam",
        "Samim",
        "Tanha"
      ];
      if (standardPresets.includes(currentFont)) {
        fontPreset.value = currentFont;
        fontCustom.classList.add("hidden");
      } else {
        fontPreset.value = "__custom__";
        fontCustom.value = currentFont;
        fontCustom.classList.remove("hidden");
      }
    }

    // Dashboard Language Segmented Control
    const dashLangBtns = document.querySelectorAll("#dashboard-lang-switcher .segmented-btn");
    dashLangBtns.forEach(btn => {
      const isCurrent = btn.dataset.dashboardLang === dashboardLang;
      btn.classList.toggle("active", isCurrent);
      btn.setAttribute("aria-pressed", isCurrent ? "true" : "false");
    });

    // Codex Language Segmented Control
    let codexLocale = "fa";
    if (state.locale && typeof state.locale.current === "string") {
      const l = state.locale.current.toLowerCase();
      if (l.startsWith("ar")) codexLocale = "ar";
      else if (l.startsWith("en")) codexLocale = "en";
      else codexLocale = "fa";
    }
    const codexLangBtns = document.querySelectorAll("#codex-lang-switcher .segmented-btn");
    codexLangBtns.forEach(btn => {
      const isCurrent = btn.dataset.codexLocale === codexLocale;
      btn.classList.toggle("active", isCurrent);
      btn.setAttribute("aria-pressed", isCurrent ? "true" : "false");
    });

    // Diagnostics & Signals
    if (state.signals && Array.isArray(state.signals)) {
      renderSignals(state.signals);
    }
  }

  function renderProvidersList(providers, activeId) {
    const container = document.getElementById("providers-list-container");
    container.innerHTML = "";
    const resolved = document.documentElement.lang || "fa";
    const dict = I18N[resolved] || I18N.fa;

    // 1. Built-in OpenAI System Default Provider
    const isOpenAiActive = !activeId || activeId.toLowerCase() === "openai" || activeId.toLowerCase() === "default";
    const openAiItem = document.createElement("div");
    openAiItem.className = "provider-item" + (isOpenAiActive ? " active" : "");

    const openAiHeader = document.createElement("div");
    openAiHeader.className = "provider-item-header";
    const openAiActiveBadge = isOpenAiActive ? `<span class="provider-badge" style="font-size:10px;">✓ ${esc(dict.activeBadge || "فعال")}</span>` : "";
    openAiHeader.innerHTML = `<strong style="font-size:11.5px;">${esc(dict.providerOpenAiTitle || "OpenAI (پیش‌فرض سیستم)")}</strong>${openAiActiveBadge}`;

    const openAiMeta = document.createElement("div");
    openAiMeta.className = "provider-item-meta";
    openAiMeta.textContent = "ID: openai | URL: api.openai.com | Env: OPENAI_API_KEY";

    openAiItem.appendChild(openAiHeader);
    openAiItem.appendChild(openAiMeta);

    if (!isOpenAiActive) {
      const openAiActions = document.createElement("div");
      openAiActions.className = "provider-item-actions";
      const actBtn = document.createElement("button");
      actBtn.className = "btn btn-sm";
      actBtn.textContent = "✓ " + (dict.activate || "فعال");
      actBtn.onclick = () => {
        vscode.postMessage({ type: "switchActiveProvider", providerId: "openai" });
      };
      openAiActions.appendChild(actBtn);
      openAiItem.appendChild(openAiActions);
    }
    container.appendChild(openAiItem);

    // 2. Custom Configured Providers
    const customList = Array.isArray(providers) ? providers.filter(p => p && p.id !== "openai") : [];
    if (customList.length === 0) {
      const empty = document.createElement("div");
      empty.className = "combobox-empty";
      empty.style.padding = "4px 0";
      empty.textContent = dict.noCustomProviders || "هیچ پروایدر سفارشی دیگری تعریف نشده است.";
      container.appendChild(empty);
      return;
    }

    customList.forEach(p => {
      const item = document.createElement("div");
      const isActive = p.id === activeId;
      item.className = "provider-item" + (isActive ? " active" : "");

      const keyInfo = p.apiKey
        ? `<span class="provider-badge" style="background:rgba(120,80,220,0.15);color:var(--md-sys-color-primary);font-size:9.5px;padding:1px 5px;border-radius:4px;">🔑 ${esc(dict.providerKeyBadge || "دارای کلید")}</span>`
        : `<span style="color:var(--md-sys-color-on-surface-variant);font-size:9.5px;">${esc(dict.providerNoKeyBadge || "بدون کلید")}</span>`;

      const activeBadge = isActive ? `<span class="provider-badge" style="font-size:10px;">✓ ${esc(dict.activeBadge || "فعال")}</span>` : "";

      const header = document.createElement("div");
      header.className = "provider-item-header";
      header.innerHTML = `<div style="display:flex;align-items:center;gap:6px;"><strong style="font-size:11.5px;">${esc(p.name || p.id)}</strong>${keyInfo}</div>${activeBadge}`;

      const meta = document.createElement("div");
      meta.className = "provider-item-meta";
      meta.textContent = `ID: ${p.id} | Base: ${p.baseUrl || "no url"} | Env: ${p.envKey || "OPENAI_API_KEY"}`;

      const actions = document.createElement("div");
      actions.className = "provider-item-actions";

      // Edit Button
      const editBtn = document.createElement("button");
      editBtn.className = "btn btn-sm";
      editBtn.textContent = "✎ " + (dict.edit || "ویرایش");
      editBtn.title = dict.edit || "ویرایش";
      editBtn.onclick = () => {
        const form = document.getElementById("form-provider-edit");
        form.reset();
        document.getElementById("txt-provider-form-title").textContent = (dict.providerFormEditTitle || "ویرایش پروایدر") + ": " + (p.name || p.id);
        const idInput = document.getElementById("provider-input-id");
        idInput.value = p.id;
        idInput.readOnly = true;
        idInput.style.opacity = "0.7";
        idInput.style.cursor = "not-allowed";
        document.getElementById("provider-input-name").value = p.name || "";
        document.getElementById("provider-input-url").value = p.baseUrl || "";
        document.getElementById("provider-input-key").value = p.apiKey || "";
        document.getElementById("provider-input-env").value = p.envKey || "OPENAI_API_KEY";
        document.getElementById("btn-save-provider").textContent = dict.saveChanges || "ذخیره تغییرات";
        form.classList.remove("hidden");
        form.scrollIntoView({ behavior: "smooth", block: "nearest" });
      };
      actions.appendChild(editBtn);

      // Activate Button (if not active)
      if (!isActive) {
        const actBtn = document.createElement("button");
        actBtn.className = "btn btn-sm";
        actBtn.textContent = "✓ " + (dict.activate || "فعال");
        actBtn.onclick = () => {
          vscode.postMessage({ type: "switchActiveProvider", providerId: p.id });
        };
        actions.appendChild(actBtn);
      }

      // Delete Button
      const delBtn = document.createElement("button");
      delBtn.className = "btn btn-sm btn-danger";
      delBtn.textContent = "✕";
      delBtn.title = dict.delete || "حذف";
      delBtn.onclick = () => {
        const confirmMsg = (dict.confirmDelete || "آیا از حذف پروایدر {id} اطمینان دارید؟").replace("{id}", p.id);
        if (confirm(confirmMsg)) {
          vscode.postMessage({ type: "deleteCustomProvider", providerId: p.id });
        }
      };
      actions.appendChild(delBtn);

      item.appendChild(header);
      item.appendChild(meta);
      item.appendChild(actions);
      container.appendChild(item);
    });
  }

  function renderComboboxOptions(models, filterQuery) {
    const list = document.getElementById("combobox-options-list");
    list.innerHTML = "";
    const q = (filterQuery || "").toLowerCase().trim();
    const filtered = q ? models.filter(m => m.toLowerCase().includes(q)) : models;
    const resolved = document.documentElement.lang || "fa";
    const dict = I18N[resolved] || I18N.fa;

    const countLabel = document.getElementById("txt-model-count");
    if (countLabel) {
      countLabel.textContent = filtered.length + " / " + models.length + " " + (dict.modelsCountSuffix || "مدل");
    }

    if (filtered.length === 0) {
      const empty = document.createElement("div");
      empty.className = "combobox-empty";
      empty.textContent = dict.noModelsFound || "هیچ مدلی یافت نشد";
      list.appendChild(empty);
      return;
    }

    const currentVal = document.getElementById("codex-model-input").value.trim();
    filtered.forEach(m => {
      const opt = document.createElement("div");
      opt.className = "combobox-option" + (m === currentVal ? " selected" : "");
      opt.textContent = m;
      opt.setAttribute("role", "option");
      opt.onclick = () => {
        document.getElementById("codex-model-input").value = m;
        closeCombobox();
        vscode.postMessage({ type: "codexModel", model: m });
      };
      list.appendChild(opt);
    });
  }

  function renderSignals(signals) {
    const list = document.getElementById("signals-list");
    const countBadge = document.getElementById("signals-count");
    list.innerHTML = "";

    if (!Array.isArray(signals) || signals.length === 0) {
      countBadge.textContent = "0/0";
      return;
    }

    const passed = signals.filter(s => s.ok).length;
    countBadge.textContent = passed + "/" + signals.length;

    signals.forEach(s => {
      const item = document.createElement("div");
      item.className = "signal-item";
      
      const dot = document.createElement("div");
      dot.className = "signal-dot " + (s.ok ? "ok" : (s.tier === 1 ? "err" : "warn"));

      const info = document.createElement("div");
      info.style.overflow = "hidden";
      info.style.textOverflow = "ellipsis";
      info.innerHTML = "<strong>" + esc(s.name) + "</strong> <span style='color:var(--md-sys-color-on-surface-variant);font-size:10px;'>(" + esc(s.category || "") + " • " + esc(s.scope || "") + ")</span>";

      item.appendChild(dot);
      item.appendChild(info);
      list.appendChild(item);
    });
  }

  function toggleCombobox(forceOpen) {
    const dropdown = document.getElementById("model-dropdown-menu");
    const toggleBtn = document.getElementById("btn-toggle-combobox");
    const isOpen = !dropdown.classList.contains("hidden");
    const shouldOpen = typeof forceOpen === "boolean" ? forceOpen : !isOpen;

    if (shouldOpen) {
      dropdown.classList.remove("hidden");
      toggleBtn.setAttribute("aria-expanded", "true");
      const searchBox = document.getElementById("combobox-filter-input");
      searchBox.value = "";
      renderComboboxOptions(providerModelsList, "");
      searchBox.focus();
    } else {
      dropdown.classList.add("hidden");
      toggleBtn.setAttribute("aria-expanded", "false");
    }
  }

  function closeCombobox() {
    toggleCombobox(false);
  }

  function esc(str) {
    return String(str || "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#039;");
  }

  // ── Event Handlers ──
  window.addEventListener("message", event => {
    const message = event.data;
    if (message && message.type === "state") {
      renderState(message.state);
    }
  });

  // Action Buttons
  document.addEventListener("click", e => {
    const target = e.target.closest("[data-cmd]");
    if (target) {
      vscode.postMessage({ type: "action", command: target.dataset.cmd });
    }
  });

  // Toggle Switches
  document.querySelectorAll("[data-setting]").forEach(input => {
    input.addEventListener("change", e => {
      const key = e.target.dataset.setting;
      const value = e.target.type === "checkbox" ? e.target.checked : e.target.value;
      vscode.postMessage({ type: "setting", key, value });
    });
  });

  // Font Preset Select
  document.getElementById("font-preset-select").addEventListener("change", e => {
    const customInput = document.getElementById("font-custom-input");
    if (e.target.value === "__custom__") {
      customInput.classList.remove("hidden");
      customInput.focus();
    } else {
      customInput.classList.add("hidden");
      vscode.postMessage({ type: "setting", key: "preferredFontFamily", value: e.target.value });
    }
  });

  // Font Custom Input blur/enter
  document.getElementById("font-custom-input").addEventListener("change", e => {
    vscode.postMessage({ type: "setting", key: "preferredFontFamily", value: e.target.value.trim() });
  });

  // Dashboard Language Switcher
  document.querySelectorAll("#dashboard-lang-switcher .segmented-btn").forEach(btn => {
    btn.addEventListener("click", e => {
      const lang = e.currentTarget.dataset.dashboardLang;
      if (!lang) return;
      updateI18n(lang);
      vscode.postMessage({ type: "setting", key: "dashboardLanguage", value: lang });
    });
  });

  // Codex Extension Language Switcher
  document.querySelectorAll("#codex-lang-switcher .segmented-btn").forEach(btn => {
    btn.addEventListener("click", e => {
      const loc = e.currentTarget.dataset.codexLocale;
      let cmd = "codexNexus.setLocalePersian";
      if (loc === "ar") {
        cmd = "codexNexus.setLocaleArabic";
      } else if (loc === "en") {
        cmd = "codexNexus.setLocaleEnglish";
      }
      vscode.postMessage({ type: "action", command: cmd });
    });
  });

  // Provider Refresh Icon Button
  document.getElementById("btn-refresh-models").addEventListener("click", (e) => {
    e.stopPropagation();
    vscode.postMessage({ type: "codexModelsRefresh" });
  });

  // Provider Manager Drawer Toggle
  document.getElementById("btn-toggle-provider-mgr").addEventListener("click", () => {
    const mgr = document.getElementById("provider-manager");
    mgr.classList.toggle("hidden");
  });

  document.getElementById("btn-close-provider-mgr").addEventListener("click", () => {
    document.getElementById("provider-manager").classList.add("hidden");
    document.getElementById("form-provider-edit").classList.add("hidden");
  });

  // New Provider Button
  document.getElementById("btn-new-provider").addEventListener("click", () => {
    const form = document.getElementById("form-provider-edit");
    form.reset();
    const resolved = document.documentElement.lang || "fa";
    const dict = I18N[resolved] || I18N.fa;
    document.getElementById("txt-provider-form-title").textContent = dict.providerFormNewTitle || "افزودن پروایدر جدید";
    const idInput = document.getElementById("provider-input-id");
    idInput.readOnly = false;
    idInput.style.opacity = "1";
    idInput.style.cursor = "text";
    document.getElementById("btn-save-provider").textContent = dict.saveAndActivate || "ذخیره و فعال‌سازی";
    form.classList.remove("hidden");
    form.scrollIntoView({ behavior: "smooth", block: "nearest" });
  });

  // Cancel Provider Edit (Resets & Hides form)
  document.getElementById("btn-cancel-provider").addEventListener("click", () => {
    const form = document.getElementById("form-provider-edit");
    form.reset();
    form.classList.add("hidden");
  });

  // Save Provider Form (Submits, Resets & Hides form)
  document.getElementById("form-provider-edit").addEventListener("submit", e => {
    e.preventDefault();
    const id = document.getElementById("provider-input-id").value.trim();
    const name = document.getElementById("provider-input-name").value.trim();
    const baseUrl = document.getElementById("provider-input-url").value.trim();
    const apiKey = document.getElementById("provider-input-key").value.trim();
    const envKey = document.getElementById("provider-input-env").value.trim();

    if (!id || !baseUrl) return;
    vscode.postMessage({
      type: "saveCustomProvider",
      providerId: id,
      data: { name: name || id, baseUrl, apiKey, envKey: envKey || "OPENAI_API_KEY", activate: true }
    });
    e.target.reset();
    document.getElementById("form-provider-edit").classList.add("hidden");
  });

  // Combobox Controls
  const modelInput = document.getElementById("codex-model-input");
  const filterInput = document.getElementById("combobox-filter-input");

  document.getElementById("btn-toggle-combobox").addEventListener("click", e => {
    e.stopPropagation();
    toggleCombobox();
  });

  modelInput.addEventListener("focus", () => {
    if (providerModelsList.length > 0) toggleCombobox(true);
  });

  filterInput.addEventListener("input", e => {
    renderComboboxOptions(providerModelsList, e.target.value);
  });

  // Save Model Form
  document.getElementById("codex-model-form").addEventListener("submit", e => {
    e.preventDefault();
    const model = modelInput.value.trim();
    if (!model) return;
    closeCombobox();
    vscode.postMessage({ type: "codexModel", model });
  });

  // Click outside to close combobox
  document.addEventListener("click", e => {
    if (!e.target.closest("#model-combobox-wrapper")) {
      closeCombobox();
    }
  });

  // Signal Ready & Auto-fetch
  vscode.postMessage({ type: "ready" });
})();
</script>
</body>
</html>`;
  }
}

function createNonce() {
  let text = "";
  const possible = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
  for (let i = 0; i < 32; i++) {
    text += possible.charAt(Math.floor(Math.random() * possible.length));
  }
  return text;
}

module.exports = {
  DashboardProvider
};
