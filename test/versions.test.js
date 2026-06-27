import test from "node:test";
import assert from "node:assert/strict";
import { deriveRolloutVersions, validateDeleteVersion, validatePromoteVersion } from "../src/versions.js";

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

test("includes retained revisions and marks only inactive ones deletable", () => {
  const versions = deriveRolloutVersions(
    {
      status: {
        phase: "Healthy",
        stableRS: "new-hash",
        currentPodHash: "new-hash",
        readyReplicas: 2,
        replicas: 2
      }
    },
    [
      {
        metadata: {
          name: "hello-new-hash",
          creationTimestamp: "2026-06-28T00:00:00Z",
          labels: { "rollouts-pod-template-hash": "new-hash" }
        },
        spec: { replicas: 2 },
        status: { replicas: 2, readyReplicas: 2 }
      },
      {
        metadata: {
          name: "hello-old-hash",
          creationTimestamp: "2026-06-27T00:00:00Z",
          labels: { "rollouts-pod-template-hash": "old-hash" }
        },
        spec: { replicas: 0 },
        status: { replicas: 0, readyReplicas: 0 }
      }
    ]
  );

  assert.deepEqual(versions.map((version) => version.role), ["stable", "retained"]);
  assert.equal(versions[1].hash, "old-hash");
  assert.equal(versions[1].canDelete, true);
  assert.equal(versions[1].resourceName, "hello-old-hash");
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

test("validates that only inactive retained versions can be deleted", () => {
  const versions = [
    { hash: "stable", role: "stable", canDelete: false, resourceName: "hello-stable" },
    { hash: "old", role: "retained", canDelete: true, resourceName: "hello-old" }
  ];

  assert.equal(validateDeleteVersion(versions, "old").resourceName, "hello-old");
  assert.throws(() => validateDeleteVersion(versions, "stable"), /cannot be deleted/);
  assert.throws(() => validateDeleteVersion(versions, "missing"), /Unknown version/);
});
