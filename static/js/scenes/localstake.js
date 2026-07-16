import { CYAN, stdLights, edges, glow, dust, gridFloor, textSprite, setOrb, ease } from './lib.js';

const CYCLE = 3.6;
const SLOTS = 5;
const SLOT0 = 0.9;
const SPACING = 1.18;
const DIST = 9.8;
const FOV_TAN = Math.tan((40 / 2) * (Math.PI / 180));
const RAW_SPAN = 13.0;
const RAW_CENTER = 0.7;

export function buildLocalstake(THREE, scene) {
  const camera = new THREE.PerspectiveCamera(40, 2, 0.1, 100);
  stdLights(THREE, scene);
  gridFloor(THREE, scene, { y: -1.9, size: 30, opacity: 0.22 });
  dust(THREE, scene, { count: 90, spread: 9 });

  const g = new THREE.Group();
  scene.add(g);

  /* your machine: a small tower with a live screen */
  const towerGeo = new THREE.BoxGeometry(1.0, 1.5, 0.85);
  const tower = new THREE.Mesh(towerGeo, new THREE.MeshStandardMaterial({
    color: 0x11161c, metalness: 0.5, roughness: 0.4,
    emissive: CYAN, emissiveIntensity: 0.05,
  }));
  tower.position.set(-4.1, -0.15, 0);
  g.add(tower);
  const te = edges(THREE, towerGeo, CYAN, 0.4);
  te.position.copy(tower.position);
  g.add(te);

  const screenMat = new THREE.MeshBasicMaterial({
    color: CYAN, transparent: true, opacity: 0.3,
  });
  const screen = new THREE.Mesh(new THREE.PlaneGeometry(0.62, 0.42), screenMat);
  screen.position.set(-4.1, 0.22, 0.44);
  g.add(screen);

  const towerGlow = glow(THREE, { scale: 2.6, opacity: 0.2 });
  towerGlow.position.copy(tower.position);
  g.add(towerGlow);

  const machineTag = textSprite(THREE, 'YOUR MACHINE', { scale: 0.5, color: 'rgba(150,240,244,0.8)' });
  machineTag.position.set(-4.1, -1.45, 0);
  g.add(machineTag);

  /* the chain: blocks advancing, head on the right */
  const blockGeo = new THREE.BoxGeometry(0.72, 0.72, 0.72);
  const rail = new THREE.Mesh(
    new THREE.BoxGeometry(SLOTS * SPACING + 0.8, 0.03, 0.16),
    new THREE.MeshBasicMaterial({
      color: CYAN, transparent: true, opacity: 0.1,
      blending: THREE.AdditiveBlending, depthWrite: false,
    }),
  );
  rail.position.set(SLOT0 + ((SLOTS - 1) * SPACING) / 2, -0.55, 0);
  g.add(rail);

  const blocks = [];
  for (let i = 0; i < SLOTS + 1; i++) {
    const mat = new THREE.MeshStandardMaterial({
      color: 0x141b22, metalness: 0.55, roughness: 0.35,
      transparent: true, emissive: CYAN, emissiveIntensity: 0.08,
    });
    const mesh = new THREE.Mesh(blockGeo, mat);
    const edge = edges(THREE, blockGeo, CYAN, 0.35);
    g.add(mesh, edge);
    blocks.push({ mesh, edge, mat, slot: i, target: i });
  }

  const chainTag = textSprite(THREE, 'ETHEREUM MAINNET', { scale: 0.5, color: 'rgba(150,240,244,0.8)' });
  chainTag.position.set(SLOT0 + ((SLOTS - 1) * SPACING) / 2, -1.45, 0);
  g.add(chainTag);

  const sigTag = textSprite(THREE, 'EIP-712', { scale: 0.42, color: 'rgba(140,240,244,0.5)' });
  sigTag.position.set(-1.6, 1.6, 0);
  sigTag.material.opacity = 0;
  g.add(sigTag);

  /* receipt out, confirmation back */
  const receipt = new THREE.Mesh(
    new THREE.OctahedronGeometry(0.13),
    new THREE.MeshBasicMaterial({ color: CYAN, transparent: true, opacity: 0 }),
  );
  receipt.add(glow(THREE, { scale: 1, opacity: 0.55 }));
  g.add(receipt);

  const confirm = new THREE.Mesh(
    new THREE.SphereGeometry(0.07, 12, 10),
    new THREE.MeshBasicMaterial({ color: 0xbfffff, transparent: true, opacity: 0 }),
  );
  confirm.add(glow(THREE, { scale: 0.8, opacity: 0.45 }));
  g.add(confirm);

  function ringPop() {
    const mat = new THREE.MeshBasicMaterial({
      color: CYAN, transparent: true, opacity: 0, side: THREE.DoubleSide,
    });
    const mesh = new THREE.Mesh(new THREE.TorusGeometry(0.34, 0.02, 8, 40), mat);
    g.add(mesh);
    let born = -9;
    return {
      fire(pos, t) { born = t; mesh.position.copy(pos); },
      update(t, cam) {
        const age = t - born;
        if (age > 0.8) { mat.opacity = 0; return; }
        mesh.scale.setScalar(1 + age * 2.8);
        mesh.quaternion.copy(cam.quaternion);
        mat.opacity = 0.65 * (1 - age / 0.8);
      },
    };
  }
  const popSign = ringPop();
  const popLand = ringPop();

  const from = new THREE.Vector3(-3.5, 0.1, 0);
  let cycleSeen = -1;
  let signed = false;
  let landed = false;

  function slotX(s) { return SLOT0 + s * SPACING; }

  return {
    camera,
    update(t) {
      const cycle = Math.floor(t / CYCLE);
      const p = (t % CYCLE) / CYCLE;

      if (cycle !== cycleSeen) {
        cycleSeen = cycle;
        signed = false;
        landed = false;
        for (const b of blocks) {
          b.target -= 1;
          if (b.target < 0) {
            b.target = SLOTS;
            b.slot = SLOTS + 0.6;
          }
        }
      }

      for (const b of blocks) {
        b.slot += (b.target - b.slot) * 0.07;
        const x = slotX(b.slot);
        b.mesh.position.set(x, -0.15, 0);
        b.edge.position.copy(b.mesh.position);
        b.mesh.rotation.y = t * 0.12 + b.target;
        b.edge.rotation.y = b.mesh.rotation.y;
        const k = Math.min(Math.max((b.slot + 0.4) / 1.2, 0), 1)
          * Math.min(Math.max((SLOTS - 0.4 - b.slot) / 1.2 + 1, 0), 1);
        b.mat.opacity = Math.min(k, 1) * 0.95;
        b.edge.material.opacity = Math.min(k, 1) * 0.35;
      }

      const head = blocks.reduce((a, b) => (b.target > a.target && b.target < SLOTS ? b : a), blocks[0]);
      const headPos = head.mesh.position;

      /* sign locally, send, land on the head block, hear back */
      if (p > 0.08 && !signed) {
        signed = true;
        popSign.fire(from, t);
      }
      if (p > 0.12 && p < 0.52) {
        const q = ease((p - 0.12) / 0.4);
        receipt.position.set(
          from.x + (headPos.x - from.x) * q,
          from.y + Math.sin(q * Math.PI) * 1.7,
          0,
        );
        receipt.rotation.y = t * 4;
        setOrb(receipt, Math.min(q * 6, 0.95));
        sigTag.material.opacity = Math.sin(q * Math.PI) * 0.6;
      } else {
        setOrb(receipt, 0);
        sigTag.material.opacity *= 0.9;
      }
      if (p >= 0.52 && !landed) {
        landed = true;
        popLand.fire(headPos, t);
      }
      if (landed) head.mat.emissiveIntensity = 0.08 + Math.max(0.5 - (p - 0.52) * 1.4, 0);

      if (p > 0.6 && p < 0.94) {
        const q = ease((p - 0.6) / 0.34);
        confirm.position.set(
          headPos.x + (from.x - headPos.x) * q,
          headPos.y + Math.sin(q * Math.PI) * 1.1,
          0.1,
        );
        setOrb(confirm, Math.min(q * 6, (1 - q) * 6, 0.6));
      } else {
        setOrb(confirm, 0);
      }

      screenMat.opacity = 0.24 + Math.sin(t * 3.1) * 0.05 + (signed && p < 0.2 ? 0.25 : 0);
      towerGlow.material.opacity = 0.16 + (p < 0.2 ? Math.sin(p * 15) * 0.1 : 0);

      popSign.update(t, camera);
      popLand.update(t, camera);

      /* the rig fits the zone the copy leaves free */
      const hw = DIST * FOV_TAN * camera.aspect;
      const sideCopy = camera.aspect > 1.35;
      const left = sideCopy ? 0.06 * hw : -0.92 * hw;
      const right = 0.92 * hw;
      const s = Math.min(1, (right - left) / RAW_SPAN);
      g.scale.setScalar(s);
      g.position.x = (left + right) / 2 - RAW_CENTER * s;

      const az = Math.sin(t * 0.07) * 0.06;
      camera.position.set(Math.sin(az) * DIST, 1.3 + Math.sin(t * 0.05) * 0.3, Math.cos(az) * DIST);
      camera.lookAt(0, -0.2, 0);
    },
  };
}
