import { CYAN, RED, stdLights, glow, dust } from './lib.js';

/* Two hash columns being compared byte by byte: a scan line descends and
   each pair lights green when it matches. Bespoke to the verify section. */
const ROWS = 10;
const CYCLE = 5;

export function buildDlhash(THREE, scene) {
  const camera = new THREE.PerspectiveCamera(40, 2, 0.1, 100);
  camera.position.set(0, 0, 8.4);
  camera.lookAt(0, 0, 0);
  stdLights(THREE, scene);
  dust(THREE, scene, { count: 70, spread: 9 });

  const g = new THREE.Group();
  scene.add(g);

  const geo = new THREE.BoxGeometry(0.5, 0.42, 0.42);
  const cols = [-1.4, 1.4];
  const cells = [];
  for (let c = 0; c < 2; c++) {
    for (let r = 0; r < ROWS; r++) {
      const mat = new THREE.MeshStandardMaterial({
        color: 0x141b22, metalness: 0.4, roughness: 0.4, emissive: CYAN, emissiveIntensity: 0.05,
      });
      const mesh = new THREE.Mesh(geo, mat);
      mesh.position.set(cols[c], (ROWS / 2 - r) * 0.56 - 0.28, 0);
      g.add(mesh);
      cells.push({ mesh, mat, row: r, col: c });
    }
  }

  /* the matched-link between a pair lights up as the scan confirms it */
  const links = [];
  for (let r = 0; r < ROWS; r++) {
    const mat = new THREE.MeshBasicMaterial({ color: CYAN, transparent: true, opacity: 0 });
    const link = new THREE.Mesh(new THREE.BoxGeometry(2.3, 0.05, 0.05), mat);
    link.position.set(0, (ROWS / 2 - r) * 0.56 - 0.28, 0);
    g.add(link);
    links.push({ mat });
  }

  const scanMat = new THREE.MeshBasicMaterial({
    color: CYAN, transparent: true, opacity: 0.5, side: THREE.DoubleSide,
    blending: THREE.AdditiveBlending, depthWrite: false,
  });
  const scan = new THREE.Mesh(new THREE.PlaneGeometry(4.4, 0.5), scanMat);
  g.add(scan);
  const scanGlow = glow(THREE, { scale: 3, opacity: 0.3 });
  g.add(scanGlow);

  const topY = (ROWS / 2) * 0.56;

  return {
    camera,
    update(t) {
      const p = (t % CYCLE) / CYCLE;
      const scanY = topY - p * (topY * 2 + 0.4);
      scan.position.y = scanY;
      scanGlow.position.y = scanY;
      const active = p < 0.9;
      scanMat.opacity = active ? 0.45 : 0;
      scanGlow.material.opacity = active ? 0.28 : 0;

      for (const c of cells) {
        const cellY = (ROWS / 2 - c.row) * 0.56 - 0.28;
        const passed = scanY < cellY + 0.28;
        const near = Math.abs(scanY - cellY) < 0.4;
        c.mat.emissiveIntensity = passed ? 0.5 : (near ? 0.3 : 0.05);
        c.mesh.material.color.setHex(passed ? 0x1a3038 : 0x141b22);
        c.mesh.rotation.y = passed ? 0 : Math.sin(t * 2 + c.row) * 0.15;
      }
      for (let r = 0; r < ROWS; r++) {
        const cellY = (ROWS / 2 - r) * 0.56 - 0.28;
        links[r].mat.opacity = scanY < cellY + 0.28 ? 0.5 : 0;
      }

      g.rotation.y = Math.sin(t * 0.12) * 0.18;
      camera.position.x = Math.sin(t * 0.1) * 0.5;
      camera.lookAt(0, 0, 0);
    },
  };
}
