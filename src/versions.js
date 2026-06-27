export function deriveRolloutVersions(rollout) {
  const status = rollout?.status || {};
  const stableHash = status.stableRS || status.canary?.stableRS || null;
  const currentHash = status.currentPodHash || status.updatedPodHash || null;
  const isPaused = status.phase === "Paused" || hasPauseConditions(status);
  const versions = [];

  if (currentHash && currentHash !== stableHash) {
    versions.push({
      hash: currentHash,
      role: "candidate",
      label: "候选版本",
      isCurrent: true,
      isStable: false,
      canPromote: isPaused,
      replicas: {
        ready: status.updatedReadyReplicas || 0,
        total: status.updatedReplicas || status.replicas || 0
      }
    });
  }

  if (stableHash) {
    versions.push({
      hash: stableHash,
      role: "stable",
      label: "稳定版本",
      isCurrent: stableHash === currentHash || !currentHash,
      isStable: true,
      canPromote: false,
      replicas: {
        ready: status.readyReplicas || 0,
        total: status.replicas || 0
      }
    });
  } else if (currentHash) {
    versions.push({
      hash: currentHash,
      role: "current",
      label: "当前版本",
      isCurrent: true,
      isStable: false,
      canPromote: false,
      replicas: {
        ready: status.readyReplicas || status.updatedReadyReplicas || 0,
        total: status.replicas || status.updatedReplicas || 0
      }
    });
  }

  return dedupeByHash(versions);
}

export function validatePromoteVersion(versions, versionHash) {
  if (!versionHash) {
    return null;
  }

  const version = versions.find((candidate) => candidate.hash === versionHash);
  if (!version) {
    const error = new Error(`Unknown version: ${versionHash}`);
    error.status = 400;
    throw error;
  }
  if (!version.canPromote) {
    const error = new Error(`Version ${versionHash} is not promotable.`);
    error.status = 409;
    throw error;
  }
  return version;
}

function hasPauseConditions(status) {
  return Array.isArray(status.pauseConditions) && status.pauseConditions.length > 0;
}

function dedupeByHash(versions) {
  const seen = new Set();
  return versions.filter((version) => {
    if (seen.has(version.hash)) {
      return false;
    }
    seen.add(version.hash);
    return true;
  });
}
