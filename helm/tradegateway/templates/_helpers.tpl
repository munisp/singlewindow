{{/*
TradeGateway™ NGSWTP — Helm Chart Template Helpers
*/}}

{{/*
Expand the name of the chart.
*/}}
{{- define "tradegateway.name" -}}
{{- default .Chart.Name .Values.nameOverride | trunc 63 | trimSuffix "-" }}
{{- end }}

{{/*
Create a default fully qualified app name.
We truncate at 63 chars because some Kubernetes name fields are limited to this.
*/}}
{{- define "tradegateway.fullname" -}}
{{- if .Values.fullnameOverride }}
{{- .Values.fullnameOverride | trunc 63 | trimSuffix "-" }}
{{- else }}
{{- $name := default .Chart.Name .Values.nameOverride }}
{{- if contains $name .Release.Name }}
{{- .Release.Name | trunc 63 | trimSuffix "-" }}
{{- else }}
{{- printf "%s-%s" .Release.Name $name | trunc 63 | trimSuffix "-" }}
{{- end }}
{{- end }}
{{- end }}

{{/*
Create chart name and version as used by the chart label.
*/}}
{{- define "tradegateway.chart" -}}
{{- printf "%s-%s" .Chart.Name .Chart.Version | replace "+" "_" | trunc 63 | trimSuffix "-" }}
{{- end }}

{{/*
Common labels applied to all resources.
*/}}
{{- define "tradegateway.labels" -}}
helm.sh/chart: {{ include "tradegateway.chart" . }}
{{ include "tradegateway.selectorLabels" . }}
{{- if .Chart.AppVersion }}
app.kubernetes.io/version: {{ .Chart.AppVersion | quote }}
{{- end }}
app.kubernetes.io/managed-by: {{ .Release.Service }}
app.kubernetes.io/part-of: tradegateway
{{- end }}

{{/*
Selector labels used for Deployment/Service matching.
*/}}
{{- define "tradegateway.selectorLabels" -}}
app.kubernetes.io/name: {{ include "tradegateway.name" . }}
app.kubernetes.io/instance: {{ .Release.Name }}
{{- end }}

{{/*
Service-specific labels (pass service name as .component).
*/}}
{{- define "tradegateway.componentLabels" -}}
app.kubernetes.io/component: {{ .component }}
app.kubernetes.io/name: {{ printf "%s-%s" (include "tradegateway.name" .root) .component }}
app.kubernetes.io/instance: {{ .root.Release.Name }}
{{- end }}

{{/*
Create the name of the service account to use.
*/}}
{{- define "tradegateway.serviceAccountName" -}}
{{- if .Values.serviceAccount.create }}
{{- default (include "tradegateway.fullname" .) .Values.serviceAccount.name }}
{{- else }}
{{- default "default" .Values.serviceAccount.name }}
{{- end }}
{{- end }}

{{/*
PostgreSQL connection string helper.
*/}}
{{- define "tradegateway.postgresUrl" -}}
{{- $host := printf "%s-postgresql" .Release.Name }}
{{- printf "postgresql://%s:$(POSTGRES_PASSWORD)@%s:5432/%s" .Values.postgresql.auth.username $host .Values.postgresql.auth.database }}
{{- end }}

{{/*
Redis connection string helper.
*/}}
{{- define "tradegateway.redisUrl" -}}
{{- $host := printf "%s-redis-master" .Release.Name }}
{{- printf "redis://:$(REDIS_PASSWORD)@%s:6379" $host }}
{{- end }}

{{/*
Kafka bootstrap servers helper.
*/}}
{{- define "tradegateway.kafkaBrokers" -}}
{{- $host := printf "%s-kafka" .Release.Name }}
{{- printf "%s:29092" $host }}
{{- end }}

{{/*
Keycloak base URL helper.
*/}}
{{- define "tradegateway.keycloakUrl" -}}
{{- $host := printf "%s-keycloak" .Release.Name }}
{{- printf "http://%s:8080" $host }}
{{- end }}

{{/*
Permify gRPC endpoint helper.
*/}}
{{- define "tradegateway.permifyGrpc" -}}
{{- $host := printf "%s-permify" .Release.Name }}
{{- printf "%s:3478" $host }}
{{- end }}

{{/*
OpenSearch URL helper.
*/}}
{{- define "tradegateway.opensearchUrl" -}}
{{- $host := printf "%s-opensearch" .Release.Name }}
{{- printf "http://%s:9200" $host }}
{{- end }}
