import { CYAN, stdLights, glow, dust, edges } from './lib.js';

/* The image being sealed: a signed disk rotates while a verification ring
   sweeps over it and periodically stamps a seal. Bespoke to the download hero. */
const SEAL = 4.2;

export function buildDlseal(THREE, scene) {
  const camera = new THREE.PerspectiveCamera(42, 2, 0.1, 100);
  camera.position.set(0, 1.4, 8);
  camera.lookAt(0, 0, 0);
  stdLights(THREE, scene);
  dust(THREE, scene, { count: 90, spread: 10 });

  const g = new THREE.Group();
  g.rotation.x = 0.4;
  scene.add(g);

  const diskGeo = new THREE.CylinderGeometry(2.1, 2.1, 0.5, 48);
  const disk = new THREE.Mesh(diskGeo, new THREE.MeshStandardMaterial({
    color: 0x121a20, metalness: 0.6, roughness: 0.3, emissive: CYAN, emissiveIntensity: 0.12,
  }));
  g.add(disk, edges(THREE, diskGeo, CYAN, 0.3));
  for (const r of [0.7, 1.2, 1.7]) {
    const groove = new THREE.Mesh(
      new THREE.TorusGeometry(r, 0.012, 8, 60),
      new THREE.MeshBasicMaterial({ color: CYAN, transparent: true, opacity: 0.22 }),
    );
    groove.rotation.x = Math.PI / 2;
    groove.position.y = 0.26;
    g.add(groove);
  }
  const hub = new THREE.Mesh(
    new THREE.IcosahedronGeometry(0.5, 1),
    new THREE.MeshStandardMaterial({ color: 0x0e1418, metalness: 0.5, roughness: 0.3, emissive: CYAN, emissiveIntensity: 0.3 }),
  );
  hub.position.y = 0.3;
  g.add(hub);
  const coreGlow = glow(THREE, { scale: 5.2, opacity: 0.24 });
  scene.add(coreGlow);

  /* the verification ring orbits above the disk */
  const ring = new THREE.Mesh(
    new THREE.TorusGeometry(2.5, 0.04, 12, 64),
    new THREE.MeshBasicMaterial({ color: CYAN, transparent: true, opacity: 0.7 }),
  );
  scene.add(ring);

  const sealMat = new THREE.MeshBasicMaterial({ color: CYAN, transparent: true, opacity: 0, side: THREE.DoubleSide });
  const seal = new THREE.Mesh(new THREE.TorusGeometry(2.1, 0.05, 10, 60), sealMat);
  seal.rotation.x = Math.PI / 2 - 0.4;
  g.add(seal);

  let sealed = -1;

  return {
    camera,
    update(t) {
      g.rotation.z = t * 0.25;
      hub.rotation.y = t * 0.8;

      const local = t % SEAL;
      /* the ring descends onto the disk, seals, lifts */
      const rp = local / SEAL;
      const y = rp < 0.5 ? 3.2 - rp * 2 * 2.9 : 0.3 + (rp - 0.5) * 2 * 2.9;
      ring.position.y = y * Math.cos(0.4);
      ring.position.z = -y * Math.sin(0.4);
      ring.rotation.x = Math.PI / 2 - 0.4;
      ring.rotation.z = t * 1.5;
      const closing = Math.max(1 - Math.abs(rp - 0.5) / 0.12, 0);
      ring.material.opacity = 0.5 + closing * 0.5;
      hub.material.emissiveIntensity = 0.3 + closing * 0.5;
      coreGlow.material.opacity = 0.2 + closing * 0.35;

      const cyc = Math.floor(t / SEAL);
      if (rp > 0.48 && rp < 0.52 && cyc !== sealed) {
        sealed = cyc;
      }
      if (rp > 0.5 && rp < 0.72) {
        const k = (rp - 0.5) / 0.22;
        seal.scale.setScalar(1 + k * 1.4);
        sealMat.opacity = Math.sin(k * Math.PI) * 0.55;
      } else {
        sealMat.opacity *= 0.9;
      }

      const az = Math.sin(t * 0.08) * 0.2;
      camera.position.set(Math.sin(az) * 8, 1.4 + Math.sin(t * 0.06) * 0.3, Math.cos(az) * 8);
      camera.lookAt(0, 0.2, 0);
    },
  };
}
