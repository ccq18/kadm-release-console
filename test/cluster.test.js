import assert from "node:assert/strict";
import test from "node:test";

import { buildJoinScript } from "../src/cluster.js";

test("buildJoinScript adds private IP detection for worker and master joins", () => {
  const worker = buildJoinScript({
    role: "worker",
    serverUrl: "https://10.0.0.11:6443",
    token: "secret-token"
  });
  const master = buildJoinScript({
    role: "master",
    serverUrl: "https://10.0.0.11:6443",
    token: "secret-token"
  });

  assert.match(worker.script, /KADM_NODE_PRIVATE_IP/);
  assert.match(worker.script, /--node-ip \$\{NODE_PRIVATE_IP\}/);
  assert.doesNotMatch(worker.script, /--advertise-address \$\{NODE_PRIVATE_IP\}/);

  assert.match(master.script, /KADM_NODE_PRIVATE_IP/);
  assert.match(master.script, /--node-ip \$\{NODE_PRIVATE_IP\}/);
  assert.match(master.script, /--advertise-address \$\{NODE_PRIVATE_IP\}/);
});
