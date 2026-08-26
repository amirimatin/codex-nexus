const fs = require("fs");
const http = require("http");
const https = require("https");
const os = require("os");
const path = require("path");

const MODEL_RE = /^[A-Za-z0-9][A-Za-z0-9._:/+-]{0,159}$/;
const PROVIDER_TOKENS_FILE = "provider-tokens.json";

function defaultCodexConfigPath(env = process.env) {
  const home = env.CODEX_HOME && path.isAbsolute(env.CODEX_HOME)
    ? env.CODEX_HOME
    : path.join(os.homedir(), ".codex");
  return path.join(home, "config.toml");
}

function normalizeCodexModelName(value) {
  if (typeof value !== "string") {
    throw new TypeError("Model name must be text.");
  }
  const model = value.trim();
  if (!MODEL_RE.test(model)) {
    throw new TypeError("Model name may contain letters, numbers, dots, dashes, underscores, slash, colon, and plus only.");
  }
  return model;
}

function defaultCodexAuthPath(env = process.env) {
  const home = env.CODEX_HOME && path.isAbsolute(env.CODEX_HOME)
    ? env.CODEX_HOME
    : path.join(os.homedir(), ".codex");
  return path.join(home, "auth.json");
}

function defaultProviderTokensPath(env = process.env) {
  const home = env.CODEX_HOME && path.isAbsolute(env.CODEX_HOME)
    ? env.CODEX_HOME
    : path.join(os.homedir(), ".codex");
  return path.join(home, PROVIDER_TOKENS_FILE);
}

function isValidEnvVarName(name) {
  return typeof name === "string" && /^[A-Za-z_][A-Za-z0-9_]*$/.test(name.trim());
}

function readAuthJson(authPath = defaultCodexAuthPath()) {
  try {
    const raw = fs.readFileSync(authPath, "utf8");
    const data = JSON.parse(raw);
    return (data && typeof data === "object" && !Array.isArray(data)) ? data : {};
  } catch (error) {
    if (error && error.code === "ENOENT") return {};
    return {};
  }
}

function writeAuthJson(data, authPath = defaultCodexAuthPath()) {
  try {
    fs.mkdirSync(path.dirname(authPath), { recursive: true });
    const content = JSON.stringify(data, null, 2) + "\n";
    fs.writeFileSync(authPath, content, { encoding: "utf8", mode: 0o600 });
  } catch {
    /* ignore write errors */
  }
}

function readProviderTokens(tokensPath = defaultProviderTokensPath()) {
  try {
    const data = JSON.parse(fs.readFileSync(tokensPath, "utf8"));
    return data && typeof data.tokens === "object" && !Array.isArray(data.tokens) ? data : { tokens: {} };
  } catch (error) {
    if (error && error.code === "ENOENT") return { tokens: {} };
    return { tokens: {} };
  }
}

function writeProviderTokens(data, tokensPath = defaultProviderTokensPath()) {
  try {
    fs.mkdirSync(path.dirname(tokensPath), { recursive: true });
    fs.writeFileSync(tokensPath, JSON.stringify({ version: 1, tokens: data.tokens || {} }, null, 2) + "\n", {
      encoding: "utf8",
      mode: 0o600
    });
  } catch {
    /* ignore write errors */
  }
}

function providerTokensPathForConfig(filePath) {
  return path.join(path.dirname(filePath), PROVIDER_TOKENS_FILE);
}

function saveProviderToken(providerId, apiKey, tokensPath = defaultProviderTokensPath()) {
  if (!providerId || typeof providerId !== "string") return;
  const id = providerId.trim();
  const key = typeof apiKey === "string" ? apiKey.trim() : "";
  if (!key) return;

  const store = readProviderTokens(tokensPath);
  store.tokens[id] = key;
  writeProviderTokens(store, tokensPath);
}

function syncActiveProviderToken(providerId, filePath = defaultCodexConfigPath()) {
  const id = typeof providerId === "string" ? providerId.trim() : "";
  if (!id) return;

  let raw = "";
  try {
    raw = fs.readFileSync(filePath, "utf8");
  } catch {
    return;
  }
  const isOpenAi = id.toLowerCase() === "openai" || id.toLowerCase() === "default";
  const provider = isOpenAi ? null : readSection(raw, `model_providers.${id}`);
  if (!isOpenAi && !readBooleanInBlock(provider || "", "requires_openai_auth")) return;

  const tokenStore = readProviderTokens(providerTokensPathForConfig(filePath));
  const token = tokenStore.tokens[id];
  const authPath = path.join(path.dirname(filePath), "auth.json");
  const auth = readAuthJson(authPath);
  if (typeof token === "string" && token.trim()) {
    auth.auth_mode = "apikey";
    auth.OPENAI_API_KEY = token.trim();
  } else {
    delete auth.OPENAI_API_KEY;
  }
  // `tokens` was an extension-specific legacy field. Codex must never see it.
  if (auth.tokens) delete auth.tokens;
  writeAuthJson(auth, authPath);
}

function sanitizeAndMigrateProviders(filePath = defaultCodexConfigPath()) {
  try {
    let raw = fs.readFileSync(filePath, "utf8");
    let changed = false;
    const authPath = path.join(path.dirname(filePath), "auth.json");
    const tokensPath = providerTokensPathForConfig(filePath);
    const auth = readAuthJson(authPath);
    const tokenStore = readProviderTokens(tokensPath);
    let authChanged = false;
    let tokenStoreChanged = false;

    // Versions before 1.0.6 kept provider secrets in auth.json.tokens. Move
    // them out once and remove that non-Codex field from auth.json.
    if (auth.tokens && typeof auth.tokens === "object" && !Array.isArray(auth.tokens)) {
      for (const [id, token] of Object.entries(auth.tokens)) {
        if (typeof token === "string" && token.trim() && !tokenStore.tokens[id]) {
          tokenStore.tokens[id] = token.trim();
          tokenStoreChanged = true;
        }
      }
      delete auth.tokens;
      authChanged = true;
    }

    const providerRegex = /^\s*\[model_providers\.([A-Za-z0-9_-]+)\]\s*(?:#.*)?$/gm;
    let match;
    const providerIds = [];
    while ((match = providerRegex.exec(raw)) !== null) {
      providerIds.push(match[1]);
    }

    for (const id of providerIds) {
      const section = readSection(raw, `model_providers.${id}`);
      if (!section) continue;
      const currentEnvKey = readStringInBlock(section, "env_key");
      const hasAuthCommand = Boolean(readProviderAuthSection(raw, id));
      const legacyRawToken = currentEnvKey && !isValidEnvVarName(currentEnvKey) ? currentEnvKey : "";
      const storedToken = tokenStore.tokens[id]
        || (currentEnvKey && auth?.[currentEnvKey])
        || (!currentEnvKey && auth?.OPENAI_API_KEY)
        || "";
      const shouldMigrate = Boolean(legacyRawToken || hasAuthCommand || tokenStore.tokens[id]);
      if (shouldMigrate) {
        // Provider secrets are private extension state. Codex itself receives
        // the selected secret only through auth.json.OPENAI_API_KEY.
        const token = legacyRawToken || storedToken;
        if (typeof token === "string" && token.trim() && !tokenStore.tokens[id]) {
          tokenStore.tokens[id] = token.trim();
          tokenStoreChanged = true;
        }

        const name = readStringInBlock(section, "name") || id;
        const baseUrl = readStringInBlock(section, "base_url") || "";
        const wireApi = readStringInBlock(section, "wire_api") || readStringInBlock(section, "wire_format") || "responses";
        raw = replaceProviderDefinition(raw, id, buildProviderDefinition({
          id,
          name,
          baseUrl,
          wireApi
        }));
        changed = true;
      }
    }

    if (changed) {
      fs.writeFileSync(filePath, raw, "utf8");
    }
    if (authChanged) {
      writeAuthJson(auth, authPath);
    }
    if (tokenStoreChanged) {
      writeProviderTokens(tokenStore, tokensPath);
    }
    if (changed) {
      const activeId = readTopLevelString(raw, "model_provider");
      if (activeId) syncActiveProviderToken(activeId, filePath);
    }
  } catch (error) {
    if (error && error.code !== "ENOENT") {
      /* ignore */
    }
  }
}

function readAllModelProviders(filePath = defaultCodexConfigPath()) {
  sanitizeAndMigrateProviders(filePath);
  try {
    const raw = fs.readFileSync(filePath, "utf8");
    const tokenStore = readProviderTokens(providerTokensPathForConfig(filePath));
    const providers = [];
    const providerRegex = /^\s*\[model_providers\.([A-Za-z0-9_-]+)\]\s*(?:#.*)?$/gm;
    let match;
    while ((match = providerRegex.exec(raw)) !== null) {
      const id = match[1];
      const section = readSection(raw, `model_providers.${id}`);
      if (section) {
        const envKey = readStringInBlock(section, "env_key");
        const apiKey = tokenStore.tokens[id] || "";
        providers.push({
          id,
          name: readStringInBlock(section, "name") || id,
          baseUrl: readStringInBlock(section, "base_url") || "",
          envKey,
          authMode: readBooleanInBlock(section, "requires_openai_auth") ? "openaiAuth" : (envKey ? "environment" : "none"),
          apiKey,
          wireApi: readStringInBlock(section, "wire_api") || readStringInBlock(section, "wire_format") || "responses"
        });
      }
    }
    return providers;
  } catch (error) {
    if (error && error.code === "ENOENT") return [];
    throw error;
  }
}

function readCodexModelConfig(filePath = defaultCodexConfigPath()) {
  sanitizeAndMigrateProviders(filePath);
  try {
    const raw = fs.readFileSync(filePath, "utf8");
    const modelProvider = readTopLevelString(raw, "model_provider");
    const provider = modelProvider ? readModelProvider(raw, modelProvider, filePath) : null;
    const providers = readAllModelProviders(filePath);
    return {
      path: filePath,
      exists: true,
      model: readTopLevelString(raw, "model"),
      modelProvider,
      reasoningEffort: readTopLevelString(raw, "model_reasoning_effort"),
      provider,
      providers
    };
  } catch (error) {
    if (error && error.code === "ENOENT") {
      return {
        path: filePath,
        exists: false,
        model: null,
        modelProvider: null,
        reasoningEffort: null,
        provider: null,
        providers: []
      };
    }
    throw error;
  }
}

function setActiveModelProvider(providerId, filePath = defaultCodexConfigPath()) {
  sanitizeAndMigrateProviders(filePath);
  let raw = "";
  try {
    raw = fs.readFileSync(filePath, "utf8");
  } catch (error) {
    if (!error || error.code !== "ENOENT") throw error;
  }
  const id = typeof providerId === "string" ? providerId.trim() : "";
  const isDefaultOpenAi = !id || id.toLowerCase() === "openai" || id.toLowerCase() === "default";
  const currentProviderId = readTopLevelString(raw, "model_provider");
  const updated = isDefaultOpenAi
    ? raw.replace(/^\s*model_provider\s*=.*$/m, "").trimEnd() + "\n"
    : writeTopLevelString(raw, "model_provider", id);
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, updated, "utf8");

  if (!isDefaultOpenAi && (!currentProviderId || currentProviderId.toLowerCase() === "openai" || currentProviderId.toLowerCase() === "default")) {
    const authPath = path.join(path.dirname(filePath), "auth.json");
    const auth = readAuthJson(authPath);
    if (typeof auth.OPENAI_API_KEY === "string" && auth.OPENAI_API_KEY.trim()) {
      saveProviderToken("openai", auth.OPENAI_API_KEY, providerTokensPathForConfig(filePath));
    }
  }
  syncActiveProviderToken(isDefaultOpenAi ? "openai" : id, filePath);

  return readCodexModelConfig(filePath);
}

function replaceOrAppendSection(raw, sectionName, sectionContent) {
  const match = raw.match(new RegExp(`^\\s*\\[${escapeRegExp(sectionName)}\\]\\s*(?:#.*)?$`, "m"));
  if (!match) {
    const separator = raw.length === 0 || raw.endsWith("\n\n") ? "" : raw.endsWith("\n") ? "\n" : "\n\n";
    return `${raw}${separator}${sectionContent.trim()}\n`;
  }
  const start = match.index;
  const afterHeader = start + match[0].length;
  const nextSectionMatch = raw.slice(afterHeader).match(/^\s*\[/m);
  const end = nextSectionMatch ? afterHeader + nextSectionMatch.index : raw.length;
  return `${raw.slice(0, start)}${sectionContent.trim()}\n${raw.slice(end)}`.replace(/\n{3,}/g, "\n\n").trimEnd() + "\n";
}

function removeSectionFromRaw(raw, sectionName) {
  const match = raw.match(new RegExp(`^\\s*\\[${escapeRegExp(sectionName)}\\]\\s*(?:#.*)?$`, "m"));
  if (!match) return raw;
  const start = match.index;
  const afterHeader = start + match[0].length;
  const nextSectionMatch = raw.slice(afterHeader).match(/^\s*\[/m);
  const end = nextSectionMatch ? afterHeader + nextSectionMatch.index : raw.length;
  return (raw.slice(0, start) + raw.slice(end)).replace(/\n{3,}/g, "\n\n").trimEnd() + "\n";
}

function replaceProviderDefinition(raw, providerId, definition) {
  const baseSection = `model_providers.${providerId}`;
  const header = new RegExp(`^\\s*\\[${escapeRegExp(baseSection)}\\]\\s*(?:#.*)?$`, "m");
  const match = raw.match(header);
  if (!match) {
    const separator = raw.length === 0 || raw.endsWith("\n\n") ? "" : raw.endsWith("\n") ? "\n" : "\n\n";
    return `${raw}${separator}${definition.trim()}\n`;
  }
  const start = match.index;
  const nextTable = /^\s*\[([^\]]+)\]\s*(?:#.*)?$/gm;
  nextTable.lastIndex = start + match[0].length;
  let next;
  let end = raw.length;
  while ((next = nextTable.exec(raw)) !== null) {
    const sectionName = next[1];
    if (next.index > start && sectionName !== baseSection && !sectionName.startsWith(`${baseSection}.`)) {
      end = next.index;
      break;
    }
  }
  return `${raw.slice(0, start)}${definition.trim()}\n${raw.slice(end)}`.replace(/\n{3,}/g, "\n\n").trimEnd() + "\n";
}

function removeProviderDefinition(raw, providerId) {
  const baseSection = `model_providers.${providerId}`;
  const header = new RegExp(`^\\s*\\[${escapeRegExp(baseSection)}\\]\\s*(?:#.*)?$`, "m");
  const match = raw.match(header);
  if (!match) return raw;
  const start = match.index;
  const nextTable = /^\s*\[([^\]]+)\]\s*(?:#.*)?$/gm;
  nextTable.lastIndex = start + match[0].length;
  let next;
  let end = raw.length;
  while ((next = nextTable.exec(raw)) !== null) {
    const sectionName = next[1];
    if (next.index > start && sectionName !== baseSection && !sectionName.startsWith(`${baseSection}.`)) {
      end = next.index;
      break;
    }
  }
  return (raw.slice(0, start) + raw.slice(end)).replace(/\n{3,}/g, "\n\n").trimEnd() + "\n";
}

function buildProviderDefinition({ id, name, baseUrl, wireApi }) {
  return [
    `[model_providers.${id}]`,
    `name = "${escapeTomlBasicString(name)}"`,
    `base_url = "${escapeTomlBasicString(baseUrl)}"`,
    `wire_api = "${escapeTomlBasicString(wireApi)}"`,
    "requires_openai_auth = true",
    ""
  ].join("\n");
}

function upsertModelProvider(providerId, data = {}, filePath = defaultCodexConfigPath()) {
  if (!providerId || typeof providerId !== "string" || !/^[A-Za-z0-9_-]+$/.test(providerId.trim())) {
    throw new TypeError("Provider ID must contain only alphanumeric characters, underscores, and dashes.");
  }
  const id = providerId.trim();
  const name = typeof data.name === "string" && data.name.trim() ? data.name.trim() : id;
  const baseUrl = typeof data.baseUrl === "string" ? data.baseUrl.trim() : "";
  let apiKey = typeof data.apiKey === "string" ? data.apiKey.trim() : "";
  const wireApi = typeof data.wireApi === "string" && data.wireApi.trim() ? data.wireApi.trim() : "responses";

  let raw = "";
  try {
    raw = fs.readFileSync(filePath, "utf8");
  } catch (error) {
    if (!error || error.code !== "ENOENT") throw error;
  }

  const updated = replaceProviderDefinition(raw, id, buildProviderDefinition({
    id, name, baseUrl, wireApi
  }));

  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, updated, "utf8");

  // Save the provider-scoped token outside Codex's auth.json.
  const tokensPath = providerTokensPathForConfig(filePath);
  if (apiKey) {
    saveProviderToken(id, apiKey, tokensPath);
  }

  if (data.activate === true) {
    return setActiveModelProvider(id, filePath);
  }

  return readCodexModelConfig(filePath);
}

function deleteModelProvider(providerId, filePath = defaultCodexConfigPath()) {
  if (!providerId || typeof providerId !== "string") return readCodexModelConfig(filePath);
  const id = providerId.trim();
  let raw = "";
  try {
    raw = fs.readFileSync(filePath, "utf8");
  } catch (error) {
    if (error && error.code === "ENOENT") return readCodexModelConfig(filePath);
    throw error;
  }

  let updated = removeProviderDefinition(raw, id);

  // Clean the provider-scoped secret without touching unrelated Codex auth.
  const tokensPath = providerTokensPathForConfig(filePath);
  const tokenStore = readProviderTokens(tokensPath);
  let tokenStoreChanged = false;
  if (tokenStore.tokens[id]) {
    delete tokenStore.tokens[id];
    tokenStoreChanged = true;
  }
  const activeId = readTopLevelString(raw, "model_provider");
  if (activeId === id) {
    const existing = readAllModelProviders(filePath);
    const remaining = existing.filter((p) => p.id !== id);
    const nextProviderId = remaining.length > 0 ? remaining[0].id : "";
    if (nextProviderId) {
      if (tokenStoreChanged) writeProviderTokens(tokenStore, tokensPath);
      updated = writeTopLevelString(updated, "model_provider", nextProviderId);
      fs.writeFileSync(filePath, updated, "utf8");
      return setActiveModelProvider(nextProviderId, filePath);
    }
    // No remaining custom providers -> fallback to OpenAI default
    if (tokenStoreChanged) writeProviderTokens(tokenStore, tokensPath);
    updated = updated.replace(/^\s*model_provider\s*=.*$/m, "").trimEnd() + "\n";
    fs.writeFileSync(filePath, updated, "utf8");
    return setActiveModelProvider("openai", filePath);
  }

  if (tokenStoreChanged) writeProviderTokens(tokenStore, tokensPath);
  fs.writeFileSync(filePath, updated, "utf8");
  return readCodexModelConfig(filePath);
}

function writeCodexModelConfig(model, filePath = defaultCodexConfigPath()) {
  const normalized = normalizeCodexModelName(model);
  let raw = "";
  try {
    raw = fs.readFileSync(filePath, "utf8");
  } catch (error) {
    if (!error || error.code !== "ENOENT") throw error;
  }
  const updated = writeTopLevelString(raw, "model", normalized);
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, updated, "utf8");
  return readCodexModelConfig(filePath);
}

function readTopLevelString(raw, key) {
  const sectionStart = raw.search(/^\s*\[/m);
  const head = sectionStart === -1 ? raw : raw.slice(0, sectionStart);
  const match = head.match(new RegExp(`^\\s*${escapeRegExp(key)}\\s*=\\s*"((?:\\\\.|[^"\\\\])*)"\\s*(?:#.*)?$`, "m"));
  return match ? unescapeTomlBasicString(match[1]) : null;
}

function readModelProvider(raw, providerName, filePath = defaultCodexConfigPath()) {
  const section = readSection(raw, `model_providers.${providerName}`);
  if (!section) return null;
  const envKey = readStringInBlock(section, "env_key");
  const tokenStore = readProviderTokens(providerTokensPathForConfig(filePath));
  const apiKey = tokenStore.tokens[providerName] || "";
  return {
    id: providerName,
    name: readStringInBlock(section, "name") || providerName,
    baseUrl: readStringInBlock(section, "base_url") || "",
    envKey,
    authMode: readBooleanInBlock(section, "requires_openai_auth") ? "openaiAuth" : (envKey ? "environment" : "none"),
    apiKey,
    wireApi: readStringInBlock(section, "wire_api") || readStringInBlock(section, "wire_format") || "responses"
  };
}

function readProviderAuthSection(raw, providerName) {
  return readSection(raw, `model_providers.${providerName}.auth`);
}

function readSection(raw, sectionName) {
  const escaped = escapeRegExp(sectionName);
  const match = raw.match(new RegExp(`^\\s*\\[${escaped}\\]\\s*(?:#.*)?$`, "m"));
  if (!match) return null;
  const start = match.index + match[0].length;
  const next = raw.slice(start).search(/^\s*\[/m);
  return next === -1 ? raw.slice(start) : raw.slice(start, start + next);
}

function readStringInBlock(raw, key) {
  const match = raw.match(new RegExp(`^\\s*${escapeRegExp(key)}\\s*=\\s*"((?:\\\\.|[^"\\\\])*)"\\s*(?:#.*)?$`, "m"));
  return match ? unescapeTomlBasicString(match[1]) : null;
}

function readBooleanInBlock(raw, key) {
  const match = raw.match(new RegExp(`^\\s*${escapeRegExp(key)}\\s*=\\s*(true|false)\\s*(?:#.*)?$`, "mi"));
  return match ? match[1].toLowerCase() === "true" : false;
}


function writeTopLevelString(raw, key, value) {
  const line = `${key} = "${escapeTomlBasicString(value)}"`;
  const sectionMatch = raw.match(/^\s*\[/m);
  const headEnd = sectionMatch ? sectionMatch.index : raw.length;
  const head = raw.slice(0, headEnd);
  const tail = raw.slice(headEnd);
  const keyRe = new RegExp(`^(\\s*)${escapeRegExp(key)}\\s*=\\s*"(?:\\\\.|[^"\\\\])*"(\\s*(?:#.*)?)$`, "m");

  if (keyRe.test(head)) {
    return head.replace(keyRe, `$1${line}$2`) + tail;
  }

  const separator = head.length === 0 || head.endsWith("\n") ? "" : "\n";
  return `${head}${separator}${line}\n${tail}`;
}

function escapeTomlBasicString(value) {
  return String(value).replace(/\\/g, "\\\\").replace(/"/g, '\\"');
}

function unescapeTomlBasicString(value) {
  return String(value).replace(/\\(["\\])/g, "$1");
}

const DEFAULT_OPENAI_MODELS = [
  "gpt-5",
  "gpt-5.5",
  "gpt-5.4",
  "gpt-5.3",
  "gpt-5.2",
  "gpt-5.1",
  "gpt-4.1",
  "gpt-4o",
  "gpt-4o-mini",
  "o1",
  "o1-mini",
  "o3",
  "o3-mini",
  "o4-mini"
];

async function fetchProviderModelsFromConfig(filePath = defaultCodexConfigPath(), env = process.env, request = httpRequestJson) {
  const config = readCodexModelConfig(filePath);
  const provider = config.provider;
  if (!provider || !provider.baseUrl) {
    const token = resolveProviderToken(filePath, "OPENAI_API_KEY", env, "openai");
    if (token) {
      try {
        const payload = await request("https://api.openai.com/v1/models", token);
        const models = normalizeModelsResponse(payload);
        if (models.length > 0) return models;
      } catch {
        /* fallback to defaults */
      }
    }
    return DEFAULT_OPENAI_MODELS;
  }

  const token = resolveProviderToken(filePath, provider.envKey, env, provider.id);
  const url = buildModelsUrl(provider.baseUrl);
  try {
    const payload = await request(url, token);
    const models = normalizeModelsResponse(payload);
    if (models.length > 0) return models;
  } catch (error) {
    if (url.endsWith("/models") && !url.includes("/v1/models")) {
      try {
        const v1Url = url.replace(/\/models$/, "/v1/models");
        const payload = await request(v1Url, token);
        const models = normalizeModelsResponse(payload);
        if (models.length > 0) return models;
      } catch {
        /* try api/tags */
      }
      try {
        const tagUrl = url.replace(/\/models$/, "/api/tags");
        const payload = await request(tagUrl, token);
        const models = normalizeModelsResponse(payload);
        if (models.length > 0) return models;
      } catch {
        /* proceed to throw original error */
      }
    }
    throw error;
  }
  return [];
}

function resolveProviderToken(configPath, envKey, env = process.env, providerId = null) {
  const authPath = path.join(path.dirname(configPath), "auth.json");
  const auth = readAuthJson(authPath);
  const tokenStore = readProviderTokens(providerTokensPathForConfig(configPath));

  // 1. Provider-scoped token from the extension-owned credentials file.
  if (providerId && tokenStore.tokens[providerId]) {
    return tokenStore.tokens[providerId];
  }

  if (typeof envKey === "string") {
    const key = envKey.trim();
    // 2. Direct bearer/sk token passed as envKey fallback
    if (key.startsWith("sk-") || key.startsWith("bearer ") || key.startsWith("Bearer ")) {
      return key.replace(/^bearer\s+/i, "");
    }
    // 3. Process environment variable
    if (key && env[key]) {
      return env[key];
    }
    // 4. auth.json entry for this envKey
    if (key && typeof auth?.[key] === "string" && auth[key]) {
      return auth[key];
    }
  }

  // 5. Active token in Codex's auth.json OPENAI_API_KEY
  if (typeof auth?.OPENAI_API_KEY === "string" && auth.OPENAI_API_KEY) {
    return auth.OPENAI_API_KEY;
  }

  // 6. Global process.env.OPENAI_API_KEY
  return env.OPENAI_API_KEY || "";
}

function readAuthJsonToken(authPath, envKey) {
  const auth = readAuthJson(authPath);
  const direct = typeof auth?.[envKey] === "string" ? auth[envKey] : "";
  if (direct) return direct;
  return typeof auth?.OPENAI_API_KEY === "string" ? auth.OPENAI_API_KEY : "";
}

function buildModelsUrl(baseUrl) {
  const url = new URL(baseUrl);
  const pathname = url.pathname.replace(/\/+$/, "");
  url.pathname = `${pathname}/models`;
  url.search = "";
  url.hash = "";
  return url.toString();
}

function normalizeModelsResponse(payload) {
  const items = Array.isArray(payload?.data) ? payload.data : Array.isArray(payload?.models) ? payload.models : [];
  return items
    .map((item) => (typeof item === "string" ? item : item?.id || item?.name || item?.model))
    .filter((id) => typeof id === "string" && id.trim().length > 0)
    .map((id) => id.trim())
    .filter((id, index, all) => all.indexOf(id) === index)
    .sort((a, b) => a.localeCompare(b));
}

function httpRequestJson(url, token) {
  const parsed = new URL(url);
  const client = parsed.protocol === "http:" ? http : https;
  const headers = {
    Accept: "application/json"
  };
  if (token) {
    headers.Authorization = `Bearer ${token}`;
  }

  return new Promise((resolve, reject) => {
    const req = client.get(url, {
      headers,
      timeout: 6000
    }, (res) => {
      let body = "";
      res.setEncoding("utf8");
      res.on("data", (chunk) => {
        body += chunk;
        if (body.length > 2 * 1024 * 1024) {
          req.destroy(new Error("Models response is too large."));
        }
      });
      res.on("end", () => {
        if (res.statusCode < 200 || res.statusCode >= 300) {
          reject(new Error(`Provider models request failed with HTTP ${res.statusCode}.`));
          return;
        }
        try {
          resolve(JSON.parse(body));
        } catch {
          reject(new Error("Provider models response is not valid JSON."));
        }
      });
    });
    req.on("timeout", () => req.destroy(new Error("Provider models request timed out.")));
    req.on("error", reject);
  });
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

module.exports = {
  defaultCodexAuthPath,
  defaultCodexConfigPath,
  buildModelsUrl,
  deleteModelProvider,
  fetchProviderModelsFromConfig,
  httpRequestJson,
  httpsRequestJson: httpRequestJson,
  isValidEnvVarName,
  normalizeCodexModelName,
  normalizeModelsResponse,
  readAllModelProviders,
  readAuthJson,
  readAuthJsonToken,
  readCodexModelConfig,
  resolveProviderToken,
  sanitizeAndMigrateProviders,
  saveProviderToken,
  setActiveModelProvider,
  upsertModelProvider,
  writeAuthJson,
  writeCodexModelConfig
};
