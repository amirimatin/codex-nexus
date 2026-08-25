const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

const {
  buildModelsUrl,
  deleteModelProvider,
  fetchProviderModelsFromConfig,
  normalizeCodexModelName,
  normalizeModelsResponse,
  readAllModelProviders,
  readCodexModelConfig,
  resolveProviderToken,
  setActiveModelProvider,
  upsertModelProvider,
  writeCodexModelConfig,
} = require("../codex-config-core");

test("codex config reads top-level model values only", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "codex-config-"));
  const file = path.join(dir, "config.toml");
  fs.writeFileSync(file, [
    'model = "cx/gpt-5.6-sol"',
    'model_reasoning_effort = "high"',
    'model_provider = "codex-9router"',
    "",
    "[projects.\"/tmp\"]",
    'model = "ignored"',
    "",
  ].join("\n"));

  assert.deepEqual(readCodexModelConfig(file), {
    path: file,
    exists: true,
    model: "cx/gpt-5.6-sol",
    modelProvider: "codex-9router",
    reasoningEffort: "high",
    provider: null,
    providers: [],
  });
});

test("codex config writes model while preserving sections", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "codex-config-"));
  const file = path.join(dir, "config.toml");
  fs.writeFileSync(file, [
    'model = "gpt-5.5" # keep comment',
    "",
    "[features]",
    "multi_agent = true",
    "",
  ].join("\n"));

  const saved = writeCodexModelConfig(" cx/gpt-5.6-sol ", file);
  assert.equal(saved.model, "cx/gpt-5.6-sol");
  const raw = fs.readFileSync(file, "utf8");
  assert.match(raw, /^model = "cx\/gpt-5\.6-sol" # keep comment$/m);
  assert.match(raw, /^\[features\]$/m);
});

test("codex model validation rejects unsafe text", () => {
  assert.equal(normalizeCodexModelName("cx/gpt-5.6-sol"), "cx/gpt-5.6-sol");
  assert.throws(() => normalizeCodexModelName(""), /Model name/);
  assert.throws(() => normalizeCodexModelName('bad"model'), /Model name/);
  assert.throws(() => normalizeCodexModelName("bad model"), /Model name/);
});

test("codex config reads active provider details and all providers", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "codex-config-"));
  const file = path.join(dir, "config.toml");
  fs.writeFileSync(file, [
    'model = "cx/gpt-5.6-sol"',
    'model_provider = "codex-9router"',
    "",
    "[model_providers.codex-9router]",
    'name = "9Router"',
    'base_url = "https://router.example.com/v1"',
    'env_key = "EXAMPLE_AI_TOKEN"',
    'wire_api = "responses"',
    "",
    "[model_providers.omni]",
    'name = "Omni Route"',
    'base_url = "https://omni.example.com/v1"',
    "",
  ].join("\n"));

  const config = readCodexModelConfig(file);
  assert.deepEqual(config.provider, {
    id: "codex-9router",
    name: "9Router",
    baseUrl: "https://router.example.com/v1",
    envKey: "EXAMPLE_AI_TOKEN",
    authMode: "environment",
    apiKey: "",
    wireApi: "responses",
  });
  assert.equal(config.providers.length, 2);
  assert.equal(config.providers[0].id, "codex-9router");
  assert.equal(config.providers[1].id, "omni");
});

test("codex custom provider CRUD works correctly", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "codex-config-"));
  const file = path.join(dir, "config.toml");
  fs.writeFileSync(file, [
    'model = "gpt-5.5"',
    'model_provider = "custom-1"',
    "",
    "[model_providers.custom-1]",
    'name = "Provider One"',
    'base_url = "https://p1.example.com/v1"',
    'env_key = "P1_KEY"',
    'wire_api = "responses"',
    "",
  ].join("\n"));

  // Upsert new provider with apiKey
  const updated1 = upsertModelProvider("custom-2", {
    name: "Provider Two",
    baseUrl: "https://p2.example.com/v1",
    apiKey: "sk-provider-two-secret-key",
    envKey: "P2_KEY",
    wireApi: "chat",
  }, file);
  assert.equal(updated1.providers.length, 2);
  assert.equal(updated1.providers[1].name, "Provider Two");
  assert.equal(updated1.providers[1].apiKey, "sk-provider-two-secret-key");

  // Check auth.json has the key stored
  const authPath = path.join(dir, "auth.json");
  const auth1 = JSON.parse(fs.readFileSync(authPath, "utf8"));
  assert.equal(auth1.tokens["custom-2"], "sk-provider-two-secret-key");

  // Edit existing provider custom-2 (update name, baseUrl, apiKey)
  const edited2 = upsertModelProvider("custom-2", {
    name: "Provider Two Edited",
    baseUrl: "https://p2-new.example.com/v1",
    apiKey: "sk-provider-two-new-key",
    envKey: "P2_KEY",
    wireApi: "chat",
  }, file);
  assert.equal(edited2.providers.length, 2);
  const foundEdited = edited2.providers.find(p => p.id === "custom-2");
  assert.equal(foundEdited.name, "Provider Two Edited");
  assert.equal(foundEdited.baseUrl, "https://p2-new.example.com/v1");
  assert.equal(foundEdited.apiKey, "sk-provider-two-new-key");
  const authEdited = JSON.parse(fs.readFileSync(authPath, "utf8"));
  assert.equal(authEdited.tokens["custom-2"], "sk-provider-two-new-key");

  // Switching only changes config.toml. Provider credentials stay scoped to tokens.<id>.
  const switched = setActiveModelProvider("custom-2", file);
  assert.equal(switched.modelProvider, "custom-2");
  assert.equal(switched.provider.name, "Provider Two Edited");
  const authSwitched = JSON.parse(fs.readFileSync(authPath, "utf8"));
  assert.equal(authSwitched.OPENAI_API_KEY, undefined);
  assert.equal(authSwitched.tokens["custom-2"], "sk-provider-two-new-key");
  assert.equal(authSwitched.auth_mode, "apikey");

  // Switch back to default OpenAI
  const switchedOpenAi = setActiveModelProvider("openai", file);
  assert.equal(switchedOpenAi.modelProvider, null);
  assert.equal(switchedOpenAi.provider, null);

  // Switch back to custom-2 and delete provider custom-2
  setActiveModelProvider("custom-2", file);
  const deleted = deleteModelProvider("custom-2", file);
  assert.equal(deleted.providers.length, 1);
  assert.equal(deleted.modelProvider, "custom-1"); // fell back to remaining provider
  const authDeleted = JSON.parse(fs.readFileSync(authPath, "utf8"));
  assert.equal(authDeleted.tokens["custom-2"], undefined);

  // Delete last remaining custom provider custom-1
  const deletedFinal = deleteModelProvider("custom-1", file);
  assert.equal(deletedFinal.providers.length, 0);
  assert.equal(deletedFinal.modelProvider, null);
  const authFinal = JSON.parse(fs.readFileSync(authPath, "utf8"));
  assert.equal(authFinal.tokens["custom-1"], undefined);
  assert.equal(authFinal.OPENAI_API_KEY, undefined); // no global token was created
});

test("codex config migrates raw env_key secrets to an auth.json command", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "codex-config-"));
  const file = path.join(dir, "config.toml");
  fs.writeFileSync(file, [
    'model_provider = "omni"',
    "",
    "[model_providers.omni]",
    'name = "OmniRoute"',
    'base_url = "https://om.candocloud.ir/api"',
    'env_key = "sk-56e69d80af06c02f-ce645b-e41d1700"',
    'wire_api = "responses"',
    "",
  ].join("\n"));

  // Reading config triggers auto-migration
  const config = readCodexModelConfig(file);
  assert.equal(config.provider.id, "omni");
  assert.equal(config.provider.envKey, null);
  assert.equal(config.provider.authMode, "authJson");
  assert.equal(config.provider.apiKey, "sk-56e69d80af06c02f-ce645b-e41d1700"); // extracted to auth.json!

  // Check config.toml file was updated
  const rawToml = fs.readFileSync(file, "utf8");
  assert.match(rawToml, /\[model_providers\.omni\.auth\]/);
  assert.match(rawToml, /command = "node"/);
  assert.doesNotMatch(rawToml, /env_key = "sk-/);
  assert.doesNotMatch(rawToml, /^env_key\s*=/m);

  // Check auth.json received the token
  const authPath = path.join(dir, "auth.json");
  const auth = JSON.parse(fs.readFileSync(authPath, "utf8"));
  assert.equal(auth.tokens["omni"], "sk-56e69d80af06c02f-ce645b-e41d1700");
  assert.equal(auth.OPENAI_API_KEY, undefined);
});

test("provider model list normalizes OpenAI-compatible responses", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "codex-config-"));
  const file = path.join(dir, "config.toml");
  fs.writeFileSync(file, [
    'model_provider = "codex-9router"',
    "",
    "[model_providers.codex-9router]",
    'base_url = "https://router.example.com/v1/"',
    'env_key = "EXAMPLE_AI_TOKEN"',
    "",
  ].join("\n"));

  assert.equal(buildModelsUrl("https://router.example.com/v1/"), "https://router.example.com/v1/models");
  assert.deepEqual(
    normalizeModelsResponse({ data: [{ id: "b" }, { id: "a" }, { id: "a" }] }),
    ["a", "b"],
  );

  const models = await fetchProviderModelsFromConfig(file, { EXAMPLE_AI_TOKEN: "secret" }, async (url, token) => {
    assert.equal(url, "https://router.example.com/v1/models");
    assert.equal(token, "secret");
    return { data: [{ id: "cx/gpt-5.6-sol" }, { id: "gpt-5.5" }] };
  });
  assert.deepEqual(models, ["cx/gpt-5.6-sol", "gpt-5.5"]);
});

test("provider token falls back to auth.json and supports direct tokens", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "codex-config-"));
  const file = path.join(dir, "config.toml");
  fs.writeFileSync(file, [
    'model_provider = "codex-9router"',
    "",
    "[model_providers.codex-9router]",
    'base_url = "https://router.example.com/v1"',
    "",
  ].join("\n"));
  fs.writeFileSync(path.join(dir, "auth.json"), JSON.stringify({
    auth_mode: "apikey",
    OPENAI_API_KEY: "auth-json-token",
  }));

  assert.equal(resolveProviderToken(file, "OPENAI_API_KEY", {}), "auth-json-token");
  assert.equal(resolveProviderToken(file, "sk-direct-secret-key-12345", {}), "sk-direct-secret-key-12345");
  assert.equal(resolveProviderToken(file, "Bearer token-value-xyz", {}), "token-value-xyz");

  const models = await fetchProviderModelsFromConfig(file, {}, async (url, token) => {
    assert.equal(token, "auth-json-token");
    return { data: [{ id: "cx/gpt-5.6-sol" }] };
  });
  assert.deepEqual(models, ["cx/gpt-5.6-sol"]);
});
