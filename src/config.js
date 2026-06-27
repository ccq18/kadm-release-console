import fs from "node:fs";

export function loadAppsConfig(path = process.env.KADM_APPS_CONFIG || process.env.ONECD_APPS_CONFIG || "config/apps.json") {
  const raw = fs.readFileSync(path, "utf8");
  return normalizeAppsConfig(JSON.parse(raw));
}

export function normalizeAppsConfig(input) {
  if (!Array.isArray(input)) {
    throw new Error("apps config must be an array");
  }

  return input.map((app, index) => {
    const prefix = `app[${index}]`;
    requireValue(app.id, `${prefix}.id`);
    requireValue(app.name, `${prefix}.name`);
    requireValue(app.github?.owner, `${prefix}.github.owner`);
    requireValue(app.github?.repo, `${prefix}.github.repo`);
    requireValue(app.github?.workflow, `${prefix}.github.workflow`);
    requireValue(app.gitops?.owner, `${prefix}.gitops.owner`);
    requireValue(app.gitops?.repo, `${prefix}.gitops.repo`);
    requireValue(app.gitops?.path, `${prefix}.gitops.path`);
    requireValue(app.gitops?.image, `${prefix}.gitops.image`);
    requireValue(app.argocd?.application, `${prefix}.argocd.application`);
    requireValue(app.rollout?.namespace, `${prefix}.rollout.namespace`);
    requireValue(app.rollout?.name, `${prefix}.rollout.name`);

    return {
      id: app.id,
      name: app.name,
      github: {
        owner: app.github.owner,
        repo: app.github.repo,
        workflow: app.github.workflow,
        ref: app.github.ref || "main"
      },
      gitops: {
        owner: app.gitops.owner,
        repo: app.gitops.repo,
        path: app.gitops.path,
        image: app.gitops.image,
        ref: app.gitops.ref || "main"
      },
      argocd: {
        application: app.argocd.application
      },
      rollout: {
        namespace: app.rollout.namespace,
        name: app.rollout.name
      }
    };
  });
}

export function requireEnv(env, name) {
  if (!env[name]) {
    throw new Error(`${name} is required`);
  }
  return env[name];
}

function requireValue(value, label) {
  if (!value) {
    throw new Error(`${label} is required`);
  }
}
