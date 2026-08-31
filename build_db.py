"""Build the SQLite dataset at image-build time.

The CSV is vendored in the repo so the in-cluster Kaniko build is hermetic —
it never reaches the public internet. Re-run locally to refresh the snapshot:

    curl -sSG https://exoplanetarchive.ipac.caltech.edu/TAP/sync \
      --data-urlencode "query=select pl_name,hostname,discoverymethod,disc_year,disc_facility,pl_orbper,pl_rade,pl_bmasse,pl_eqt,st_teff,st_rad,st_mass,sy_dist from pscomppars" \
      --data-urlencode "format=csv" -o data/exoplanets.csv
"""

import csv
import os
import sqlite3
import sys

SRC = os.path.join(os.path.dirname(__file__), "data", "exoplanets.csv")
DST = os.path.join(os.path.dirname(__file__), "exoplanets.db")

NUMERIC = {
    "disc_year", "pl_orbper", "pl_rade", "pl_bmasse",
    "pl_eqt", "st_teff", "st_rad", "st_mass", "sy_dist",
}


def num(value):
    """CSV blanks and sentinels become NULL rather than 0.0."""
    value = (value or "").strip()
    if not value:
        return None
    try:
        return float(value)
    except ValueError:
        return None


def main():
    if os.path.exists(DST):
        os.remove(DST)
    db = sqlite3.connect(DST)
    db.execute(
        """
        CREATE TABLE planets (
            pl_name TEXT PRIMARY KEY, hostname TEXT, discoverymethod TEXT,
            disc_year INTEGER, disc_facility TEXT, pl_orbper REAL,
            pl_rade REAL, pl_bmasse REAL, pl_eqt REAL,
            st_teff REAL, st_rad REAL, st_mass REAL, sy_dist REAL
        )
        """
    )
    with open(SRC, newline="", encoding="utf-8") as fh:
        rows = []
        for row in csv.DictReader(fh):
            rows.append(
                tuple(
                    num(row.get(col)) if col in NUMERIC else (row.get(col) or "").strip()
                    for col in (
                        "pl_name", "hostname", "discoverymethod", "disc_year",
                        "disc_facility", "pl_orbper", "pl_rade", "pl_bmasse",
                        "pl_eqt", "st_teff", "st_rad", "st_mass", "sy_dist",
                    )
                )
            )
    # INSERT OR IGNORE: pscomppars is one row per planet, but a re-pull that
    # overlaps a name would otherwise abort the whole build.
    db.executemany(
        "INSERT OR IGNORE INTO planets VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)", rows
    )
    db.execute("CREATE INDEX idx_year ON planets(disc_year)")
    db.execute("CREATE INDEX idx_method ON planets(discoverymethod)")
    db.execute("CREATE INDEX idx_dist ON planets(sy_dist)")
    db.commit()
    count = db.execute("SELECT count(*) FROM planets").fetchone()[0]
    db.close()
    print(f"built {DST}: {count} planets", file=sys.stderr)
    if count < 1000:
        raise SystemExit(f"refusing to ship a suspiciously small dataset ({count})")


if __name__ == "__main__":
    main()
