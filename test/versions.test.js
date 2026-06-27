import test from "node:test";
import assert from "node:assert/strict";
import { deriveRolloutVersions, validatePromoteVersion } from "../src/versions.js";

test("derives stable and candidate versions from Rollout status", () => {
  const versions = deriveRolloutVersions({
    status: {
      phase: "Paused",
      stableRS: "old-hash",
      currentPodHash: "new-hash",
      updatedReadyReplicas: 1,
      readyReplicas: 3,
      replicas: 3
    }
  });

  assert.deepEqual(versions.map((version) => version.role), ["candidate", "stable"]);
  assert.equal(versions[0].hash, "new-hash");
  assert.equal(versions[0].canPromote, true);
  assert.equal(versions[0].replicas.ready, 1);
  assert.equal(versions[1].hash, "old-hash");
  assert.equal(versions[1].isStable, true);
});

test("shows only the stable version when current hash already matches stable", () => {
  const versions = deriveRolloutVersions({
    status: {
      phase: "Healthy",
      stableRS: "stable-hash",
      currentPodHash: "stable-hash"
    }
  });

  assert.equal(versions.length, 1);
  assert.equal(versions[0].role, "stable");
  assert.equal(versions[0].canPromote, false);
});

test("validates that promote can only target the current candidate", () => {
  const versions = [
    { hash: "new-hash", role: "candidate", canPromote: true },
    { hash: "old-hash", role: "stable", canPromote: false }
  ];

  assert.equal(validatePromoteVersion(versions, "new-hash").hash, "new-hash");
  assert.throws(() => validatePromoteVersion(versions, "old-hash"), /not promotable/);
  assert.throws(() => validatePromoteVersion(versions, "missing-hash"), /Unknown version/);
});
