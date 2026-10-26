import * as THREE from 'three';
import { createScene, buildContext, buildProject, buildTraffic } from './world.js';
import { rad, bearing, compass, angDiff } from './geom.js';

const $ = (s, r = document) => r.querySelector(s);
const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const pad = n => String(n).padStart(2, '0');
const store = { get(k, d) { try { return JSON.parse(localStorage.getItem(k)) ?? d; } catch { return d; } }, set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch {} } };

export async function boot(cfg) {
  const D = await (await fetch(cfg.data)).json();
  const A = cfg.assets.replace(/\/?$/, '/');
  const AG = D.agent, first = AG.name.split(' ')[0];
  document.title = cfg.title || `${D.name} 3D Explorer`;

  // ---------- shell ----------
  $('#app').innerHTML = `
  <header class="top">
    <div class="id"><h1>${esc(D.name)} · 3D Explorer</h1><p>${esc(D.subtitle)} · by ${esc(AG.name)}, ${esc(AG.agency)}</p></div>
    <a class="wa" id="topwa" href="#" target="_blank" rel="noopener">WhatsApp <span>${esc(first)}</span></a>
  </header>
  <div class="body">
    <div class="stage">
      <canvas id="gl" aria-label="Interactive 3D model of ${esc(D.name)}. Drag to turn, scroll or pinch to zoom, tap any home."></canvas>
      <div class="labels" id="labels"></div>
      <div class="tip" id="tip" hidden></div>
      <div class="tools" id="tools"></div>
      <div class="status" id="status" hidden></div>
      <div class="lookbar" id="lookbar" hidden><span id="looktxt"></span><button id="lookexit">Back to model</button></div>
      <div class="attrib" id="attrib"></div>
      <div class="views" id="views"></div>
    </div>
    <aside class="panel">
      <nav class="tabs" role="tablist">
        <button role="tab" data-tab="explore" aria-selected="true">Explore</button>
        <button role="tab" data-tab="facilities" aria-selected="false">Facilities</button>
        <button role="tab" data-tab="around" aria-selected="false">Around</button>
        <button role="tab" data-tab="facts" aria-selected="false">Factsheet</button>
      </nav>
      <div class="pane" id="pane"><div class="pane-in" id="pin"></div></div>
      <div class="shortbar" id="shortbar" hidden></div>
      <div class="foot"><b>${esc(AG.name)}</b> · CEA ${esc(AG.cea)} · ${esc(AG.agency)} (${esc(AG.agencyLicence)}) · WhatsApp <span style="font-family:var(--mono)">${esc(AG.display)}</span><br>${esc(D.disclaimer)}</div>
    </aside>
  </div>`;
  const waLink = msg => `https://wa.me/${AG.whatsapp}?text=${encodeURIComponent(msg)}`;
  $('#topwa').href = waLink(`Hi ${first}, I'm looking at the ${D.name} 3D Explorer and have a few questions.`);

  // ---------- world ----------
  const canvas = $('#gl');
  const { renderer, scene, camera, controls } = createScene(canvas);
  const P = buildProject(D);
  scene.add(P.group);
  const C = buildContext(D, P.siteTest);
  scene.add(C.group, C.furniture);
  const T = buildTraffic(C.roadLines, P.siteTest);
  scene.add(T.group);
  const { units, byKey, blocks, inst } = P;
  const SH = D.storeyHeight;

  const cat = code => { if (!code) return null; const b = code.replace(' (L)', ''); for (const e of D.typeCatalogue) if (new RegExp(e.match).test(b)) return e; return null; };
  const groupOf = id => D.groups.find(g => g.id === id);
  const pType = t => t.includes(' (L)') ? t.replace(' (L)', 'p (L)') : t + 'p';
  units.forEach(u => { const s = u.stack; if (s.type) { u.type = s.pFloor === u.f ? pType(s.type) : s.type; u.cat = cat(u.type); u.plan = s.type.replace(' (L)', 'L').replace(/\s/g, ''); } });
  const counts = {}; units.forEach(u => { if (u.cat) counts[u.cat.group] = (counts[u.cat.group] || 0) + 1; });
  const SI = D.stackInfo || {}, PR = D.prices || {}, PM = D.priceMeta;
  Object.values(blocks).forEach(B => B.stacks.forEach(s => { const si = SI[s.no]; if (si && si.bearing != null) { s.bearing = si.bearing; const r = rad(si.bearing); s.out = [Math.sin(r), -Math.cos(r)]; } }));
  units.forEach(u => { const p = PR[u.key]; if (p) { u.price = p[0]; u.psf = p[1]; u.flag = p[2] >= 0 ? PM.flags[p[2]] : ''; } });
  const hasPrices = units.some(u => u.price);
  const fmt$ = n => '$' + Math.round(n).toLocaleString('en-SG');
  const fmtM = n => '$' + (n / 1e6).toFixed(n >= 1e7 ? 1 : n % 1e5 === 0 ? 1 : 2) + 'M';
  const priceList = units.filter(u => u.price).map(u => u.price).sort((a, b) => a - b);
  const pMin = priceList[0] || 0, pMax = priceList[priceList.length - 1] || 0;

  // ---------- state & colour ----------
  const st = { sel: null, hover: null, groups: new Set(), colorTypes: false, look: false, fac: null, showFac: false, tab: 'explore', photoreal: false, short: store.get(`short:${D.slug}`, []) };
  const col = new THREE.Color(), BRASS = new THREE.Color('#c08a2e'), DIM = new THREE.Color('#d9ddd6'), HOVER = new THREE.Color('#bfc8c4');
  const BASE = { Classic: new THREE.Color('#ffffff'), Luxury: new THREE.Color('#ffffff') };
  function paint() {
    units.forEach(u => {
      if ((st.colorTypes || st.groups.size) && u.cat) col.set(groupOf(u.cat.group).color); else col.copy(BASE[blocks[u.blk].collection] || BASE.Classic);
      if (st.groups.size && !(u.cat && st.groups.has(u.cat.group))) col.copy(DIM);
      if (st.budget) { if (u.price && u.price <= st.budget && (!st.groups.size || (u.cat && st.groups.has(u.cat.group)))) col.set('#f0bf45'); else col.copy(DIM); }
      if (st.sel) { if (u === st.sel) col.copy(BRASS); else if (u.no === st.sel.no) col.lerp(BRASS, 0.3); }
      if (st.short.includes(u.key) && u !== st.sel) col.lerp(new THREE.Color('#7a5ec8'), 0.55);
      if (st.hover === u && u !== st.sel) col.lerp(HOVER, 0.6);
      inst.setColorAt(u, col);
    });
    inst.flush();
    Object.values(blocks).forEach(B => B.label?.classList.toggle('on', !!st.sel && st.sel.blk === B.id));
    facPins.forEach(p => p.el.classList.toggle('on', st.fac === p.f));
  }

  // ---------- labels ----------
  const labelsEl = $('#labels'), labels = [];
  const addLabel = (html, cls, v, onClick, layer = 'base') => {
    const el = document.createElement('div'); el.className = cls; el.innerHTML = html;
    if (onClick) { el.setAttribute('role', 'button'); el.tabIndex = 0; el.addEventListener('click', onClick); el.addEventListener('keydown', e => { if (e.key === 'Enter') onClick(); }); }
    labelsEl.appendChild(el); const L = { el, v, layer }; labels.push(L); return L;
  };
  Object.values(blocks).forEach(B => { B.label = addLabel('Blk ' + esc(B.id), 'lbl blk', new THREE.Vector3(B.ccx, B.base + B.top * SH + 12, B.ccz), () => flyToBlock(B.id)).el; });
  C.stops.forEach(s => addLabel(`<b>${esc(s.code)}</b>${esc(s.name)}`, 'lbl poi bus', new THREE.Vector3(s.x, 6, s.z), null, 'transit'));
  C.mrt.forEach(m => addLabel(`<b>TE8</b>Exit ${esc(m.exit)}`, 'lbl poi mrt', new THREE.Vector3(m.x, 9, m.z), null, 'transit'));
  const seenRoad = new Set();
  C.roadLines.filter(r => r.name && (r.cls === 'P' || r.cls === 'S' || r.cls === 'T' || r.cls === 'r')).sort((a, b) => b.pts.length - a.pts.length).forEach(r => {
    const L = r.pts.reduce((s, p, i) => i ? s + Math.hypot(p[0] - r.pts[i - 1][0], p[1] - r.pts[i - 1][1]) : 0, 0);
    if (L < 60 || seenRoad.has(r.name)) return; seenRoad.add(r.name);
    const m = r.pts[Math.floor(r.pts.length / 2)], n = r.pts[Math.min(r.pts.length - 1, Math.floor(r.pts.length / 2) + 1)];
    addLabel(esc(r.name), 'lbl road', new THREE.Vector3((m[0] + n[0]) / 2, 1, (m[1] + n[1]) / 2), null, 'model');
  });
  C.labels.forEach(b => addLabel(esc(b.name), 'lbl bld', new THREE.Vector3(b.x, b.y, b.z), null, 'model'));
  const facPins = D.facilities.map(f => {
    const L = addLabel(String(f.n), 'pin ' + f.club, new THREE.Vector3(f.x, P.groundAt(f.x, f.z) + 3, f.z), () => selectFacility(f), 'fac');
    L.f = f; L.el.title = f.name; return L;
  });
  const pv = new THREE.Vector3();
  function placeLabels() {
    const w = canvas.clientWidth, h = canvas.clientHeight;
    labels.forEach(l => {
      let show = true;
      if (l.layer === 'fac') show = st.showFac || st.tab === 'facilities';
      if (l.layer === 'model') show = !st.photoreal;
      if (st.look && l.layer !== 'base') show = false;
      if (show) { pv.copy(l.v).project(camera); show = pv.z < 1 && Math.abs(pv.x) < 1.05 && Math.abs(pv.y) < 1.05; }
      if (show && l.layer === 'transit') { show = camera.position.distanceTo(l.v) < 900; }
      l.el.style.display = show ? '' : 'none';
      if (show) { l.el.style.left = ((pv.x + 1) / 2 * w) + 'px'; l.el.style.top = ((1 - pv.y) / 2 * h) + 'px'; }
    });
  }

  // ---------- camera ----------
  const CAMS = {
    overview: { pos: [-330, 380, 420], target: [30, 30, -60], label: 'Overview' },
    plan: { pos: [30, 900, -59], target: [30, 0, -60], label: 'Site plan' },
    road: { pos: [-260, 40, 120], target: [10, 45, -80], label: 'From Upper Thomson Rd' },
    mrt: { pos: [330, 70, 260], target: [100, 40, 20], label: 'From the MRT' },
    nature: { pos: [-520, 160, -140], target: [0, 40, -80], label: 'From the nature reserve' },
  };
  let anim = null;
  const fit = c => { const p = new THREE.Vector3(...c.pos), t = new THREE.Vector3(...c.target), k = camera.aspect < 1 ? Math.min(2.2, 1.15 / camera.aspect) : 1; return p.sub(t).multiplyScalar(k).add(t); };
  const fly = (p1, t1, done) => { anim = { s: performance.now(), p0: camera.position.clone(), t0: controls.target.clone(), p1, t1, done }; };
  const viewsEl = $('#views');
  Object.entries(CAMS).forEach(([k, c]) => { const b = document.createElement('button'); b.className = 'chipbtn'; b.textContent = c.label; b.dataset.k = k; b.setAttribute('aria-pressed', k === 'overview'); b.onclick = () => goView(k); viewsEl.appendChild(b); });
  const clearViews = () => [...viewsEl.children].forEach(b => b.setAttribute('aria-pressed', 'false'));
  function goView(k) { exitLook(true); fly(fit(CAMS[k]), new THREE.Vector3(...CAMS[k].target)); [...viewsEl.children].forEach(b => b.setAttribute('aria-pressed', b.dataset.k === k)); }
  function flyToBlock(id) {
    exitLook(true); const B = blocks[id], t = new THREE.Vector3(B.ccx, B.base + B.top * SH * 0.5, B.ccz);
    const dir = camera.position.clone().sub(controls.target); dir.y = Math.max(dir.y, 70); dir.setLength(B.top > 25 ? 280 : 230); fly(t.clone().add(dir), t); clearViews();
  }

  // look out from a unit
  let saved = null;
  function lookOut(u) {
    const [ox0, oz0] = u.stack.out, L = Math.hypot(ox0, oz0) || 1, ox = ox0 / L, oz = oz0 / L;
    if (!st.look) saved = { p: camera.position.clone(), t: controls.target.clone() };
    st.look = true;
    const eye = new THREE.Vector3(u.x + ox * 6.5, u.y + 0.3, u.z + oz * 6.5);
    controls.minDistance = 0; controls.maxDistance = Infinity; controls.enableZoom = false; controls.enablePan = false; controls.maxPolarAngle = Math.PI * 0.62;
    fly(eye, eye.clone().add(new THREE.Vector3(ox, 0, oz).multiplyScalar(0.6)), () => { if (st.look) { controls.minDistance = 0.1; controls.maxDistance = 1; } });
    camera.fov = 60; camera.updateProjectionMatrix();
    $('#looktxt').textContent = `From #${u.key} · facing ${compass(u.stack.bearing)} · drag to look around`;
    $('#lookbar').hidden = false; clearViews(); $('#lookbtn')?.setAttribute('aria-pressed', 'true');
  }
  function exitLook(silent) {
    if (!st.look) return; st.look = false; $('#lookbar').hidden = true;
    camera.fov = 35; camera.updateProjectionMatrix();
    controls.minDistance = 30; controls.maxDistance = 2200; controls.enableZoom = true; controls.enablePan = true; controls.maxPolarAngle = Math.PI * 0.495;
    if (!silent && saved) fly(saved.p, saved.t);
    $('#lookbtn')?.setAttribute('aria-pressed', 'false');
  }
  $('#lookexit').onclick = () => exitLook(false);

  // ---------- tools ----------
  const toolsEl = $('#tools');
  const tool = (label, pressed, onClick, id) => { const b = document.createElement('button'); b.className = 'chipbtn'; b.textContent = label; if (id) b.id = id; b.setAttribute('aria-pressed', pressed); b.onclick = () => onClick(b); toolsEl.appendChild(b); return b; };
  tool('Unit types', false, b => { st.colorTypes = !st.colorTypes; b.setAttribute('aria-pressed', st.colorTypes); paint(); });
  tool('Facilities', false, b => { st.showFac = !st.showFac; b.setAttribute('aria-pressed', st.showFac); });
  let photoreal = null, prTimer = null;
  const prBtn = cfg.mapsKey ? tool('Photoreal city', false, b => togglePhotoreal(b), 'prbtn') : null;
  async function togglePhotoreal(b) {
    if (!photoreal) {
      b.disabled = true; setStatus('Loading the photoreal city…');
      try {
        const { loadPhotoreal } = await import('./tiles.js');
        photoreal = await loadPhotoreal({ key: cfg.mapsKey, D, scene, camera, renderer, project: P, onStatus: (s, msg) => {
          if (s === 'ready') { setStatus(''); clearTimeout(prTimer); if (st.photoreal) setPhotoreal(true); } if (s === 'calibrated' && st.photoreal) T.setHeights(photoreal.heightAt); if (s === 'error') { setStatus(msg + ' Showing the model city.'); setPhotoreal(false); }
        } });
      } catch (e) { console.error(e); setStatus('The photoreal city could not load. Showing the model city.'); b.disabled = false; return; }
      b.disabled = false;
      prTimer = setTimeout(() => { if (!photoreal?.ready) { setStatus(''); setPhotoreal(false); b.disabled = true; b.title = 'The photoreal city is only available on xavierchong.sg'; } }, 20000);
    }
    setPhotoreal(!st.photoreal);
  }
  function setPhotoreal(on) {
    st.photoreal = on; prBtn?.setAttribute('aria-pressed', on);
    const real = on && !!photoreal?.ready;
    if (photoreal) photoreal.holder.visible = on;
    C.group.visible = !real; C.furniture.visible = !real;
    if (on && !real) setStatus('Loading the photoreal city…');
    T.setHeights(on && photoreal?.ready ? photoreal.heightAt : null);
    scene.fog.far = real ? 6000 : 2600; scene.background = new THREE.Color(real ? '#dfe8ee' : '#e9eeec');
    $('#attrib').textContent = real ? '' : (D.osm.attribution || '');
  }
  $('#attrib').textContent = D.osm.attribution || '';
  const setStatus = t => { const s = $('#status'); s.textContent = t; s.hidden = !t; };

  // ---------- panel ----------
  const pin = $('#pin'), pane = $('#pane');
  const tabs = [...document.querySelectorAll('.tabs button')];
  tabs.forEach(t => t.onclick = () => showTab(t.dataset.tab));
  function showTab(tab) {
    st.tab = tab; tabs.forEach(t => t.setAttribute('aria-selected', t.dataset.tab === tab));
    if (st.sel && tab === 'explore') return renderUnit();
    ({ explore: renderExplore, facilities: renderFacilities, around: renderAround, facts: renderFacts })[tab]();
    pane.scrollTop = 0;
  }

  const factsHTML = () => `<dl class="facts">${D.facts.map(([k, v]) => `<div><dt>${esc(k)}</dt><dd>${esc(v)}</dd></div>`).join('')}</dl>`;
  function renderExplore() {
    pin.innerHTML = `
      <div><div class="eyebrow">New launch · interactive 3D</div><h2>${esc(D.name)}</h2></div>
      <img class="hero" src="${A}ai/hero.jpg" alt="Artist's impression of ${esc(D.name)}" loading="lazy">
      <p class="lede">${esc(D.lede)}</p>
      ${factsHTML()}
      <div><div class="eyebrow" style="margin-bottom:8px">Have a unit in mind?</div>
        <form class="find" id="find"><input id="findin" inputmode="numeric" autocomplete="off" placeholder="e.g. 18-20" aria-label="Unit number, floor then stack"><button>Go</button></form></div>
      <p class="err" id="finderr" hidden></p>
      <p class="note">Stack numbers 01 to 55 are unique across the development, so no block is needed.</p>
      ${hasPrices ? `<div><div class="eyebrow" style="margin-bottom:8px">Slide to your budget</div>
        <input type="range" id="budget" min="${pMin}" max="${pMax}" step="10000" value="${st.budget || pMax}" style="width:100%;accent-color:var(--brass)" aria-label="Budget">
        <div style="display:flex;justify-content:space-between;align-items:baseline;gap:8px;margin-top:4px"><b id="budgetval" style="font:600 20px var(--display)">${st.budget ? fmt$(st.budget) : 'Any budget'}</b><span class="note" id="budgetn"></span></div>
        <p class="note" style="margin-top:6px">Homes within budget light up in gold. Combine with the unit types below. Indicative estimates, not developer prices.</p>
        <button class="ghost" id="budgetclear" style="margin-top:6px" ${st.budget ? '' : 'hidden'}>Clear budget</button></div>` : ''}
      <div><div class="eyebrow" style="margin-bottom:8px">Light up unit types</div>
        <div class="row">${D.groups.map(g => `<button class="chip" data-g="${g.id}" aria-pressed="${st.groups.has(g.id)}"><i class="sw" style="background:${g.color}"></i>${esc(g.label)} <span class="n">${counts[g.id] || 0}</span></button>`).join('')}</div></div>
      <div><div class="eyebrow" style="margin-bottom:8px">Go to a block</div>
        <div class="row">${Object.values(blocks).map(B => `<button class="chip" data-b="${B.id}">Blk ${B.id} <span class="n">${B.top} storeys</span></button>`).join('')}</div></div>
      <p class="note">Tap any home in the model to see its unit number, layout, size, facing and the developer's drone photo for that direction.</p>`;
    pin.querySelectorAll('[data-g]').forEach(el => el.onclick = () => { const g = el.dataset.g; st.groups.has(g) ? st.groups.delete(g) : st.groups.add(g); el.setAttribute('aria-pressed', st.groups.has(g)); paint(); budgetCount(); });
    pin.querySelectorAll('[data-b]').forEach(el => el.onclick = () => flyToBlock(el.dataset.b));
    $('#find').onsubmit = e => { e.preventDefault(); findUnit($('#findin').value); };
    const bi = $('#budget');
    if (bi) {
      bi.oninput = () => { st.budget = +bi.value >= pMax ? 0 : +bi.value; $('#budgetval').textContent = st.budget ? fmt$(st.budget) : 'Any budget'; $('#budgetclear').hidden = !st.budget; paint(); budgetCount(); };
      $('#budgetclear').onclick = () => { st.budget = 0; bi.value = pMax; bi.oninput(); };
      budgetCount();
    }
  }
  function budgetCount() {
    const el = $('#budgetn'); if (!el) return;
    if (!st.budget) { el.textContent = `From ${fmtM(pMin)}`; return; }
    const n = units.filter(u => u.price && u.price <= st.budget && (!st.groups.size || (u.cat && st.groups.has(u.cat.group)))).length;
    el.textContent = `${n.toLocaleString()} home${n === 1 ? '' : 's'} within budget`;
  }
  function findUnit(v) {
    const m = String(v).trim().replace(/^#/, '').match(/^(\d{1,2})\s*[-–\s]\s*(\d{1,2})$/);
    const err = $('#finderr');
    if (!m) { err.hidden = false; err.textContent = 'Type the floor then the stack, like 18-20.'; return; }
    const u = byKey[`${pad(m[1])}-${pad(m[2])}`];
    if (!u) { err.hidden = false; err.textContent = `There is no unit #${pad(m[1])}-${pad(m[2])}. Check the floor range for that stack.`; return; }
    err.hidden = true; select(u);
  }

  function nearestView(u) {
    const grp = D.viewGroups[u.blk], b = u.stack.bearing;
    let best = null, bd = 999;
    D.views.forEach(v => { const d = angDiff(v.bearing, b) + (v.group === grp ? 0 : 25); if (d < bd) { bd = d; best = v; } });
    return bd <= 55 ? best : null;
  }
  const outlook = b => { let best = D.outlook[0], bd = 999; D.outlook.forEach(o => { const d = angDiff(o[0], b); if (d < bd) { bd = d; best = o; } }); return best[1]; };
  const dial = b => `<svg class="dial" viewBox="-30 -30 60 60" aria-hidden="true"><circle r="27" fill="none" stroke="#d7ddd6" stroke-width="2"/><text y="-17" text-anchor="middle" font-size="9" font-family="IBM Plex Mono,monospace" fill="#5f6c68">N</text><g transform="rotate(${b.toFixed(0)})"><path d="M0,-22 L6,4 L0,0 L-6,4Z" fill="#a87a2c"/></g><circle r="2.5" fill="#1d2b29"/></svg>`;
  const distM = (x, z, X, Z) => Math.round(Math.hypot(x - X, z - Z) / 10) * 10;
  function renderUnit() {
    const u = st.sel, B = blocks[u.blk], s = u.stack, lo = s.fromFloor, hi = s.toFloor;
    const band = u.f - lo < (hi - lo + 1) / 3 ? 'Low floor' : u.f - lo < 2 * (hi - lo + 1) / 3 ? 'Mid floor' : 'High floor';
    const g = u.cat ? groupOf(u.cat.group) : null, share = u.cat ? D.shareByGroup[u.cat.group] : null;
    const v = nearestView(u), b = s.bearing;
    const ex2 = C.mrt.find(m => m.exit === '2') || C.mrt[0];
    const stops = C.stops.map(t => ({ ...t, d: distM(B.ccx, B.ccz, t.x, t.z) })).sort((a, b) => a.d - b.d).slice(0, 2);
    const inShort = st.short.includes(u.key);
    pin.innerHTML = `
      <button class="back" id="back">← ${st.tab === 'explore' ? 'Whole development' : 'Back'}</button>
      <div><div class="eyebrow">${esc(D.collections[B.collection]?.label || B.collection)} · ${esc(B.address)}</div><p class="unitno">#${u.key}</p></div>
      <p class="note" style="margin-top:-8px">Blk ${esc(B.id)} · Stack ${esc(u.no)} · Level ${u.f} · ${band} (homes on levels ${lo} to ${hi})</p>
      ${u.cat ? `<div class="typecard"><i class="sw" style="background:${g.color}"></i><b>${esc(u.cat.label)}</b><span>Type ${esc(u.type)} · ${u.cat.sqm} sqm · ${u.cat.sqft.toLocaleString()} sqft${share ? ` · est. maintenance $${share[1]}/month` : ''}</span></div>` : ''}
      ${u.price ? `<div class="price"><div><span class="eyebrow">Indicative price</span><b>${fmt$(u.price)}</b><span class="note">${fmt$(u.psf)} psf${SI[u.no]?.tier ? ` · stack tier ${esc(SI[u.no].tier)}: ${esc(PM.tiers[SI[u.no].tier] || '')}` : ''}</span></div>
        ${u.flag ? `<p class="note flag">${esc(u.flag)}</p>` : ''}<p class="note">${esc(PM.note)}</p></div>` : ''}
      <div class="floorpick">
        <button class="step" id="dn" aria-label="One floor down" ${u.f <= lo ? 'disabled' : ''}>−</button>
        <div class="floorval"><b>${u.f}</b><span>Level</span></div>
        <button class="step" id="up" aria-label="One floor up" ${u.f >= hi ? 'disabled' : ''}>+</button>
        <button class="ghost" id="lookbtn" aria-pressed="${st.look}" style="margin-left:auto">Look out in 3D</button>
      </div>
      <div class="facing">${dial(b)}<div><h3>Faces ${SI[u.no]?.compass ? esc(SI[u.no].compass) + ' (' + compass(b) + ')' : compass(b)}</h3><p class="note">${SI[u.no]?.facing ? esc(SI[u.no].facing) + '.' : 'Toward ' + esc(outlook(b)) + '.'}</p></div></div>
      ${v ? `<figure class="figure"><img src="${A}views/${v.file}" alt="Drone photo toward ${esc(v.toward)}" loading="lazy" data-zoom><figcaption>Developer's drone photo looking toward ${esc(v.toward)}, shot from heights matching levels ${esc(v.levels)}. Your exact view depends on your floor and stack.</figcaption></figure>`
        : `<p class="note">The developer has no drone photo in this direction. Use Look out in 3D to see which way the windows face.</p>`}
      ${u.plan ? `<figure class="figure"><img src="${A}plans/${u.plan}.png" alt="Floor plan type ${esc(u.type)}" loading="lazy" data-zoom><figcaption>Floor plan, type ${esc(s.type)}${u.stack.pFloor === u.f ? ' (this level is the ground variant with a private enclosed space)' : ''}. Tap to enlarge.</figcaption></figure>` : ''}
      <a class="cta" href="${waLink(`Hi ${first}, I'm interested in ${D.name} Blk ${u.blk} #${u.key}${u.cat ? ` (${u.cat.label}, ${u.cat.sqft} sqft)` : ''}${u.price ? `, indicative ${fmt$(u.price)}` : ''}. Could you confirm the price and availability?`)}" target="_blank" rel="noopener">${u.price ? `Confirm price and availability for #${u.key}` : `Get the price for #${u.key}`}</a>
      <div class="row"><button class="ghost" id="shortbtn" aria-pressed="${inShort}">${inShort ? 'In your shortlist' : 'Add to shortlist'}</button><button class="ghost" id="copylink">Copy link to this unit</button></div>
      <div><div class="eyebrow" style="margin-bottom:8px">Walking distances from Blk ${esc(B.id)} (straight line)</div>
        <ul class="dist">${ex2 ? `<li><span>Upper Thomson MRT, Exit ${esc(ex2.exit)}</span><span>${distM(B.ccx, B.ccz, ex2.x, ex2.z)} m</span></li>` : ''}${stops.map(t => `<li><span>Bus stop ${esc(t.code)}, ${esc(t.name)}</span><span>${t.d} m</span></li>`).join('')}</ul></div>
      <div class="alt">Or WhatsApp <code>${esc(AG.display)}</code><button id="copy">Copy number</button></div>`;
    $('#back').onclick = deselect;
    $('#dn').onclick = () => select(byKey[`${pad(u.f - 1)}-${u.no}`], true);
    $('#up').onclick = () => select(byKey[`${pad(u.f + 1)}-${u.no}`], true);
    $('#lookbtn').onclick = () => st.look ? exitLook(false) : lookOut(u);
    $('#shortbtn').onclick = () => toggleShort(u.key);
    $('#copylink').onclick = e => copy(location.href.split('#')[0].split('?')[0] + '?unit=' + u.key, e.currentTarget, 'Link copied');
    $('#copy').onclick = e => copy(AG.display, e.currentTarget, 'Copied');
    pin.querySelectorAll('[data-zoom]').forEach(img => img.onclick = () => openModal(`<img src="${img.src}" alt="${esc(img.alt)}">`));
  }
  function copy(text, btn, ok) { navigator.clipboard?.writeText(text).then(() => btn.textContent = ok, () => btn.textContent = 'Select and copy'); }

  function select(u, keepCam) {
    if (!u) return; st.sel = u; st.fac = null;
    if (st.tab !== 'explore') { st.tab = 'explore'; tabs.forEach(t => t.setAttribute('aria-selected', t.dataset.tab === 'explore')); }
    renderUnit(); paint(); pane.scrollTop = 0;
    if (st.look) { lookOut(u); return; }
    if (!keepCam) { const t = new THREE.Vector3(u.x, u.y, u.z), dir = camera.position.clone().sub(controls.target); dir.setLength(Math.min(Math.max(dir.length(), 150), 240)); fly(t.clone().add(dir), t); clearViews(); }
    try { history.replaceState(null, '', '?unit=' + u.key); } catch {}
  }
  function deselect() { exitLook(true); st.sel = null; paint(); showTab('explore'); goView('overview'); try { history.replaceState(null, '', location.pathname); } catch {} }

  // ---------- facilities ----------
  function renderFacilities() {
    const byClub = {}; D.facilities.forEach(f => (byClub[f.club] ||= []).push(f));
    pin.innerHTML = `
      <div><div class="eyebrow">Three clubs · ${D.facilities.length} facilities</div><h2>Facilities</h2></div>
      <p class="lede">Tap any facility to fly to it. Numbers match the developer's site plan.</p>
      ${Object.entries(D.clubs).map(([id, c]) => `<section class="club">
        <img src="${A}ai/${c.img}" alt="Artist's impression, ${esc(c.name)}" loading="lazy" data-zoom>
        <div class="in"><h3><i style="background:${c.color}"></i>${esc(c.name)}</h3><p class="note">${esc(c.desc)}</p>
        <div class="flist">${(byClub[id] || []).map(f => `<button data-f="${f.n}"><span class="num" style="background:${c.color}">${f.n}</span>${esc(f.name)}</button>`).join('')}</div></div></section>`).join('')}
      <p class="note">Facility positions are traced from the developer's site plan and drawn as simple illustrations. Artist's impressions are from the developer.</p>`;
    pin.querySelectorAll('[data-f]').forEach(el => el.onclick = () => selectFacility(D.facilities.find(f => f.n === +el.dataset.f)));
    pin.querySelectorAll('[data-zoom]').forEach(img => img.onclick = () => openModal(`<img src="${img.src}" alt="${esc(img.alt)}">`));
  }
  function selectFacility(f) {
    exitLook(true); st.sel = null; st.fac = f; paint();
    if (st.tab !== 'facilities') { st.tab = 'facilities'; tabs.forEach(t => t.setAttribute('aria-selected', t.dataset.tab === 'facilities')); }
    const c = D.clubs[f.club], y = P.groundAt(f.x, f.z), t = new THREE.Vector3(f.x, y, f.z);
    const dir = camera.position.clone().sub(controls.target); dir.y = Math.max(dir.y * 0.6, 50); dir.setLength(120); fly(t.clone().add(dir), t); clearViews();
    pin.innerHTML = `
      <button class="back" id="back">← All facilities</button>
      <div><div class="eyebrow" style="color:${c.color}">${esc(c.name)} · No. ${f.n}</div><h2>${esc(f.name)}</h2></div>
      ${f.info ? `<p class="lede">${esc(f.info)}</p>` : ''}
      ${f.img ? `<figure class="figure"><img src="${A}ai/${f.img}" alt="Artist's impression, ${esc(f.name)}" loading="lazy" data-zoom><figcaption>Artist's impression from the developer.</figcaption></figure>` : ''}
      <p class="note">${y > D.platformHeight + 1 ? 'On the landscaped deck one storey up.' : 'At the main landscape level.'}</p>
      <a class="cta" href="${waLink(`Hi ${first}, I'd like to know more about the ${f.name} at ${D.name}.`)}" target="_blank" rel="noopener">Ask ${esc(first)} about this</a>`;
    $('#back').onclick = () => { st.fac = null; paint(); renderFacilities(); };
    pin.querySelectorAll('[data-zoom]').forEach(img => img.onclick = () => openModal(`<img src="${img.src}" alt="${esc(img.alt)}">`));
    pane.scrollTop = 0;
  }

  // ---------- around ----------
  function renderAround() {
    const cx = (Object.values(blocks).reduce((a, B) => a + B.ccx, 0)) / 6, cz = (Object.values(blocks).reduce((a, B) => a + B.ccz, 0)) / 6;
    const rows = (list, f) => list.map(f).join('');
    const mrt = C.mrt.map(m => ({ ...m, d: Object.values(blocks).map(B => [B.id, distM(B.ccx, B.ccz, m.x, m.z)]) }));
    pin.innerHTML = `
      <div><div class="eyebrow">Getting around</div><h2>Around ${esc(D.name)}</h2></div>
      <p class="lede">Upper Thomson MRT on the Thomson-East Coast Line sits at the Bright Hill Drive gate. Distances are straight-line from each block; walking routes are longer.</p>
      <div class="tblwrap"><table class="tbl"><thead><tr><th>From</th>${Object.values(blocks).map(B => `<th>Blk ${B.id}</th>`).join('')}</tr></thead><tbody>
        ${rows(mrt.filter(m => ['1', '2', '5'].includes(m.exit)), m => `<tr><td>MRT Exit ${esc(m.exit)}</td>${m.d.map(([, d]) => `<td class="num">${d}m</td>`).join('')}</tr>`)}
      </tbody></table></div>
      <div><div class="eyebrow" style="margin-bottom:8px">Bus stops nearby</div>
        <ul class="dist">${C.stops.map(t => ({ ...t, d: distM(cx, cz, t.x, t.z) })).sort((a, b) => a.d - b.d).slice(0, 8).map(t => `<li><span><b style="font-family:var(--mono);font-weight:500">${esc(t.code)}</b> ${esc(t.name)}</span><span>${t.d} m</span></li>`).join('')}</ul>
        <p class="note" style="margin-top:6px">From the centre of the development. Bus stop codes and positions from OpenStreetMap.</p></div>
      <div><div class="eyebrow" style="margin-bottom:8px">Schools</div>
        <p class="note">Primary school distances for P1 registration must be checked on OneMap SchoolQuery for the exact block address. <a href="https://www.onemap.gov.sg/school" target="_blank" rel="noopener">Open OneMap</a>.</p></div>
      <div><div class="eyebrow" style="margin-bottom:8px">What the towers look toward</div>
        <ul class="dist">${D.outlook.map(([b, t]) => `<li><span>${compass(b)[0].toUpperCase() + compass(b).slice(1)}</span><span style="font-family:var(--body);color:var(--ink);text-align:right">${esc(t)}</span></li>`).join('')}</ul></div>`;
  }

  // ---------- factsheet ----------
  function renderFacts() {
    const mix = D.groups.map(g => { const c = D.typeCatalogue.find(e => e.group === g.id); return [g, counts[g.id] || 0, c]; });
    pin.innerHTML = `
      <div><div class="eyebrow">From the developer's factsheet</div><h2>Factsheet</h2></div>
      ${D.factsheet.map(sec => `<section><h3 style="margin-bottom:6px">${esc(sec.title)}</h3><table class="tbl"><tbody>${sec.rows.map(([k, v]) => `<tr><th>${esc(k)}</th><td>${esc(v)}</td></tr>`).join('')}</tbody></table></section>`).join('')}
      <section><h3 style="margin-bottom:6px">Unit mix${hasPrices ? ' and indicative prices' : ''}</h3><div class="tblwrap"><table class="tbl"><thead><tr><th>Type</th><th>Homes</th><th>Size</th>${hasPrices ? '<th>Indicative range</th>' : ''}</tr></thead><tbody>
        ${mix.map(([g, n, c]) => { const ps = units.filter(u => u.cat?.group === g.id && u.price).map(u => u.price); const sz = [...new Set(units.filter(u => u.cat?.group === g.id).map(u => u.cat.sqft))].sort((a, b) => a - b);
          return `<tr><td><i class="sw" style="background:${g.color};display:inline-block;margin-right:6px"></i>${esc(g.label)}</td><td class="num">${n}</td><td class="num">${sz.map(s => s.toLocaleString()).join(' / ')} sqft</td>${hasPrices ? `<td class="num">${ps.length ? fmtM(Math.min(...ps)) + ' to ' + fmtM(Math.max(...ps)) : ''}</td>` : ''}</tr>`; }).join('')}
        <tr><td><b>Total</b></td><td class="num"><b>${units.length.toLocaleString()}</b></td><td></td>${hasPrices ? '<td></td>' : ''}</tr></tbody></table></div>
        ${hasPrices ? `<p class="note">${esc(PM.source)} ${esc(PM.note)}</p>` : ''}</section>
      <section><h3 style="margin-bottom:6px">Estimated maintenance</h3><table class="tbl"><tbody>${D.maintenance.map(([t, s, f]) => `<tr><th>${esc(t)}</th><td>${esc(s)}</td><td class="num">${esc(f)}/mth</td></tr>`).join('')}</tbody></table>
        <p class="note">At an estimated $65 per share per month.</p></section>`;
  }

  // ---------- shortlist & compare ----------
  function toggleShort(key) {
    const i = st.short.indexOf(key);
    if (i >= 0) st.short.splice(i, 1); else { if (st.short.length >= 4) st.short.shift(); st.short.push(key); }
    store.set(`short:${D.slug}`, st.short); renderShort(); paint(); if (st.sel) renderUnit();
  }
  function renderShort() {
    const bar = $('#shortbar');
    bar.hidden = !st.short.length;
    bar.innerHTML = `<span class="lab">Shortlist</span>${st.short.map(k => `<button class="su" data-k="${k}">#${k}<span aria-label="Remove">×</span></button>`).join('')}${st.short.length > 1 ? '<button class="go" id="cmp">Compare</button>' : ''}`;
    bar.querySelectorAll('.su').forEach(b => b.onclick = e => { if (e.target.tagName === 'SPAN') toggleShort(b.dataset.k); else select(byKey[b.dataset.k]); });
    $('#cmp')?.addEventListener('click', openCompare);
  }
  function openCompare() {
    const us = st.short.map(k => byKey[k]).filter(Boolean);
    openModal(`<h2 style="margin:0 0 4px;font:600 22px var(--display)">Compare your shortlist</h2>
      <div class="cmp">${us.map(u => `<div class="col"><b>#${u.key}</b><span class="note">Blk ${u.blk} · Level ${u.f} · faces ${compass(u.stack.bearing)}</span>
        ${u.cat ? `<span>${esc(u.cat.label)}<br><span class="note">Type ${esc(u.type)} · ${u.cat.sqft.toLocaleString()} sqft</span></span>` : ''}
        ${u.price ? `<span><b style="font-size:18px">${fmt$(u.price)}</b><br><span class="note">${fmt$(u.psf)} psf, indicative</span></span>` : ''}
        ${u.plan ? `<img src="${A}plans/${u.plan}.png" alt="Plan ${esc(u.type)}" loading="lazy">` : ''}</div>`).join('')}</div>
      <p style="margin:14px 0 0"><a class="cta" href="${waLink(`Hi ${first}, here is my ${D.name} shortlist in order: ${us.map(u => '#' + u.key + ' (Blk ' + u.blk + ')').join(', ')}. Could you send prices and availability?`)}" target="_blank" rel="noopener">Send this shortlist to ${esc(first)}</a></p>`);
  }
  function openModal(html) {
    const m = document.createElement('div'); m.className = 'modal'; m.innerHTML = `<div class="box" role="dialog" aria-modal="true"><button class="close">Close</button>${html}</div>`;
    m.onclick = e => { if (e.target === m || e.target.classList.contains('close')) m.remove(); };
    document.addEventListener('keydown', function k(e) { if (e.key === 'Escape') { m.remove(); document.removeEventListener('keydown', k); } });
    document.body.appendChild(m); m.querySelector('.close').focus();
  }

  // ---------- picking ----------
  const ray = new THREE.Raycaster(), mouse = new THREE.Vector2(), tip = $('#tip'); let down = null;
  const pick = e => { const r = canvas.getBoundingClientRect(); mouse.set((e.clientX - r.left) / r.width * 2 - 1, -(e.clientY - r.top) / r.height * 2 + 1); ray.setFromCamera(mouse, camera); return inst.unitFromHit(ray.intersectObjects(inst.meshes)[0]); };
  canvas.addEventListener('pointerdown', e => { down = { x: e.clientX, y: e.clientY }; });
  canvas.addEventListener('pointerup', e => { if (!down || Math.hypot(e.clientX - down.x, e.clientY - down.y) > 6) { down = null; return; } down = null; if (st.look) return; const u = pick(e); if (u) select(u); });
  canvas.addEventListener('pointermove', e => {
    if (e.buttons || st.look || e.pointerType === 'touch') { tip.hidden = true; return; }
    const u = pick(e); if (u !== st.hover) { st.hover = u; paint(); canvas.style.cursor = u ? 'pointer' : 'grab'; }
    if (u) { const r = canvas.getBoundingClientRect(); tip.style.left = (e.clientX - r.left) + 'px'; tip.style.top = (e.clientY - r.top) + 'px'; tip.innerHTML = `<b>#${u.key}</b> · Blk ${esc(u.blk)}${u.cat ? `<br>${esc(u.cat.label)} · ${u.cat.sqft.toLocaleString()} sqft` : ''}${u.price ? `<br>Est. ${fmtM(u.price)} · ${fmt$(u.psf)} psf` : ''}`; tip.hidden = false; } else tip.hidden = true;
  });
  canvas.addEventListener('pointerleave', () => { tip.hidden = true; if (st.hover) { st.hover = null; paint(); } });

  // ---------- loop ----------
  function resize() { const w = canvas.clientWidth, h = canvas.clientHeight; if (!w || !h) return; renderer.setSize(w, h, false); camera.aspect = w / h; camera.updateProjectionMatrix(); photoreal?.resize(); }
  new ResizeObserver(resize).observe(canvas); resize();
  camera.position.copy(fit(CAMS.overview)); controls.target.set(...CAMS.overview.target);
  const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
  let lastAttrib = 0, lastT = performance.now();
  renderer.setAnimationLoop(() => {
    const now = performance.now(); T.update((now - lastT) / 1000); lastT = now;
    if (anim) { const t = reduce ? 1 : Math.min(1, (performance.now() - anim.s) / 950), k = 1 - Math.pow(1 - t, 3); camera.position.lerpVectors(anim.p0, anim.p1, k); controls.target.lerpVectors(anim.t0, anim.t1, k); if (t >= 1) { const d = anim.done; anim = null; d && d(); } }
    controls.update();
    if (photoreal && st.photoreal) { photoreal.update(); if (performance.now() - lastAttrib > 2000) { lastAttrib = performance.now(); $('#attrib').textContent = 'Map data ©Google' + (photoreal.attributions() ? ' · ' + photoreal.attributions() : ''); } }
    renderer.render(scene, camera); placeLabels();
  });

  renderExplore(); renderShort(); paint();
  const q = new URLSearchParams(location.search).get('unit') || (location.hash.match(/^#u(\d{2}-\d{2})$/) || [])[1];
  if (q && byKey[q]) select(byKey[q]);
  if (cfg.mapsKey && cfg.photorealDefault !== false && !matchMedia('(max-width: 860px)').matches) prBtn?.click();
  window.__explorer = { D, P, C, T, camera, controls, select, byKey };
}
