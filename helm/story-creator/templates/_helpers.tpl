{{/*
Expand the name of the chart.
*/}}
{{- define "story-creator.name" -}}
{{- default .Chart.Name .Values.nameOverride | trunc 63 | trimSuffix "-" }}
{{- end }}

{{/*
Common labels
*/}}
{{- define "story-creator.labels" -}}
helm.sh/chart: {{ .Chart.Name }}-{{ .Chart.Version }}
{{ include "story-creator.selectorLabels" . }}
app.kubernetes.io/managed-by: {{ .Release.Service }}
{{- end }}

{{/*
Selector labels
*/}}
{{- define "story-creator.selectorLabels" -}}
app.kubernetes.io/name: {{ include "story-creator.name" . }}
app.kubernetes.io/instance: {{ .Release.Name }}
{{- end }}
