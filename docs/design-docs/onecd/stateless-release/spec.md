# Stateless Release Pipeline Spec

Status: Quick Draft

## Background

OneCD currently exposes separate build, deploy, and rollout action buttons over GitHub Actions, Argo CD, and Argo Rollouts. The desired product model is a smaller release console with two main actions: publish and promote. Publish should run build, deploy, and canary check as one long task, then stop before traffic is fully promoted. Promote remains the explicit business-impacting version switch.

## Goals

- Replace the main release flow with two primary actions: publish and promote.
- Run publish as an in-memory long task: build -> wait for build success -> deploy -> wait for canary/checking state.
- Allow only one active publish task per application in a OneCD process.
- Avoid a database in the first version. If OneCD restarts, runtime task state can be lost because stable traffic is changed only by explicit promote.
- Keep existing low-level API wrappers available for compatibility, while adding higher-level publish and version APIs.

## Requirements

- `POST /api/apps/:id/release` starts a publish task and returns `202`.
- `POST /api/apps/:id/release/cancel` marks the in-memory publish task cancelled.
- `POST /api/apps/:id/promote` promotes the current Rollout candidate.
- `GET /api/apps/:id/status` includes external state plus any active in-memory task.
- `GET /api/apps/:id/versions` returns stable/current/candidate version hints derived from Rollout status without requiring extra Kubernetes permissions.
- The frontend shows publish and promote as the main actions, with abort as a secondary safety action.
- Publish failure before promote must not switch stable traffic.

## Design

The backend owns a small `ReleaseManager` with a `Map<appId, ReleaseTask>`. A task dispatches the configured GitHub Actions workflow, polls workflow runs until success or failure, syncs Argo CD, then polls Argo CD and Rollout until the Rollout reaches a paused checking state or a healthy already-released state. The task is cancellable between polling steps.

Status remains recoverable from external systems. `/status` aggregates GitHub, Argo CD, Rollout, and the in-memory task. If there is no active task, the UI still derives a state from GitHub workflow runs, Argo CD sync, and Rollout phase.

Version listing is intentionally conservative in this first implementation. The API reads only Rollout status fields already available through existing RBAC and exposes stable/current/candidate hashes. Full historical image management can be added later by granting read-only ReplicaSet access and updating GitOps manifests before syncing.

## Testing

- Unit test the release manager for successful publish, duplicate publish rejection, build failure, and cancellation.
- Unit test version derivation from Rollout status.
- Unit test frontend release-state derivation for task-aware publish states.
- Run existing request builder tests.
