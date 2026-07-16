import { CYAN, stdLights, glow, dust, setOrb, ease } from './lib.js';

/* Value streams in from every direction and the core grows brighter as it
   lands. Bespoke to the fund page: nothing else on the site uses it. */
const N = 20;
const TRAVEL = 3.4;
const R = 7;

function startFor(seed, cycle, out) {
  const a = Math.sin((seed + cycle * 0.7) * 12.9898) * 43758.5453;
  const b = Math.sin((seed + cycle * 0.7) * 78.233) * 43758.5453;
  const th = (a - Math.floor(a)) * Math.PI * 2;
  const ph = Math.acos(2 * (b - Math.floor(b)) - 1);
  out.set(R * Math.sin(ph) * Math.cos(th), R * Math.cos(ph) * 0.7, R * Math.sin(ph) * Math.sin(th));
}

export function buildFund(THREE, scene) {
  const camera = new THREE.PerspectiveCamera(42, 2, 0.1, 100);
  camera.position.set(0, 1.2, 10.2);
  camera.lookAt(0, 0, 0);
  stdLights(THREE, scene);
  dust(THREE, scene, { count: 110, spread: 12 });

  const g = new THREE.Group();
  scene.add(g);

  const shell = new THREE.Mesh(
    new THREE.IcosahedronGeometry(1.55, 0),
    new THREE.MeshBasicMaterial({ color: CYAN, wireframe: true, transparent: true, opacity: 0.3 }),
  );
  const core = new THREE.Mesh(
    new THREE.IcosahedronGeometry(1.05, 1),
    new THREE.MeshStandardMaterial({ color: 0x11202a, metalness: 0.5, roughness: 0.3, emissive: CYAN, emissiveIntensity: 0.3 }),
  );
  g.add(shell, core);
  const coreGlow = glow(THREE, { scale: 6.2, opacity: 0.4 });
  g.add(coreGlow);

  /* faint accumulation track with a bright bead travelling it */
  const track = new THREE.Mesh(
    new THREE.TorusGeometry(2.2, 0.012, 8, 90),
    new THREE.MeshBasicMaterial({ color: CYAN, transparent: true, opacity: 0.14 }),
  );
  track.rotation.x = Math.PI / 2 - 0.34;
  g.add(track);
  const bead = new THREE.Mesh(new THREE.SphereGeometry(0.08, 12, 10), new THREE.MeshBasicMaterial({ color: CYAN }));
  bead.add(glow(THREE, { scale: 0.9, opacity: 0.6 }));
  g.add(bead);

  const center = new THREE.Vector3();
  const shardGeo = new THREE.TetrahedronGeometry(0.16);
  const shards = [];
  for (let i = 0; i < N; i++) {
    const mesh = new THREE.Mesh(shardGeo, new THREE.MeshStandardMaterial({
      color: 0xbfeff2, metalness: 0.4, roughness: 0.3, transparent: true, emissive: CYAN, emissiveIntensity: 0.5,
    }));
    mesh.add(glow(THREE, { scale: 0.85, opacity: 0.5 }));
    g.add(mesh);
    shards.push({ mesh, seed: i * 3.17 + 1, offset: (i / N) * TRAVEL, from: new THREE.Vector3(), cycle: -1 });
  }

  return {
    camera,
    update(t) {
      shell.rotation.y = t * 0.16;
      shell.rotation.x = Math.sin(t * 0.2) * 0.1;
      core.rotation.y = -t * 0.1;

      let pulse = 0;
      for (const s of shards) {
        const local = (t + s.offset) % TRAVEL;
        const cycle = Math.floor((t + s.offset) / TRAVEL);
        if (cycle !== s.cycle) { s.cycle = cycle; startFor(s.seed, cycle, s.from); }
        const q = local / TRAVEL;
        s.mesh.position.lerpVectors(s.from, center, ease(q));
        s.mesh.rotation.x = t * 3 + s.seed;
        s.mesh.rotation.y = t * 2;
        s.mesh.scale.setScalar(1 - ease(q) * 0.55);
        setOrb(s.mesh, q < 0.94 ? Math.min(q * 5, 0.95) : 0);
        if (q > 0.9) pulse = Math.max(pulse, (q - 0.9) / 0.1);
      }

      core.material.emissiveIntensity = 0.18 + pulse * 0.55;
      coreGlow.material.opacity = 0.22 + Math.sin(t * 1.2) * 0.04 + pulse * 0.32;
      shell.scale.setScalar(1 + pulse * 0.06);

      const bp = (t * 0.14) % 1;
      const ba = bp * Math.PI * 2;
      bead.position.set(Math.cos(ba) * 2.2, 0, Math.sin(ba) * 2.2).applyAxisAngle(new THREE.Vector3(1, 0, 0), Math.PI / 2 - 0.34);

      const az = Math.sin(t * 0.08) * 0.24;
      camera.position.set(Math.sin(az) * 10.2, 1.2 + Math.sin(t * 0.05) * 0.4, Math.cos(az) * 10.2);
      camera.lookAt(0, 0, 0);
    },
  };
}
