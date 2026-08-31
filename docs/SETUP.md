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
