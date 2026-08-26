# Dedicated GitHub Actions Runner

This deployment package provides a **Docker-hosted, Linux self-hosted runner** for `munisp/singlewindow`. It is intended to bypass the observed hosted-runner provisioning failure by routing the existing service CI workflow to a runner controlled by the repository owner. The default deployment is persistent so that CI jobs can be scheduled whenever a pull request or push arrives; an explicit `--ephemeral` option is also available for one isolated job.

> **Security boundary.** The current CI workflow requires Docker service containers for PostgreSQL, Redis, and Toxiproxy. Mounting the host Docker socket gives jobs the ability to control the Docker host. Use this runner only for trusted code in a private repository, on a dedicated build machine with no production credentials or sensitive host data. GitHub makes the same private-repository recommendation for self-hosted runners because untrusted pull-request code can execute dangerous commands on the runner host. [1]

## Deployment choices

| Approach | Intended use | Trade-off | Setup complexity |
| --- | --- | --- | --- |
| **Persistent dedicated runner** | Recommended for the existing `services.yml` push and pull-request CI. It stays online and receives any matching job. | The workspace is reused between jobs; use a dedicated VM and trusted repository policy. | Moderate; one Docker host and a one-time registration. |
| **Ephemeral runner** | Manual dispatches, release checks, and security-sensitive one-job validation. Each invocation receives a separate Compose project and work volume that are removed after the job. | A new registration token and a new container are required for each job; queued jobs wait until the runner starts. | Moderate; use `--ephemeral` for each job. |
| **Managed scale set** | Teams with Kubernetes and concurrent CI demand. | More infrastructure and operational overhead than the one-runner package. | High; GitHub recommends Actions Runner Controller for Kubernetes scale sets. [2] |

The scripts target the first option because it directly restores the repository’s current CI. The host must be Linux with Docker: GitHub requires Linux plus Docker for workflows that use Docker container actions or service containers. [2]

## Contents

| File | Purpose |
| --- | --- |
| `Dockerfile` | Ubuntu 24.04 runner image with Docker CLI/daemon client, Git, Python, OpenSSL, and a checksum-verified `actions/runner` release. |
| `entrypoint.sh` | Registers a runner on first start, maps the Docker socket group, and starts `run.sh` as a non-root `runner` user. |
| `compose.yml` | Persistent runner definition with host networking, a named work volume, a Docker-socket mount, capability reduction, and a read-only runtime token-file mount. |
| `register-and-start.sh` | Obtains a fresh registration token from GitHub at runtime and starts the selected deployment mode. |
| `remove-and-stop.sh` | Obtains a fresh removal token, deregisters the runner, stops the container, and removes local runner data. |

## Prerequisites

The runner host needs Docker Engine, Docker Compose v2, a shell, and the GitHub CLI (`gh`). The command used to register must be authenticated as an account with repository administration access for a repository runner, or organization self-hosted-runner administration access for an organization runner. The registration token is minted only when the script executes. Persistent mode writes it to an owner-only runtime file only long enough to complete first registration, then truncates that file while retaining the empty bind-mount placeholder required for safe container restarts. GitHub registration tokens expire after one hour. [1]

The host needs outbound HTTPS access to GitHub Actions. At minimum, permit `github.com`, `api.github.com`, and `*.actions.githubusercontent.com`; artifact, cache, action-download, and runner-update domains are also required for complete workflow operation. GitHub maintains the authoritative domain list. [2]

The Compose deployment deliberately uses Linux host networking. GitHub Actions service containers in `services.yml` publish PostgreSQL and Redis ports on the Docker host, while the repository’s test process uses `localhost`. Host networking preserves that existing `DATABASE_URL` and lets the runner reach the test PostgreSQL container at `localhost:5432`; a bridge-networked runner would instead resolve its own container loopback and see database-unavailable failures. Do not use this deployment mode on a shared or untrusted host.

## Start the persistent repository runner

Run the following on the dedicated Linux build host, from this directory. The registration script validates the inputs, obtains a new token from GitHub, builds the image, and starts a persistent runner named `singlewindow-ci-01`.

```bash
cd infra/github-actions-runner
chmod 0755 register-and-start.sh remove-and-stop.sh entrypoint.sh
./register-and-start.sh \
  --repository munisp/singlewindow \
  --name singlewindow-ci-01 \
  --labels docker,singlewindow-ci
```

The runner should appear as **Idle** under the repository’s **Settings → Actions → Runners** page. GitHub routes a job only when an online, idle runner matches every requested label. [2]

For an organization runner, replace the repository target with the organization target:

```bash
./register-and-start.sh \
  --organization munisp \
  --name singlewindow-ci-01 \
  --labels docker,singlewindow-ci
```

GitHub automatically adds the standard `self-hosted`, operating-system, and architecture labels to a registered runner. The deployment script adds the two workload-specific labels, `docker` and `singlewindow-ci`.

## Route the current CI workflow

After the runner is visible and idle, update every service CI job in `.github/workflows/services.yml` from:

```yaml
runs-on: ubuntu-latest
```

To:

```yaml
runs-on: [self-hosted, linux, x64, docker, singlewindow-ci]
```

The current workflow has eight hosted-runner job declarations. They should be changed together so that the change-classifier, TypeScript/PostgreSQL, Redis/Toxiproxy, Go, Rust, JWS, and worker checks all use the same dedicated runner pool. The `x64` label is correct for the default image. For an ARM64 host, build with `--arch arm64` and change the workflow’s architecture label to `arm64`.

Once the workflow change is pushed, invoke **Run workflow** or push a qualifying change. The runner must stay online; a job with no matching runner remains queued and will ultimately fail after GitHub’s queue timeout. [2]

## Run one isolated job

Use ephemeral mode for a manually triggered workflow validation or a sensitive release check. GitHub automatically de-registers an ephemeral runner after one completed job. [2]

```bash
./register-and-start.sh \
  --repository munisp/singlewindow \
  --name singlewindow-adhoc-01 \
  --labels docker,singlewindow-ci \
  --ephemeral
```

The startup script assigns every ephemeral invocation a unique Compose project. The container exits after its job, and the script removes that project’s workspace volume during cleanup; neither the runner configuration nor its workspace is reused by the next ephemeral invocation. Forward runner logs to durable storage before adopting high-volume ephemeral operation, as GitHub recommends. [2]

## Operational controls

| Control | Required practice |
| --- | --- |
| Repository trust | Do not expose this Docker-socket runner to public forks or unreviewed, untrusted workflows. Keep it repository-scoped or limit the organization runner group to approved private repositories. [1] |
| Host isolation | Use a dedicated Linux VM or build host. Host networking and Docker-socket access make this stronger than a normal container trust boundary; do not place cloud credentials, database backups, SSH keys, production kubeconfigs, or developer home directories on it. |
| Secrets | The scripts obtain short-lived registration/removal tokens at runtime. Never place a token in Git, a Compose file, shell history, or process arguments. |
| Image updates | The image intentionally uses `--disableupdate` to preserve the checksum-verified runner binary. Update `RUNNER_VERSION` and the matching SHA-256 build arguments in the Dockerfile whenever `actions/runner` releases an update. GitHub requires a disabled-update runner to be updated within 30 days of a new release, and can stop queueing jobs for old or security-critical versions. [2] |
| Monitoring | Watch `docker compose logs -f runner` and the GitHub Runners page. Treat unexpected containers, jobs, or runner labels as a security incident. |
| Capacity | One runner accepts one job at a time. Add isolated runner hosts or move to a scale set if the queue becomes material. [2] |

## Stop and de-register

The removal script asks GitHub for a one-time removal token before stopping the container. Run it on the same host where the runner is active.

```bash
./remove-and-stop.sh \
  --repository munisp/singlewindow \
  --name singlewindow-ci-01
```

If the host is already unavailable, use **Force remove** in the GitHub Runners settings page to clear the stale GitHub-side record. [3]

## References

[1]: https://docs.github.com/actions/hosting-your-own-runners/adding-self-hosted-runners "GitHub Docs: Adding self-hosted runners"
[2]: https://docs.github.com/en/actions/reference/runners/self-hosted-runners "GitHub Docs: Self-hosted runners reference"
[3]: https://docs.github.com/actions/hosting-your-own-runners/removing-self-hosted-runners "GitHub Docs: Removing self-hosted runners"
