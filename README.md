# conflict-exo-dash

A NASA Exoplanet Archive dashboard, and the cheapest shape an Astrolift app can
take: **one `deployment` workload, no managed services, no state.**

The dataset is a SQLite file compiled from a vendored CSV at image-build time,
so the running pod costs nothing but its own CPU and memory request, and the
in-cluster build never has to reach the public internet.

## Topology

| | |
|---|---|
| Workloads | `web` (`deployment`, public, 1 replica) |
| Managed services | none |
| Storage | SQLite, baked into the image |
| Request / limit | 100m–500m CPU, 128Mi–256Mi memory |

## Endpoints

| Path | Purpose |
|---|---|
| `/` | The dashboard |
| `/health` | Readiness and liveness probe target |
| `/debug` | Pod identity, uptime, non-secret env keys, binding presence, dataset size |
| `/selftest` | Exercises every attached dependency and reports per-service `{ok, latency_ms, error}` |
| `/api/summary`, `/api/by-year`, `/api/by-method`, `/api/scatter`, `/api/nearest` | Chart data |

`/selftest` reporting only the baked SQLite check is the **expected** result
here — this app attaches no managed services on purpose. The same code reports
real per-service results in the fixtures that do bind them.

## Deploying

The platform takes the repo and does the cloud work — it creates the ECR
repository, mints the build and runtime roles, builds the image in-cluster with
Kaniko, and rolls it out. There is no CI to configure and nothing to build
locally.

```sh
astro app register --project-id <demos-project-guid> \
  --source-repo ConflictHQ/conflict-exo-dash
astro app deploy --wait
```

## Refreshing the dataset

```sh
curl -sSG https://exoplanetarchive.ipac.caltech.edu/TAP/sync \
  --data-urlencode "query=select pl_name,hostname,discoverymethod,disc_year,disc_facility,pl_orbper,pl_rade,pl_bmasse,pl_eqt,st_teff,st_rad,st_mass,sy_dist from pscomppars" \
  --data-urlencode "format=csv" -o data/exoplanets.csv
python3 build_db.py   # local sanity check; the image build runs this itself
```

## Charts

Colors are not chosen by eye. The categorical set and the sequential ramp were
both run through the palette validator against the `#0A0A0A` panel surface and
pass every check — lightness band, chroma floor, colorblind separation,
normal-vision separation, and contrast. Charts are hand-rolled inline SVG: a
private install should not have to reach a CDN to render its own dashboard.

Data: [NASA Exoplanet Archive](https://exoplanetarchive.ipac.caltech.edu/),
which is operated by Caltech under contract with NASA.
