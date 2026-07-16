import { CYAN, stdLights, glow, dust } from './lib.js';

/* A 3D ring segmented by the real language composition: each arc is one
   language, sized by its share, in its own colour. Bespoke to the language
   breakdown, honest to the numbers (Rust dominates the ring). */
const R = 2.5;
const TUBE = 0.5;
const GAP = 0.02;

export function buildLangring(THREE, scene, host) {
  const camera = new THREE.PerspectiveCamera(42, 2, 0.1, 100);
  camera.position.set(0, 1.4, 7.2);
  camera.lookAt(0, 0, 0);
  stdLights(THREE, scene);
  dust(THREE, scene, { count: 80, spread: 9 });

  let langs = [];
  try { langs = JSON.parse(host.dataset.langs || '[]'); } catch { langs = []; }
  if (!langs.length) langs = [{ name: 'Rust', pct: 100, color: '#dea584' }];

  const g = new THREE.Group();
  g.rotation.x = 0.62;
  scene.add(g);

  let acc = -Math.PI / 2;
  const segs = [];
  for (const l of langs) {
    const frac = Math.max(l.pct / 100, 0.004);
    const arc = Math.max(frac * Math.PI * 2 - GAP, 0.03);
    const tubular = Math.max(6, Math.round(frac * 200));
    const geo = new THREE.TorusGeometry(R, TUBE, 18, tubular, arc);
    const col = new THREE.Color(l.color);
    const mat = new THREE.MeshStandardMaterial({
      color: col, metalness: 0.35, roughness: 0.35,
      emissive: col, emissiveIntensity: 0.22,
    });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.rotation.z = acc;
    g.add(mesh);
    segs.push({ mesh, mat, mid: acc + arc / 2, big: l.pct > 5 });
    acc += frac * Math.PI * 2;
  }

  const coreGlow = glow(THREE, { scale: 5.4, opacity: 0.16 });
  g.add(coreGlow);

  const inner = new THREE.Mesh(
    new THREE.IcosahedronGeometry(0.7, 1),
    new THREE.MeshStandardMaterial({ color: 0x0e1418, metalness: 0.5, roughness: 0.3, emissive: CYAN, emissiveIntensity: 0.15 }),
  );
  g.add(inner);

  return {
    camera,
    update(t) {
      g.rotation.z = t * 0.18;
      g.rotation.x = 0.62 + Math.sin(t * 0.14) * 0.07;
      inner.rotation.y = t * 0.5;

      for (const s of segs) {
        /* a highlight sweeps around the ring, brightening each segment as it passes */
        const phase = ((t * 0.6 - s.mid) % (Math.PI * 2) + Math.PI * 2) % (Math.PI * 2);
        const near = Math.max(1 - phase / 0.6, 0) + Math.max(1 - (Math.PI * 2 - phase) / 0.6, 0);
        s.mat.emissiveIntensity = 0.2 + near * 0.5;
      }

      const az = Math.sin(t * 0.09) * 0.18;
      camera.position.set(Math.sin(az) * 7.2, 1.4 + Math.sin(t * 0.07) * 0.3, Math.cos(az) * 7.2);
      camera.lookAt(0, 0, 0);
    },
  };
}
