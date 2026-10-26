// Google Photorealistic 3D Tiles around the project. Loaded only when a Maps key is configured.
import * as THREE from 'three';

export async function loadPhotoreal({ key, D, scene, camera, renderer, project, onStatus }) {
  const { TilesRenderer } = await import('3d-tiles-renderer');
  const { GoogleCloudAuthPlugin, ReorientationPlugin, TileFlatteningPlugin, TilesFadePlugin, GLTFExtensionsPlugin } = await import('3d-tiles-renderer/plugins');
  const { DRACOLoader } = await import('three/examples/jsm/loaders/DRACOLoader.js');

  const DEG = Math.PI / 180;
  const tiles = new TilesRenderer();
  tiles.registerPlugin(new GoogleCloudAuthPlugin({ apiToken: key, autoRefreshToken: true }));
  const draco = new DRACOLoader().setDecoderPath('https://www.gstatic.com/draco/versioned/decoders/1.5.7/');
  tiles.registerPlugin(new GLTFExtensionsPlugin({ dracoLoader: draco }));
  tiles.registerPlugin(new TilesFadePlugin());
  const geo = D.geo;
  tiles.registerPlugin(new ReorientationPlugin({ lat: geo.lat0 * DEG, lon: geo.lon0 * DEG, height: geo.ellipsoidHeight ?? 26, azimuth: (geo.tilesAzimuth || 0) * DEG, recenter: true }));
  const flatten = new TileFlatteningPlugin();
  tiles.registerPlugin(flatten);
  tiles.errorTarget = 6;
  tiles.setCamera(camera);
  tiles.setResolutionFromRenderer(camera, renderer);

  // Wrapper so we can lift/lower the photoreal city to line its roads up with y = 0.
  const holder = new THREE.Group(); holder.name = 'photoreal';
  holder.add(tiles.group); scene.add(holder);

  let failed = false;
  tiles.addEventListener('load-error', e => { if (!failed) { failed = true; onStatus?.('error', e?.error?.message || 'Could not load the photoreal city.'); } });
  tiles.addEventListener('load-tile-set', () => onStatus?.('loading'));

  // Flatten Google's mesh inside the site so our model sits on a clean pad.
  const addFlatten = () => {
    const pts = D.platform.map(([x, z]) => new THREE.Vector2(x, -z));
    const g = new THREE.ShapeGeometry(new THREE.Shape(pts)); g.rotateX(-Math.PI / 2);
    const shape = new THREE.Mesh(g);
    tiles.group.updateMatrixWorld(true);
    const inv = tiles.group.matrixWorld.clone().invert();
    shape.applyMatrix4(inv);
    const dir = new THREE.Vector3(0, -1, 0).transformDirection(inv);
    try { flatten.addShape(shape, dir, { threshold: 60 }); } catch (e) { console.warn('flatten', e); }
  };

  // Calibrate vertical offset: sample road points around the site and move the city so roads sit at y = 0.
  const ray = new THREE.Raycaster();
  const samples = (D.calibration || []).length ? D.calibration : [[-109, -86], [41, 70], [-125, -330], [222, 30], [-140, -200], [150, 140]];
  let calibrated = 0;
  const calibrate = () => {
    const hits = [];
    samples.forEach(([x, z]) => {
      ray.set(new THREE.Vector3(x, 600, z), new THREE.Vector3(0, -1, 0));
      const h = ray.intersectObject(tiles.group, true)[0];
      if (h) hits.push(h.point.y - holder.position.y);
    });
    if (hits.length >= 3) {
      hits.sort((a, b) => a - b);
      const med = hits[Math.floor(hits.length / 2)];
      holder.position.y = -med;
      calibrated++;
      if (calibrated === 1) { addFlatten(); onStatus?.('ready'); }
    }
  };
  const timer = setInterval(() => { calibrate(); if (calibrated >= 4) clearInterval(timer); }, 1500);

  const attributions = () => {
    const out = []; tiles.getAttributions(out);
    return out.filter(a => a.type === 'string').map(a => a.value).join(' · ');
  };

  return {
    holder, tiles,
    update() { camera.updateMatrixWorld(); tiles.update(); },
    resize() { tiles.setResolutionFromRenderer(camera, renderer); },
    attributions,
    dispose() { clearInterval(timer); tiles.dispose(); scene.remove(holder); },
  };
}
