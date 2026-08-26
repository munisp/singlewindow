#!/usr/bin/env bash
set -Eeuo pipefail

RUNNER_HOME="${RUNNER_HOME:-/opt/actions-runner}"
RUNNER_WORKDIR="${RUNNER_WORKDIR:-/runner/_work}"
RUNNER_USER="${RUNNER_USER:-runner}"
RUNNER_LABELS="${RUNNER_LABELS:-docker,singlewindow-ci}"
DOCKER_SOCKET="${DOCKER_SOCKET:-/var/run/docker.sock}"
REQUIRE_DOCKER="${REQUIRE_DOCKER:-true}"
RUNNER_EPHEMERAL="${RUNNER_EPHEMERAL:-false}"
RUNNER_NAME="${RUNNER_NAME:-singlewindow-${HOSTNAME}}"

fail() {
  echo "runner-entrypoint: $*" >&2
  exit 64
}

read_registration_token() {
  local value="${RUNNER_TOKEN:-}"
  local secret_file="${RUNNER_TOKEN_FILE:-}"

  if [[ -n "${value}" && -n "${secret_file}" ]]; then
    fail "Set exactly one of RUNNER_TOKEN or RUNNER_TOKEN_FILE; prefer RUNNER_TOKEN_FILE."
  fi
  if [[ -n "${secret_file}" ]]; then
    [[ -r "${secret_file}" ]] || fail "RUNNER_TOKEN_FILE is not readable: ${secret_file}"
    value="$(tr -d '\r\n' < "${secret_file}")"
  fi
  [[ -n "${value}" ]] || fail "A time-limited registration token is required for the first start through RUNNER_TOKEN_FILE or RUNNER_TOKEN."
  printf '%s' "${value}"
}

configure_docker_access() {
  if [[ ! -S "${DOCKER_SOCKET}" ]]; then
    if [[ "${REQUIRE_DOCKER}" == "true" ]]; then
      fail "Docker socket is required at ${DOCKER_SOCKET}; mount the host socket for service-container workflows."
    fi
    return
  fi

  local socket_gid group_name
  socket_gid="$(stat --format='%g' "${DOCKER_SOCKET}")"
  group_name="$(getent group "${socket_gid}" | cut --delimiter=: --fields=1 || true)"
  if [[ -z "${group_name}" ]]; then
    group_name="docker-host"
    groupadd --gid "${socket_gid}" "${group_name}"
  fi
  usermod --append --groups "${group_name}" "${RUNNER_USER}"
}

case "${RUNNER_EPHEMERAL}" in
  true|false) ;;
  *) fail "RUNNER_EPHEMERAL must be true or false." ;;
esac

configure_docker_access
install --directory --owner="${RUNNER_USER}" --group="${RUNNER_USER}" --mode=0755 "${RUNNER_WORKDIR}"

if [[ ! -f "${RUNNER_HOME}/.runner" ]]; then
  : "${RUNNER_URL:?RUNNER_URL must be a repository or organization URL, for example https://github.com/munisp/singlewindow}"
  registration_token="$(read_registration_token)"
  config_args=(
    --unattended
    --url "${RUNNER_URL}"
    --token "${registration_token}"
    --name "${RUNNER_NAME}"
    --labels "${RUNNER_LABELS}"
    --work "${RUNNER_WORKDIR}"
    --disableupdate
  )
  if [[ "${RUNNER_EPHEMERAL}" == "true" ]]; then
    config_args+=(--ephemeral)
  fi

  gosu "${RUNNER_USER}" "${RUNNER_HOME}/config.sh" "${config_args[@]}"
  unset RUNNER_TOKEN registration_token
else
  echo "runner-entrypoint: existing runner configuration found; starting ${RUNNER_NAME} without reading a registration token."
fi

if [[ "${RUNNER_EPHEMERAL}" == "true" ]]; then
  echo "runner-entrypoint: ${RUNNER_NAME} is ephemeral and will stop after one job."
else
  echo "runner-entrypoint: ${RUNNER_NAME} is persistent and ready for jobs."
fi

exec gosu "${RUNNER_USER}" "${RUNNER_HOME}/run.sh"
