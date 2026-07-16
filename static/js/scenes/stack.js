import { CYAN, RED, stdLights, edges, textSprite, glow, dust, gridFloor, pointerX, setOrb } from './lib.js';

const POD_SPOTS = [
  { x: -2.5, z: 0.7 },
  { x: -0.85, z: -0.75 },
  { x: 0.85, z: 0.7 },
  { x: 2.5, z: -0.75 },
];
const BOUNDARY_Y = 1.25;
const DENIED_EVERY = 6.5;
const DIST = 12.4;
const FOV_TAN = Math.tan((40 / 2) * (Math.PI / 180));
const RAW_SPAN = 9.2;
const RAW_CENTER = -0.2;

function platform(THREE, g, y, edgeColor, edgeOpacity) {
  const geo = new THREE.BoxGeometry(7.6, 0.14, 4.9);
  const mesh = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({
    color: 0x0c1116, metalness: 0.35, roughness: 0.55,
    transparent: true, opacity: 0.92,
  }));
  mesh.position.y = y;
  g.add(mesh);
  const e = edges(THREE, geo, edgeColor, edgeOpacity);
  e.position.y = y;
  g.add(e);

  const inner = new THREE.GridHelper(4.4, 8, 0x1d4046, 0x14262b);
  inner.material.transparent = true;
  inner.material.opacity = 0.35;
  inner.scale.x = 1.6;
  inner.position.y = y + 0.075;
  g.add(inner);
}

function makeRipple(THREE, g) {
  const mat = new THREE.MeshBasicMaterial({
    color: CYAN, transparent: true, opacity: 0, side: THREE.DoubleSide,
  });
  const mesh = new THREE.Mesh(new THREE.TorusGeometry(0.3, 0.02, 8, 40), mat);
  mesh.rotation.x = Math.PI / 2;
  g.add(mesh);
  let born = -9;
  return {
    fire(pos, color, t) {
      born = t;
      mesh.position.copy(pos);
      mat.color.setHex(color);
    },
    update(t) {
      const age = t - born;
      if (age > 0.9) {
        mat.opacity = 0;
        return;
      }
      mesh.scale.setScalar(1 + age * 3.2);
      mat.opacity = 0.7 * (1 - age / 0.9);
    },
  };
}

export function buildStack(THREE, scene) {
  const camera = new THREE.PerspectiveCamera(40, 2, 0.1, 100);
  stdLights(THREE, scene);
  gridFloor(THREE, scene, { y: -4.2, size: 40, divisions: 34, opacity: 0.22 });

  const g = new THREE.Group();
  scene.add(g);

  platform(THREE, g, 2.4, CYAN, 0.4);
  platform(THREE, g, 0, 0xffffff, 0.3);
  platform(THREE, g, -2.4, 0xffffff, 0.16);

  for (const l of [
    { y: 2.4, label: 'USERLAND' },
    { y: 0, label: 'KERNEL' },
    { y: -2.4, label: 'HARDWARE' },
  ]) {
    const tag = textSprite(THREE, l.label, { scale: 0.58, color: 'rgba(120,220,226,0.6)' });
    tag.position.set(-3.15, l.y + 0.52, 1.9);
    g.add(tag);
  }

  /* capsule pods on the userland platform, echoing the hero motif */
  const podGeo = new THREE.CapsuleGeometry(0.28, 0.5, 6, 14);
  const pods = [];
  for (const s of POD_SPOTS) {
    const pod = new THREE.Mesh(podGeo, new THREE.MeshStandardMaterial({
      color: 0xd7e6ea, metalness: 0.3, roughness: 0.3,
      emissive: CYAN, emissiveIntensity: 0.1,
    }));
    pod.position.set(s.x, 2.78, s.z);
    g.add(pod);
    const halo = glow(THREE, { scale: 1.2, opacity: 0.22 });
    halo.position.copy(pod.position);
    g.add(halo);
    pods.push({ mesh: pod, base: 2.78, x: s.x, z: s.z });
  }

  /* the kernel core: same icosahedron heart as the hero */
  const core = new THREE.Group();
  core.add(new THREE.Mesh(
    new THREE.IcosahedronGeometry(0.85, 1),
    new THREE.MeshBasicMaterial({ color: CYAN, wireframe: true, transparent: true, opacity: 0.4 }),
  ));
  core.add(new THREE.Mesh(
    new THREE.IcosahedronGeometry(0.55, 2),
    new THREE.MeshStandardMaterial({
      color: 0x0e1418, metalness: 0.55, roughness: 0.3,
      emissive: CYAN, emissiveIntensity: 0.25,
    }),
  ));
  core.position.y = 0.75;
  g.add(core);
  const coreGlow = glow(THREE, { scale: 3.2, opacity: 0.3 });
  coreGlow.position.y = 0.75;
  g.add(coreGlow);

  /* the syscall boundary, made visible */
  const boundaryMat = new THREE.MeshBasicMaterial({
    color: CYAN, transparent: true, opacity: 0.035, side: THREE.DoubleSide,
    blending: THREE.AdditiveBlending, depthWrite: false,
  });
  const boundary = new THREE.Mesh(new THREE.PlaneGeometry(7.6, 4.9), boundaryMat);
  boundary.rotation.x = Math.PI / 2;
  boundary.position.y = BOUNDARY_Y;
  g.add(boundary);
  const boundaryTag = textSprite(THREE, 'syscall boundary', { scale: 0.42, color: 'rgba(140,240,244,0.4)' });
  boundaryTag.position.set(2.9, BOUNDARY_Y + 0.24, 1.9);
  g.add(boundaryTag);

  /* broker module with spinning ring, feeding hardware */
  const brokerGeo = new THREE.BoxGeometry(0.9, 0.55, 0.8);
  const broker = new THREE.Mesh(brokerGeo, new THREE.MeshStandardMaterial({
    color: 0x14343a, metalness: 0.4, roughness: 0.35,
    emissive: CYAN, emissiveIntensity: 0.25,
  }));
  broker.position.set(2.6, 0.42, 1.25);
  g.add(broker);
  const be = edges(THREE, brokerGeo, CYAN, 0.7);
  be.position.copy(broker.position);
  g.add(be);
  const brokerRing = new THREE.Mesh(
    new THREE.TorusGeometry(0.72, 0.02, 8, 40),
    new THREE.MeshBasicMaterial({ color: CYAN, transparent: true, opacity: 0.4 }),
  );
  brokerRing.position.copy(broker.position);
  brokerRing.rotation.x = Math.PI / 2;
  g.add(brokerRing);

  /* hardware skyline */
  const chipSpots = [
    [-2.9, 0.5, 0.34], [-2.1, -0.9, 0.22], [-1.2, 0.8, 0.42], [-0.3, -0.4, 0.28],
    [0.6, 0.6, 0.5], [1.5, -0.8, 0.3], [2.4, 0.4, 0.24], [3.1, -0.3, 0.4],
  ];
  const blinkers = [];
  for (const [x, z, h] of chipSpots) {
    const chip = new THREE.Mesh(
      new THREE.BoxGeometry(0.55, h, 0.55),
      new THREE.MeshStandardMaterial({
        color: 0x10161c, metalness: 0.5, roughness: 0.4,
        emissive: CYAN, emissiveIntensity: 0.06,
      }),
    );
    chip.position.set(x, -2.33 + h / 2 + 0.07, z);
    g.add(chip);
    if (h > 0.38) blinkers.push({ mat: chip.material, phase: x * 2.1 });
  }

  /* light rails: pods to core, broker to hardware */
  const railMat = new THREE.MeshBasicMaterial({
    color: CYAN, transparent: true, opacity: 0.1,
    blending: THREE.AdditiveBlending, depthWrite: false,
  });
  const up = new THREE.Vector3(0, 1, 0);
  const corePos = new THREE.Vector3(0, 0.75, 0);
  function rail(from, to, opacity) {
    const dir = to.clone().sub(from);
    const len = dir.length();
    const m = new THREE.Mesh(new THREE.CylinderGeometry(0.012, 0.012, len, 6, 1, true), railMat.clone());
    m.material.opacity = opacity;
    m.position.copy(from).add(to).multiplyScalar(0.5);
    m.quaternion.setFromUnitVectors(up, dir.normalize());
    g.add(m);
  }
  for (const p of pods) rail(new THREE.Vector3(p.x, 2.5, p.z), corePos, 0.1);
  const brokerTop = new THREE.Vector3(2.6, 0.15, 1.25);
  const brokerHw = new THREE.Vector3(2.6, -2.3, 1.25);
  rail(brokerTop, brokerHw, 0.2);

  /* traffic */
  function pulse(color) {
    const p = new THREE.Mesh(
      new THREE.SphereGeometry(0.06, 10, 8),
      new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0 }),
    );
    p.add(glow(THREE, { scale: 0.8, opacity: 0.6, color }));
    g.add(p);
    return p;
  }
  const calls = pods.map((p, i) => ({
    down: pulse(CYAN),
    upP: pulse(0xbfffff),
    from: new THREE.Vector3(p.x, 2.5, p.z),
    offset: i * 0.61,
  }));
  const grant = pulse(CYAN);
  const denied = pulse(RED);
  const rippleA = makeRipple(THREE, g);
  const rippleB = makeRipple(THREE, g);
  let lastDeny = -1;
  let lastCross = -1;

  dust(THREE, scene, { count: 130, spread: 11 });

  const px = pointerX();
  const tmp = new THREE.Vector3();

  return {
    camera,
    update(t) {
      /* the machine parks itself in the zone the copy leaves free */
      const hw = DIST * FOV_TAN * camera.aspect;
      const sideCopy = camera.aspect > 1.35;
      const left = sideCopy ? 0.06 * hw : -0.92 * hw;
      const right = 0.92 * hw;
      const s = Math.min(1, (right - left) / RAW_SPAN);
      g.scale.setScalar(s);
      g.position.x = (left + right) / 2 - RAW_CENTER * s;

      const az = Math.sin(t * 0.07) * 0.08 + px() * 0.06;
      camera.position.set(Math.sin(az) * DIST, 2.1 + Math.sin(t * 0.05) * 0.4, Math.cos(az) * DIST);
      camera.lookAt(0, 0.1, 0);

      core.rotation.y = t * 0.3;
      coreGlow.material.opacity = 0.26 + Math.sin(t * 1.1) * 0.06;
      brokerRing.rotation.z = t * 0.8;
      boundaryMat.opacity = 0.03 + Math.sin(t * 0.9) * 0.012;

      for (const p of pods) p.mesh.position.y = p.base + Math.sin(t * 0.8 + p.x * 2) * 0.06;
      for (const b of blinkers) b.mat.emissiveIntensity = 0.06 + Math.max(Math.sin(t * 2.2 + b.phase), 0.4) * 0.16;

      for (const c of calls) {
        const cyc = (t * 0.34 + c.offset) % 1;
        if (cyc < 0.5) {
          const q = cyc / 0.5;
          tmp.lerpVectors(c.from, corePos, q);
          c.down.position.copy(tmp);
          setOrb(c.down, Math.min(q * 8, (1 - q) * 8, 0.9));
          setOrb(c.upP, 0);
          if (Math.abs(tmp.y - BOUNDARY_Y) < 0.06 && t - lastCross > 0.5) {
            lastCross = t;
            rippleA.fire(new THREE.Vector3(tmp.x, BOUNDARY_Y, tmp.z), CYAN, t);
          }
        } else {
          const q = (cyc - 0.5) / 0.5;
          tmp.lerpVectors(corePos, c.from, q);
          c.upP.position.copy(tmp);
          setOrb(c.upP, Math.min(q * 8, (1 - q) * 8, 0.55));
          setOrb(c.down, 0);
        }
      }

      const gp = (t * 0.3) % 1;
      tmp.lerpVectors(brokerTop, brokerHw, gp);
      grant.position.copy(tmp);
      setOrb(grant, Math.min(gp * 6, (1 - gp) * 6, 0.9));

      const dc = (t % DENIED_EVERY) / DENIED_EVERY;
      const dId = Math.floor(t / DENIED_EVERY);
      const dFrom = calls[1].from;
      if (dc < 0.22) {
        const q = dc / 0.22;
        tmp.lerpVectors(dFrom, corePos, q * 0.55);
        denied.position.copy(tmp);
        setOrb(denied, Math.min(q * 6, 0.9));
        if (tmp.y <= BOUNDARY_Y + 0.05 && dId !== lastDeny) {
          lastDeny = dId;
          rippleB.fire(new THREE.Vector3(tmp.x, BOUNDARY_Y, tmp.z), RED, t);
        }
      } else if (dc < 0.34) {
        setOrb(denied, Math.max(0.9 - (dc - 0.22) * 8, 0));
      } else {
        setOrb(denied, 0);
      }

      rippleA.update(t);
      rippleB.update(t);
    },
  };
}
