# syntax=docker/dockerfile:1.7
# Dedicated, ephemeral GitHub Actions runner for munisp/singlewindow.
# Runner packages are verified using the SHA-256 digests published with the release.
FROM ubuntu:24.04

ARG RUNNER_VERSION=2.336.0
ARG RUNNER_ARCH=x64
ARG RUNNER_SHA256_X64=04cf0be1aff4c3ec3554466c39124ca250e3effd8873bb7e8d68535aa9505d5d
ARG RUNNER_SHA256_ARM64=58b758e420b87093fbd4bfddd368074960053e2f1388f01848c82624b90f27d1

ENV DEBIAN_FRONTEND=noninteractive \
    RUNNER_HOME=/opt/actions-runner \
    RUNNER_WORKDIR=/runner/_work

RUN apt-get update \
    && apt-get install --no-install-recommends -y \
      bash \
      ca-certificates \
      curl \
      docker.io \
      docker-compose-v2 \
      dumb-init \
      git \
      gosu \
      jq \
      make \
      openssh-client \
      openssl \
      python3 \
      python3-pip \
      tar \
      unzip \
    && rm -rf /var/lib/apt/lists/*

RUN groupadd --gid 1001 runner \
    && useradd --uid 1001 --gid runner --create-home --shell /bin/bash runner \
    && install --directory --owner=runner --group=runner --mode=0755 "${RUNNER_HOME}" "${RUNNER_WORKDIR}"

RUN set -eux; \
    case "${RUNNER_ARCH}" in \
      x64) runner_sha256="${RUNNER_SHA256_X64}" ;; \
      arm64) runner_sha256="${RUNNER_SHA256_ARM64}" ;; \
      *) echo "Unsupported RUNNER_ARCH: ${RUNNER_ARCH}. Use x64 or arm64." >&2; exit 1 ;; \
    esac; \
    archive="actions-runner-linux-${RUNNER_ARCH}-${RUNNER_VERSION}.tar.gz"; \
    curl --fail --location --retry 3 --retry-connrefused \
      --output "/tmp/${archive}" \
      "https://github.com/actions/runner/releases/download/v${RUNNER_VERSION}/${archive}"; \
    echo "${runner_sha256}  /tmp/${archive}" | sha256sum --check --strict; \
    tar --extract --gzip --file "/tmp/${archive}" --directory "${RUNNER_HOME}"; \
    rm "/tmp/${archive}"; \
    "${RUNNER_HOME}/bin/installdependencies.sh"; \
    rm -rf /var/lib/apt/lists/*; \
    chown -R runner:runner "${RUNNER_HOME}"

COPY --chmod=0755 entrypoint.sh /usr/local/bin/runner-entrypoint

WORKDIR /opt/actions-runner
ENTRYPOINT ["/usr/bin/dumb-init", "--", "/usr/local/bin/runner-entrypoint"]
