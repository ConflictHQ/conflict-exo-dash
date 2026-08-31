/* Charts are hand-rolled inline SVG on purpose: a BYOC install should not have
   to reach a CDN to render its own dashboard. No dependencies, no network calls
   beyond this app's own API. */
"use strict";

const SEQ = ["#405d02", "#547a02", "#699700", "#80b508", "#96d507"];
const LEAD = "#8FD82A";
const tip = document.getElementById("tip");

const fmt = (n, d = 0) =>
  n === null || n === undefined || Number.isNaN(n)
    ? "—"
    : Number(n).toLocaleString(undefined, { minimumFractionDigits: d, maximumFractionDigits: d });

const el = (tag, attrs = {}, kids = []) => {
  const node = document.createElementNS("http://www.w3.org/2000/svg", tag);
  for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, v);
  for (const kid of [].concat(kids)) node.appendChild(kid);
  return node;
};

function showTip(evt, html) {
  tip.innerHTML = html;
  tip.classList.add("on");
  // Flip before the right/bottom edge rather than letting the panel clip it.
  const pad = 14;
  const r = tip.getBoundingClientRect();
  let x = evt.clientX + pad;
  let y = evt.clientY + pad;
  if (x + r.width > window.innerWidth - 8) x = evt.clientX - r.width - pad;
  if (y + r.height > window.innerHeight - 8) y = evt.clientY - r.height - pad;
  tip.style.left = `${x}px`;
  tip.style.top = `${y}px`;
}
const hideTip = () => tip.classList.remove("on");

/** A bar with rounded top corners, square-anchored to the baseline. */
function barPath(x, y, w, h, r) {
  const rr = Math.max(0, Math.min(r, w / 2, h));
  return `M${x},${y + h}V${y + rr}a${rr},${rr} 0 0 1 ${rr},${-rr}h${w - 2 * rr}a${rr},${rr} 0 0 1 ${rr},${rr}V${y + h}Z`;
}

/** Round a raw max up to a readable tick step (1/2/5 x 10^n). */
function niceTicks(max, count = 4) {
  const raw = max / count;
  const mag = 10 ** Math.floor(Math.log10(raw));
  const step = [1, 2, 2.5, 5, 10].map((m) => m * mag).find((s) => s >= raw) || 10 * mag;
  const out = [];
  for (let v = 0; v <= max + step * 0.001; v += step) out.push(v);
  return { ticks: out, top: out[out.length - 1] };
}

/* ---------- vertical bars: planets per discovery year ---------- */
function chartYear(host, rows) {
  const W = 1000, H = 300, m = { t: 14, r: 12, b: 34, l: 48 };
  const iw = W - m.l - m.r, ih = H - m.t - m.b;
  const rawMax = Math.max(...rows.map((d) => d.n));
  const { ticks, top: max } = niceTicks(rawMax);
  const step = iw / rows.length;
  const bw = Math.max(1, step - 2); // 2px surface gap between adjacent bars
  const y = (v) => ih - (v / max) * ih;

  const svg = el("svg", { viewBox: `0 0 ${W} ${H}`, role: "img",
    "aria-label": "Confirmed exoplanets by discovery year" });
  const g = el("g", { transform: `translate(${m.l},${m.t})` });

  for (const v of ticks) {
    g.appendChild(el("line", { class: "gridline", x1: 0, x2: iw, y1: y(v), y2: y(v) }));
    g.appendChild(el("text", { class: "axis", x: -8, y: y(v) + 3.5, "text-anchor": "end" },
      [document.createTextNode(fmt(v))]));
  }

  rows.forEach((d, i) => {
    const h = ih - y(d.n);
    const p = el("path", { class: "bar", d: barPath(i * step, y(d.n), bw, h, 4) });
    p.addEventListener("mousemove", (e) =>
      showTip(e, `<div>${d.year}</div><div><span class="k">planets</span> ${fmt(d.n)}</div>`));
    p.addEventListener("mouseleave", hideTip);
    g.appendChild(p);
    // Label every fifth year plus the last, so the axis never collides.
    if (i % 5 === 0 || i === rows.length - 1) {
      g.appendChild(el("text", { class: "axis", x: i * step + bw / 2, y: ih + 16,
        "text-anchor": "middle" }, [document.createTextNode(d.year)]));
    }
  });
  g.appendChild(el("line", { class: "axis", x1: 0, x2: iw, y1: ih, y2: ih }));
  svg.appendChild(g);
  host.replaceChildren(svg);
}

/* ---------- horizontal ranked bars: discovery method ---------- */
function chartMethod(host, rows, tableHost) {
  const top = rows.slice(0, 5);
  const rest = rows.slice(5).reduce((a, d) => a + d.n, 0);
  // A sixth category is never a new hue -- it folds into Other.
  if (rest > 0) top.push({ method: "Other", n: rest });

  const W = 560, rowH = 34, m = { t: 6, r: 52, b: 6, l: 168 };
  const H = m.t + m.b + top.length * rowH;
  const iw = W - m.l - m.r;
  const max = Math.max(...top.map((d) => d.n));

  const svg = el("svg", { viewBox: `0 0 ${W} ${H}`, role: "img",
    "aria-label": "Exoplanets by discovery method" });
  const g = el("g", { transform: `translate(${m.l},${m.t})` });

  top.forEach((d, i) => {
    const w = (d.n / max) * iw;
    const yy = i * rowH + 5;
    const h = rowH - 12;
    // Horizontal bar: rounded on the value end, square on the baseline.
    const rr = Math.min(4, w / 2, h / 2);
    g.appendChild(el("path", {
      class: "bar",
      d: `M0,${yy}h${Math.max(0, w - rr)}a${rr},${rr} 0 0 1 ${rr},${rr}v${h - 2 * rr}a${rr},${rr} 0 0 1 ${-rr},${rr}H0Z`,
    }));
    // "Transit Timing Variations" is wider than the gutter; clip it rather
    // than letting it run off the left edge of the viewBox.
    const label = d.method.length > 24 ? `${d.method.slice(0, 23)}\u2026` : d.method;
    const t = el("text", { class: "axis", x: -10, y: yy + h / 2 + 3.5, "text-anchor": "end" },
      [document.createTextNode(label)]);
    t.appendChild(el("title", {}, [document.createTextNode(d.method)]));
    g.appendChild(t);
    // Direct label: selective by design -- these six carry values, the year
    // chart above does not.
    g.appendChild(el("text", { class: "direct-label", x: w + 8, y: yy + h / 2 + 3.5 },
      [document.createTextNode(fmt(d.n))]));
  });
  svg.appendChild(g);
  host.replaceChildren(svg);

  tableHost.innerHTML =
    `<table class="table"><thead><tr><th>Method</th><th style="text-align:right">Planets</th>` +
    `<th style="text-align:right">Share</th></tr></thead><tbody>` +
    rows.map((d) => {
      const total = rows.reduce((a, r) => a + r.n, 0);
      return `<tr><td>${d.method}</td><td class="num">${fmt(d.n)}</td>` +
        `<td class="num">${((d.n / total) * 100).toFixed(1)}%</td></tr>`;
    }).join("") + "</tbody></table>";
}

/* ---------- scatter: radius vs period, sequential by host-star temp ---------- */
function chartScatter(host, rows) {
  const pts = rows.filter((d) => d.pl_orbper > 0 && d.pl_rade > 0);
  const W = 760, H = 380, m = { t: 14, r: 16, b: 42, l: 64 };
  const iw = W - m.l - m.r, ih = H - m.t - m.b;

  const lx = (v) => Math.log10(v);
  const xs = pts.map((d) => lx(d.pl_orbper)), ys = pts.map((d) => lx(d.pl_rade));
  const x0 = Math.min(...xs), x1 = Math.max(...xs);
  const y0 = Math.min(...ys), y1 = Math.max(...ys);
  const X = (v) => ((lx(v) - x0) / (x1 - x0)) * iw;
  const Y = (v) => ih - ((lx(v) - y0) / (y1 - y0)) * ih;

  // Temperature is a magnitude, so it earns the sequential ramp.
  const temps = pts.map((d) => d.st_teff).filter((t) => t);
  const tMin = Math.min(...temps), tMax = Math.max(...temps);
  const band = (t) => {
    if (!t) return "rgba(233,246,239,.22)";
    const f = (t - tMin) / (tMax - tMin || 1);
    return SEQ[Math.min(SEQ.length - 1, Math.floor(f * SEQ.length))];
  };

  const svg = el("svg", { viewBox: `0 0 ${W} ${H}`, role: "img",
    "aria-label": "Planet radius against orbital period, colored by host star temperature" });
  const g = el("g", { transform: `translate(${m.l},${m.t})` });

  const decades = (lo, hi) => {
    const out = [];
    for (let p = Math.floor(lo); p <= Math.ceil(hi); p++) out.push(10 ** p);
    return out;
  };
  decades(x0, x1).forEach((v) => {
    if (lx(v) < x0 || lx(v) > x1) return;
    g.appendChild(el("line", { class: "gridline", x1: X(v), x2: X(v), y1: 0, y2: ih }));
    g.appendChild(el("text", { class: "axis", x: X(v), y: ih + 16, "text-anchor": "middle" },
      [document.createTextNode(v >= 1 ? fmt(v) : String(v))]));
  });
  decades(y0, y1).forEach((v) => {
    if (lx(v) < y0 || lx(v) > y1) return;
    g.appendChild(el("line", { class: "gridline", x1: 0, x2: iw, y1: Y(v), y2: Y(v) }));
    g.appendChild(el("text", { class: "axis", x: -8, y: Y(v) + 3.5, "text-anchor": "end" },
      [document.createTextNode(v >= 1 ? fmt(v) : String(v))]));
  });

  pts.forEach((d) => {
    const c = el("circle", { cx: X(d.pl_orbper), cy: Y(d.pl_rade), r: 2.6,
      fill: band(d.st_teff), "fill-opacity": ".85" });
    c.addEventListener("mousemove", (e) => showTip(e,
      `<div>${d.pl_name}</div>` +
      `<div><span class="k">period</span> ${fmt(d.pl_orbper, 2)} d</div>` +
      `<div><span class="k">radius</span> ${fmt(d.pl_rade, 2)} R⊕</div>` +
      `<div><span class="k">star</span> ${d.st_teff ? fmt(d.st_teff) + " K" : "—"}</div>` +
      `<div><span class="k">method</span> ${d.method}</div>`));
    c.addEventListener("mouseleave", hideTip);
    g.appendChild(c);
  });

  g.appendChild(el("text", { class: "axis", x: iw / 2, y: ih + 33, "text-anchor": "middle" },
    [document.createTextNode("orbital period (days)")]));
  g.appendChild(el("text", { class: "axis", transform: `translate(-48,${ih / 2}) rotate(-90)`,
    "text-anchor": "middle" }, [document.createTextNode("radius (R⊕)")]));
  svg.appendChild(g);

  const legend = document.createElement("div");
  legend.className = "legend";
  legend.innerHTML =
    `<span class="ramp"><span>host star ${fmt(tMin)} K</span>` +
    SEQ.map((c) => `<i style="background:${c}"></i>`).join("") +
    `<span>${fmt(tMax)} K</span></span>` +
    `<span><span class="swatch" style="background:rgba(233,246,239,.22)"></span>temperature unknown</span>`;
  host.replaceChildren(svg, legend);
}

function tableNearest(host, rows) {
  host.innerHTML =
    `<table class="table"><thead><tr><th>Planet</th><th>Host</th><th>Method</th>` +
    `<th style="text-align:right">Year</th><th style="text-align:right">Distance (pc)</th>` +
    `<th style="text-align:right">Radius (R⊕)</th></tr></thead><tbody>` +
    rows.map((d) =>
      `<tr><td class="mono">${d.pl_name}</td><td>${d.hostname}</td><td>${d.method}</td>` +
      `<td class="num">${d.disc_year ? String(d.disc_year) : "—"}</td>` +
      `<td class="num">${fmt(d.sy_dist, 2)}</td>` +
      `<td class="num">${d.pl_rade ? fmt(d.pl_rade, 2) : "—"}</td></tr>`).join("") +
    "</tbody></table>";
}

function tiles(host, s) {
  const items = [
    { num: fmt(s.planets), lbl: "confirmed planets", sub: `${s.first_year}–${s.last_year}` },
    { num: fmt(s.systems), lbl: "host systems", sub: "distinct stars" },
    { num: fmt(s.facilities), lbl: "discovery facilities", sub: "observatories and missions" },
    { num: fmt(s.nearest_pc, 2), lbl: "nearest planet (pc)", sub: s.nearest_name || "—" },
  ];
  host.innerHTML = items.map((i) =>
    `<div class="tile"><div class="num">${i.num}</div>` +
    `<div class="lbl">${i.lbl}</div><div class="sub">${i.sub}</div></div>`).join("");
}

const get = (p) => fetch(p).then((r) => {
  if (!r.ok) throw new Error(`${p} -> ${r.status}`);
  return r.json();
});

async function main() {
  document.querySelectorAll(".toggle[data-table]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const t = document.getElementById(btn.dataset.table);
      const chart = t.previousElementSibling;
      const showTable = t.hidden;
      t.hidden = !showTable;
      chart.hidden = showTable;
      btn.textContent = showTable ? "chart" : "table";
    });
  });

  try {
    const [s, year, method, scat, near, dbg] = await Promise.all([
      get("/api/summary"), get("/api/by-year"), get("/api/by-method"),
      get("/api/scatter"), get("/api/nearest"), get("/debug"),
    ]);
    tiles(document.getElementById("tiles"), s);
    chartYear(document.getElementById("c-year"), year);
    chartMethod(document.getElementById("c-method"), method, document.getElementById("t-method"));
    chartScatter(document.getElementById("c-scatter"), scat);
    tableNearest(document.getElementById("t-nearest"), near);
    document.getElementById("f-version").textContent = `version ${dbg.version}`;
    document.getElementById("f-pod").textContent = `pod ${dbg.hostname}`;
    document.getElementById("f-uptime").textContent = `uptime ${fmt(dbg.uptime_s, 0)}s`;
  } catch (err) {
    const h = document.getElementById("health");
    h.className = "status status--err";
    h.textContent = "degraded";
    console.error(err);
  }
}
main();
