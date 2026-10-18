# Logging

The StoryCreator backend logs with **pino** and writes one JSON object per line
to stdout. Docker and Kubernetes capture that stream, and a cluster log
collector forwards it to VictoriaLogs. The application writes no log files and
the Helm chart does not deploy VictoriaLogs or a log collector.

## At a glance

- One JSON object per line, no multi-line records (stack traces are escaped
  inside `err.stack`).
- Standard pino field names: `msg` (message), `time` (timestamp), `level`.
- `level` is a **string** (`info`, `error`, …), not pino's numeric level, so
  VictoriaLogs can filter with `level:error`.
- **No HTTP access logs.** Only startup messages and error paths emit records.
- Every request gets an id (`req.id`), returned as the `X-Request-Id` response
  header. Errors logged through `req.log` carry it for correlation.

## Record format

Production sample (startup):

```json
{"level":"info","time":"2026-10-18T19:04:38.485Z","service":"story-creator","port":3000,"nodeEnv":"production","msg":"Server listening"}
```

Background job sample:

```json
{"level":"error","time":"2026-10-18T19:10:02.104Z","service":"story-creator","module":"storyGeneration","storyId":"6710a1b2c3d4e5f60718293a","err":{"type":"Error","message":"…","stack":"Error: …"},"msg":"Background story generation failed"}
```

| Field | Always | Description |
|---|---|---|
| `level` | yes | `trace`, `debug`, `info`, `warn`, `error`, or `fatal` (string) |
| `time` | yes | ISO 8601 / RFC 3339 UTC timestamp |
| `msg` | yes | Human-readable message (never a secret) |
| `service` | yes | `story-creator` |
| `module` | no | Child-logger name: `database`, `apiKeyService`, `storyGeneration`, `regenerateChapter` |
| `req.id` | request errors | Request id from `X-Request-Id` or a generated UUID |
| `req.method`, `req.url`, `req.remoteAddress`, `req.headers` | request errors | Request context; credential headers are removed |
| `storyId` | background jobs | Story being generated or regenerated |
| `err.type`, `err.message`, `err.stack` | error records | Serialized error; Mongoose errors may add `reason`/`cause` fields |
| `port`, `nodeEnv` | startup | Listening port and mode |

Credential fields are **removed** from `req.headers` and `req.body` before
serialization: `authorization`, `x-api-key`, `cookie`, `set-cookie`, `password`.
Request bodies are never logged, and API key material is never logged in any
field. `apiKeyId` is not emitted.

## What is logged

| Event | Level | Source |
|---|---|---|
| Server listening | `info` | `src/server.ts` |
| MongoDB connected | `info` | `src/config/database.ts` |
| MongoDB connection failure (process exits) | `fatal` | `src/config/database.ts` |
| Server initialisation failure (process exits) | `fatal` | `src/server.ts` |
| Route handler failure (HTTP 500 paths) | `error` | `src/routes/*.ts` via `req.log` |
| Creator-permission lookup failure | `error` | `src/routes/stories.ts`, `src/routes/apiKeys.ts` |
| API-key authentication exception | `error` | `src/middleware/requireApiKey.ts` |
| Background chapter regeneration failure | `error` | `src/routes/stories.ts` (`module: regenerateChapter`, `storyId`) |
| Story generation failure | `error` | `src/services/storyGenerationService.ts` (`module: storyGeneration`, `storyId`) |
| Failure while persisting `generationError` | `error` | `src/services/storyGenerationService.ts` |
| `lastUsedAt` touch failure (fire-and-forget) | `error` | `src/services/apiKeyService.ts` |

Not logged: successful requests, `/api/health` probes, static assets, request
bodies, response payloads, credentials. Errors that never reach a `catch` block
are not logged by the application logger (Express may still print its own stack
trace to stderr).

## Log level

`LOG_LEVEL` is read from the environment (or `.env` in development):

| `NODE_ENV` | Default level |
|---|---|
| `production` | `info` |
| `development` or unset | `debug` |
| `test` | `silent` |

Valid values: `trace`, `debug`, `info`, `warn`, `error`, `fatal`, `silent`.
Invalid values fall back to the default instead of crashing the process.

In Helm, set the level through `app.logLevel` (rendered as the `LOG_LEVEL`
environment variable):

```bash
helm upgrade --install story-creator helm/story-creator \
  --set app.logLevel=debug
```

Production output is always JSON. In development only, `pino-pretty` renders
colourised single-line output; it is a dev dependency and is not installed in
the runtime image, so the logger falls back to JSON if it is missing.

## VictoriaLogs configuration

### How the data flows

1. The container writes JSON lines to stdout.
2. A node-level collector (vlagent, Fluent Bit, Vector, …) reads container logs.
3. The collector sends the JSON lines to VictoriaLogs and tells it which fields
   hold the message, timestamp, and stream labels.

Because pino uses standard names, VictoriaLogs needs these mappings:

| Purpose | Query parameter | Header equivalent | Value |
|---|---|---|---|
| Message | `_msg_field` | `VL-Msg-Field` | `msg` |
| Timestamp | `_time_field` | `VL-Time-Field` | `time` |
| Stream labels | `_stream_fields` | `VL-Stream-Fields` | container/pod/namespace fields |

Query parameters take precedence over headers.

### Option A — vlagent / victoria-logs-collector (no extra config)

If the cluster uses the VictoriaLogs collector (`victoria-logs-collector` Helm
chart, which deploys `vlagent` with `-kubernetesCollector`), **the defaults
already match this application**:

- `_msg` is taken from `message`, `msg`, or `log` (first match) — `msg` matches.
- `_time` is taken from `time`, `timestamp`, or `ts` — `time` matches.
- Stream fields default to
  `kubernetes.container_name,kubernetes.pod_name,kubernetes.pod_namespace`.

No collector overrides are required. To pin the mapping explicitly:

```text
-kubernetesCollector.msgField=msg
-kubernetesCollector.timeField=time
-kubernetesCollector.streamFields=kubernetes.container_name,kubernetes.pod_name,kubernetes.pod_namespace
```

The collector must still be pointed at VictoriaLogs, for example
`-remoteWrite.url=http://victoria-logs:9428/insert/native`.

### Option B — Fluent Bit

Fluent Bit must parse the container JSON and merge its fields to the top level.
With a `tail` input and the `kubernetes` filter, enable `Merge_Log On` and
`Keep_Log Off`; otherwise pino's fields stay inside `log` and `_msg_field=msg`
finds nothing.

```ini
[OUTPUT]
    Name              http
    Match             kube.*
    Host              victoria-logs.example.svc
    Port              9428
    URI               /insert/jsonline?_msg_field=msg,log&_time_field=time,date&_stream_fields=kubernetes.namespace_name,kubernetes.pod_name,kubernetes.container_name
    Format            json_lines
    Json_date_key     date
    Json_date_format  iso8601
    compress          gzip
    Retry_Limit       False
```

- `_msg_field=msg,log`: pino's `msg` is preferred; `log` is a fallback for lines
  that were not merged.
- `_time_field=time,date`: pino's ISO `time` is preferred; Fluent Bit's event
  time (`date`) is the fallback.
- Stream field names are Fluent Bit's Kubernetes metadata names
  (`kubernetes.namespace_name`, …). Adjust them if your filter renames keys.

### Option C — Vector

Vector's `kubernetes_logs` source puts the raw container line in `.message`; it
does not parse pino JSON automatically. Add a `remap` transform, then use the
HTTP sink with newline-delimited JSON:

```yaml
transforms:
  pino_json:
    type: remap
    inputs:
      - kubernetes_logs
    source: |
      parsed, err = parse_json(.message)
      if err == null && is_object(parsed) {
        . = merge(., parsed)
        del(.message)
      }

sinks:
  victorialogs:
    type: http
    inputs:
      - pino_json
    uri: http://victoria-logs:9428/insert/jsonline?_msg_field=msg,message&_time_field=time,timestamp&_stream_fields=kubernetes.pod_namespace,kubernetes.pod_name,kubernetes.container_name
    encoding:
      codec: json
    framing:
      method: newline_delimited
    compression: gzip
    healthcheck:
      enabled: false
```

- `_msg_field=msg,message`: pino's `msg` first, raw line as fallback.
- `_time_field=time,timestamp`: pino's ISO `time` first, Vector's event time
  (`timestamp`) as fallback.
- Stream field names follow Vector's Kubernetes enrichment
  (`kubernetes.pod_namespace`, …).

### Option D — manual verification

Send one record straight to the JSON line API with `debug=1` (parsed but not
stored; the record is written to the VictoriaLogs log instead):

```bash
curl -X POST \
  'http://victoria-logs:9428/insert/jsonline?_msg_field=msg&_time_field=time&_stream_fields=kubernetes.container_name,kubernetes.pod_name,kubernetes.pod_namespace&debug=1' \
  -H 'Content-Type: application/stream+json' \
  --data-binary @- <<'EOF'
{"level":"info","time":"2026-10-18T19:04:38.485Z","service":"story-creator","msg":"Server listening"}
EOF
```

To test ingestion end-to-end, remove `debug=1` and query
`level:info service:story-creator`.

### Stream fields and cardinality

Use only fields that identify the container instance, for example
`kubernetes.container_name`, `kubernetes.pod_name`, and
`kubernetes.pod_namespace`. Never add `req.id`, `storyId`, `apiKeyId`,
`level`, or `msg` to `_stream_fields`: high-cardinality fields create one stream
per value and degrade VictoriaLogs performance and storage.

### Queries

```logsql
level:error
service:story-creator level:error
storyId:"6710a1b2c3d4e5f60718293a"
req.id:"<value from the X-Request-Id response header>"
kubernetes.container_name:app level:error
```

`req.id`, `storyId`, and `module` are regular fields, so they are searchable
without stream filters. VictoriaLogs flattens nested JSON, so pino's `req.id`
is queryable as `req.id`.

### Troubleshooting

| Symptom | Likely cause | Fix |
|---|---|---|
| `_msg` is the whole JSON line, or the default `missing _msg field` text | Collector did not parse/merge the JSON | Fluent Bit: `Merge_Log On`, `Keep_Log Off`. Vector: add the `remap` transform |
| `_time` is the ingestion time, not the event time | `_time_field` missing or points at the wrong field | Set `_time_field=time` (or use the header `VL-Time-Field: time`) |
| `level` is numeric (`30`, `50`) | Container runs an old image | Deploy the current build; it emits string levels |
| No application records at all | Collector not shipping, wrong namespace/labels, or process exits before logging | Check collector status and `vl_rows_ingested_total`; use `debug=1` on the ingestion endpoint |
| ANSI colour codes in production logs | `NODE_ENV` is not `production` so `pino-pretty` was used | Set `NODE_ENV=production` (the Docker image already does) |
| Logs stop at pod shutdown | No SIGTERM flush handler (known limitation) | Tracked in [TODO.md](TODO.md#flush-logs-on-shutdown) |

## Local development

`npm run dev` loads `.env` and defaults to `debug` with `pino-pretty` output,
for example:

```text
[2026-10-18 19:04:38.520 +0000] INFO: Server listening {"service":"story-creator","port":3000}
```

Local pretty output is **not** representative of production; validate collector
configuration against the JSON output (`NODE_ENV=production node dist/server.js`
or the container image).

## Implementation notes

- Logger: `src/config/logger.ts` (`logger` singleton and `createLogger(module)`).
- Request ids and `req.log`: mounted in `src/server.ts` with
  `pino-http` and `autoLogging: false`.
- Never use `console.*` in backend code. The only exception is the CLI script
  `src/scripts/migrate-to-chapters.ts`, whose stdout is the command output.
  `console.*` under `src/client/` runs in the browser and never reaches
  VictoriaLogs.
- Always log errors as `{ err: error }` so pino serializes type, message, and
  stack. `{ error }` is not serialized specially.
