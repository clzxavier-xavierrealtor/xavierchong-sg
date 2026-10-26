import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { rad, pairs, inPoly, distToPolyline, along, rng, centroid, bearing } from './geom.js';

const lam = (c, o = {}) => new THREE.MeshLambertMaterial({ color: c, ...o });
const Y = new THREE.Vector3(0, 1, 0);

// ---------------------------------------------------------------- scene
export function createScene(canvas) {
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, logarithmicDepthBuffer: true });
  renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  const scene = new THREE.Scene();
  const sky = new THREE.Color('#e9eeec');
  scene.background = sky;
  scene.fog = new THREE.Fog(sky, 1100, 2600);
  const camera = new THREE.PerspectiveCamera(35, 1, 0.5, 20000);
  const controls = new OrbitControls(camera, canvas);
  controls.enableDamping = true; controls.dampingFactor = 0.08;
  controls.maxPolarAngle = Math.PI * 0.495; controls.minDistance = 30; controls.maxDistance = 2200;
  controls.screenSpacePanning = false;

  scene.add(new THREE.HemisphereLight(0xffffff, 0xa9b3a6, 0.95));
  const sun = new THREE.DirectionalLight(0xfff6e8, 1.35);
  sun.position.set(-220, 520, 260);
  sun.castShadow = true;
  sun.shadow.mapSize.set(4096, 4096);
  Object.assign(sun.shadow.camera, { left: -420, right: 420, top: 420, bottom: -420, near: 50, far: 1500 });
  sun.shadow.bias = -0.0004; sun.shadow.normalBias = 0.6;
  sun.target.position.set(40, 0, -60);
  scene.add(sun, sun.target);
  return { renderer, scene, camera, controls, sun };
}

// ---------------------------------------------------------------- context (OSM)
const ROAD_W = { P: 3.4, p: 3.3, S: 3.3, s: 3.2, T: 3.2, r: 3.1, u: 3.0, v: 2.6 };

function ribbon(pts, w, y) {
  const pos = [], idx = [];
  for (let i = 0; i < pts.length; i++) {
    const a = pts[Math.max(0, i - 1)], b = pts[Math.min(pts.length - 1, i + 1)];
    let dx = b[0] - a[0], dz = b[1] - a[1]; const L = Math.hypot(dx, dz) || 1; dx /= L; dz /= L;
    const nx = -dz * w / 2, nz = dx * w / 2;
    pos.push(pts[i][0] + nx, y, pts[i][1] + nz, pts[i][0] - nx, y, pts[i][1] - nz);
    if (i) { const k = 2 * i; idx.push(k - 2, k, k - 1, k - 1, k, k + 1); }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setIndex(idx); g.computeVertexNormals();
  return g;
}

function flatPoly(pts, y) {
  const sh = new THREE.Shape(pts.map(p => new THREE.Vector2(p[0], -p[1])));
  const g = new THREE.ShapeGeometry(sh);
  g.rotateX(-Math.PI / 2); g.translate(0, y, 0);
  return g;
}

function extrudePoly(pts, h, y0 = 0) {
  if (Math.abs(((a) => { let s = 0; for (let i = 0; i < a.length; i++) { const p = a[i], q = a[(i + 1) % a.length]; s += p[0] * q[1] - q[0] * p[1]; } return s; })(pts)) < 1) return null;
  const sh = new THREE.Shape(pts.map(p => new THREE.Vector2(p[0], -p[1])));
  const g = new THREE.ExtrudeGeometry(sh, { depth: h, bevelEnabled: false });
  g.rotateX(-Math.PI / 2); g.translate(0, y0, 0);
  return g;
}

export function buildContext(D, siteTest) {
  const group = new THREE.Group(); group.name = 'context';
  const furniture = new THREE.Group(); furniture.name = 'furniture';
  const ground = new THREE.Mesh(new THREE.PlaneGeometry(6000, 6000), lam('#dfe4dc'));
  ground.rotation.x = -Math.PI / 2; ground.receiveShadow = true; group.add(ground);

  // areas
  const AREA_C = { park: '#c3d3b4', garden: '#c7d6b9', grass: '#ccdabf', recreation_ground: '#c6d5b6', pitch: '#b9cfa4', playground: '#d8d0b4', dog_park: '#c6d5b6',
    water: '#a8c8ca', swimming_pool: '#9ccbd3', school: '#e4ddcf', parking: '#d6d8d2' };
  const byColor = {};
  D.osm.A.forEach(([k, , flat]) => { const c = AREA_C[k]; if (!c) return; (byColor[c] ||= []).push(flatPoly(pairs(flat), k === 'water' || k === 'swimming_pool' ? 0.14 : 0.06)); });
  Object.entries(byColor).forEach(([c, gs]) => { const m = new THREE.Mesh(mergeGeometries(gs), lam(c)); m.receiveShadow = true; group.add(m); });

  // roads
  const roadGeo = [], walkGeo = [], roadLines = [];
  D.osm.R.forEach(([cls, lanes, oneway, name, flat]) => {
    const pts = pairs(flat); if (pts.length < 2) return;
    const lw = ROAD_W[cls] || 3, n = lanes || (oneway ? 1 : 2), w = Math.max(n, 1) * lw;
    roadGeo.push(ribbon(pts, w, 0.1));
    if (cls !== 'v') walkGeo.push(ribbon(pts, w + 5, 0.08));
    roadLines.push({ cls, name, pts, w });
  });
  const roads = new THREE.Mesh(mergeGeometries(roadGeo), lam('#b9bdb8')); roads.receiveShadow = true; group.add(roads);
  if (walkGeo.length) { const walks = new THREE.Mesh(mergeGeometries(walkGeo), lam('#d6d8d1')); walks.receiveShadow = true; group.add(walks); }

  // buildings
  const BCOL = { h: ['#ece6dc', '#c9a58c'], r: ['#eeeeea', '#d9dbd6'], c: ['#e9e8e2', '#d2d4cf'], o: ['#ecebe6', '#d5d7d2'], f: ['#e4e4df', '#cfd1cc'] };
  const bGeo = {}, labelsOut = [];
  D.osm.B.forEach(([ty, lv, name, flat]) => {
    const pts = pairs(flat); if (pts.length < 3) return;
    const h = ty === 'f' ? 4 : Math.max(3, lv * 3.2);
    const y0 = ty === 'f' ? 3.5 : 0;
    const g = extrudePoly(pts, ty === 'f' ? 0.6 : h, y0); if (!g) return;
    (bGeo[ty] ||= []).push(g);
    if (name && lv >= 3) { const c = centroid(pts); labelsOut.push({ name, x: c[0], z: c[1], y: h + 6, lv }); }
  });
  Object.entries(bGeo).forEach(([ty, gs]) => {
    const [wall, roof] = BCOL[ty] || BCOL.o;
    const m = new THREE.Mesh(mergeGeometries(gs, true), [lam(roof), lam(wall)]);
    // ExtrudeGeometry groups: 0 = caps, 1 = sides
    m.castShadow = true; m.receiveShadow = true; group.add(m);
  });

  // street furniture: lamp posts + street trees along roads
  const r = rng(11);
  const lampSpots = [], treeSpots = [];
  roadLines.forEach(({ cls, pts, w }) => {
    if (cls === 'v' || cls === 'p' || cls === 's') return;
    const step = cls === 'P' || cls === 'S' ? 32 : 40;
    along(pts, step, r() * step).forEach((p, i) => {
      const side = i % 2 ? 1 : -1, off = w / 2 + 1.2;
      const x = p.x - p.uz * off * side, z = p.z + p.ux * off * side;
      if (siteTest(x, z, 2)) return;
      lampSpots.push({ x, z, ang: Math.atan2(p.ux, p.uz) + (side > 0 ? Math.PI / 2 : -Math.PI / 2) });
    });
    if (cls === 'P' || cls === 'S' || cls === 'T') along(pts, 14, r() * 14).forEach((p, i) => {
      for (const side of [1, -1]) {
        const off = w / 2 + 3.6 + r();
        const x = p.x - p.uz * off * side, z = p.z + p.ux * off * side;
        if (!siteTest(x, z, 3)) treeSpots.push([x, z, 0.8 + r() * 0.5]);
      }
    });
  });
  furniture.add(makeLamps(lampSpots));
  const streetTrees = makeTrees(treeSpots, 7, '#7f9e72'); furniture.add(streetTrees);

  // traffic signals
  const sig = D.osm.N.filter(n => n[0] === 'signal');
  if (sig.length) {
    const g = mergeGeometries([new THREE.CylinderGeometry(0.12, 0.12, 4.2, 6).translate(0, 2.1, 0), new THREE.BoxGeometry(0.5, 1.2, 0.4).translate(0, 4.4, 0)]);
    const im = new THREE.InstancedMesh(g, lam('#4a524f'), sig.length);
    sig.forEach(([, x, z], i) => im.setMatrixAt(i, new THREE.Matrix4().makeTranslation(x, 0, z)));
    im.castShadow = true; furniture.add(im);
  }

  // bus stops
  const stopObjs = D.transit.stops.map(([name, code, x, z]) => {
    let best = null, bd = Infinity;
    roadLines.forEach(rl => { for (let i = 0; i < rl.pts.length - 1; i++) { const a = rl.pts[i], b = rl.pts[i + 1]; const d = distToPolyline(x, z, [a, b]); if (d < bd) { bd = d; best = [a, b]; } } });
    const ang = best ? Math.atan2(best[1][0] - best[0][0], best[1][1] - best[0][1]) : 0;
    const m = busShelter(); m.position.set(x, 0, z); m.rotation.y = ang + Math.PI / 2; furniture.add(m);
    return { name, code, x, z };
  });
  const mrtObjs = D.transit.mrt.map(([name, exit, x, z]) => { const m = mrtCanopy(); m.position.set(x, 0, z); furniture.add(m); return { name, exit, x, z }; });

  return { group, furniture, streetTrees, labels: labelsOut, roadLines, stops: stopObjs, mrt: mrtObjs, ground };
}

function makeLamps(spots) {
  const pole = new THREE.CylinderGeometry(0.09, 0.13, 8, 6).translate(0, 4, 0);
  const arm = new THREE.BoxGeometry(0.12, 0.12, 2.2).translate(0, 7.9, 1.0);
  const head = new THREE.BoxGeometry(0.5, 0.18, 0.9).translate(0, 7.8, 2.0);
  const g = mergeGeometries([pole, arm, head]);
  const im = new THREE.InstancedMesh(g, lam('#5d6662'), spots.length);
  const m = new THREE.Matrix4(), q = new THREE.Quaternion();
  spots.forEach((s, i) => { q.setFromAxisAngle(Y, s.ang); m.compose(new THREE.Vector3(s.x, 0, s.z), q, new THREE.Vector3(1, 1, 1)); im.setMatrixAt(i, m); });
  im.castShadow = true; im.name = 'lamps';
  return im;
}

export function makeTrees(spots, baseH = 8, color = '#7c9a6d', palms = 0) {
  const g = new THREE.Group();
  const crown = new THREE.IcosahedronGeometry(1, 1);
  const trunk = new THREE.CylinderGeometry(0.12, 0.2, 1, 5).translate(0, 0.5, 0);
  const cm = new THREE.InstancedMesh(crown, lam('#ffffff', { flatShading: true }), spots.length);
  const tm = new THREE.InstancedMesh(trunk, lam('#8a7a66'), spots.length);
  const m = new THREE.Matrix4(), q = new THREE.Quaternion(), c = new THREE.Color(), base = new THREE.Color(color), r = rng(spots.length + 3);
  spots.forEach(([x, z, s = 1, y0 = 0], i) => {
    const h = baseH * s, rad0 = h * 0.33;
    q.setFromAxisAngle(Y, r() * 6.28);
    m.compose(new THREE.Vector3(x, y0 + h * 0.62, z), q, new THREE.Vector3(rad0 * (0.9 + r() * 0.25), rad0 * 0.85, rad0 * (0.9 + r() * 0.25)));
    cm.setMatrixAt(i, m);
    c.copy(base).offsetHSL((r() - 0.5) * 0.04, (r() - 0.5) * 0.08, (r() - 0.5) * 0.08); cm.setColorAt(i, c);
    m.compose(new THREE.Vector3(x, y0, z), q, new THREE.Vector3(1, h * 0.5, 1)); tm.setMatrixAt(i, m);
  });
  cm.castShadow = true; cm.receiveShadow = true; tm.castShadow = true;
  g.add(cm, tm);
  return g;
}

function busShelter() {
  const g = new THREE.Group();
  const roof = new THREE.Mesh(new THREE.BoxGeometry(9, 0.25, 2.8), lam('#5f6f6a')); roof.position.y = 2.7;
  const back = new THREE.Mesh(new THREE.BoxGeometry(9, 1.9, 0.1), lam('#cfdad8', { transparent: true, opacity: 0.75 })); back.position.set(0, 1.5, -1.25);
  const bench = new THREE.Mesh(new THREE.BoxGeometry(5, 0.12, 0.5), lam('#8b7a63')); bench.position.set(0, 0.5, -0.9);
  [-4.3, 0, 4.3].forEach(x => { const p = new THREE.Mesh(new THREE.BoxGeometry(0.15, 2.7, 0.15), lam('#4d5753')); p.position.set(x, 1.35, -1.2); g.add(p); });
  const sign = new THREE.Mesh(new THREE.BoxGeometry(0.7, 0.7, 0.08), lam('#3b6e5c')); sign.position.set(4.9, 2.6, 1.1);
  const signPole = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 2.6), lam('#4d5753')); signPole.position.set(4.9, 1.3, 1.1);
  g.add(roof, back, bench, sign, signPole);
  g.traverse(o => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });
  return g;
}

function mrtCanopy() {
  const g = new THREE.Group();
  const roof = new THREE.Mesh(new THREE.CylinderGeometry(4.2, 4.2, 9, 16, 1, false, 0, Math.PI), lam('#d9dee0'));
  roof.rotation.z = Math.PI / 2; roof.scale.set(1, 1, 0.5); roof.position.y = 3.2;
  const base = new THREE.Mesh(new THREE.BoxGeometry(9, 3.2, 6.5), lam('#a7b6bb', { transparent: true, opacity: 0.55 })); base.position.y = 1.6;
  const tag = new THREE.Mesh(new THREE.BoxGeometry(1.2, 1.2, 0.15), lam('#b3532f')); tag.position.set(0, 5.8, 3.2);
  g.add(roof, base, tag);
  g.traverse(o => { if (o.isMesh) o.castShadow = true; });
  return g;
}

// ---------------------------------------------------------------- facade texture
function facadeTexture(style = 'classic') {
  // One storey of one unit's face. Bottom of the canvas = floor slab.
  const W = 256, H = 128, c = document.createElement('canvas'); c.width = W; c.height = H;
  const x = c.getContext('2d');
  const grad = (y0, y1, a, b) => { const g = x.createLinearGradient(0, y0, 0, y1); g.addColorStop(0, a); g.addColorStop(1, b); return g; };
  if (style === 'luxury') {
    x.fillStyle = '#6b5a48'; x.fillRect(0, 0, W, H);                                   // bronze body
    x.fillStyle = grad(14, 104, '#3b4a52', '#26323a'); x.fillRect(10, 14, W - 20, 90);  // deep glass
    x.fillStyle = 'rgba(190,215,225,0.18)'; x.fillRect(10, 14, W - 20, 18);             // sky reflection
    x.fillStyle = '#9c7c58'; for (let i = 10; i <= W - 10; i += 22) x.fillRect(i - 2, 10, 5, 96); // timber-tone fins
    x.fillStyle = 'rgba(255,255,255,0.55)'; x.fillRect(10, 86, W - 20, 2);               // glass railing top
    x.fillStyle = '#f1ece3'; x.fillRect(0, 104, W, 14);                                  // white balcony slab
    x.fillStyle = '#cfc6b8'; x.fillRect(0, 118, W, 10);                                  // slab soffit shadow
  } else {
    x.fillStyle = '#f6f4ef'; x.fillRect(0, 0, W, H);                                   // white wall
    x.fillStyle = grad(18, 98, '#7e98a6', '#5e7684'); x.fillRect(14, 18, W - 28, 80);   // glass
    x.fillStyle = 'rgba(230,240,245,0.28)'; x.fillRect(14, 18, W - 28, 14);
    x.fillStyle = '#f6f4ef'; [W * 0.33, W * 0.66].forEach(m => x.fillRect(m - 3, 18, 6, 80)); // mullions
    x.fillStyle = 'rgba(255,255,255,0.6)'; x.fillRect(14, 80, W - 28, 2);              // railing
    x.fillStyle = '#e3ded4'; x.fillRect(0, 104, W, 12);                                  // slab band
    x.fillStyle = '#d2ccc0'; x.fillRect(0, 116, W, 12);
  }
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 8;
  return t;
}

// ---------------------------------------------------------------- traffic
const CAR_COLS = ['#f2f2f0', '#f2f2f0', '#c9ccce', '#9aa0a4', '#2b2e31', '#1c1f22', '#5a6670', '#8e2b2b', '#2d4f7c', '#d9d4c7'];
export function buildTraffic(roadLines, siteTest) {
  // 1. chain OSM ways (often split into short pieces) into long drivable paths.
  const pieces = roadLines.filter(r => 'PSTru'.includes(r.cls) && r.pts.length > 1).map(r => ({ ...r, pts: r.pts.slice() }));
  const near = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1]) < 3;
  const used = new Set(), chains = [];
  pieces.forEach((p, i) => {
    if (used.has(i)) return; used.add(i);
    let pts = p.pts.slice(), grew = true;
    while (grew) {
      grew = false;
      for (let j = 0; j < pieces.length; j++) {
        if (used.has(j)) continue; const q = pieces[j];
        if (q.name !== p.name || q.cls !== p.cls || q.oneway !== p.oneway) continue;
        if (near(pts[pts.length - 1], q.pts[0])) { pts = pts.concat(q.pts.slice(1)); used.add(j); grew = true; }
        else if (near(q.pts[q.pts.length - 1], pts[0])) { pts = q.pts.concat(pts.slice(1)); used.add(j); grew = true; }
        else if (!p.oneway && near(pts[pts.length - 1], q.pts[q.pts.length - 1])) { pts = pts.concat(q.pts.slice(0, -1).reverse()); used.add(j); grew = true; }
      }
    }
    chains.push({ ...p, pts });
  });
  // 2. lanes (Singapore drives on the left).
  const LW = 3.2, paths = [];
  const offsetPath = (pts, off) => pts.map((p, i) => {
    const a = pts[Math.max(0, i - 1)], b = pts[Math.min(pts.length - 1, i + 1)];
    let dx = b[0] - a[0], dz = b[1] - a[1]; const L = Math.hypot(dx, dz) || 1; dx /= L; dz /= L;
    return [p[0] + dz * off, p[1] - dx * off];   // +off = left of travel
  });
  chains.forEach(c => {
    const len = c.pts.reduce((s, p, i) => i ? s + Math.hypot(p[0] - c.pts[i - 1][0], p[1] - c.pts[i - 1][1]) : 0, 0);
    if (len < 90) return;
    const major = c.cls === 'P' || c.cls === 'S';
    if (c.oneway) {
      const n = Math.max(1, Math.min(c.lanes || 2, 4));
      for (let k = 0; k < n; k++) paths.push({ pts: offsetPath(c.pts, ((n - 1) / 2 - k) * LW), major, len, bus: k === n - 1 && major });
    } else {
      const n = Math.max(1, Math.floor((c.lanes || 2) / 2));
      for (let k = 0; k < n; k++) {
        paths.push({ pts: offsetPath(c.pts, (k + 0.5) * LW), major, len });
        paths.push({ pts: offsetPath(c.pts.slice().reverse(), (k + 0.5) * LW), major, len });
      }
    }
  });
  paths.forEach(p => { p.cum = [0]; for (let i = 1; i < p.pts.length; i++) p.cum.push(p.cum[i - 1] + Math.hypot(p.pts[i][0] - p.pts[i - 1][0], p.pts[i][1] - p.pts[i - 1][1])); p.len = p.cum[p.cum.length - 1]; p.h = null; });

  // 3. vehicles
  const r = rng(99), cars = [], buses = [];
  paths.forEach((p, pi) => {
    const gap = p.major ? 34 : 75;
    for (let s = r() * gap; s < p.len; s += gap * (0.6 + r() * 0.9)) {
      const isBus = p.major && p.bus && r() < 0.18;
      const v = { p: pi, s, speed: (p.major ? 11 : 7) * (0.85 + r() * 0.3), bus: isBus };
      (isBus ? buses : cars).push(v);
    }
  });
  const maxCars = Math.min(cars.length, 700); cars.length = maxCars;
  const body = mergeGeometries([new THREE.BoxGeometry(1.8, 0.75, 4.4).translate(0, 0.62, 0), new THREE.BoxGeometry(1.6, 0.55, 2.3).translate(0, 1.25, -0.2)]);
  const glassG = new THREE.BoxGeometry(1.62, 0.42, 2.0).translate(0, 1.27, -0.2);
  const carM = new THREE.InstancedMesh(body, lam('#ffffff'), cars.length);
  const carG = new THREE.InstancedMesh(glassG, new THREE.MeshPhongMaterial({ color: '#2a3238', shininess: 80 }), cars.length);
  const busM = new THREE.InstancedMesh(new THREE.BoxGeometry(2.5, 3.0, 12).translate(0, 1.75, 0), lam('#ffffff'), Math.max(1, buses.length));
  const c = new THREE.Color();
  cars.forEach((v, i) => carM.setColorAt(i, c.set(CAR_COLS[Math.floor(r() * CAR_COLS.length)])));
  buses.forEach((v, i) => busM.setColorAt(i, c.set(r() < 0.6 ? '#5f9a52' : '#d9d9d2')));
  [carM, carG, busM].forEach(m => { m.castShadow = true; m.frustumCulled = false; });
  busM.count = buses.length;
  const group = new THREE.Group(); group.name = 'traffic'; group.add(carM, carG, busM);
  let heightFn = null;
  const mtx = new THREE.Matrix4(), q = new THREE.Quaternion(), pos = new THREE.Vector3(), one = new THREE.Vector3(1, 1, 1);
  const place = (v, mesh, i, extra = null) => {
    const p = paths[v.p]; let k = 1; while (k < p.cum.length - 1 && p.cum[k] < v.s) k++;
    const a = p.pts[k - 1], b = p.pts[k], t = (v.s - p.cum[k - 1]) / ((p.cum[k] - p.cum[k - 1]) || 1);
    const x = a[0] + (b[0] - a[0]) * t, z = a[1] + (b[1] - a[1]) * t;
    const y = p.h ? p.h[k - 1] + (p.h[k] - p.h[k - 1]) * t : 0.12;
    q.setFromAxisAngle(Y, Math.atan2(b[0] - a[0], b[1] - a[1]));
    pos.set(x, y, z); mtx.compose(pos, q, one); mesh.setMatrixAt(i, mtx); if (extra) extra.setMatrixAt(i, mtx);
  };
  return {
    group, count: cars.length + buses.length,
    setHeights(fn) { heightFn = fn; paths.forEach(p => { p.h = fn ? p.pts.map(([x, z]) => fn(x, z)) : null; }); },
    update(dt) {
      dt = Math.min(dt, 0.1);
      cars.forEach((v, i) => { v.s += v.speed * dt; const L = paths[v.p].len; if (v.s > L) v.s -= L; place(v, carM, i, carG); });
      buses.forEach((v, i) => { v.s += v.speed * 0.8 * dt; const L = paths[v.p].len; if (v.s > L) v.s -= L; place(v, busM, i); });
      carM.instanceMatrix.needsUpdate = carG.instanceMatrix.needsUpdate = busM.instanceMatrix.needsUpdate = true;
    },
  };
}

// ---------------------------------------------------------------- project
export function buildProject(D, opts = {}) {
  const group = new THREE.Group(); group.name = 'project';
  const SH = D.storeyHeight, PH = D.platformHeight, [UW, UD] = D.unitSize;
  const platform = D.platform, deck = D.deck;
  const onDeck = (x, z) => deck && inPoly(x, z, deck);
  const groundAt = (x, z) => PH + (onDeck(x, z) ? D.deckHeight : 0);

  // platform + deck
  const pg = extrudePoly(platform, PH, 0);
  const plat = new THREE.Mesh(pg, [lam('#c4d3b7'), lam('#cfd3c8')]); plat.receiveShadow = true; plat.castShadow = true; group.add(plat);
  if (deck?.length) { const dg = extrudePoly(deck, D.deckHeight, PH); const dm = new THREE.Mesh(dg, [lam('#c8d6bb'), lam('#d3d6cc')]); dm.receiveShadow = true; dm.castShadow = true; group.add(dm); }
  // planting band along the edge
  const edge = new THREE.Mesh(ribbon(platform.concat([platform[0]]), 6, PH + 0.05), lam('#aec39e')); edge.receiveShadow = true; group.add(edge);

  // water
  const waterMat = new THREE.MeshPhongMaterial({ color: '#7fc3d0', shininess: 90, specular: 0x557f88 });
  const copingMat = lam('#ece7dc');
  const lounge = [];
  D.water.forEach((w, wi) => {
    const c = centroid(w), y = groundAt(c[0], c[1]);
    const deckPoly = grow(w, 2.8);
    const dk = new THREE.Mesh(flatPoly(deckPoly, y + 0.04), lam('#d8c3a0')); dk.receiveShadow = true; group.add(dk);
    const cop = new THREE.Mesh(flatPoly(w, y + 0.07), copingMat); cop.receiveShadow = true; group.add(cop);
    const wm = new THREE.Mesh(flatPoly(shrink(w, 0.94), y + 0.12), waterMat); wm.receiveShadow = true; group.add(wm);
    // sun loungers on the deck, facing the water
    const ring = deckPoly.concat([deckPoly[0]]);
    along(ring, 3.2, 1.5).forEach((p, i) => {
      if (i % 5 === 4) return;
      const x = p.x - p.uz * 1.3, z = p.z + p.ux * 1.3;
      if (D.water.some(o => inPoly(x, z, o))) return;
      lounge.push({ x, z, y: groundAt(x, z), a: Math.atan2(p.ux, p.uz) });
    });
  });
  if (lounge.length) {
    const lg = mergeGeometries([new THREE.BoxGeometry(0.7, 0.25, 1.9).translate(0, 0.32, 0), new THREE.BoxGeometry(0.7, 0.5, 0.5).rotateX(-0.6).translate(0, 0.55, -0.75)]);
    const lm = new THREE.InstancedMesh(lg, lam('#f3efe6'), lounge.length);
    const m4 = new THREE.Matrix4(), qq = new THREE.Quaternion();
    lounge.forEach((l, i) => { qq.setFromAxisAngle(Y, l.a); m4.compose(new THREE.Vector3(l.x, l.y + 0.05, l.z), qq, new THREE.Vector3(1, 1, 1)); lm.setMatrixAt(i, m4); });
    lm.castShadow = true; group.add(lm);
  }

  // blocks, cores, crowns, carpark decks
  const blocks = {};
  D.blocks.forEach(b => blocks[b.id] = { ...b, stacks: [] });
  const F = D.stackFields, units = [], byKey = {};
  const pad = n => String(n).padStart(2, '0');
  Object.entries(D.stacks).forEach(([no, row]) => {
    const s = {}; F.forEach((k, i) => s[k] = row[i]); s.no = no; blocks[s.block].stacks.push(s);
  });
  Object.values(blocks).forEach(B => {
    B.cx = B.stacks.reduce((a, s) => a + s.x, 0) / B.stacks.length;
    B.cz = B.stacks.reduce((a, s) => a + s.z, 0) / B.stacks.length;
    B.top = Math.max(...B.stacks.map(s => s.toFloor)); B.base = groundAt(B.cx, B.cz);
    B.stacks.forEach(s => { const dx = s.x - B.cx, dz = s.z - B.cz; s.bearing = bearing(dx, dz); s.out = [dx, dz]; });
  });
  Object.values(blocks).forEach(B => B.stacks.forEach(s => {
    for (let f = s.fromFloor; f <= s.toFloor; f++) {
      const u = { i: units.length, no: s.no, f, blk: s.block, x: s.x, z: s.z, stack: s, key: `${pad(f)}-${s.no}` };
      u.y = B.base + (f - 0.5) * SH; units.push(u); byKey[u.key] = u;
    }
  }));

  // One instanced mesh per collection so each gets its own facade, matching the developer's impressions:
  // Classic = white with a window grid; Luxury = bronze fins with white balcony slabs.
  const ug = new THREE.BoxGeometry(1, 1, 1);
  const meshes = {};
  const capMat = new THREE.MeshLambertMaterial({ color: 0xffffff });
  const colls = [...new Set(Object.values(blocks).map(B => B.collection))];
  colls.forEach(cn => {
    const list = units.filter(u => blocks[u.blk].collection === cn);
    const style = /lux/i.test(cn) ? 'luxury' : 'classic';
    const unitMat = new THREE.MeshLambertMaterial({ color: 0xffffff, map: facadeTexture(style) });
    const capM = new THREE.MeshLambertMaterial({ color: style === 'luxury' ? '#e9e2d6' : '#f4f2ec' });
    const m = new THREE.InstancedMesh(ug, [unitMat, unitMat, capM, capM, unitMat, unitMat], list.length);
    m.castShadow = true; m.receiveShadow = true; m.userData.units = list;
    const mtx = new THREE.Matrix4(), q = new THREE.Quaternion(), pos = new THREE.Vector3(), scl = new THREE.Vector3(UW - 0.3, SH - 0.02, UD - 0.3);
    list.forEach((u, i) => { u.mesh = m; u.mi = i; q.setFromAxisAngle(Y, -rad(blocks[u.blk].angle)); pos.set(u.x, u.y, u.z); mtx.compose(pos, q, scl); m.setMatrixAt(i, mtx); });
    m.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(list.length * 3).fill(1), 3);
    meshes[cn] = m; group.add(m);
  });
  const unitMeshes = Object.values(meshes);
  const inst = {
    meshes: unitMeshes,
    setColorAt: (u, c) => u.mesh.setColorAt(u.mi, c),
    flush: () => unitMeshes.forEach(m => { m.instanceColor.needsUpdate = true; }),
    unitFromHit: h => h && h.object.userData.units ? h.object.userData.units[h.instanceId] : null,
  };

  const coreMat = lam('#d9d6ce'), crownMat = lam('#8d8678'), deckMat = lam('#cfd1ca');
  Object.values(blocks).forEach(B => {
    const a = rad(B.angle), ca = Math.cos(a), sa = Math.sin(a);
    const loc = B.stacks.map(s => { const dx = s.x - B.cx, dz = s.z - B.cz; return [dx * ca + dz * sa, -dx * sa + dz * ca]; });
    const xs = loc.map(p => p[0]), zs = loc.map(p => p[1]);
    const w = Math.max(...xs) - Math.min(...xs) + UW, d = Math.max(...zs) - Math.min(...zs) + UD;
    const mx = (Math.max(...xs) + Math.min(...xs)) / 2, mz = (Math.max(...zs) + Math.min(...zs)) / 2;
    const cx = B.cx + mx * ca - mz * sa, cz = B.cz + mx * sa + mz * ca;
    B.ccx = cx; B.ccz = cz; B.w = w; B.d = d;
    const H = B.top * SH;
    const core = new THREE.Mesh(new THREE.BoxGeometry(Math.min(w * 0.42, 18), H + 3, Math.min(d * 0.32, 8)), coreMat);
    core.position.set(cx, B.base + (H + 3) / 2, cz); core.rotation.y = -a; core.castShadow = core.receiveShadow = true; group.add(core);
    // roof crown frame
    const crown = new THREE.Mesh(new THREE.BoxGeometry(Math.min(w * 0.7, 30), 4, Math.min(d * 0.5, 14)), crownMat);
    crown.position.set(cx, B.base + H + 2.5, cz); crown.rotation.y = -a; crown.castShadow = true; group.add(crown);
    if (D.collections[B.collection]?.carparkL1) {
      const dk = new THREE.Mesh(new THREE.BoxGeometry(w + 6, SH, d + 6), deckMat);
      dk.position.set(cx, B.base + SH / 2, cz); dk.rotation.y = -a; dk.castShadow = dk.receiveShadow = true; group.add(dk);
    }
  });

  // club buildings
  const clubMat = lam('#efe9df'), glassMat = new THREE.MeshPhongMaterial({ color: '#8fb0b8', shininess: 60, transparent: true, opacity: 0.85 }), roofMat = lam('#7b7468');
  D.clubBuildings.forEach(cb => {
    for (let i = 0; i < cb.pts.length - 1; i++) {
      const [x1, z1] = cb.pts[i], [x2, z2] = cb.pts[i + 1], L = Math.hypot(x2 - x1, z2 - z1);
      const mx = (x1 + x2) / 2, mz = (z1 + z2) / 2, y = groundAt(mx, mz), h = cb.storeys * 4;
      const a = Math.atan2(z2 - z1, x2 - x1);
      const glass = new THREE.Mesh(new THREE.BoxGeometry(L + 1, h - 0.6, cb.depth), glassMat); glass.position.set(mx, y + (h - 0.6) / 2, mz); glass.rotation.y = -a;
      const roof = new THREE.Mesh(new THREE.BoxGeometry(L + 3, 0.6, cb.depth + 3), roofMat); roof.position.set(mx, y + h, mz); roof.rotation.y = -a;
      glass.castShadow = roof.castShadow = true; group.add(glass, roof);
    }
  });

  // facility models
  const fac = new THREE.Group(); fac.name = 'facilities';
  const timber = lam('#b48a63'), postMat = lam('#5e554b'), lawnMat = lam('#b6cf9f'), courtMat = { tennis: lam('#6f9c7a'), mp: lam('#c98d6c') }, lineMat = new THREE.MeshBasicMaterial({ color: '#f4f2ea' });
  const playCols = ['#e3a33b', '#d4644a', '#5c9fc7', '#79b26a'];
  const siteAngle = rad(D.geo.rotDeg);
  D.facilities.forEach(f => {
    const y = groundAt(f.x, f.z), o = new THREE.Group(); o.position.set(f.x, y, f.z); o.rotation.y = -siteAngle;
    const k = f.kind;
    if (k === 'pavilion') {
      const dk = new THREE.Mesh(new THREE.BoxGeometry(7, 0.3, 6), timber); dk.position.y = 0.15;
      o.add(dk);
      [[-3, -2.5], [3, -2.5], [-3, 2.5], [3, 2.5]].forEach(([x, z]) => { const p = new THREE.Mesh(new THREE.BoxGeometry(0.25, 3, 0.25), postMat); p.position.set(x, 1.6, z); o.add(p); });
      const roof = new THREE.Mesh(new THREE.ConeGeometry(5.6, 1.8, 4), roofMat); roof.rotation.y = Math.PI / 4; roof.position.y = 4; o.add(roof);
    } else if (k === 'deck') {
      const dk = new THREE.Mesh(new THREE.BoxGeometry(10, 0.3, 6), timber); dk.position.y = 0.15; o.add(dk);
    } else if (k === 'lawn') {
      const l = new THREE.Mesh(new THREE.CylinderGeometry(9, 9, 0.12, 24), lawnMat); l.scale.set(1.3, 1, 0.9); l.position.y = 0.08; o.add(l);
    } else if (k === 'pool') {
      const big = /Lap|Island Pool$|Leisure Pool$/.test(f.name);
      if (!big) { const c = new THREE.Mesh(new THREE.BoxGeometry(9, 0.2, 6), copingMat); c.position.y = 0.1; const wv = new THREE.Mesh(new THREE.BoxGeometry(8, 0.22, 5), waterMat); wv.position.y = 0.12; o.add(c, wv); }
    } else if (k === 'water') {
      const wv = new THREE.Mesh(new THREE.CylinderGeometry(5, 5, 0.25, 20), waterMat); wv.position.y = 0.15; o.add(wv);
    } else if (k === 'court') {
      const tennis = /Tennis/.test(f.name), L = tennis ? 34 : 26, Wd = tennis ? 17 : 15;
      const c = new THREE.Mesh(new THREE.BoxGeometry(Wd, 0.15, L), tennis ? courtMat.tennis : courtMat.mp); c.position.y = 0.08; o.add(c);
      const fr = (w, l, x, z) => { const m = new THREE.Mesh(new THREE.BoxGeometry(w, 0.02, l), lineMat); m.position.set(x, 0.17, z); o.add(m); };
      fr(Wd - 4, 0.12, 0, 0); fr(Wd - 4, 0.12, 0, L / 2 - 2); fr(Wd - 4, 0.12, 0, -L / 2 + 2); fr(0.12, L - 4, Wd / 2 - 2, 0); fr(0.12, L - 4, -Wd / 2 + 2, 0);
      if (tennis) { const net = new THREE.Mesh(new THREE.BoxGeometry(Wd - 3, 1, 0.05), lam('#3b403e')); net.position.y = 0.6; o.add(net); }
    } else if (k === 'play') {
      for (let i = 0; i < 5; i++) { const b = new THREE.Mesh(new THREE.BoxGeometry(1.6, 1 + i * 0.5, 1.6), lam(playCols[i % 4])); b.position.set(-4 + i * 2, 0.5 + i * 0.25, (i % 2) * 1.5); b.castShadow = true; o.add(b); }
      const pad = new THREE.Mesh(new THREE.CylinderGeometry(7, 7, 0.1, 20), lam('#e7d9b8')); pad.position.y = 0.05; o.add(pad);
    } else if (k === 'arrival') {
      const ring = new THREE.Mesh(new THREE.RingGeometry(9, 15, 40), lam('#c7cac3')); ring.rotation.x = -Math.PI / 2; ring.position.y = 0.12;
      const pool = new THREE.Mesh(new THREE.CylinderGeometry(8.5, 8.5, 0.3, 40), waterMat); pool.position.y = 0.15;
      const art = new THREE.Mesh(new THREE.TorusKnotGeometry(1.4, 0.35, 64, 8), lam('#a07a4c')); art.position.y = 3;
      const canopy = new THREE.Mesh(new THREE.CylinderGeometry(16.5, 16.5, 0.5, 48, 1, true, 0, Math.PI * 1.2), lam('#ede8de', { side: THREE.DoubleSide })); canopy.position.y = 5;
      o.add(ring, pool, art);
    } else if (k === 'bridge') {
      const b = new THREE.Mesh(new THREE.BoxGeometry(3, 0.3, 14), timber); b.position.y = 0.4; o.add(b);
    } else if (k === 'gym') {
      const fr = new THREE.Mesh(new THREE.BoxGeometry(4, 2.4, 0.15), postMat); fr.position.y = 1.2; o.add(fr);
    }
    o.traverse(m => { if (m.isMesh) { m.castShadow = true; m.receiveShadow = true; } });
    fac.add(o);
  });
  group.add(fac);

  // trees inside the site
  const r = rng(5), spots = [], palmSpots = [];
  const blocked = (x, z) => {
    for (const B of Object.values(blocks)) if (Math.hypot(x - B.ccx, z - B.ccz) < Math.max(B.w, B.d) * 0.62) return true;
    for (const w of D.water) if (inPoly(x, z, w)) return true;
    for (const f of D.facilities) if (Math.hypot(x - f.x, z - f.z) < (f.kind === 'court' ? 20 : f.kind === 'arrival' ? 17 : 7)) return true;
    for (const cb of D.clubBuildings) if (distToPolyline(x, z, cb.pts) < cb.depth + 3) return true;
    return false;
  };
  const xs = platform.map(p => p[0]), zs = platform.map(p => p[1]);
  const [x0, x1, z0, z1] = [Math.min(...xs), Math.max(...xs), Math.min(...zs), Math.max(...zs)];
  for (let i = 0; i < 9000 && spots.length < 950; i++) {
    const x = x0 + r() * (x1 - x0), z = z0 + r() * (z1 - z0);
    if (!inPoly(x, z, platform)) continue;
    const de = distToPolyline(x, z, platform, true);
    if (de < 2.5) continue;
    const pKeep = de < 14 ? 0.95 : 0.22;
    if (r() > pKeep || blocked(x, z)) continue;
    if (spots.some(s => Math.hypot(s[0] - x, s[1] - z) < 4.2)) continue;
    const big = de < 14;
    (r() < 0.12 && !big ? palmSpots : spots).push([x, z, big ? 1.1 + r() * 0.5 : 0.7 + r() * 0.4, groundAt(x, z)]);
  }
  const siteTrees = makeTrees(spots, 9, '#6f9466'); group.add(siteTrees);
  const palms = makeTrees(palmSpots, 11, '#86a36b'); group.add(palms);

  // pick helpers
  const siteTest = (x, z, margin = 0) => inPoly(x, z, platform) || distToPolyline(x, z, platform, true) < margin;

  return { group, inst, units, byKey, blocks, groundAt, siteTest, facilitiesGroup: fac };
}

function shrink(poly, k) { const c = centroid(poly); return poly.map(([x, z]) => [c[0] + (x - c[0]) * k, c[1] + (z - c[1]) * k]); }

function grow(poly, d) {
  // Offset a polygon outward by ~d metres (simple per-vertex miter, fine for smooth pool outlines).
  const n = poly.length, ccw = (() => { let s = 0; for (let i = 0; i < n; i++) { const a = poly[i], b = poly[(i + 1) % n]; s += a[0] * b[1] - b[0] * a[1]; } return s > 0; })();
  return poly.map((p, i) => {
    const a = poly[(i - 1 + n) % n], b = poly[(i + 1) % n];
    let dx = b[0] - a[0], dz = b[1] - a[1]; const L = Math.hypot(dx, dz) || 1; dx /= L; dz /= L;
    const nx = ccw ? dz : -dz, nz = ccw ? -dx : dx;
    return [p[0] + nx * d, p[1] + nz * d];
  });
}
