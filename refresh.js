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

function usgsEventHref(id) {
  const raw = String(id ?? "");
  const page = raw.replace(/^usgs:/i, "");
  if (!page) return "";
  return "https://earthquake.usgs.gov/earthquakes/eventpage/" + encodeURIComponent(page);
}

function renderTools(el, d) {
  if (!el) return;
  const t = d && d.tools;
  if (!t || typeof t !== "object") {
    el.innerHTML = '<div class="muted">not in this snapshot (flags off or older data)</div>';
    return;
  }
  const flags = t.flags || {};
  const pill = (name, on) => `<span class="tag">${gsEsc(name)} ${on ? "on" : "off"}</span>`;
  const qpuBadge = t.qpu === true
    ? '<span class="tag bad">QPU on</span>'
    : '<span class="tag ok">QPU off</span>';
  const head = `<div>${pill("qubo", !!flags.qubo)} ${pill("grib2", !!flags.grib2)} ${pill("attack_layer", !!flags.attack_layer)} ${qpuBadge}</div>`;

  const sel = (t.qubo && t.qubo.selection) || {};
  const solver = sel.solver || (t.qubo && t.qubo.solver) || "–";
  const ver = sel.dimod_version ? ` · dimod ${sel.dimod_version}` : "";
  const energy = sel.ground_energy == null ? "–" : Number(sel.ground_energy).toFixed(4);
  const budget = sel.budget == null ? "–" : String(sel.budget);
  let qubo = `<p>solver ${gsEsc(solver)}${gsEsc(ver)} · ground energy ${gsEsc(energy)} · budget ${gsEsc(budget)}</p>`;
  const rows = sel.selected || [];
  if (rows.length) {
    qubo += "<table><tr><th>event</th><th>weight</th></tr>";
    for (const r of rows) {
      const href = usgsEventHref(r.id);
      const label = gsEsc(r.id);
      const link = href ? `<a href="${gsEsc(href)}">${label}</a>` : label;
      const w = r.weight == null ? "–" : Number(r.weight).toFixed(3);
      qubo += `<tr><td>${link}</td><td>${gsEsc(w)}</td></tr>`;
    }
    qubo += "</table>";
  } else if (flags.qubo) {
    qubo += '<div class="muted">no events selected</div>';
  } else {
    qubo += '<div class="muted">QUBO flag off</div>';
  }

  const a = t.attack_layer || {};
  const layerHref = "data/attack-layer.json";
  let attack;
  if (flags.attack_layer || a.enabled || a.ok) {
    const lv = a.layer_version || "–";
    const nv = a.navigator_version || "–";
    attack = `<p><a href="${layerHref}">ATT&amp;CK Navigator layer</a> · layer ${gsEsc(lv)} · navigator ${gsEsc(nv)} · <span class="tools-layer-n muted">techniques …</span></p>`;
  } else {
    attack = '<div class="muted">ATT&amp;CK layer flag off</div>';
  }

  const g = t.grib2;
  const dec = g && g.decode;
  let grib;
  if (dec && dec.parked) {
    grib = `<div class="muted">GRIB2 parked: ${gsEsc(dec.reason || "parked")}</div>`;
  } else if (dec && dec.ok) {
    const m = (dec.messages || [])[0] || {};
    const shape = (m.shape || []).join("×");
    grib = `<div>GRIB2 ${gsEsc(dec.grib2io_version || "")} · ${gsEsc(m.shortName || "")} ${gsEsc(m.units || "")}${shape ? " · shape " + gsEsc(shape) : ""}</div>`;
  } else if (g && g.available === false) {
    grib = `<div class="muted">GRIB2 parked: ${gsEsc((dec && dec.reason) || "grib2io not installed")}</div>`;
  } else if (!flags.grib2) {
    grib = '<div class="muted">GRIB2 off</div>';
  } else {
    grib = `<div class="muted">GRIB2: ${gsEsc((dec && dec.reason) || "no decode")}</div>`;
  }

  el.innerHTML = head + qubo + attack + grib;

  const nEl = el.querySelector(".tools-layer-n");
  if (nEl) {
    gsGet(layerHref).then(layer => {
      const n = Array.isArray(layer && layer.techniques) ? layer.techniques.length : 0;
      nEl.textContent = n + " technique" + (n === 1 ? "" : "s");
      nEl.classList.remove("muted");
    }).catch(() => { nEl.textContent = "technique count unavailable"; });
  }
}

function renderSpaceWeather(panel) {
  if (!panel) return;
  const el = panel.querySelector("#space-weather") || panel;
  const href = "data/space-weather.json";
  gsGet(href).then(doc => {
    if (!doc || typeof doc !== "object") return;
    const kp = (doc.kp && doc.kp.latest) || {};
    const wind = (doc.solar_wind && doc.solar_wind.latest) || {};
    const alerts = (doc.alerts && doc.alerts.items) || [];
    const seeds = doc.seeds || {};
    const fmt = v => (v == null || v === "") ? "–" : gsEsc(v);
    const nfmt = (v, d) => (v == null || v === "") ? "–" : gsEsc(Number(v).toFixed(d));
    let html = '<p class="muted">experimental correlation input, not predictive</p>';
    html += "<table><tr><th>Kp</th><th>solar wind</th><th>Bz / Bt</th></tr>";
    html += `<tr><td>${nfmt(kp.kp, 2)}<br><span class="muted">${fmt(kp.time)}</span></td>`;
    html += `<td>${kp.kp == null && wind.speed == null ? "–" : nfmt(wind.speed, 0) + " km/s"}<br><span class="muted">${fmt(wind.time)}</span></td>`;
    html += `<td>Bz ${nfmt(wind.bz_gsm, 1)} nT · Bt ${nfmt(wind.bt, 1)} nT</td></tr></table>`;
    html += "<div><b>SWPC alerts</b></div>";
    if (!(doc.alerts && doc.alerts.ok)) {
      html += `<div class="muted">${gsEsc((doc.alerts && doc.alerts.error) || "alerts unavailable")}</div>`;
    } else if (!alerts.length) {
      html += '<div class="muted">no current alerts</div>';
    } else {
      html += "<table><tr><th>time</th><th>alert</th></tr>";
      for (const a of alerts.slice(0, 5)) {
        html += `<tr><td class="muted">${fmt(a.time)}</td><td>${gsEsc(a.title || a.product_id || "")}</td></tr>`;
      }
      html += "</table>";
    }
    const portal = gsUrl(seeds.portal || "http://spaceweather.gmu.edu/seeds/") || "http://spaceweather.gmu.edu/seeds/";
    const live = gsUrl(seeds.source || "http://spaceweather.gmu.edu/seeds/realtime.php") || "http://spaceweather.gmu.edu/seeds/realtime.php";
    html += `<div><b>SEEDS CMEs</b> · <a href="${gsEsc(live)}">realtime</a> · <a href="${gsEsc(portal)}">portal</a></div>`;
    const dets = seeds.detections || [];
    if (!seeds.ok) {
      html += `<div class="muted">SEEDS catalog unavailable${seeds.error ? ": " + gsEsc(seeds.error) : ""}. Linked above.</div>`;
    } else if (!dets.length) {
      html += '<div class="muted">no recent detections</div>';
    } else {
      html += "<table><tr><th>time</th><th>PA</th><th>width</th><th>velocity</th><th>instrument</th></tr>";
      for (const c of dets.slice(0, 8)) {
        html += `<tr><td class="muted">${fmt(c.time)}</td><td>${fmt(c.position_angle)}</td><td>${fmt(c.angular_width)}</td><td>${c.velocity == null ? "–" : gsEsc(c.velocity) + " km/s"}</td><td class="muted">${fmt(c.instrument)}</td></tr>`;
      }
      html += "</table>";
    }
    const attr = doc.attribution || {};
    html += `<div class="muted">${gsEsc(attr.swpc || "NOAA SWPC")} · <a href="https://www.swpc.noaa.gov/">SWPC</a>`;
    if (attr.seeds) html += ` · ${gsEsc(attr.seeds)}`;
    html += "</div>";
    el.innerHTML = html;
    panel.hidden = false;
  }).catch(() => {
    panel.hidden = true;
    el.innerHTML = "";
  });
}


function renderMilFlightCounts(panel, d) {
  if (!panel) return;
  const el = panel.querySelector("#mil-flight-counts") || panel;
  const doc = d && d.tools && d.tools.mil_flight_counts;
  const hasData = !!(doc && doc.ok && typeof doc.aircraft === "number");
  if (!hasData) {
    panel.hidden = true;
    el.innerHTML = "";
    return;
  }
  const types = doc.types || {};
  const parts = Object.keys(types).map(k => gsEsc(k) + " " + gsEsc(types[k]));
  const hist = parts.length ? parts.join(", ") : "no type codes";
  const attr = (doc.attribution && doc.attribution.attribution) || "Contains information from adsb.lol, ODbL 1.0.";
  const license = (doc.attribution && doc.attribution.license_url) || "https://opendatacommons.org/licenses/odbl/1-0/";
  const src = (doc.attribution && doc.attribution.url) || "https://adsb.lol/";
  el.innerHTML = `<p>${gsEsc(doc.aircraft)} military-registered aircraft · ${hist}</p>`
    + `<div class="muted">${gsEsc(doc.label || "experimental context, non-predictive")} · not used in the hazard index · `
    + `${gsEsc(attr)} <a href="${gsEsc(src)}">adsb.lol</a> · <a href="${gsEsc(license)}">ODbL 1.0</a></div>`;
  panel.hidden = false;
}


function renderFlaggedAggregate(panel, elId, doc, bodyHtml, attrFallback, srcFallback, licenseFallback) {
  if (!panel) return;
  const el = panel.querySelector(elId) || panel;
  const hasData = !!(doc && doc.ok);
  if (!hasData) {
    panel.hidden = true;
    el.innerHTML = "";
    return;
  }
  const attr = (doc.attribution && doc.attribution.attribution) || attrFallback;
  const license = (doc.attribution && doc.attribution.license_url) || licenseFallback;
  const src = (doc.attribution && doc.attribution.url) || srcFallback;
  const licenseName = (doc.attribution && doc.attribution.license) || "";
  let credit = "";
  if (attr || src || license) {
    credit = `${gsEsc(attr)}`;
    if (src) credit += ` <a href="${gsEsc(src)}">${gsEsc(src)}</a>`;
    if (license) credit += ` · <a href="${gsEsc(license)}">${gsEsc(licenseName || license)}</a>`;
  }
  el.innerHTML = bodyHtml
    + `<div class="muted">${gsEsc(doc.label || "experimental context, non-predictive")} · not used in the hazard index`
    + (credit ? " · " + credit : "")
    + "</div>";
  panel.hidden = false;
}

function renderLocalAdsb(panel, d) {
  const doc = d && d.tools && d.tools.local_adsb;
  const ok = !!(doc && doc.ok && typeof doc.aircraft === "number");
  const cats = (doc && doc.categories) || {};
  const parts = Object.keys(cats).map(k => gsEsc(k) + " " + gsEsc(cats[k]));
  const hist = parts.length ? parts.join(", ") : "no categories";
  const body = ok
    ? `<p>${gsEsc(doc.aircraft)} aircraft · ${gsEsc(doc.with_position)} with position · ${hist}</p>`
    : "";
  renderFlaggedAggregate(panel, "#local-adsb", ok ? doc : null, body, "own receiver", "", "");
}

function renderRegionalAdsb(panel, d) {
  const doc = d && d.tools && d.tools.regional_adsb;
  const ok = !!(doc && doc.ok && typeof doc.aircraft === "number");
  const cats = (doc && doc.categories) || {};
  const parts = Object.keys(cats).map(k => gsEsc(k) + " " + gsEsc(cats[k]));
  const hist = parts.length ? parts.join(", ") : "no categories";
  const r = (doc && doc.query && doc.query.radius_nm) || 100;
  const body = ok
    ? `<p>${gsEsc(doc.aircraft)} aircraft within ${gsEsc(r)} nm of Rogers, AR · ${gsEsc(doc.with_position)} with position · ${hist}</p>`
    : "";
  renderFlaggedAggregate(
    panel, "#regional-adsb", ok ? doc : null, body,
    "Contains information from adsb.lol, ODbL 1.0.",
    "https://adsb.lol/",
    "https://opendatacommons.org/licenses/odbl/1-0/",
  );
}

function renderGmn(panel, d) {
  const doc = d && d.tools && d.tools.gmn;
  const ok = !!(doc && doc.ok && typeof doc.stations === "number");
  const body = ok ? `<p>${gsEsc(doc.stations)} contributing stations (count only)</p>` : "";
  renderFlaggedAggregate(
    panel, "#gmn", ok ? doc : null, body,
    "Station-count aggregate from the Global Meteor Network, licensed under CC BY 4.0.",
    "https://globalmeteornetwork.org/",
    "https://creativecommons.org/licenses/by/4.0/",
  );
}


function renderWban(panel) {
  if (!panel) return;
  const el = panel.querySelector("#wban") || panel;
  const href = "data/wban.json";
  gsGet(href).then(doc => {
    if (!doc || typeof doc !== "object") {
      panel.hidden = true;
      el.innerHTML = "";
      return;
    }
    const bands = doc.bands || {};
    const chans = doc.wifi_channels || {};
    const nfmt = (v, d) => (v == null || v === "") ? "–" : gsEsc(Number(v).toFixed(d));
    const count = name => {
      const rec = bands[name] || {};
      return rec.devices == null ? "–" : gsEsc(rec.devices);
    };
    const rssi = name => {
      const s = (bands[name] && bands[name].rssi) || {};
      if (s.min == null && s.median == null && s.max == null) return "–";
      return nfmt(s.min, 0) + " / " + nfmt(s.median, 1) + " / " + nfmt(s.max, 0) + " dBm";
    };
    let html = '<p class="muted">experimental electromagnetic-environment correlation input, not predictive</p>';
    if (doc.parked) {
      html += `<div class="muted">${gsEsc(doc.reason || "parked")}</div>`;
    } else if (!doc.ok) {
      html += `<div class="muted">${gsEsc(doc.error || "unavailable")}</div>`;
    } else {
      html += "<table><tr><th>band</th><th>devices</th><th>RSSI min / median / max</th></tr>";
      for (const name of ["2.4", "5", "6", "ble"]) {
        const rec = bands[name] || {};
        if (name === "6" && !rec.devices) continue;
        html += `<tr><td>${gsEsc(name === "ble" ? "BLE" : name + " GHz")}</td><td>${count(name)}</td><td class="muted">${rssi(name)}</td></tr>`;
      }
      html += "</table>";
      const parts = Object.keys(chans).map(k => gsEsc(k) + " " + gsEsc(chans[k]));
      if (parts.length) {
        html += `<div class="muted">channels: ${parts.join(", ")}</div>`;
      }
    }
    html += '<div class="muted">own sensor · not used in the hazard index · broadcast beacons only, no identifiers</div>';
    el.innerHTML = html;
    panel.hidden = false;
  }).catch(() => {
    panel.hidden = true;
    el.innerHTML = "";
  });
}

function renderKnownEvents(el, d) {
  if (!el) return;
  const doc = d && d.known_events;
  if (!doc || !Array.isArray(doc.items) || !doc.items.length) {
    el.innerHTML = "";
    const panel = el.closest ? el.closest("#known-events-panel") : null;
    if (panel) panel.hidden = true;
    return;
  }
  const panel = el.closest ? el.closest("#known-events-panel") : null;
  if (panel) panel.hidden = false;
  let html = "";
  for (const item of doc.items) {
    const typ = item.type === "watch" ? "watch" : "scheduled";
    const st = item.status || "";
    html += `<div><span class="tag">${gsEsc(typ)}</span> <span class="tag">${gsEsc(st)}</span> `;
    html += `<b>${gsEsc(item.title || item.label || item.id)}</b></div>`;
    const wins = item.windows || [];
    if (wins.length) {
      html += '<div class="muted">' + wins.map(w => {
        const role = w.role ? gsEsc(w.role) + ": " : "";
        return role + gsEsc(w.start) + " – " + gsEsc(w.end);
      }).join("<br>") + (item.local_window ? "<br>" + gsEsc(item.local_window) : "") + "</div>";
    }
    if (typ === "scheduled") {
      const ch = (item.channels || []).join(", ");
      const ex = (item.excludes || []).join(", ");
      html += `<div class="muted">${gsEsc(item.label || "known: scheduled EAS test")}`;
      if (ch) html += " · " + gsEsc(ch);
      if (ex) html += " · no " + gsEsc(ex);
      html += ". Matching alerts are labeled, not dropped, and are not scored as anomalies.</div>";
    } else {
      html += `<div class="muted">${gsEsc(item.purpose || "Timeline marker only. Does not suppress or relabel anomalies.")}</div>`;
    }
    const links = (item.sources || []).filter(s => s && (s.url || s.name));
    if (links.length) {
      html += "<div>" + links.map(s => {
        const href = gsUrl(s.url);
        const name = gsEsc(s.name || s.url || "source");
        return href ? `<a href="${gsEsc(href)}">${name}</a>` : name;
      }).join(" · ") + "</div>";
    }
  }
  const watches = ((d.verification || {}).watches) || [];
  if (watches.length) {
    html += '<table><tr><th>watch</th><th>pre</th><th>during</th><th>post</th></tr>';
    for (const w of watches) {
      const cell = b => (b && b.n != null) ? gsEsc(b.n) : "–";
      html += `<tr><td>${gsEsc(w.label || w.id)}</td><td>${cell(w.pre)}</td><td>${cell(w.during)}</td><td>${cell(w.post)}</td></tr>`;
    }
    html += "</table>";
  }
  el.innerHTML = html;
}
