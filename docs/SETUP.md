# Setup Guide

## Prerequisites

- Node.js (v18 or higher)
- npm
- MongoDB Atlas account (free tier available at [mongodb.com](https://www.mongodb.com/cloud/atlas))

## Installation

```bash
npm install
```

## Environment Setup

Create a `.env` file in the project root:

```env
MONGODB_URI=mongodb+srv://<db_username>:<db_password>@cluster0.xxxxx.mongodb.net/?appName=Cluster0
SESSION_SECRET=your-secret-key-change-in-production
NODE_ENV=development
PORT=3000
```

Replace `<db_username>` and `<db_password>` with your actual MongoDB Atlas credentials.

## MongoDB Atlas Setup

1. Go to [MongoDB Atlas](https://www.mongodb.com/cloud/atlas) and sign in or create a free account
2. Create a new cluster (free tier is sufficient)
3. Create a database user with username and password
4. Add your IP address to the IP allowlist (or use `0.0.0.0/0` for development)
5. Copy the connection string from the "Connect" button and paste it as `MONGODB_URI`

No manual collection or index creation is required — Mongoose creates the schema and indexes on first run.

## Development

Run both the server and client in development mode:

```bash
npm run dev
```

- Backend (Express): http://localhost:3000
- Frontend (Webpack dev server): http://localhost:8080

The Webpack dev server proxies `/api/*` requests to the Express backend automatically.

## Production Build

Build both server and client:

```bash
npm run build
```

Start the production server:

```bash
npm start
```

The production server serves the compiled frontend bundle from `public/` and listens on the port defined by `PORT` (default `3000`).

## Available Scripts

| Script | Description |
|---|---|
| `npm run dev` | Run server and client concurrently in watch mode |
| `npm run dev:server` | Run only the Express server with hot-reload |
| `npm run dev:client` | Run only the Webpack dev server |
| `npm run build` | Compile server (TypeScript → `dist/`) and bundle client (`public/`) |
| `npm run build:server` | Compile server only |
| `npm run build:client` | Bundle client only |
| `npm start` | Start the compiled production server |

## Deployment (Kubernetes / Helm)

### GitHub Actions CI/CD

Two workflows are defined in `.github/workflows/`:

- **`ci-cd.yml`** — runs on every push to `master`. Builds the app, builds and integration-tests the Docker image, then lints and validates the Helm chart. Pushes `charly37/storycreator:<sha>` + `charly37/storycreator:latest` to Docker Hub.
- **`release.yml`** — manual dispatch. Accepts a `version` input (e.g. `v1.2.0`), creates a git tag, pushes a versioned Docker image, packages the Helm chart, and publishes a GitHub Release with the chart attached to GHCR (`oci://ghcr.io/charly37`).

**Required GitHub repository secrets/variables** (Settings → Secrets and variables → Actions):

| Name | Type | Value |
|---|---|---|
| `DOCKER_USERNAME` | Variable | `charly37` |
| `DOCKER_PASSWORD` | Secret | Docker Hub access token |

`GITHUB_TOKEN` is provided automatically by GitHub Actions.

### One-time Kubernetes secret

Before the first `helm install`, create the secret that holds sensitive config in the target namespace:

```bash
kubectl create secret generic story-creator-secrets \
  --namespace=story-creator \
  --from-literal=mongodb-uri='<your-atlas-connection-string>' \
  --from-literal=session-secret='<random-secret-key>'
```

This only needs to be done once per cluster. The Helm chart references it but never creates it (keeping credentials out of version control).

### Install / upgrade with Helm

```bash
# From the GHCR OCI registry (after a release):
helm upgrade --install story-creator \
  oci://ghcr.io/charly37/story-creator \
  --version 1.2.0 \
  --namespace story-creator --create-namespace

# From the local chart (development / staging):
helm upgrade --install story-creator helm/story-creator \
  --values helm/story-creator/values-prod.yaml \
  --namespace story-creator --create-namespace
```

Update `helm/story-creator/values.yaml` (or pass `--set`) to change the domain (`bilingualstory.net` by default), image tag, or resource limits.
