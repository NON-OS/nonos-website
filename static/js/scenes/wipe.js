import { CYAN, stdLights, glow, dust, gridFloor } from './lib.js';

const COLS = 16;
const ROWS = 5;
const CYCLE = 8;
const SPAN = COLS * 0.5;

export function buildWipe(THREE, scene) {
  const camera = new THREE.PerspectiveCamera(38, 2, 0.1, 100);
  camera.position.set(0, 2.9, 5.6);
  camera.lookAt(0, -0.3, 0);
  stdLights(THREE, scene);

  gridFloor(THREE, scene, { y: -0.65, size: 26, opacity: 0.22 });

  const under = glow(THREE, { scale: 9, opacity: 0.12 });
  under.position.y = -0.5;
  scene.add(under);
  dust(THREE, scene, { count: 60, spread: 7 });

  const geo = new THREE.BoxGeometry(0.36, 0.22, 0.36);
  const wireGeo = new THREE.BoxGeometry(0.44, 0.28, 0.44);
  const cells = [];
  for (let x = 0; x < COLS; x++) {
    for (let z = 0; z < ROWS; z++) {
      const mat = new THREE.MeshStandardMaterial({
        color: 0x10161c, metalness: 0.2, roughness: 0.55,
        emissive: CYAN, emissiveIntensity: 0.5,
      });
      const mesh = new THREE.Mesh(geo, mat);
      mesh.position.set((x - (COLS - 1) / 2) * 0.5, 0, (z - (ROWS - 1) / 2) * 0.5);
      scene.add(mesh);
      cells.push({ mesh, mat, x: mesh.position.x, phase: x * 0.18 + z * 0.05 });
    }
  }

  const frame = new THREE.Mesh(
    new THREE.BoxGeometry(COLS * 0.5 + 0.4, 0.34, ROWS * 0.5 + 0.4),
    new THREE.MeshBasicMaterial({ color: CYAN, wireframe: true, transparent: true, opacity: 0.07 }),
  );
  scene.add(frame);

  /* the zeroization sweep: a scan plane that erases as it crosses */
  const sweepMat = new THREE.MeshBasicMaterial({
    color: CYAN, transparent: true, opacity: 0.16, side: THREE.DoubleSide,
    blending: THREE.AdditiveBlending, depthWrite: false,
  });
  const sweep = new THREE.Mesh(new THREE.PlaneGeometry(0.08, ROWS * 0.5 + 1.2), sweepMat);
  sweep.rotation.x = 0;
  sweep.rotation.y = Math.PI / 2;
  sweep.position.y = 0.25;
  scene.add(sweep);
  const sweepGlow = glow(THREE, { scale: 2.6, opacity: 0.3 });
  scene.add(sweepGlow);

  return {
    camera,
    update(t) {
      const local = (t % CYCLE) / CYCLE;

      let sweepX = -SPAN;
      let sweepVisible = 0;
      if (local < 0.42) {
        sweepX = -SPAN / 2 - 0.6 + (local / 0.42) * (SPAN + 1.2);
        sweepVisible = Math.min(local * 20, (0.42 - local) * 20, 1);
      }
      sweep.position.x = sweepX;
      sweepMat.opacity = sweepVisible * 0.2;
      sweepGlow.position.set(sweepX, 0.15, 0);
      sweepGlow.material.opacity = sweepVisible * 0.32;

      let lit = 0;
      for (const c of cells) {
        let k;
        if (local < 0.42) {
          k = c.x > sweepX ? 1 : 0.02;
          if (Math.abs(c.x - sweepX) < 0.3) k = 1.6;
        } else if (local < 0.62) {
          k = 0.02;
        } else {
          const refill = (local - 0.62) / 0.3;
          k = Math.min(Math.max((refill * 1.6 - (c.phase / 3)), 0.02), 1);
        }
        c.mat.emissiveIntensity = 0.03 + Math.min(k, 1) * 0.3 + (k > 1 ? 0.22 : 0);
        c.mesh.scale.y = 0.4 + Math.min(k, 1) * 0.6;
        lit += Math.min(k, 1);
      }
      under.material.opacity = 0.05 + (lit / cells.length) * 0.12;

      camera.position.x = Math.sin(t * 0.1) * 0.6;
      camera.lookAt(0, -0.3, 0);
    },
  };
}
