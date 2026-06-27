import express from "express";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { ReleaseManager } from "./release-manager.js";
import { deriveRolloutVersions, validatePromoteVersion } from "./versions.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export function createApp({ apps, github, argocd, rollouts, releaseManager, cluster }) {
  const server = express();
  const releases = releaseManager || new ReleaseManager({ github, argocd, rollouts });

  server.use(express.json({ limit: "64kb" }));
  server.use(express.static(path.join(__dirname, "../public")));

  server.get("/api/apps", (_req, res) => {
    res.json({ apps: apps.map(publicApp) });
  });

  server.get("/api/cluster", async (_req, res, next) => {
    try {
      ensureCluster(cluster);
      res.json(await cluster.getCluster());
    } catch (error) {
      next(error);
    }
  });

  server.post("/api/cluster/join-script", async (req, res, next) => {
    try {
      ensureCluster(cluster);
      const role = req.body?.role;
      if (!["master", "worker"].includes(role)) {
        const error = new Error(`Unsupported node role: ${role}`);
        error.status = 400;
        throw error;
      }
      res.json(cluster.generateJoinScript({ role }));
    } catch (error) {
      next(error);
    }
  });

  server.get("/api/apps/:id/status", async (req, res, next) => {
    try {
      const app = findApp(apps, req.params.id);
      const [application, rollout, workflowRuns] = await Promise.allSettled([
        argocd.getApplication(app),
        rollouts.getRollout(app),
        github.listWorkflowRuns(app)
      ]);
      const rolloutValue = settledValue(rollout);

      res.json({
        app: publicApp(app),
        argocd: settledValue(application),
        rollout: rolloutValue,
        workflowRuns: settledValue(workflowRuns, []),
        releaseTask: releases.getTask(app.id),
        versions: rollout.status === "fulfilled" ? deriveRolloutVersions(rolloutValue) : []
      });
    } catch (error) {
      next(error);
    }
  });

  server.get("/api/apps/:id/versions", async (req, res, next) => {
    try {
      const app = findApp(apps, req.params.id);
      const rollout = await rollouts.getRollout(app);
      res.json({
        app: publicApp(app),
        versions: deriveRolloutVersions(rollout)
      });
    } catch (error) {
      next(error);
    }
  });

  server.post("/api/apps/:id/release", async (req, res, next) => {
    try {
      const app = findApp(apps, req.params.id);
      const releaseTask = releases.start(app, {
        imageTag: req.body?.imageTag
      });
      res.status(202).json({ app: publicApp(app), releaseTask });
    } catch (error) {
      next(error);
    }
  });

  server.post("/api/apps/:id/release/cancel", async (req, res, next) => {
    try {
      const app = findApp(apps, req.params.id);
      const releaseTask = releases.cancel(app.id);
      res.status(202).json({ app: publicApp(app), releaseTask });
    } catch (error) {
      next(error);
    }
  });

  server.post("/api/apps/:id/build", async (req, res, next) => {
    try {
      const app = findApp(apps, req.params.id);
      const result = await github.dispatchWorkflow(app, {
        imageTag: req.body?.imageTag
      });
      res.status(202).json({ app: publicApp(app), result });
    } catch (error) {
      next(error);
    }
  });

  server.post("/api/apps/:id/sync", async (req, res, next) => {
    try {
      const app = findApp(apps, req.params.id);
      const result = await argocd.syncApplication(app);
      res.status(202).json({ app: publicApp(app), result });
    } catch (error) {
      next(error);
    }
  });

  server.post("/api/apps/:id/promote", async (req, res, next) => {
    try {
      const app = findApp(apps, req.params.id);
      if (req.body?.versionHash) {
        const rollout = await rollouts.getRollout(app);
        validatePromoteVersion(deriveRolloutVersions(rollout), req.body.versionHash);
      }
      const result = await rollouts.runAction(app, "promote");
      res.status(202).json({ app: publicApp(app), action: "promote", result });
    } catch (error) {
      next(error);
    }
  });

  server.post("/api/apps/:id/rollout/:action", async (req, res, next) => {
    try {
      const app = findApp(apps, req.params.id);
      const action = req.params.action;
      if (!["promote", "abort", "restart"].includes(action)) {
        res.status(400).json({ error: "Unsupported rollout action." });
        return;
      }
      const result = await rollouts.runAction(app, action);
      res.status(202).json({ app: publicApp(app), action, result });
    } catch (error) {
      next(error);
    }
  });

  server.use((req, res) => {
    if (req.path.startsWith("/api/")) {
      res.status(404).json({ error: "API endpoint not found." });
      return;
    }
    res.sendFile(path.join(__dirname, "../public/index.html"));
  });

  server.use((error, _req, res, _next) => {
    const status = error.status || 500;
    res.status(status).json({ error: error.message || "Internal server error." });
  });

  return server;
}

function publicApp(app) {
  return {
    id: app.id,
    name: app.name,
    github: {
      owner: app.github.owner,
      repo: app.github.repo,
      workflow: app.github.workflow,
      ref: app.github.ref
    },
    argocd: app.argocd,
    rollout: app.rollout
  };
}

function findApp(apps, id) {
  const app = apps.find((candidate) => candidate.id === id);
  if (!app) {
    const error = new Error(`Unknown app: ${id}`);
    error.status = 404;
    throw error;
  }
  return app;
}

function ensureCluster(cluster) {
  if (!cluster) {
    const error = new Error("Cluster API is not configured.");
    error.status = 503;
    throw error;
  }
}

function settledValue(result, fallback = null) {
  if (result.status === "fulfilled") {
    return result.value;
  }
  return { error: result.reason?.message || "request failed", fallback };
}
