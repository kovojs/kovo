# G11: packed deploy journey on Google Cloud Run

Kovo's G11 release proof scaffolds an app from authenticated package tarballs, builds the generated
Node preset, deploys it to Google Cloud Run, and probes a public HTTPS URL. The implementation lives
in `.github/workflows/g11-cloud-run.yml` and `scripts/g11-cloud-run-journey.mjs`.

## Why every run gets a new service

Updating one Cloud Run service in place is not enough for Kovo's deploy-skew contract. A document
from the old revision would request its `/c/__v/...` module and `/_q/...` read from the new revision's
origin. Cloud Run revision retention alone does not route those requests back to the old app build.

The G11 journey therefore uses a version-addressed service:

```text
kovo-g11-<github-run-id>-<attempt>
```

That service is never updated after it receives public traffic. The public service URL, its exact
app build, immutable client files, and typed reads stay together for 26 hours. An hourly sweep probes
the public app and deletes the service only after the declared 24-hour floor has elapsed. A new
journey creates a new URL.

This is a bounded release probe, not a stable-domain production topology. Do not point a persistent
custom domain at a sequence of these services and keep the retention assertion. A stable production
origin needs an ingress that routes `Kovo-Build` to retained app builds and keeps every referenced
`/c/__v/...` representation available, or another reviewed serving layer with equivalent behavior.

## One-time Google Cloud setup

Use GitHub OIDC federation. Do not add a JSON service-account key to GitHub.

The selected Google Cloud project needs:

- the Cloud Run, Artifact Registry, IAM Credentials, and Security Token Service APIs enabled;
- one Docker Artifact Registry repository in the chosen region;
- one deploy service account with `roles/run.admin` on the project,
  `roles/artifactregistry.writer` on the repository, and `roles/iam.serviceAccountUser` on the
  runtime service account used by Cloud Run;
- one Workload Identity Pool provider whose attribute condition admits only
  `assertion.repository == 'kovojs/kovo'` and `assertion.ref == 'refs/heads/main'`;
- `roles/iam.workloadIdentityUser` on the deploy service account for that provider's exact
  repository principal; and
- an Artifact Registry lifecycle rule that retains G11 images for more than 24 hours and removes
  them later.

Create a protected GitHub environment named `g11-cloud-run`. Add these repository or environment
variables:

| Variable                                  | Example shape                                                               |
| ----------------------------------------- | --------------------------------------------------------------------------- |
| `KOVO_G11_GCP_PROJECT`                    | `kovo-devex`                                                                |
| `KOVO_G11_GCP_REGION`                     | `us-central1`                                                               |
| `KOVO_G11_GCP_ARTIFACT_REPOSITORY`        | `kovo-g11`                                                                  |
| `KOVO_G11_GCP_SERVICE_ACCOUNT`            | `kovo-g11-deployer@kovo-devex.iam.gserviceaccount.com`                      |
| `KOVO_G11_GCP_WORKLOAD_IDENTITY_PROVIDER` | `projects/123/locations/global/workloadIdentityPools/github/providers/kovo` |

The workflow generates Better Auth, CSRF, and runtime-attestation secrets for each service. It masks
them before writing the job-scoped environment and never uploads their environment files.

## Run the journey

Only `main` can deploy. The explicit confirmation prevents an accidental click from creating a
billable public service.

```sh
gh workflow run g11-cloud-run.yml --ref main -f confirm=DEPLOY_G11
gh run watch
```

The `kovo-g11-cloud-run-<service>` artifact contains:

- `kovo-g11-plan.json`, which binds the source SHA, unique service, and retention deadline; and
- `kovo-g11-proof.json`, which records Google Cloud Run as the host and proves HTTP 200 for
  `/api/health`, `/login`, and the emitted stylesheet without copying response bodies.

The scheduled sweep uploads its later endpoint digests before it deletes an expired service. If a
probe fails, it leaves the service in place and fails so the next run can inspect or retry it.

## Local contract checks

These checks do not claim a public deployment:

```sh
node --test scripts/g11-cloud-run-journey.test.mjs
git diff --check
```

An actual G11 release claim requires a successful manual workflow run and its public-URL proof
artifact. Repository-side tests alone are intentionally insufficient.
