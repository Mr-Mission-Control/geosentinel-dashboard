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
  const head = `<div>${pill("qubo", !!flags.qubo)} ${pill("grib2", !!flags.grib2)} ${pill("attack_layer", !!flags.attack_layer)} ${pill("decision_triage", !!flags.decision_triage)} ${qpuBadge}</div>`;

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


  const dt = t.decision_triage;
  let triage;
  if (dt && typeof dt === "object") {
    const cases = dt.cases && typeof dt.cases === "object" ? Object.values(dt.cases) : [];
    const live = dt.live_requests == null ? "–" : String(dt.live_requests);
    const note = dt.note ? ` · ${gsEsc(dt.note)}` : (dt.degraded ? " · degraded" : "");
    triage = `<p>Decision-1 triage · live calls ${gsEsc(live)}${note}</p>`;
    if (cases.length) {
      triage += "<table><tr><th>feed</th><th>class</th><th>severity</th><th>needs human</th></tr>";
      for (const c of cases) {
        const cls = c.failure_class || (c.skipped ? "skipped" : (c.ok ? "–" : "error"));
        const sev = c.severity == null ? "–" : Number(c.severity).toFixed(2);
        const human = c.p_needs_human == null ? "–" : Number(c.p_needs_human).toFixed(2);
        triage += `<tr><td>${gsEsc(c.feed || "–")}</td><td>${gsEsc(cls)}</td><td>${gsEsc(sev)}</td><td>${gsEsc(human)}</td></tr>`;
      }
      triage += "</table>";
    } else if (flags.decision_triage) {
      triage += '<div class="muted">no feed failures this run</div>';
    }
  } else if (flags.decision_triage) {
    triage = '<div class="muted">Decision-1 triage on (no result in this snapshot)</div>';
  } else {
    triage = '<div class="muted">Decision-1 triage flag off</div>';
  }

  el.innerHTML = head + qubo + attack + grib + triage;

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

function renderUsgsWater(panel) {
  if (!panel) return;
  const el = panel.querySelector("#usgs-water") || panel;
  const href = "data/usgs_water.json";
  gsGet(href).then(doc => {
    if (!doc || typeof doc !== "object") {
      panel.hidden = true;
      el.innerHTML = "";
      return;
    }
    const fmt = v => (v == null || v === "") ? "–" : gsEsc(v);
    const nfmt = (v, d) => (v == null || v === "") ? "–" : gsEsc(Number(v).toFixed(d));
    const locHref = id => "https://waterdata.usgs.gov/monitoring-location/" + encodeURIComponent(id) + "/";
    const siteCell = s => {
      const id = s && s.id ? String(s.id) : "";
      const name = s && s.name ? gsEsc(s.name) : gsEsc(id || "site");
      if (!id) return name;
      return `${name}<br><a class="muted" href="${gsEsc(locHref(id))}">${gsEsc(id)}</a>`;
    };
    let html = '<p class="muted">experimental correlation input, not predictive</p>';
    if (doc.parked) {
      html += `<div class="muted">${gsEsc(doc.reason || "parked")}</div>`;
    } else if (!doc.ok) {
      html += `<div class="muted">${gsEsc(doc.error || "unavailable")}</div>`;
    } else {
      const rogers = ((doc.rogers_area && doc.rogers_area.sites) || []).slice(0, 12);
      const arkansas = ((doc.arkansas && doc.arkansas.sites) || []).slice(0, 16);
      const unusual = ((doc.national && doc.national.unusual_rises) || []).slice(0, 12);
      const shown = rogers.length ? rogers : arkansas;
      const heading = rogers.length ? "Rogers, AR area" : "Arkansas";
      html += `<div><b>${heading}</b> · ${gsEsc((doc.rogers_area && doc.rogers_area.count) || 0)} nearby · ${gsEsc((doc.arkansas && doc.arkansas.count) || 0)} in Arkansas</div>`;
      if (shown.length) {
        html += "<table><tr><th>gauge</th><th>discharge</th><th>gage height</th></tr>";
        for (const s of shown) {
          const cfs = s.discharge_cfs == null ? "–" : nfmt(s.discharge_cfs, 2) + " ft³/s";
          const ft = s.gage_height_ft == null ? "–" : nfmt(s.gage_height_ft, 2) + " ft";
          html += `<tr><td>${siteCell(s)}</td><td>${cfs}<br><span class="muted">${fmt(s.discharge_time)}</span></td><td>${ft}<br><span class="muted">${fmt(s.gage_height_time)}</span></td></tr>`;
        }
        html += "</table>";
      } else {
        html += '<div class="muted">no regional gauges in this snapshot</div>';
      }
      const nRise = (doc.national && doc.national.unusual_rise_count) || unusual.length;
      const considered = (doc.national && doc.national.sites_considered) || 0;
      html += `<div><b>National unusual rises</b> · ${gsEsc(nRise)} of ${gsEsc(considered)} sites (latest discharge vs prior daily mean)</div>`;
      if (unusual.length) {
        html += "<table><tr><th>gauge</th><th>latest</th><th>prior daily mean</th><th>rise</th></tr>";
        for (const s of unusual) {
          const ratio = s.rise_ratio == null ? "–" : nfmt(s.rise_ratio, 2) + "×";
          const delta = s.rise_cfs == null ? "–" : ((s.rise_cfs > 0 ? "+" : "") + nfmt(s.rise_cfs, 0) + " ft³/s");
          html += `<tr><td>${siteCell(s)}</td><td>${s.latest_cfs == null ? "–" : nfmt(s.latest_cfs, 2) + " ft³/s"}<br><span class="muted">${fmt(s.latest_time)}</span></td>`;
          html += `<td>${s.prior_daily_mean_cfs == null ? "–" : nfmt(s.prior_daily_mean_cfs, 2) + " ft³/s"}<br><span class="muted">${fmt(s.prior_daily_date)}</span></td>`;
          html += `<td>${ratio} · ${delta}</td></tr>`;
        }
        html += "</table>";
      } else {
        html += '<div class="muted">no unusual day-over-day rises in this snapshot</div>';
      }
    }
    const attr = doc.attribution || {};
    const credit = attr.attribution || "USGS Water Data";
    const src = attr.url || "https://api.waterdata.usgs.gov/";
    const license = attr.license_url || "https://www.usgs.gov/information-policies-and-instructions/copyrights-and-credits";
    html += `<div class="muted">${gsEsc(doc.label || "experimental correlation input, not predictive")} · not used in the hazard index · ${gsEsc(credit)} · <a href="${gsEsc(src)}">USGS Water Data</a> · <a href="${gsEsc(license)}">${gsEsc(attr.license || "U.S. Public Domain")}</a></div>`;
    el.innerHTML = html;
    panel.hidden = false;
  }).catch(() => {
    panel.hidden = true;
    el.innerHTML = "";
  });
}



function renderKarst(panel) {
  if (!panel) return;
  const el = panel.querySelector("#karst") || panel;
  const href = "data/karst.json";
  gsGet(href).then(doc => {
    if (!doc || typeof doc !== "object") {
      panel.hidden = true;
      el.innerHTML = "";
      return;
    }
    const fmt = v => (v == null || v === "") ? "missing" : gsEsc(v);
    const nfmt = (v, d) => (v == null || v === "") ? "missing" : gsEsc(Number(v).toFixed(d));
    const locHref = id => "https://waterdata.usgs.gov/monitoring-location/" + encodeURIComponent(id) + "/";
    const siteCell = s => {
      const id = s && s.id ? String(s.id) : "";
      const name = s && s.name ? gsEsc(s.name) : gsEsc(id || "site");
      const typ = s && s.site_type_label ? ` <span class="muted">${gsEsc(s.site_type_label)}</span>` : "";
      if (!id) return name + typ;
      return `${name}${typ}<br><a class="muted" href="${gsEsc(locHref(id))}">${gsEsc(id)}</a>`;
    };
    const paramLabels = { "00060": "discharge", "00065": "gage height", "72019": "groundwater", "00095": "conductance", "00010": "temp" };
    const paramOrder = ["00060", "00065", "72019", "00095", "00010"];
    const paramCell = (s, code) => {
      const p = (s.parameters || {})[code];
      if (!p) return '<span class="muted">missing</span>';
      if (p.status === "missing" || p.value == null || p.value === "") {
        const why = p.missing_reason && p.missing_reason !== "no_value" ? ` (${gsEsc(p.missing_reason)})` : "";
        return `<span class="muted">missing${why}</span>`;
      }
      const unit = p.unit ? " " + gsEsc(p.unit) : "";
      const z = p.z == null ? "missing" : "z " + Number(p.z).toFixed(2);
      const klass = p.status === "anomaly" ? "bad" : (p.status === "known_excluded" ? "muted" : "");
      const tag = p.status === "anomaly" ? " · anomaly" : (p.status === "known_excluded" ? " · known event" : "");
      return `<span class="${klass}">${nfmt(p.value, 2)}${unit}${tag}</span><br><span class="muted">${gsEsc(z)}</span>`;
    };
    let html = '<p class="muted">experimental correlation input, not predictive</p>';
    if (doc.parked) {
      html += `<div class="muted">${gsEsc(doc.reason || "parked")}</div>`;
    } else if (!doc.ok) {
      html += `<div class="muted">${gsEsc(doc.error || "unavailable")}</div>`;
    } else {
      const counts = doc.counts || {};
      const scope = doc.scope || {};
      html += `<div>Ozark Plateau · home focus ${gsEsc(scope.home_focus || "NW Arkansas corridor")} · ${gsEsc(counts.sites || 0)} sites`;
      html += ` · ${gsEsc(counts.springs || 0)} springs · ${gsEsc(counts.groundwater || 0)} groundwater · ${gsEsc(counts.streams || 0)} streams`;
      html += ` · ${gsEsc(counts.anomalies || 0)} anomalies vs prior 7–30 day baseline</div>`;
      const anomalies = (doc.anomalies || []).slice(0, 12);
      if (anomalies.length) {
        html += '<div><b>Anomalies</b> (|z| ≥ 2 vs prior daily mean; missing baselines are not flagged)</div>';
        html += "<table><tr><th>site</th><th>region</th><th>parameter</th><th>value</th><th>z</th></tr>";
        for (const a of anomalies) {
          html += `<tr><td>${siteCell(a)}</td><td>${gsEsc(a.region_label || a.region || "")}</td>`;
          html += `<td>${gsEsc(a.parameter_label || a.parameter || "")}</td>`;
          html += `<td class="bad">${a.value == null ? "missing" : nfmt(a.value, 2)}${a.unit ? " " + gsEsc(a.unit) : ""}</td>`;
          html += `<td class="bad">${a.z == null ? "missing" : nfmt(a.z, 2)}</td></tr>`;
        }
        html += "</table>";
      }
      const regions = doc.regions || {};
      const order = ["nwa_corridor", "sw_missouri", "ne_oklahoma", "rest_of_plateau"];
      for (const key of order) {
        const group = regions[key] || {};
        const sites = group.sites || [];
        const label = group.label || key;
        html += `<div><b>${gsEsc(label)}</b> · ${gsEsc(group.count || sites.length || 0)}</div>`;
        if (!sites.length) {
          html += '<div class="muted">no sites in this snapshot</div>';
          continue;
        }
        html += "<table><tr><th>site</th>";
        for (const code of paramOrder) html += `<th>${gsEsc(paramLabels[code])}</th>`;
        html += "</tr>";
        for (const s of sites) {
          html += `<tr><td>${siteCell(s)}</td>`;
          for (const code of paramOrder) html += `<td>${paramCell(s, code)}</td>`;
          html += "</tr>";
        }
        html += "</table>";
      }
    }
    const attr = doc.attribution || {};
    const credit = attr.attribution || "USGS Water Data";
    const src = attr.url || "https://api.waterdata.usgs.gov/";
    const license = attr.license_url || "https://www.usgs.gov/information-policies-and-instructions/copyrights-and-credits";
    html += `<div class="muted">${gsEsc(doc.label || "experimental correlation input, not predictive")} · not used in the hazard index · ${gsEsc(credit)} · <a href="${gsEsc(src)}">USGS Water Data</a> · <a href="${gsEsc(license)}">${gsEsc(attr.license || "U.S. Public Domain")}</a></div>`;
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
    const typ = item.type || "scheduled";
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
    if (typ === "watch") {
      html += `<div class="muted">${gsEsc(item.purpose || "Timeline marker only. Does not suppress or relabel anomalies.")}</div>`;
    } else {
      const ch = (item.channels || []).join(", ");
      const ex = (item.excludes || []).join(", ");
      const fallback = typ === "outage" ? "known: service outage" : "known: scheduled EAS test";
      html += `<div class="muted">${gsEsc(item.label || fallback)}`;
      if (ch) html += " · " + gsEsc(ch);
      if (ex) html += " · no " + gsEsc(ex);
      html += ". Matching alerts are labeled, not dropped, and are not scored as anomalies.</div>";
      if (item.purpose) html += `<div class="muted">${gsEsc(item.purpose)}</div>`;
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


function renderNaturalHazards(panel, d) {
  if (!panel) return;
  const el = panel.querySelector("#natural-hazards") || panel;
  const ctx = (d && d.context) || {};
  const eonet = ctx.nasa_eonet;
  const gdacs = ctx.gdacs;
  if (!eonet && !gdacs) {
    el.innerHTML = '<div class="muted">NASA EONET and GDACS are not in this snapshot.</div>';
    panel.hidden = false;
    return;
  }
  const priority = ["Severe Storms", "Sea and Lake Ice", "Floods", "Volcanoes", "Drought", "Landslides", "Wildfires"];
  const gdacsType = {EQ: "Earthquake", TC: "Tropical cyclone", FL: "Flood", VO: "Volcano", DR: "Drought", WF: "Wildfire"};
  let html = "";
  if (eonet) {
    const sum = eonet.summary || {};
    const stale = eonet.stale ? ' <span class="tag">stale</span>' : "";
    html += `<div><b>NASA EONET</b> open events: ${gsEsc(sum.open_events != null ? sum.open_events : "–")}${stale}</div>`;
    if (!eonet.ok && !sum.open_events && !sum.top) {
      html += `<div class="muted">${gsEsc(eonet.error || "degraded")}</div>`;
    } else {
      const cats = sum.by_category || {};
      const names = priority.concat(Object.keys(cats).filter(k => !priority.includes(k)));
      const bits = names.filter(n => (cats[n] || 0) > 0 || priority.includes(n)).map(n => `${gsEsc(n)} ${gsEsc(cats[n] || 0)}`);
      if (bits.length) html += `<div class="muted">${bits.join(" · ")}</div>`;
      const top = sum.top || [];
      html += "<table><tr><th>event</th><th>category</th></tr>";
      if (!top.length) html += '<tr><td colspan="2" class="muted">no open events in this window</td></tr>';
      for (const ev of top.slice(0, 12)) {
        const href = gsUrl(ev.link);
        const title = ev.title ? (href ? `<a href="${gsEsc(href)}">${gsEsc(ev.title)}</a>` : gsEsc(ev.title)) : "–";
        html += `<tr><td>${title}</td><td class="muted">${gsEsc(ev.category || "")}</td></tr>`;
      }
      html += "</table>";
    }
  }
  if (gdacs) {
    const sum = gdacs.summary || {};
    const stale = gdacs.stale ? ' <span class="tag">stale</span>' : "";
    const fb = (sum.fallback || sum.endpoint) ? ` · ${gsEsc(sum.endpoint || "fallback")}` : "";
    html += `<div><b>GDACS</b> Orange/Red events: ${gsEsc(sum.events != null ? sum.events : "–")}${stale}<span class="muted">${fb}</span></div>`;
    if (!gdacs.ok && !(sum.top || []).length && sum.events == null) {
      html += `<div class="muted">${gsEsc(gdacs.error || "degraded")}</div>`;
    } else {
      if (gdacs.degraded && gdacs.error) html += `<div class="muted">${gsEsc(gdacs.error)}</div>`;
      const types = sum.by_type || {}, alerts = sum.by_alert || {};
      const tbits = Object.keys(types).map(k => `${gsEsc(gdacsType[k] || k)} ${gsEsc(types[k])}`);
      const abits = Object.keys(alerts).map(k => `${gsEsc(k)} ${gsEsc(alerts[k])}`);
      if (tbits.length || abits.length) html += `<div class="muted">${tbits.join(" · ")}${tbits.length && abits.length ? " · " : ""}${abits.join(" · ")}</div>`;
      const top = sum.top || [];
      html += "<table><tr><th>event</th><th>alert</th><th>where</th></tr>";
      if (!top.length) html += '<tr><td colspan="3" class="muted">no Orange or Red events in this window</td></tr>';
      for (const ev of top.slice(0, 12)) {
        const typ = gdacsType[ev.type] || ev.type || "";
        html += `<tr><td>${gsEsc(ev.name || typ)}</td><td>${gsEsc(ev.alert || "")}</td><td class="muted">${gsEsc(ev.country || typ)}</td></tr>`;
      }
      html += "</table>";
    }
  }
  html += '<div class="muted">Credit: <a href="https://eonet.gsfc.nasa.gov/">NASA EONET</a> (public domain) · <a href="https://www.gdacs.org/">EC JRC / GDACS</a></div>';
  el.innerHTML = html;
  panel.hidden = false;
}

function renderLoosh(panel) {
  if (!panel) return;
  const el = panel.querySelector("#loosh") || panel;
  gsGet("data/loosh.json").then(doc => {
    if (!doc || typeof doc !== "object") {
      panel.hidden = true;
      el.innerHTML = "";
      return;
    }
    const num = v => (v == null || v === "") ? "missing" : gsEsc(v);
    const km = v => v == null ? "–" : gsEsc(Number(v).toFixed(0)) + " km";
    const bar = (v, color) => v == null ? '<span class="muted">missing</span>'
      : `<div style="background:#21262d;border-radius:4px;height:8px"><div style="width:${Math.max(0, Math.min(100, Number(v)))}%;height:8px;border-radius:4px;background:${color}"></div></div>`;
    const real = doc.real_hazard || {};
    const fear = doc.fear || {};
    const gap = doc.gap || {};
    const gapClass = /act/.test(gap.label || "") ? "bad" : (/exceeds local/.test(gap.label || "") ? "muted" : "ok");
    let html = '<p class="muted">Real = official, local, verified hazards. Loosh = collective fear pressure in news and attention. Aggregate only; not predictive; not used in the hazard index.</p>';
    if (!doc.ok) {
      html += `<div class="muted">${gsEsc(doc.error || "unavailable")}</div>`;
    }
    html += "<table>";
    html += `<tr><td><b>Real Hazard Level</b><br><span class="muted">${gsEsc((real.home && real.home.name) || "Rogers, AR")} + ${gsEsc(real.region || "NW Arkansas / Ozark")}</span></td><td style="width:45%">${bar(real.level, "#f85149")}</td><td><b>${num(real.level)}</b> ${gsEsc(real.label || "")}</td></tr>`;
    html += `<tr><td><b>Fear Pressure Index</b><br><span class="muted">global ${num(fear.global_index)} · US ${num(fear.us_index)}</span></td><td>${bar(fear.index, "#a371f7")}</td><td><b>${num(fear.index)}</b></td></tr>`;
    html += `<tr><td><b>Gap</b> (fear − real)</td><td colspan="2"><b class="${gapClass}">${gsEsc(gap.label || "missing")}</b> · ${num(gap.value)}</td></tr>`;
    html += "</table>";
    const items = (real.items || []).filter(i => i.score > 0 || i.actionable).slice(0, 10);
    html += `<div><b>Real hazards</b> · ${gsEsc(real.actionable_count || 0)} actionable</div>`;
    if (items.length) {
      html += "<table><tr><th>item</th><th>source</th><th>distance</th><th>severity</th><th>score</th><th>act?</th></tr>";
      for (const i of items) {
        const title = i.url ? `<a href="${gsEsc(i.url)}">${gsEsc(i.title)}</a>` : gsEsc(i.title);
        html += `<tr><td>${title}${i.area ? `<br><span class="muted">${gsEsc(i.area)}</span>` : ""}</td><td>${gsEsc(i.source)}${i.official ? "" : ' <span class="tag">statistical</span>'}</td>`;
        html += `<td>${km(i.distance_km)}</td><td>${gsEsc([i.severity, i.urgency, i.certainty].filter(Boolean).join(" / "))}</td>`;
        html += `<td>${gsEsc(Number(i.score).toFixed(2))}</td><td class="${i.actionable ? "bad" : "muted"}">${i.actionable ? "yes" : "no"}</td></tr>`;
      }
      html += "</table>";
    } else {
      html += '<div class="muted">no scored real hazards near home in this snapshot</div>';
    }
    if ((real.missing || []).length) html += `<div class="muted">missing: ${gsEsc(real.missing.join("; "))}</div>`;
    const themes = (fear.themes || []).slice().sort((a, b) => (b.score ?? -1) - (a.score ?? -1));
    html += "<div><b>Fear themes</b> (50 = normal vs 30-day baseline)</div>";
    html += "<table><tr><th>theme</th><th>score</th><th>GDELT global / US</th><th>Wikipedia</th><th>official signal</th></tr>";
    for (const t of themes) {
      const c = t.components || {};
      const sig = t.official_signal || {};
      const sigClass = sig.status === "match" ? "bad" : "muted";
      const sigText = sig.status === "match" ? "match" : (sig.status === "none_active" ? "none active" : (sig.status === "no_open_source" ? "no open source" : (sig.status || "missing")));
      html += `<tr><td>${gsEsc(t.label)}</td><td><b>${num(t.score)}</b></td><td>${num(c.gdelt_global)} / ${num(c.gdelt_us)}</td><td>${num(c.wikipedia)}</td>`;
      html += `<td class="${sigClass}">${gsEsc(sigText)}${sig.detail ? `<br><span class="muted">${gsEsc(sig.detail)}</span>` : ""}</td></tr>`;
    }
    html += "</table>";
    const g = fear.gdelt || {};
    const req = g.requests || {};
    const gk = g.gkg || {};
    let gnote;
    if (g.source === "gkg_files") {
      gnote = g.ok ? "GDELT GKG raw files" : "GDELT GKG files missing";
      gnote += ` (${gsEsc(gk.cached_files || 0)} sampled files, ${gsEsc(gk.cached_days || 0)} days; this run ${gsEsc(Math.round((gk.downloaded_bytes || 0) / 1e6))} MB)`;
      if (req.rate_limited) gnote += " · DOC API rate-limited";
    } else {
      gnote = g.ok ? (g.cached ? "GDELT DOC API cached " + gsEsc(g.fetched_at || "") : "GDELT DOC API ok") : "GDELT missing";
      if (req.rate_limited) gnote += " (rate-limited)";
    }
    html += `<div class="muted">${gnote} · Wikipedia ${(fear.wikipedia && fear.wikipedia.ok) ? "ok" : "missing"} · collected ${num(doc.collected_at)}</div>`;
    const adv = (doc.official_feeds || {}).cisa_advisories || {};
    html += "<div><b>CISA advisories</b> (aggregates only)</div>";
    if (!adv.ok) {
      html += `<div class="muted">${gsEsc(adv.error || "missing")}</div>`;
    } else {
      const srcNote = adv.source === "cisa_csaf_github"
        ? ' · source <a href="https://github.com/cisagov/CSAF">cisagov/CSAF</a> (RSS unreachable)'
        : " · source CISA advisories RSS";
      html += `<div class="muted">${gsEsc(adv.count_7d)} in the last 7 days · ${gsEsc(adv.count_30d)} in the last 30 days (feed window ${gsEsc(adv.feed_items || 0)} items)${srcNote}</div>`;
      const recent = adv.recent || [];
      if (recent.length) {
        html += "<table><tr><th>published</th><th>advisory</th><th>type</th></tr>";
        for (const a of recent.slice(0, 8)) {
          const href = gsUrl(a.url);
          const title = a.title ? (href ? `<a href="${gsEsc(href)}">${gsEsc(a.title)}</a>` : gsEsc(a.title)) : "–";
          html += `<tr><td class="muted">${gsEsc(a.published || "")}</td><td>${title}</td><td class="muted">${gsEsc(a.type || "")}</td></tr>`;
        }
        html += "</table>";
      }
    }
    html += '<div class="muted">Sources: NWS · USGS · NOAA SWPC · <a href="https://www.gdeltproject.org/">GDELT Project</a> · Wikimedia pageviews (CC0) · FDIC · <a href="https://www.cisa.gov/known-exploited-vulnerabilities-catalog">CISA KEV</a> · <a href="https://www.cisa.gov/cybersecurity-advisories/all.xml">CISA advisories RSS</a> · <a href="https://github.com/cisagov/CSAF">cisagov/CSAF</a> · <a href="https://www.cisa.gov/terms-use">CISA terms</a> · weights in docs/LOOSH.md</div>';
    el.innerHTML = html;
    panel.hidden = false;
  }).catch(() => {
    panel.hidden = true;
    el.innerHTML = "";
  });
}

const AUXCOMM_BENTON_SAME = "005007";
const AUXCOMM_BENTON_UGC = "ARC007";
const AUXCOMM_CALLING = ["VCALL10", "UCALL40", "7CALL50", "7CALL70", "8CALL90"];
const AUXCOMM_CATEGORY_GROUPS = [
  ["nationwide interop", /nationwide_interop/],
  ["mutual aid", /mutual_aid/],
  ["amateur emergency", /amateur/],
  ["MURS \/ FRS \/ GMRS \/ CB", /^(murs|frs|gmrs|cb)$/],
  ["NOAA Weather Radio", /noaa_weather_radio/],
  ["federal interop", /federal_interop/],
  ["SHARES", /shares/],
];

function auxcommNormSame(code) {
  const digits = String(code ?? "").replace(/\D/g, "");
  if (digits.length === 5) return "0" + digits;
  return digits.length === 6 ? digits : "";
}

function auxcommAffectsBenton(ev) {
  const raw = (ev && ev.raw) || {};
  const same = raw.same || [];
  const ugc = raw.ugc || [];
  if (same.some(c => auxcommNormSame(c) === AUXCOMM_BENTON_SAME)) return true;
  if (ugc.some(c => String(c).toUpperCase().split(",")[0].trim() === AUXCOMM_BENTON_UGC)) return true;
  return false;
}

function auxcommBentonAlerts(doc, snap) {
  const fromDoc = (doc && doc.benton_county_ar_alerts) || [];
  const fromSnap = ((snap && snap.events) || []).filter(auxcommAffectsBenton).map(ev => {
    const raw = ev.raw || {};
    return {
      id: ev.id, title: ev.title, event: raw.event, severity: raw.severity || ev.severity,
      urgency: raw.urgency, headline: raw.headline, expires: raw.expires, url: ev.url,
      same: raw.same || [], ugc: raw.ugc || [],
    };
  });
  const seen = new Set();
  const out = [];
  for (const a of fromSnap.concat(fromDoc)) {
    const key = a.id || a.title || JSON.stringify(a);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(a);
  }
  return out;
}

function auxcommCallingStrip(channels) {
  const wanted = new Set(AUXCOMM_CALLING);
  const byName = {};
  for (const ch of channels || []) {
    const n = String(ch.channel_name || "").toUpperCase();
    if (wanted.has(n) && !byName[n]) byName[n] = ch;
  }
  let html = '<div id="auxcomm-call"><b>National calling channels</b> <span class="tag">reference only</span><br>';
  html += '<span class="muted">Calling / hailing only. A license or served-agency authorization is required to transmit.</span><table>';
  html += "<tr><th>channel</th><th>RX MHz</th><th>TX MHz</th><th>tone / NAC</th><th>source</th></tr>";
  for (const name of AUXCOMM_CALLING) {
    const ch = byName[name];
    if (!ch) { html += `<tr><td>${gsEsc(name)}</td><td colspan="4" class="muted">not in this extract</td></tr>`; continue; }
    html += `<tr><td>${gsEsc(ch.channel_name)}</td><td>${gsEsc(ch.rx_mhz)}</td><td>${gsEsc(ch.tx_mhz)}</td>`;
    html += `<td>${gsEsc(ch.rx_ctcss_nac || "")}${ch.tx_ctcss_nac && ch.tx_ctcss_nac !== ch.rx_ctcss_nac ? " / TX " + gsEsc(ch.tx_ctcss_nac) : ""}</td>`;
    html += `<td class="muted">${gsEsc(ch.source_page || "")}</td></tr>`;
  }
  return html + "</table></div>";
}

function auxcommNwrBlock(nwr) {
  const txs = (nwr && nwr.transmitters) || [];
  let html = `<div><b>Benton County, AR NOAA Weather Radio</b> · SAME ${gsEsc((nwr && nwr.same_fips) || AUXCOMM_BENTON_SAME)} · ${gsEsc((nwr && nwr.wfo) || "NWS Tulsa")}</div>`;
  html += '<div class="muted">NWR is receive-only. These are official coverage transmitters, not a live audio feed.</div>';
  html += "<table><tr><th>call</th><th>site</th><th>MHz</th><th>power</th><th>status</th></tr>";
  for (const t of txs) {
    html += `<tr><td>${gsEsc(t.callsign)}</td><td>${gsEsc(t.sitename)} <span class="muted">(${gsEsc(t.siteloc)})</span></td>`;
    html += `<td>${gsEsc(t.frequency_mhz)}</td><td>${gsEsc(t.power_watts || "")} W</td><td class="muted">${gsEsc(t.status || "")}</td></tr>`;
  }
  html += "</table>";
  const disc = (nwr && nwr.source_discrepancy) || {};
  if (disc.description) {
    html += `<div class="muted"><b>Frequency discrepancy:</b> ${gsEsc(disc.description)} `;
    if (disc.wfo_tulsa_url) html += `<a href="${gsEsc(disc.wfo_tulsa_url)}">WFO Tulsa table</a> lists Grove at 162.500; `;
    if (disc.national_url) html += `the <a href="${gsEsc(disc.national_url)}">national NWR list</a> has WWH38 Grove at 162.525. `;
    html += "This panel uses the national program data and shows the disagreement.</div>";
  }
  return html;
}

function auxcommCategoryLabel(cat) {
  for (const [label, re] of AUXCOMM_CATEGORY_GROUPS) if (re.test(cat || "")) return label;
  return cat || "other";
}

function renderAuxcomm(panel, snap) {
  if (!panel) return;
  const el = panel.querySelector("#auxcomm") || panel;
  gsGet("data/auxcomm.json").then(doc => {
    if (!doc || !Array.isArray(doc.channels)) {
      panel.hidden = true;
      el.innerHTML = "";
      return;
    }
    const channels = doc.channels;
    const nwr = doc.local_nwr_benton_county_ar || {};
    const defaults = doc.defaults || {};
    const alerts = auxcommBentonAlerts(doc, snap);
    const ares = doc.local_ares_races_benton_county_ar || {};
    let html = '<p class="muted"><b>Reference data only.</b> This is a lookup sheet, not a radio. ';
    html += "No live interception, scanner, or LiveATC feed. Aggregates and published official tables only. ";
    html += "Transmitting on most of these channels requires an FCC license, NTIA authorization, SHARES registration, and/or served-agency / COML direction. ";
    html += "Showing a frequency here does not authorize you to transmit. NOAA Weather Radio is receive-only.</p>";
    html += '<div><span class="chip">CTCSS default 156.7 Hz</span>';
    html += '<span class="chip">VTAC repeater TX 136.5 Hz</span>';
    const nac = (defaults.p25_nac || {});
    html += `<span class="chip">P25 NAC ${gsEsc(nac.default_nac || "$293")} / unsquelch ${gsEsc(nac.receiver_unsquelch_any_nac || "$F7E")}</span>`;
    html += `<span class="chip">default TGID ${gsEsc(nac.default_talkgroup_id || "$0001")}</span></div>`;
    html += auxcommNwrBlock(nwr);
    if (alerts.length) {
      html += `<div><b>NWS alerts affecting Benton County, AR</b> · ${alerts.length} active in this snapshot</div>`;
      html += "<table><tr><th>alert</th><th>severity</th><th>expires</th></tr>";
      for (const a of alerts) {
        const href = gsUrl(a.url);
        const title = a.headline || a.title || a.event || "alert";
        const label = href ? `<a href="${gsEsc(href)}">${gsEsc(title)}</a>` : gsEsc(title);
        html += `<tr><td>${label}</td><td>${gsEsc(a.severity || "")}${a.urgency ? " / " + gsEsc(a.urgency) : ""}</td><td class="muted">${gsEsc(a.expires || "")}</td></tr>`;
      }
      html += "</table>";
      html += '<div class="muted">Local NWR transmitters and nationwide calling channels for this county context:</div>';
    }
    html += auxcommCallingStrip(channels);
    if (ares && ares.found_on_official_sources === false) {
      html += '<div class="muted">No official public Benton County ARES/RACES net frequencies were found on .gov sources, so none are listed. An Arkansas Field Operations Guide marked For Official Use Only is not used.</div>';
    }
    html += '<div class="muted">SHARES HF program notes are in NIFOG; the unpublished SHARES frequency list is not. See <a href="https://www.cisa.gov/shares">cisa.gov/shares</a>.</div>';
    const groups = [];
    const seenG = new Set();
    for (const ch of channels) {
      const label = auxcommCategoryLabel(ch.category);
      if (!seenG.has(label)) { seenG.add(label); groups.push(label); }
    }
    html += '<div><input id="auxcomm-q" type="search" placeholder="Search channel, assignment, MHz, page…" aria-label="Search AUXCOMM channels">';
    html += '<select id="auxcomm-cat" aria-label="Filter by category"><option value="">All categories</option>';
    for (const g of groups) html += `<option value="${gsEsc(g)}">${gsEsc(g)}</option>`;
    html += `</select> <span class="muted" id="auxcomm-count">${channels.length} channels</span></div>`;
    html += '<div class="scroll"><table id="auxcomm-table"><thead><tr><th>channel</th><th>assignment</th><th>RX</th><th>TX</th><th>tone / NAC</th><th>band</th><th>page</th></tr></thead><tbody></tbody></table></div>';
    const srcs = (doc.sources || []).map(s => `${s.name || ""} ${s.version || ""}`.trim()).filter(Boolean);
    html += '<div class="muted">Sources: ' + gsEsc(srcs.join(" · ") || "CISA NIFOG 2.02 and AUXFOG 1.1");
    html += ' · NOAA/NWS NWR · U.S. government works (17 U.S.C. § 105). Attribute CISA and NOAA/NWS. ';
    html += "Do not use CISA or SAFECOM logos. Verify against the current official PDF before operational use. ";
    html += 'Guides: <a href="https://www.cisa.gov/safecom/field-operations-guides">CISA field operations guides</a>. See docs/AUXCOMM.md.</div>';
    el.innerHTML = html;

    const tbody = el.querySelector("#auxcomm-table tbody");
    const qEl = el.querySelector("#auxcomm-q");
    const catEl = el.querySelector("#auxcomm-cat");
    const countEl = el.querySelector("#auxcomm-count");
    function apply() {
      const q = (qEl && qEl.value || "").trim().toLowerCase();
      const cat = (catEl && catEl.value) || "";
      const rows = [];
      for (const ch of channels) {
        const label = auxcommCategoryLabel(ch.category);
        if (cat && label !== cat) continue;
        const blob = [ch.channel_name, ch.assignment, ch.rx_mhz, ch.tx_mhz, ch.rx_ctcss_nac, ch.tx_ctcss_nac, ch.band, ch.source_page, ch.notes, ch.category].join(" ").toLowerCase();
        if (q && !blob.includes(q)) continue;
        const tone = (ch.rx_ctcss_nac || "") + (ch.tx_ctcss_nac && ch.tx_ctcss_nac !== ch.rx_ctcss_nac ? " / TX " + ch.tx_ctcss_nac : "");
        rows.push(`<tr><td>${gsEsc(ch.channel_name)}</td><td>${gsEsc(ch.assignment)}</td><td>${gsEsc(ch.rx_mhz)}</td><td>${gsEsc(ch.tx_mhz)}</td><td>${gsEsc(tone)}</td><td class="muted">${gsEsc(ch.band)}</td><td class="muted">${gsEsc(ch.source_page || "")}</td></tr>`);
      }
      tbody.innerHTML = rows.join("") || '<tr><td colspan="7" class="muted">no matching channels</td></tr>';
      if (countEl) countEl.textContent = rows.length + " of " + channels.length + " channels";
    }
    if (qEl) qEl.addEventListener("input", apply);
    if (catEl) catEl.addEventListener("change", apply);
    apply();
    panel.hidden = false;
  }).catch(() => {
    panel.hidden = true;
    el.innerHTML = "";
  });
}

function neoFmtNum(v, d) {
  if (v == null || v === "") return "–";
  const n = Number(v);
  if (!Number.isFinite(n)) return "–";
  return n.toFixed(d);
}

function neoSize(item) {
  if (!item || item.diameter_km == null) return "–";
  const km = Number(item.diameter_km);
  if (!Number.isFinite(km)) return "–";
  let label;
  if (km >= 1) label = neoFmtNum(km, 2) + " km";
  else label = neoFmtNum(km * 1000, 0) + " m";
  if (item.diameter_source === "h_albedo_0.14") label += " est.";
  return label;
}

function renderNeo(panel) {
  if (!panel) return;
  const el = panel.querySelector("#neo") || panel;
  gsGet("data/neo.json").then(doc => {
    if (!doc || typeof doc !== "object") {
      panel.hidden = true;
      el.innerHTML = "";
      return;
    }
    const close = doc.close_approaches || {};
    const sentry = doc.sentry || {};
    const fire = doc.fireballs || {};
    const stel = doc.stellarium || {};
    const live = doc.livemeteors || {};
    const home = doc.home || {};
    let html = '<p class="muted">Official NASA/JPL CNEOS catalog context, not a forecast, and not used in the hazard index. A close approach is not an impact.</p>';
    if (!doc.ok) html += `<div class="muted">${gsEsc(doc.error || "CNEOS feeds unavailable")}</div>`;
    else if (doc.degraded) html += '<div class="muted">One or more CNEOS feeds were unavailable in this refresh; other tables below still use what arrived.</div>';
    const stelUrl = gsUrl(stel.url || "https://stellarium-web.org/");
    const liveUrl = gsUrl(live.url || "https://www.livemeteors.com/");
    const place = home.name || "Rogers, AR";
    html += `<div>Sky view: <a href="${gsEsc(stelUrl)}" target="_blank" rel="noopener">Stellarium Web (${gsEsc(place)})</a>`;
    html += ' <span class="muted">· outbound link only; nothing from Stellarium is embedded</span></div>';
    html += `<div>Listen live: <a href="${gsEsc(liveUrl)}" target="_blank" rel="noopener">radio meteor echoes (LiveMeteors.com)</a>`;
    html += ' <span class="muted">· outbound link only; nothing from LiveMeteors is ingested or embedded. Summer Sporadic E can mask meteor echoes.</span></div>';

    html += `<div><b>Upcoming close approaches</b> · next ${gsEsc(close.window_days || 60)} days · ≤ ${gsEsc(close.dist_max_au || 0.05)} au · ${gsEsc(close.count || 0)} objects`;
    html += ` · <a href="https://cneos.jpl.nasa.gov/ca/">CNEOS CA</a></div>`;
    const approaches = close.items || [];
    if (!close.ok) {
      html += `<div class="muted">${gsEsc(close.error || "close-approach feed unavailable")}</div>`;
    } else if (!approaches.length) {
      html += '<div class="muted">no Earth close approaches within 0.05 au in the next 60 days</div>';
    } else {
      html += "<table><tr><th>object</th><th>date (CT)</th><th>distance</th><th>velocity</th><th>est. size</th></tr>";
      for (const a of approaches) {
        const dist = (a.dist_ld == null ? "–" : neoFmtNum(a.dist_ld, 2) + " LD") +
          (a.dist_au == null ? "" : " / " + neoFmtNum(a.dist_au, 4) + " au");
        html += `<tr><td>${gsEsc(a.name || a.des || "")}</td><td class="muted">${gsEsc(a.time_ct || "")}</td>`;
        html += `<td>${gsEsc(dist)}</td><td>${a.v_rel_km_s == null ? "–" : gsEsc(neoFmtNum(a.v_rel_km_s, 2)) + " km/s"}</td>`;
        html += `<td>${gsEsc(neoSize(a))}</td></tr>`;
      }
      html += "</table>";
      html += '<div class="muted">Size is the JPL diameter when published, otherwise an estimate from H at albedo 0.14 (CNEOS convention).</div>';
    }

    html += `<div><b>Sentry top risks</b> · top ${gsEsc((sentry.items || []).length)} of ${gsEsc(sentry.catalog_count == null ? "–" : sentry.catalog_count)}`;
    html += ` · <a href="https://cneos.jpl.nasa.gov/sentry/">CNEOS Sentry</a></div>`;
    if (!sentry.ok) {
      html += `<div class="muted">${gsEsc(sentry.error || "Sentry feed unavailable")}</div>`;
    } else {
      if (sentry.note) html += `<div class="muted">${gsEsc(sentry.note)}</div>`;
      const risks = sentry.items || [];
      if (!risks.length) {
        html += '<div class="muted">no Sentry objects in this snapshot</div>';
      } else {
        html += "<table><tr><th>object</th><th>impact prob.</th><th>Palermo</th><th>Torino</th><th>est. size</th><th>years</th></tr>";
        for (const r of risks) {
          const ip = r.ip == null ? "–" : Number(r.ip).toExponential(2);
          html += `<tr><td>${gsEsc(r.name || r.des || "")}</td><td>${gsEsc(ip)}</td>`;
          html += `<td>${r.ps_cum == null ? "–" : gsEsc(neoFmtNum(r.ps_cum, 2))}</td>`;
          html += `<td>${r.ts_max == null ? "–" : gsEsc(r.ts_max)}</td>`;
          html += `<td>${gsEsc(neoSize(r))}</td><td class="muted">${gsEsc(r.year_range || "")}</td></tr>`;
        }
        html += "</table>";
      }
    }

    html += `<div><b>Recent fireballs</b> · ${gsEsc(fire.count || 0)} · <a href="https://cneos.jpl.nasa.gov/fireballs/">CNEOS fireballs</a></div>`;
    const bolides = fire.items || [];
    if (!fire.ok) {
      html += `<div class="muted">${gsEsc(fire.error || "fireball feed unavailable")}</div>`;
    } else if (!bolides.length) {
      html += '<div class="muted">no recent fireballs in this snapshot</div>';
    } else {
      html += "<table><tr><th>date (CT)</th><th>impact energy</th><th>where</th><th>alt.</th><th>velocity</th></tr>";
      for (const f of bolides) {
        const where = (f.lat == null || f.lon == null) ? "–" :
          `${neoFmtNum(f.lat, 1)}, ${neoFmtNum(f.lon, 1)}`;
        html += `<tr><td class="muted">${gsEsc(f.time_ct || "")}</td>`;
        html += `<td>${f.impact_energy_kt == null ? "–" : gsEsc(neoFmtNum(f.impact_energy_kt, 2)) + " kt"}</td>`;
        html += `<td>${gsEsc(where)}</td>`;
        html += `<td>${f.altitude_km == null ? "–" : gsEsc(neoFmtNum(f.altitude_km, 1)) + " km"}</td>`;
        html += `<td>${f.velocity_km_s == null ? "–" : gsEsc(neoFmtNum(f.velocity_km_s, 1)) + " km/s"}</td></tr>`;
      }
      html += "</table>";
    }

    const attr = doc.attribution || {};
    html += `<div class="muted">${gsEsc(attr.credit || "NASA/JPL Center for Near-Earth Object Studies (CNEOS)")}`;
    html += ' · <a href="https://cneos.jpl.nasa.gov/">cneos.jpl.nasa.gov</a>';
    html += ' · <a href="https://ssd-api.jpl.nasa.gov/">SSD/CNEOS API</a>';
    html += " · U.S. government work. See docs/NEO.md.</div>";
    el.innerHTML = html;
    panel.hidden = false;
  }).catch(() => {
    panel.hidden = true;
    el.innerHTML = "";
  });
}


// Data provenance panel (GEOSENTINEL_PROVENANCE). Status pills only; no payloads.
// Receipt idea adapted from tribunal by Kevin Michael Talbert (BleakNarratives), MIT.
const PROV_LABELS = {
  verified_live: "verified live",
  cached: "cached last-good",
  reference: "reference / computed",
  simulated: "simulated",
  unverified: "unverified",
};
function renderProvenance(panel, d) {
  if (!panel) return;
  const el = panel.querySelector("#provenance") || panel;
  const p = d && d.provenance;
  if (!p || typeof p !== "object") { panel.hidden = true; el.innerHTML = ""; return; }
  panel.hidden = false;
  if (!p.ok || !Array.isArray(p.records)) {
    el.innerHTML = `<p class="bad">Provenance check degraded: ${gsEsc(p.error || "no records")}</p>`;
    return;
  }
  const c = p.counts || {};
  const pills = Object.keys(PROV_LABELS).map(s =>
    `<span class="pv pv-${s}">${gsEsc(PROV_LABELS[s])}: ${gsEsc(c[s] || 0)}</span>`).join(" ");
  const notLive = p.records.filter(r => r.status !== "verified_live");
  const rows = notLive.map(r => `<tr><td>${gsEsc(r.name || r.source)}</td><td class="muted">${gsEsc(r.kind)}</td>` +
    `<td><span class="pv pv-${gsEsc(r.status)}">${gsEsc(PROV_LABELS[r.status] || r.status)}</span></td>` +
    `<td class="muted">${gsEsc(r.note || r.error || "")}</td></tr>`).join("");
  el.innerHTML = `<p>${pills}</p>` +
    `<p class="muted">${gsEsc(c.verified_live || 0)} of ${gsEsc(p.total)} sources were fetched live this run. ` +
    `Anything not marked verified live is not evidence on its own. Simulated data is never shown as verified.</p>` +
    (rows ? `<details><summary>Not verified live (${notLive.length})</summary><div class="scroll"><table>${rows}</table></div></details>` : "") +
    `<p class="muted">${gsEsc(p.label || "")}. ${gsEsc(p.credit || "")}.</p>`;
}
