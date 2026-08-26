# Changelog

## 1.0.6

- Stores provider-specific API keys in `~/.codex/provider-tokens.json`, rather than the Codex-owned `auth.json` file.
- Activating a provider synchronizes its token to `auth.json` as `OPENAI_API_KEY` and writes `requires_openai_auth = true` in its provider definition.
- Removes legacy `model_providers.<id>.auth` command blocks and migrates legacy `auth.json.tokens` values into the new provider token store.

## 1.0.5

- Allows manual model name typing and editing directly in the input field without combobox popup interference or focus hijacking.
- Adds on-demand model discovery and loading indicator when opening the combobox dropdown if the list is empty, avoiding redundant network requests during dashboard startup.

## 1.0.4

- Fixes extension activation and dashboard loading by removing nested template literals from the generated webview script.
- Restores registration of dashboard commands, including `codexNexus.refreshDashboard`.

## 1.0.3

- Custom providers now obtain their bearer token through a Codex `auth.command` that reads the provider-scoped secret from `~/.codex/auth.json`; no exported `env_key` is required.
- Migrates usable legacy provider credentials into `auth.json` and removes the environment-variable dependency from the managed provider definition.
- Updates the provider dashboard so API keys are not prefilled on edit and authentication status clearly identifies `auth.json` storage.

## 1.0.2

- Redesigned provider API key management with secure token persistence in `~/.codex/auth.json` (locked with `0600` filesystem permissions) and automatic healing of legacy raw `env_key` entries to eliminate `Missing environment variable` crashes.
- Added provider editing capabilities and live key status badges directly within the dashboard.
- Enhanced provider deletion with complete cleanup of associated tokens from `auth.json`.
- Updated default dashboard interface language upon installation to English (`en`).

## 1.0.1

- Fully revamped documentation in English with comprehensive guides for custom AI providers, features, and settings.
- Added official VS Code Marketplace badges, links, and repository metadata.
- Optimized GitHub Actions workflows for seamless automated CI/CD and release publishing on Node 22.

## 1.0.0

- Official release as **Codex Nexus** (`codex-nexus` / `amirimatin/codex-nexus`).
- Introduces new high-resolution official brand icon and visual assets.
- Complete Google Material Design 3 (M3) dashboard interface with seamless VS Code dark/light theme adaptation.
- Multi-provider AI manager for `~/.codex/config.toml` supporting custom endpoints, live models fetching, switching, and returning to default OpenAI.
- Unified model selector combobox with freeform editing, live search, and auto-refresh.
- Comprehensive multilingual dashboard support (Persian, Arabic, and English).
- Native VS Code AI Chat & Copilot RTL bidirectional typography support with automated checksum verification.

## 0.1.18

- Adds comprehensive Persian RTL and Vazirmatn font support for VS Code AI Chat, Copilot Chat, and Interactive Editor workbench surfaces.
- Automatically updates product.json checksums to prevent "Unsupported / Corrupted installation" warnings.
- Adds comprehensive test coverage for Workbench targets, CSS rules, checksum calculations, and cleanup.

## 0.1.17

- Shows the active custom-provider model beside the composer reasoning-effort control; hover reveals the full model name and active-provider context.
- Keeps the badge absent when Codex is using its native ChatGPT provider, and does not make it a model-changing control.

## 0.1.16

- Replaces the Provider model dropdown with a searchable, bounded result list.
- Gives each model result an explicit minimum height and non-shrinking flex layout so VS Code theme styles cannot collapse or overlap list entries.

## 0.1.15

- Supports the current `data-codex-composer-root` structure used by Codex `26.715.31925`.
- Keeps the stateful direction toggle (`فا` for RTL and `EN` for LTR) in the composer action row next to Send.
- Refuses to inject the toggle into an editable input when no safe action row can be identified.
- Adds browser regression coverage for the toggle label, parent, order, and editable-input exclusion.

## 0.1.13

- Fixes reversed Persian letters in the composer `/` slash-command dropdown.
- Keeps per-character fuzzy-search highlight spans in one shared bidirectional text run while the menu root remains RTL.
- Adds a real-browser regression check for the visual order of split Persian command-title characters.

## 0.1.12

- Classifies each prose block as RTL when its complete text contains at least one Persian/Arabic-script character, even when the block starts with English.
- Keeps entirely non-Persian prose blocks LTR while preserving strict LTR isolation for code, terminal, and diff surfaces.
- Replaces `unicode-bidi: plaintext` on classified prose with an explicit isolated base direction so the first strong character cannot override the detected direction.
- Adds streaming regression coverage for English-first mixed Persian text.

## 0.1.11

- Guarantees that the installer and runtime do not change the enabled or disabled state of GitHub Copilot or any other VS Code extension.
- Adds regression tests that reject extension-state database access and disable/uninstall flags in executable sources.
- Excludes the machine-specific recovery report from the installable VSIX package.
- Updates the tested Codex target to `26.707.71524`.

## 0.1.9

- Adds `installer.sh` for a safe build, full VS Code shutdown, offline VSIX installation, offline patch, reopen, and startup-log verification flow.
- Preserves the current font and extension settings while applying the patch without a live Codex webview.
- Refuses installation from the VS Code integrated terminal so shutdown cannot terminate the installer halfway through.

## 0.1.8

- Keeps expanded file-review popups LTR through Codex's `data-app-action-review-file-expanded` portal marker.
- Extends portal-level LTR guards to code-block wrappers rendered outside the main conversation root.

## 0.1.7

- Keeps Codex StreamingMarkdown fade spans in one parent bidi paragraph instead of isolating every arriving word.
- Applies a native `dir` attribute synchronously when streamed Markdown changes direction.
- Retains the existing LTR guards for code blocks and Diff surfaces.

## 0.1.6

- Covers transient streaming descendants through the stable Codex conversation, turn, and unit roots.
- Applies the configured chat font size through Codex typography variables as well as prose text elements.
- Preserves the final LTR authority for code blocks, terminals, and Diff surfaces.

## 0.1.5

- Applies RTL immediately to every Markdown descendant while Persian mode is active, including transient streaming wrappers.
- Adds LTR guards for Codex code-block containers and Markdown copy surfaces, not only native `pre` and `code` elements.
- Adds `codexNexus.fontSize` (`0` for Codex default, or `10`–`24` px) for conversation text and the composer.
- Re-applies the managed stylesheet when typography settings change.

## 0.1.4

- Reclassifies an initially LTR streaming message as soon as a newly appended element contains Persian text.
- Keeps diff and code-line renderers LTR when Codex mounts them in dialogs or popover portals outside the main root.

## 0.1.3

- Reworked the patch to load scoped RTL CSS from a small external stylesheet instead of a large inline block.
- Removed legacy global Custom UI Style rules from the Codex webview patch.
- Kept review panels, inline file diffs, code lines, and diff metadata strictly LTR.
- Replaced whole-conversation streaming scans with nearest-Markdown-root updates.

## 0.1.2

- Fixed Persian assistant text growing from the left while Codex is streaming.
- Added the current Codex Markdown root signals used by version 26.707.41301.
- Applied per-message direction synchronously before the next animation frame.

## 0.1.1

- Fixed RTL direction while reasoning text is streamed into the conversation.
- Added character-data observation and per-message Persian direction detection.
- Kept code blocks, terminals, and Codex Git diff surfaces strictly LTR.
- Removed an overly broad class selector that could misclassify non-code content.

## 0.1.0

- Combined Vazirmatn, dynamic composer direction, and scoped Persian UI styling.
- Removed the dependency on Custom UI Style and VS Code core-file changes.

## 0.3.3

- Minor bug fix.

## 0.3.2

- Remote-SSH / WSL / Dev Container support.
- Skips cleanly instead of erroring when Codex files aren't reachable.

## 0.3.1

- Compatibility with the latest Codex builds.
- Fixed the direction toggle placement in the composer.

## 0.3.0

- New logo and activity-bar icon.
- Minor cleanup.

## 0.2.9

- Stability fixes.

## 0.2.8

- Small compatibility tweaks.

## 0.2.7

- Safer cleanup behavior.

## 0.2.6

- Improved patch and restore.

## 0.2.4

- Initial release.
