#!/usr/bin/env bash
set -Eeuo pipefail

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
COMPOSE_FILE="${SCRIPT_DIR}/compose.yml"

usage() {
  cat <<'USAGE'
Usage:
  ./remove-and-stop.sh --repository OWNER/REPOSITORY [--name NAME]
  ./remove-and-stop.sh --organization ORGANIZATION [--name NAME]

Stops the local runner only after asking GitHub to de-register it. The script requires
Docker Compose v2 and an authenticated GitHub CLI with permission to remove the runner.
USAGE
}

scope=""
target=""
runner_name="singlewindow-ci-01"

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
    -h|--help)
      usage; exit 0 ;;
    *)
      echo "Unknown argument: $1" >&2; usage >&2; exit 64 ;;
  esac
done

[[ -n "${scope}" && -n "${target}" ]] || { usage >&2; exit 64; }
command -v docker >/dev/null || { echo "Docker is required on the runner host." >&2; exit 69; }
docker compose version >/dev/null || { echo "Docker Compose v2 is required on the runner host." >&2; exit 69; }
command -v gh >/dev/null || { echo "GitHub CLI is required to mint the removal token." >&2; exit 69; }
gh auth status >/dev/null

case "${scope}" in
  repository)
    [[ "${target}" == */* ]] || { echo "--repository must be OWNER/REPOSITORY" >&2; exit 64; }
    removal_endpoint="repos/${target}/actions/runners/remove-token"
    runner_url="https://github.com/${target}"
    project_name="$(printf '%s' "${target}" | tr '/_' '-')-runner"
    ;;
  organization)
    removal_endpoint="orgs/${target}/actions/runners/remove-token"
    runner_url="https://github.com/${target}"
    project_name="${target}-runner"
    ;;
esac

runtime_dir="${SCRIPT_DIR}/.runtime"
runtime_file="${runtime_dir}/${project_name}-registration-token"
install --directory --mode=0700 "${runtime_dir}"
touch "${runtime_file}"
chmod 600 "${runtime_file}"
export RUNNER_URL="${runner_url}"
export RUNNER_NAME="${runner_name}"
export RUNNER_REGISTRATION_TOKEN_FILE="${runtime_file}"

container_id="$(docker compose --project-name "${project_name}" --file "${COMPOSE_FILE}" ps --quiet runner)"
if [[ -z "${container_id}" ]]; then
  echo "No local runner container is active. Remove an offline runner from GitHub Actions settings if it remains listed." >&2
  exit 0
fi

secret_dir="$(mktemp --directory)"
secret_file="${secret_dir}/remove-token"
cleanup() {
  rm -rf "${secret_dir}"
}
trap cleanup EXIT
umask 077

gh api --method POST "${removal_endpoint}" --jq '.token' > "${secret_file}"
[[ -s "${secret_file}" ]] || { echo "GitHub returned an empty removal token." >&2; exit 70; }
chmod 600 "${secret_file}"

docker cp "${secret_file}" "${container_id}:/tmp/remove-token"
docker exec "${container_id}" /bin/bash -ceu '
  token="$(tr -d "\r\n" < /tmp/remove-token)"
  rm -f /tmp/remove-token
  gosu runner /opt/actions-runner/config.sh remove --unattended --token "$token"
'

docker compose --project-name "${project_name}" --file "${COMPOSE_FILE}" down --volumes --remove-orphans
echo "Runner ${runner_name} was de-registered and its local container state was removed."
