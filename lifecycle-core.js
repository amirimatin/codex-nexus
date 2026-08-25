const fs = require("fs");
const path = require("path");

function readObsoleteRegistry(extensionsDir) {
  const obsoleteFile = path.join(extensionsDir, ".obsolete");
  if (!fs.existsSync(obsoleteFile)) {
    return {};
  }

  try {
    const parsed = JSON.parse(fs.readFileSync(obsoleteFile, "utf8"));
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

function isExtensionMarkedObsolete(extensionPath, obsoleteRegistry = {}) {
  if (!extensionPath || !obsoleteRegistry || typeof obsoleteRegistry !== "object") {
    return false;
  }

  return obsoleteRegistry[path.basename(extensionPath)] === true;
}

function shouldCleanupOnDeactivate(extensionPath) {
  if (!extensionPath) {
    return false;
  }

  const extensionsDir = path.dirname(extensionPath);
  return isExtensionMarkedObsolete(extensionPath, readObsoleteRegistry(extensionsDir));
}

module.exports = {
  isExtensionMarkedObsolete,
  readObsoleteRegistry,
  shouldCleanupOnDeactivate
};
