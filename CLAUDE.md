# Working on this repo

- Always end every reply that follows a push with the commit hash(es) just pushed (short SHA +
  branch, and the repo if more than one is involved). The owner asked for this explicitly.
- Talk to the owner in Polish; code, comments, commit messages and docs stay in English.
- Before pushing: `npm test`, `npm run typecheck`, `npm run build --workspace packages/web`.
- Deployment target: Synology NAS, `/volume1/docker/topbox`, https://topbox.duckdns.org (see
  docs/deployment.md). The NAS pulls `ghcr.io/bakardihahahaha/signoff-server:latest`, published by
  `.github/workflows/ci.yml` on pushes to `main`.
