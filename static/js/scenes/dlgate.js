import { CYAN, stdLights, glow, dust, gridFloor } from './lib.js';

/* Concentric security gates that light up in sequence as a pulse travels
   outward through them: signature, anti-rollback, attestation, boot. Bespoke
   to the "what gates the boot" section. */
const GATES = ['sig', 'rollback', 'attest', 'boot'];
const CYCLE = 5.2;

export function buildDlgate(THREE, scene) {
  const camera = new THREE.PerspectiveCamera(42, 2, 0.1, 100);
  camera.position.set(0, 2.6, 8.4);
  camera.lookAt(0, 0, 0);
  stdLights(THREE, scene);
  gridFloor(THREE, scene, { y: -2.4, size: 30, opacity: 0.18 });
  dust(THREE, scene, { count: 80, spread: 10 });

  const g = new THREE.Group();
  g.rotation.x = -0.5;
  scene.add(g);

  const core = new THREE.Mesh(
    new THREE.IcosahedronGeometry(0.6, 1),
    new THREE.MeshStandardMaterial({ color: 0x0e1418, metalness: 0.5, roughness: 0.3, emissive: CYAN, emissiveIntensity: 0.3 }),
  );
  g.add(core);
  const coreGlow = glow(THREE, { scale: 3, opacity: 0.3 });
  g.add(coreGlow);

  const gates = GATES.map((_, i) => {
    const r = 1.2 + i * 0.85;
    const mat = new THREE.MeshStandardMaterial({
      color: 0x16232a, metalness: 0.4, roughness: 0.35, emissive: CYAN, emissiveIntensity: 0.08,
    });
    const mesh = new THREE.Mesh(new THREE.TorusGeometry(r, 0.07, 14, 72), mat);
    g.add(mesh);
    /* teeth around each gate ring */
    for (let k = 0; k < 12 + i * 4; k++) {
      const a = (k / (12 + i * 4)) * Math.PI * 2;
      const tooth = new THREE.Mesh(
        new THREE.BoxGeometry(0.05, 0.05, 0.16),
        new THREE.MeshBasicMaterial({ color: CYAN, transparent: true, opacity: 0.25 }),
      );
      tooth.position.set(Math.cos(a) * r, Math.sin(a) * r, 0);
      tooth.rotation.z = a;
      mesh.add(tooth);
    }
    return { mesh, mat, r };
  });

  const pulse = new THREE.Mesh(
    new THREE.SphereGeometry(0.12, 14, 12),
    new THREE.MeshBasicMaterial({ color: CYAN }),
  );
  pulse.add(glow(THREE, { scale: 1.4, opacity: 0.6 }));
  g.add(pulse);

  const ripMat = new THREE.MeshBasicMaterial({ color: CYAN, transparent: true, opacity: 0, side: THREE.DoubleSide });
  const ripple = new THREE.Mesh(new THREE.TorusGeometry(1, 0.04, 10, 60), ripMat);
  g.add(ripple);

  return {
    camera,
    update(t) {
      g.rotation.z = t * 0.06;
      core.rotation.y = t * 0.6;
      gates.forEach((gt, i) => { gt.mesh.rotation.z = t * (0.12 - i * 0.02) * (i % 2 ? 1 : -1); });

      const p = (t % CYCLE) / CYCLE;
      const maxR = gates[gates.length - 1].r + 0.4;
      const pr = p * maxR;
      const a = t * 2;
      pulse.position.set(Math.cos(a) * pr, Math.sin(a) * pr, 0);
      pulse.material.opacity = p < 0.95 ? 1 : 0;

      let lit = -1;
      gates.forEach((gt, i) => {
        const reached = pr >= gt.r - 0.1;
        const passing = Math.abs(pr - gt.r) < 0.35;
        gt.mat.emissiveIntensity = reached ? 0.5 : 0.08;
        if (passing) lit = i;
      });
      core.material.emissiveIntensity = 0.3 + (1 - p) * 0.3;

      if (lit >= 0 && ripMat.opacity < 0.1) {
        ripple.scale.setScalar(gates[lit].r);
        ripMat.opacity = 0.6;
      }
      ripMat.opacity *= 0.92;
      ripple.scale.multiplyScalar(1.02);

      const az = Math.sin(t * 0.07) * 0.2;
      camera.position.set(Math.sin(az) * 8.4, 2.6 + Math.sin(t * 0.05) * 0.3, Math.cos(az) * 8.4);
      camera.lookAt(0, 0, 0);
    },
  };
}
