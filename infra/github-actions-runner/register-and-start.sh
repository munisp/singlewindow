#!/usr/bin/env bash
set -Eeuo pipefail

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
COMPOSE_FILE="${SCRIPT_DIR}/compose.yml"
RUNTIME_DIR="${SCRIPT_DIR}/.runtime"

usage() {
  cat <<'USAGE'
Usage:
  ./register-and-start.sh --repository OWNER/REPOSITORY [options]
  ./register-and-start.sh --organization ORGANIZATION [options]

Options:
  --name NAME          Runner name (default: singlewindow-ci-01)
  --labels LABELS      Additional runner labels (default: docker,singlewindow-ci)
  --arch ARCH          Runner image architecture: x64 or arm64 (default: x64)
  --version VERSION    actions/runner version (default: 2.336.0)
  --ephemeral          Register an isolated runner that accepts exactly one job
  -h, --help           Show this help text

The script requires Docker Compose v2 and an authenticated GitHub CLI with repository
administration access (or organization self-hosted-runner administration access).
USAGE
}

scope=""
target=""
runner_name="singlewindow-ci-01"
runner_labels="docker,singlewindow-ci"
runner_arch="x64"
runner_version="2.336.0"
ephemeral="false"

while [[ $# -gt 0 ]]; do
  case "$1" in
    --repository)
      [[ $# -ge 2 ]] || { usage >&2; exit 64; }
      scope="repository"; target="$2"; shift 2 ;;
    --organization)
      [[ $# -ge 2 ]] || { usage >&2; exit 64; }
      scope="organization"; target="$2"; shift 2 ;;
    --name)
      [[ $# -ge 2 ]] || { usage >&2; exit 64; }
      runner_name="$2"; shift 2 ;;
    --labels)
      [[ $# -ge 2 ]] || { usage >&2; exit 64; }
      runner_labels="$2"; shift 2 ;;
    --arch)
      [[ $# -ge 2 ]] || { usage >&2; exit 64; }
      runner_arch="$2"; shift 2 ;;
    --version)
      [[ $# -ge 2 ]] || { usage >&2; exit 64; }
      runner_version="$2"; shift 2 ;;
    --ephemeral)
      ephemeral="true"; shift ;;
    -h|--help)
      usage; exit 0 ;;
    *)
      echo "Unknown argument: $1" >&2; usage >&2; exit 64 ;;
  esac
done

[[ -n "${scope}" && -n "${target}" ]] || { usage >&2; exit 64; }
[[ "${runner_arch}" == "x64" || "${runner_arch}" == "arm64" ]] || { echo "--arch must be x64 or arm64" >&2; exit 64; }
command -v docker >/dev/null || { echo "Docker is required on the runner host." >&2; exit 69; }
docker compose version >/dev/null || { echo "Docker Compose v2 is required on the runner host." >&2; exit 69; }
command -v gh >/dev/null || { echo "GitHub CLI is required to mint the registration token." >&2; exit 69; }
gh auth status >/dev/null

case "${scope}" in
  repository)
    [[ "${target}" == */* ]] || { echo "--repository must be OWNER/REPOSITORY" >&2; exit 64; }
    registration_endpoint="repos/${target}/actions/runners/registration-token"
    runner_url="https://github.com/${target}"
    project_name="$(printf '%s' "${target}" | tr '/_' '-')-runner"
    ;;
  organization)
    registration_endpoint="orgs/${target}/actions/runners/registration-token"
    runner_url="https://github.com/${target}"
    project_name="${target}-runner"
    ;;
esac

prepare_token_file() {
  local token_file="$1"
  install --directory --mode=0700 "$(dirname "${token_file}")"
  umask 077
  gh api --method POST "${registration_endpoint}" --jq '.token' > "${token_file}"
  [[ -s "${token_file}" ]] || { echo "GitHub returned an empty registration token." >&2; exit 70; }
  chmod 600 "${token_file}"
}

export RUNNER_URL="${runner_url}"
export RUNNER_NAME="${runner_name}"
export RUNNER_LABELS="${runner_labels}"
export RUNNER_ARCH="${runner_arch}"
export RUNNER_VERSION="${runner_version}"
export RUNNER_EPHEMERAL="${ephemeral}"

if [[ "${ephemeral}" == "true" ]]; then
  secret_dir="$(mktemp --directory)"
  secret_file="${secret_dir}/registration-token"
  ephemeral_project_name="${project_name}-ephemeral-$(date +%s)"
  ephemeral_compose=(docker compose --project-name "${ephemeral_project_name}" --file "${COMPOSE_FILE}")
  cleanup_ephemeral() {
    local status="$?"
    trap - EXIT
    "${ephemeral_compose[@]}" down --volumes --remove-orphans >/dev/null 2>&1 || true
    rm -rf "${secret_dir}"
    exit "${status}"
  }
  trap cleanup_ephemeral EXIT
  prepare_token_file "${secret_file}"
  export RUNNER_REGISTRATION_TOKEN_FILE="${secret_file}"

  echo "Starting isolated ephemeral runner ${runner_name} for ${runner_url}. It will exit after one job."
  "${ephemeral_compose[@]}" run --rm runner
  exit 0
fi

runtime_file="${RUNTIME_DIR}/${project_name}-registration-token"
prepare_token_file "${runtime_file}"
export RUNNER_REGISTRATION_TOKEN_FILE="${runtime_file}"

cleanup_runtime_file() {
  # The bind mount must remain present for restart safety, but it no longer contains
  # a credential after config.sh has consumed the time-limited registration token.
  : > "${runtime_file}"
  chmod 600 "${runtime_file}"
}
trap cleanup_runtime_file EXIT

echo "Starting persistent runner ${runner_name} for ${runner_url}."
docker compose --project-name "${project_name}" --file "${COMPOSE_FILE}" up --build --detach --remove-orphans

container_id="$(docker compose --project-name "${project_name}" --file "${COMPOSE_FILE}" ps --quiet runner)"
[[ -n "${container_id}" ]] || { echo "Runner container did not start; inspect Docker Compose logs." >&2; exit 70; }

for _ in $(seq 1 30); do
  if docker exec "${container_id}" test -f /opt/actions-runner/.runner 2>/dev/null; then
    echo "Runner registration completed. Confirm it is idle in GitHub Actions runner settings before triggering CI."
    exit 0
  fi
  if [[ "$(docker inspect --format '{{.State.Running}}' "${container_id}" 2>/dev/null || true)" != "true" ]]; then
    docker compose --project-name "${project_name}" --file "${COMPOSE_FILE}" logs --tail=100 runner >&2 || true
    echo "Runner registration failed before creating its local configuration." >&2
    exit 70
  fi
  sleep 1
done

docker compose --project-name "${project_name}" --file "${COMPOSE_FILE}" logs --tail=100 runner >&2 || true
echo "Timed out waiting for runner registration." >&2
exit 70
