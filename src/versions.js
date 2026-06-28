export function deriveRolloutVersions(rollout, replicaSets = []) {
  const status = rollout?.status || {};
  const strategyMode = deriveStrategyMode(rollout);
  const stableHash = status.stableRS || status.canary?.stableRS || null;
  const currentHash = status.currentPodHash || status.updatedPodHash || null;
  const isPaused = status.phase === "Paused" || hasPauseConditions(status);

  if (!Array.isArray(replicaSets) || replicaSets.length === 0) {
    return dedupeByHash(deriveFallbackVersions(status, stableHash, currentHash, isPaused, strategyMode));
  }

  const versions = replicaSets
    .map((replicaSet) => deriveReplicaSetVersion(replicaSet, { stableHash, currentHash, isPaused, strategyMode }))
    .filter(Boolean)
    .sort((left, right) => compareVersions(left, right, stableHash, currentHash));

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

export function validateSwitchVersion(versions, versionHash) {
  const version = versions.find((candidate) => candidate.hash === versionHash);
  if (!version) {
    const error = new Error(`Unknown version: ${versionHash}`);
    error.status = 400;
    throw error;
  }
  if (!version.canSwitch || !version.resourceName) {
    const error = new Error(`Version ${versionHash} is not switchable.`);
    error.status = 409;
    throw error;
  }
  return version;
}

export function validateDeleteVersion(versions, versionHash) {
  const version = versions.find((candidate) => candidate.hash === versionHash);
  if (!version) {
    const error = new Error(`Unknown version: ${versionHash}`);
    error.status = 400;
    throw error;
  }
  if (!version.canDelete || !version.resourceName) {
    const error = new Error(`Version ${versionHash} cannot be deleted while it still serves traffic or is current.`);
    error.status = 409;
    throw error;
  }
  return version;
}

function deriveFallbackVersions(status, stableHash, currentHash, isPaused, strategyMode) {
  const versions = [];
  const previewOnly = strategyMode === "blueGreen" && stableHash && currentHash && currentHash !== stableHash;

  if (currentHash && currentHash !== stableHash) {
    versions.push({
      hash: currentHash,
      role: "candidate",
      label: "候选版本",
      isCurrent: true,
      isStable: false,
      canPromote: isPaused,
      canSwitch: isPaused,
      canDelete: false,
      receivingTraffic: !previewOnly,
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
      canSwitch: false,
      canDelete: false,
      receivingTraffic: receivesTraffic({
        strategyMode,
        stableHash,
        currentHash,
        hash: stableHash,
        isStable: true,
        isCurrent: stableHash === currentHash || !currentHash,
        isCandidate: false
      }),
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
      canSwitch: false,
      canDelete: false,
      receivingTraffic: true,
      replicas: {
        ready: status.readyReplicas || status.updatedReadyReplicas || 0,
        total: status.replicas || status.updatedReplicas || 0
      }
    });
  }

  return versions;
}

function deriveReplicaSetVersion(replicaSet, { stableHash, currentHash, isPaused, strategyMode }) {
  const hash =
    replicaSet?.metadata?.labels?.["rollouts-pod-template-hash"] ||
    replicaSet?.metadata?.labels?.["pod-template-hash"] ||
    null;
  if (!hash) {
    return null;
  }

  const desired = replicaSet?.spec?.replicas ?? replicaSet?.status?.replicas ?? 0;
  const ready = replicaSet?.status?.readyReplicas ?? 0;
  const isCandidate = Boolean(currentHash && hash === currentHash && hash !== stableHash);
  const isStable = Boolean(stableHash && hash === stableHash);
  const isCurrent = hash === currentHash || (!currentHash && isStable);
  const receivingTraffic = receivesTraffic({
    strategyMode,
    stableHash,
    currentHash,
    hash,
    isStable,
    isCurrent,
    isCandidate
  });
  const canSwitch = isCandidate ? isPaused : isStable ? false : true;

  return {
    hash,
    role: isCandidate ? "candidate" : isStable ? "stable" : "retained",
    label: isCandidate ? "候选版本" : isStable ? "稳定版本" : "历史版本",
    isCurrent,
    isStable,
    canPromote: isCandidate && isPaused,
    canSwitch,
    canDelete: !isCurrent && !receivingTraffic,
    receivingTraffic,
    resourceName: replicaSet?.metadata?.name || null,
    createdAt: replicaSet?.metadata?.creationTimestamp || null,
    replicas: {
      ready,
      total: desired
    }
  };
}

function compareVersions(left, right, stableHash, currentHash) {
  return versionRank(left, stableHash, currentHash) - versionRank(right, stableHash, currentHash) ||
    compareCreatedAt(right.createdAt, left.createdAt);
}

function versionRank(version, stableHash, currentHash) {
  if (currentHash && version.hash === currentHash && version.hash !== stableHash) {
    return 0;
  }
  if (version.hash === stableHash) {
    return 1;
  }
  return 2;
}

function compareCreatedAt(left, right) {
  const leftTime = left ? Date.parse(left) : 0;
  const rightTime = right ? Date.parse(right) : 0;
  return leftTime - rightTime;
}

function hasPauseConditions(status) {
  return Array.isArray(status.pauseConditions) && status.pauseConditions.length > 0;
}

function deriveStrategyMode(rollout) {
  if (rollout?.spec?.strategy?.blueGreen) {
    return "blueGreen";
  }
  return "canary";
}

function receivesTraffic({ strategyMode, stableHash, currentHash, hash, isStable, isCurrent, isCandidate }) {
  if (strategyMode === "blueGreen") {
    if (!stableHash) {
      return isCurrent;
    }
    if (currentHash && currentHash !== stableHash) {
      return isStable;
    }
    return isCurrent;
  }

  if (currentHash && stableHash && currentHash !== stableHash) {
    return isCandidate || isStable;
  }

  return isCurrent;
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
