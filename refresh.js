/* Mirror refresh for static hosts.
   The page's own data/latest.json may be a frozen deploy. The public GitHub Pages
   mirror sends Access-Control-Allow-Origin: * and is updated by the scheduled
   refresh when MIRROR_GITHUB_TOKEN is set. Use whichever snapshot is newer.
   No API key is involved. OpenAQ is queried only on the ingest host. */
const GEOSENTINEL_LIVE = "https://mr-mission-control.github.io/geosentinel-dashboard/data/latest.json";

function gsEsc(s) {
  return String(s ?? "").replace(/[&<>"]/g, c => ({"&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;"}[c]));
}

function gsStamp(d) {
  const t = Date.parse(d && d.generated_at);
  return Number.isFinite(t) ? t : 0;
}

async function gsGet(url) {
  const r = await fetch(url, {cache: "no-store"});
  if (!r.ok) throw new Error(String(r.status));
  return r.json();
}

async function loadSnapshot() {
  const localUrl = "data/latest.json";
  let local = null, live = null, source = "snapshot";
  try { local = await gsGet(localUrl); } catch (e) { local = null; }
  let same = false;
  try { same = new URL(GEOSENTINEL_LIVE).href === new URL(localUrl, location.href).href; } catch (e) { same = false; }
  // On the GitHub Pages mirror the shipped file is the canonical copy.
  if (same) source = "live";
  else {
    try { live = await gsGet(GEOSENTINEL_LIVE); } catch (e) { live = null; }
  }
  const usable = d => !!(d && d.generated_at && (Array.isArray(d.events) || d.context));
  if (!usable(local)) local = null;
  if (!usable(live)) live = null;
  let doc = local;
  if (live && gsStamp(live) >= gsStamp(local)) { doc = live; source = "live"; }
  if (!doc) throw new Error("no snapshot");
  doc._refresh = source;
  return doc;
}

function gsUrl(u) {
  try {
    const x = new URL(u);
    if (x.protocol === "https:" || x.protocol === "http:") return x.href;
  } catch (e) { /* ignore non-URLs */ }
  return "";
}

function renderAir(el, d, fmt) {
  if (!el) return;
  const src = (d.context || {}).openaq;
  const when = t => t ? (fmt ? fmt(t) : gsEsc(t)) : "–";
  if (!src) { el.innerHTML = '<div class="muted">OpenAQ is not in this snapshot.</div>'; return; }
  const sum = src.summary || {};
  if (sum.parked) {
    el.innerHTML = `<div class="muted">${gsEsc(sum.reason)} · set <code>${gsEsc(sum.env)}</code>. See docs/DATA_SOURCES.md. No request is made until the key is set.</div>`;
    return;
  }
  if (!src.ok) { el.innerHTML = `<div class="bad">${gsEsc(src.error || "degraded")}</div>`; return; }
  const rows = [];
  for (const loc of sum.top || []) {
    const credits = (loc.licenses || []).map(l => l.attribution || l.name).filter(Boolean);
    const readings = (loc.readings && loc.readings.length) ? loc.readings : [{parameter: (loc.sensors || []).join(", "), value: null, unit: "", time: loc.last}];
    for (const r of readings) rows.push({t: r.time || loc.last || "", name: loc.name, parameter: r.parameter, value: r.value, unit: r.unit || "", provider: loc.provider, credit: credits.join(", ")});
  }
  rows.sort((a, b) => String(b.t).localeCompare(String(a.t)));
  let table = '<table><tr><th>time</th><th>location</th><th>parameter</th><th>value</th><th>provider</th></tr>';
  if (!rows.length) table += '<tr><td colspan="5" class="muted">no locations in this run</td></tr>';
  for (const r of rows.slice(0, 24)) {
    const val = r.value == null || r.value === "" ? "–" : `${gsEsc(r.value)} ${gsEsc(r.unit)}`.trim();
    table += `<tr><td class="muted">${when(r.t)}</td><td>${gsEsc(r.name)}</td><td>${gsEsc(r.parameter)}</td><td>${val}</td><td class="muted">${gsEsc(r.provider || r.credit || "")}</td></tr>`;
  }
  const providers = (sum.providers || []).map(gsEsc).join(", ");
  table += `</table><div class="muted">${gsEsc(sum.attribution || "")}${providers ? " Providers in this run: " + providers + "." : ""} <a href="https://openaq.org/">OpenAQ</a> · <a href="https://creativecommons.org/licenses/by/4.0/">CC BY 4.0</a> when the location license requires it.</div>`;
  el.innerHTML = table;
}
