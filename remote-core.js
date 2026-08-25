function isRemoteWindow(remoteName) {
  return typeof remoteName === "string" && remoteName.trim().length > 0;
}

function classifyTargetAvailability(facts = {}) {
  const {
    targetFound = false,
    targetReadable = false,
    remoteName,
    extensionIsLocalUi = false
  } = facts;

  if (targetFound && targetReadable) return "patchable";
  if (isRemoteWindow(remoteName) && extensionIsLocalUi && !targetReadable) return "remote-split";
  if (!targetFound) return "target-missing";
  return "target-unreachable";
}

function shouldAttemptPatch(classification) {
  return classification === "patchable";
}

function shouldExplainRemote(classification) {
  return classification === "remote-split" || classification === "target-unreachable";
}

function describeRemote(remoteName) {
  if (!isRemoteWindow(remoteName)) return "remote";
  const name = remoteName.trim().toLowerCase();
  if (name.startsWith("ssh")) return "Remote-SSH";
  if (name.startsWith("wsl")) return "WSL";
  if (name.includes("container")) return "Dev Container";
  if (name.includes("codespace")) return "Codespaces";
  return remoteName;
}

function buildRemoteGuidanceMessage(classification, displayName, remoteName) {
  const where = describeRemote(remoteName);
  if (classification === "remote-split") {
    return `${displayName} is installed on the ${where} side. Install this extension on the ${where} side too so the font patch can run next to it.`;
  }
  return `${displayName} was found but its files are not reachable from here, so the font patch was skipped.`;
}

module.exports = {
  isRemoteWindow,
  classifyTargetAvailability,
  shouldAttemptPatch,
  shouldExplainRemote,
  buildRemoteGuidanceMessage,
  describeRemote
};
