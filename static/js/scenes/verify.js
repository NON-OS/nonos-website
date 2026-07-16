import { CYAN, RED, stdLights, glow, dust, ease } from './lib.js';

const PERIOD = 3.8;

export function buildVerify(THREE, scene) {
  const camera = new THREE.PerspectiveCamera(40, 2, 0.1, 100);
  camera.position.set(0.4, 1.4, 8.0);
  camera.lookAt(0, 0, 0);
  stdLights(THREE, scene);

  const grid = new THREE.GridHelper(26, 26, 0x2a6e73, 0x131f24);
  grid.material.transparent = true;
  grid.material.opacity = 0.3;
  grid.position.y = -2.1;
  scene.add(grid);

  const track = new THREE.Mesh(
    new THREE.BoxGeometry(13.5, 0.02, 0.5),
    new THREE.MeshBasicMaterial({ color: CYAN, transparent: true, opacity: 0.07 }),
  );
  track.position.y = -0.85;
  scene.add(track);

  /* inspection tunnel: faint rings along the path, double ring at the gate */
  const tunnel = [];
  for (const x of [-4.6, -2.9, 2.9, 4.6]) {
    const r = new THREE.Mesh(
      new THREE.TorusGeometry(1.1, 0.018, 8, 48),
      new THREE.MeshBasicMaterial({ color: CYAN, transparent: true, opacity: 0.1 }),
    );
    r.rotation.y = Math.PI / 2;
    r.position.x = x;
    scene.add(r);
    tunnel.push({ mesh: r, x });
  }

  const gate = new THREE.Group();
  const ringMat = new THREE.MeshBasicMaterial({ color: CYAN, transparent: true, opacity: 0.8 });
  const ringA = new THREE.Mesh(new THREE.TorusGeometry(1.5, 0.05, 12, 64), ringMat);
  const ringB = new THREE.Mesh(new THREE.TorusGeometry(1.72, 0.02, 8, 64), ringMat.clone());
  ringB.material.opacity = 0.3;
  const spokes = new THREE.Group();
  for (let i = 0; i < 6; i++) {
    const s = new THREE.Mesh(
      new THREE.BoxGeometry(0.02, 0.34, 0.02),
      new THREE.MeshBasicMaterial({ color: CYAN, transparent: true, opacity: 0.5 }),
    );
    const a = (i / 6) * Math.PI * 2;
    s.position.set(Math.cos(a) * 1.61, Math.sin(a) * 1.61, 0);
    s.rotation.z = a;
    spokes.add(s);
  }
  const discMat = new THREE.MeshBasicMaterial({
    color: CYAN, transparent: true, opacity: 0.05, side: THREE.DoubleSide,
  });
  gate.add(ringA, ringB, spokes, new THREE.Mesh(new THREE.CircleGeometry(1.46, 48), discMat));
  gate.rotation.y = Math.PI / 2;
  scene.add(gate);

  const ringGlow = glow(THREE, { scale: 6, opacity: 0.24 });
  scene.add(ringGlow);
  dust(THREE, scene, { count: 80, spread: 8 });

  const capGeo = new THREE.CapsuleGeometry(0.32, 0.85, 6, 16);
  const wireGeo = new THREE.CapsuleGeometry(0.4, 0.95, 3, 8);
  const items = [];
  for (let i = 0; i < 3; i++) {
    const mat = new THREE.MeshStandardMaterial({
      color: 0xd7e6ea, metalness: 0.35, roughness: 0.28,
      transparent: true, emissive: CYAN, emissiveIntensity: 0.05,
    });
    const mesh = new THREE.Mesh(capGeo, mat);
    const wire = new THREE.Mesh(wireGeo, new THREE.MeshBasicMaterial({
      color: CYAN, wireframe: true, transparent: true, opacity: 0.12,
    }));
    mesh.add(wire);
    mesh.rotation.z = Math.PI / 2;
    scene.add(mesh);
    items.push({ mesh, mat, wire, offset: i * (PERIOD / 3) * 1.9 });
  }

  return {
    camera,
    update(t) {
      let heat = 0;
      let heatBad = false;

      gate.rotation.x = t * 0.25;
      ringB.rotation.z = -t * 0.6;

      for (const it of items) {
        const local = (t + it.offset) % PERIOD;
        const cycle = Math.floor((t + it.offset) / PERIOD);
        const bad = cycle % 4 === 3;
        const p = local / PERIOD;
        const x = -6.8 + 13.6 * (p * 0.7 + ease(p) * 0.3);

        it.mesh.position.x = x;
        it.mesh.rotation.x = t * 0.9 + it.offset;

        if (bad && p > 0.5) {
          const q = (p - 0.5) * 2;
          it.mesh.position.y = -q * q * 3.4;
          it.mesh.rotation.z = Math.PI / 2 + q * 1.3;
          it.mat.opacity = Math.max(1 - q * 1.7, 0);
          it.wire.material.opacity = 0;
          it.mat.emissive.setHex(RED);
          it.mat.emissiveIntensity = 0.55;
        } else {
          it.mesh.position.y = 0;
          it.mesh.rotation.z = Math.PI / 2;
          it.mat.opacity = p > 0.9 ? (1 - p) * 10 : 1;
          it.wire.material.opacity = !bad && p > 0.5 ? 0.3 : 0.12;
          it.mat.emissive.setHex(bad ? RED : CYAN);
          it.mat.emissiveIntensity = !bad && p > 0.5 ? 0.5 : 0.05;
        }

        for (const tr of tunnel) {
          const near = Math.max(1 - Math.abs(x - tr.x) / 0.7, 0);
          if (near > 0) tr.mesh.material.opacity = Math.max(tr.mesh.material.opacity, 0.1 + near * 0.4);
        }

        const nearGate = Math.max(1 - Math.abs(x) / 0.9, 0);
        if (nearGate > heat) {
          heat = nearGate;
          heatBad = bad;
        }
      }

      for (const tr of tunnel) tr.mesh.material.opacity += (0.1 - tr.mesh.material.opacity) * 0.08;

      const col = heatBad ? RED : CYAN;
      ringMat.color.setHex(col);
      discMat.color.setHex(col);
      ringGlow.material.color.setHex(col);
      gate.scale.setScalar(1 + heat * 0.1);
      ringMat.opacity = 0.55 + heat * 0.45;
      discMat.opacity = 0.05 + heat * 0.2;
      ringGlow.material.opacity = 0.14 + heat * 0.42;

      camera.position.y = 1.4 + Math.sin(t * 0.4) * 0.12;
      camera.lookAt(0, 0, 0);
    },
  };
}
