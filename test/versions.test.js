import test from "node:test";
import assert from "node:assert/strict";
import { deriveRolloutVersions, validateDeleteVersion, validatePromoteVersion, validateSwitchVersion } from "../src/versions.js";

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
  assert.equal(versions[0].canSwitch, true);
  assert.equal(versions[0].replicas.ready, 1);
  assert.equal(versions[1].hash, "old-hash");
  assert.equal(versions[1].isStable, true);
  assert.equal(versions[1].canSwitch, false);
  assert.equal(versions[1].canDelete, false);
  assert.equal(versions[1].receivingTraffic, true);
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
  assert.equal(versions[0].canSwitch, false);
});

test("includes retained revisions and marks only non-live ones deletable", () => {
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
  assert.equal(versions[1].canSwitch, true);
  assert.equal(versions[1].canDelete, true);
  assert.equal(versions[1].resourceName, "hello-old-hash");
});

test("validates that switch can target any non-current version", () => {
  const versions = [
    { hash: "new-hash", role: "candidate", canSwitch: true, resourceName: "hello-new" },
    { hash: "old-hash", role: "retained", canSwitch: true, resourceName: "hello-old" },
    { hash: "stable-hash", role: "stable", canSwitch: false, resourceName: "hello-stable" }
  ];

  assert.equal(validateSwitchVersion(versions, "new-hash").hash, "new-hash");
  assert.equal(validateSwitchVersion(versions, "old-hash").hash, "old-hash");
  assert.throws(() => validateSwitchVersion(versions, "stable-hash"), /not switchable/);
  assert.throws(() => validateSwitchVersion(versions, "missing-hash"), /Unknown version/);
});

test("validates that only inactive retained versions can be deleted", () => {
  const versions = [
    { hash: "stable", role: "stable", receivingTraffic: true, canDelete: false, resourceName: "hello-stable" },
    { hash: "old-stable", role: "stable", receivingTraffic: false, canDelete: true, resourceName: "hello-old-stable" },
    { hash: "old", role: "retained", canDelete: true, resourceName: "hello-old" }
  ];

  assert.equal(validateDeleteVersion(versions, "old-stable").resourceName, "hello-old-stable");
  assert.equal(validateDeleteVersion(versions, "old").resourceName, "hello-old");
  assert.throws(() => validateDeleteVersion(versions, "stable"), /cannot be deleted/);
  assert.throws(() => validateDeleteVersion(versions, "missing"), /Unknown version/);
});

test("blue-green preview keeps traffic on the stable version before manual switch", () => {
  const versions = deriveRolloutVersions(
    {
      spec: {
        strategy: {
          blueGreen: {
            activeService: "hello",
            previewService: "hello-preview",
            autoPromotionEnabled: false
          }
        }
      },
      status: {
        phase: "Paused",
        stableRS: "stable-hash",
        currentPodHash: "preview-hash",
        readyReplicas: 3,
        replicas: 3,
        updatedReplicas: 3,
        updatedReadyReplicas: 3,
        pauseConditions: [{ reason: "BlueGreenPause" }]
      }
    },
    [
      {
        metadata: {
          name: "hello-preview-hash",
          creationTimestamp: "2026-06-28T06:12:21Z",
          labels: { "rollouts-pod-template-hash": "preview-hash" }
        },
        spec: { replicas: 3 },
        status: { replicas: 3, readyReplicas: 3 }
      },
      {
        metadata: {
          name: "hello-stable-hash",
          creationTimestamp: "2026-06-28T01:28:58Z",
          labels: { "rollouts-pod-template-hash": "stable-hash" }
        },
        spec: { replicas: 3 },
        status: { replicas: 3, readyReplicas: 3 }
      }
    ]
  );

  assert.equal(versions[0].hash, "preview-hash");
  assert.equal(versions[0].role, "candidate");
  assert.equal(versions[0].receivingTraffic, false);
  assert.equal(versions[0].canSwitch, true);
  assert.equal(versions[1].hash, "stable-hash");
  assert.equal(versions[1].role, "stable");
  assert.equal(versions[1].receivingTraffic, true);
  assert.equal(versions[1].canSwitch, false);
  assert.equal(versions[1].canDelete, false);
});
