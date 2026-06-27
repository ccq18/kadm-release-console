# Stateless Release Pipeline Tasks

## Task 1: Backend runtime release pipeline

- [x] Add failing tests for release manager orchestration, duplicate rejection, build failure, cancellation, and version derivation.
- [x] Implement `ReleaseManager`.
- [x] Implement Rollout version extraction.
- [x] Wire `/release`, `/release/cancel`, `/promote`, and `/versions` routes.
- [x] Keep existing low-level routes for compatibility.

## Task 2: Frontend two-action release console

- [x] Add failing tests for task-aware release state labels.
- [x] Replace the action bar with publish, promote, and secondary abort controls.
- [x] Render stable/current/candidate version hints.
- [x] Bind button enabled states to derived release stage.

## Task 3: Verification

- [x] Run `node --test`.
- [x] Run syntax checks equivalent to `npm run lint` with bundled Node.
- [x] Smoke test the app locally with a mock server.
