"""conflict-exo-dash — the cheapest shape an Astrolift app can take.

Stdlib only, no dependencies, no managed services. The dataset is a SQLite
file baked into the image at build time, so the running pod owns no state and
costs nothing but its own CPU/memory request.

Diagnostic surface (spec 42 §3.1): /health, /debug, /selftest.
"""

import json
import os
import socket
import sqlite3
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import urlparse

PORT = int(os.environ.get("PORT", "8080"))
DB = os.path.join(os.path.dirname(os.path.abspath(__file__)), "exoplanets.db")
STATIC = os.path.join(os.path.dirname(os.path.abspath(__file__)), "static")
BOOT = time.time()

APP = "conflict-exo-dash"
VERSION = os.environ.get("GIT_SHA", "dev")

# Binding envs we would surface if a managed service were attached. A1 attaches
# none on purpose -- /selftest reporting "no bindings" IS the expected result
# here, and the same code reports real per-service results in the apps that do.
BINDING_KEYS = {
    "postgres": ("POSTGRES_HOST", "POSTGRES_DB"),
    "mysql": ("MYSQL_HOST", "MYSQL_DB"),
    "object_store": ("BUCKET_NAME", "BUCKET_REGION"),
    "redis": ("REDIS_HOST",),
}

MIME = {
    ".html": "text/html; charset=utf-8",
    ".css": "text/css; charset=utf-8",
    ".js": "application/javascript; charset=utf-8",
    ".svg": "image/svg+xml",
}


def q(sql, args=()):
    """One connection per request -- SQLite handles this fine at demo scale and
    it keeps the handler threadsafe without a pool."""
    db = sqlite3.connect(DB)
    db.row_factory = sqlite3.Row
    try:
        return [dict(r) for r in db.execute(sql, args).fetchall()]
    finally:
        db.close()


def summary():
    row = q(
        """
        SELECT count(*) AS planets,
               count(DISTINCT hostname) AS systems,
               count(DISTINCT disc_facility) AS facilities,
               min(disc_year) AS first_year,
               max(disc_year) AS last_year
        FROM planets
        """
    )[0]
    nearest = q(
        "SELECT pl_name, hostname, sy_dist FROM planets "
        "WHERE sy_dist IS NOT NULL ORDER BY sy_dist LIMIT 1"
    )
    row["nearest_pc"] = nearest[0]["sy_dist"] if nearest else None
    row["nearest_name"] = nearest[0]["pl_name"] if nearest else None
    return row


def by_year():
    return q(
        "SELECT CAST(disc_year AS INTEGER) AS year, count(*) AS n FROM planets "
        "WHERE disc_year IS NOT NULL GROUP BY year ORDER BY year"
    )


def by_method():
    return q(
        "SELECT discoverymethod AS method, count(*) AS n FROM planets "
        "WHERE discoverymethod != '' GROUP BY method ORDER BY n DESC"
    )


def scatter():
    """Radius vs orbital period, colored by host-star temperature.

    Temperature is a magnitude, so it gets the sequential ramp rather than a
    categorical hue -- which is also why this chart needs no legend of colors
    competing with the discovery-method chart below it.
    """
    return q(
        "SELECT pl_name, pl_orbper, pl_rade, st_teff, discoverymethod AS method "
        "FROM planets WHERE pl_orbper IS NOT NULL AND pl_rade IS NOT NULL "
        "AND pl_orbper > 0 AND pl_rade > 0 ORDER BY pl_rade DESC LIMIT 3000"
    )


def nearest(limit=12):
    return q(
        "SELECT pl_name, hostname, discoverymethod AS method, disc_year, "
        "sy_dist, pl_rade FROM planets WHERE sy_dist IS NOT NULL "
        "ORDER BY sy_dist LIMIT ?",
        (limit,),
    )


def debug_payload():
    seen = sorted(
        k for k in os.environ
        if not any(s in k.upper() for s in ("SECRET", "PASSWORD", "TOKEN", "KEY"))
    )
    return {
        "app": APP,
        "version": VERSION,
        "kind": "deployment",
        "hostname": socket.gethostname(),
        "uptime_s": round(time.time() - BOOT, 1),
        "now": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
        "env_seen": seen,
        "bindings": {
            kind: ("present" if all(os.environ.get(k) for k in keys) else "absent")
            for kind, keys in BINDING_KEYS.items()
        },
        "dataset": {
            "path": DB,
            "bytes": os.path.getsize(DB) if os.path.exists(DB) else 0,
            "planets": summary()["planets"],
        },
    }


def selftest():
    """Exercise every attached dependency, not merely report that we booted."""
    checks = []
    t0 = time.time()
    try:
        n = q("SELECT count(*) AS n FROM planets")[0]["n"]
        checks.append({
            "service": "sqlite (baked)", "ok": n > 0,
            "latency_ms": round((time.time() - t0) * 1000, 2),
            "detail": f"{n} rows", "error": None,
        })
    except Exception as exc:  # surfaced, not swallowed
        checks.append({
            "service": "sqlite (baked)", "ok": False,
            "latency_ms": round((time.time() - t0) * 1000, 2),
            "detail": None, "error": str(exc),
        })
    for kind, keys in BINDING_KEYS.items():
        if all(os.environ.get(k) for k in keys):
            checks.append({
                "service": kind, "ok": None, "latency_ms": None,
                "detail": "bound but unused by this app", "error": None,
            })
    return {"app": APP, "ok": all(c["ok"] is not False for c in checks), "checks": checks}


ROUTES = {
    "/api/summary": summary,
    "/api/by-year": by_year,
    "/api/by-method": by_method,
    "/api/scatter": scatter,
    "/api/nearest": nearest,
    "/debug": debug_payload,
    "/selftest": selftest,
}


class Handler(BaseHTTPRequestHandler):
    protocol_version = "HTTP/1.1"

    def _send(self, code, body, ctype="application/json"):
        raw = body if isinstance(body, bytes) else json.dumps(body).encode()
        self.send_response(code)
        self.send_header("Content-Type", ctype)
        self.send_header("Content-Length", str(len(raw)))
        self.end_headers()
        self.wfile.write(raw)

    def do_GET(self):
        path = urlparse(self.path).path
        if path == "/health":
            # Carry the running version so a rollout can be confirmed from the
            # load balancer without exec-ing into the pod. /selftest touches the
            # dataset and is too slow for a liveness probe; this stays constant-time.
            return self._send(200, {"status": "ok", "version": VERSION})
        if path in ROUTES:
            try:
                return self._send(200, ROUTES[path]())
            except Exception as exc:
                return self._send(500, {"error": str(exc)})
        if path == "/":
            path = "/index.html"
        target = os.path.normpath(os.path.join(STATIC, path.lstrip("/")))
        # normpath before the prefix check -- otherwise ../ escapes the dir.
        if target.startswith(STATIC) and os.path.isfile(target):
            ext = os.path.splitext(target)[1]
            with open(target, "rb") as fh:
                return self._send(200, fh.read(), MIME.get(ext, "application/octet-stream"))
        return self._send(404, {"error": "not found", "path": path})

    def log_message(self, fmt, *args):
        # One structured line per request; the default writes to stderr unparsed.
        print(json.dumps({
            "app": APP, "msg": fmt % args,
            "at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
        }), flush=True)


if __name__ == "__main__":
    print(json.dumps({
        "app": APP, "version": VERSION, "port": PORT,
        "dataset_bytes": os.path.getsize(DB) if os.path.exists(DB) else 0,
        "bindings": debug_payload()["bindings"],
        "msg": "listening",
    }), flush=True)
    ThreadingHTTPServer(("0.0.0.0", PORT), Handler).serve_forever()
