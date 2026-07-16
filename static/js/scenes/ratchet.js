import { CYAN, RED, stdLights, edges, textSprite, glow, dust, makeBurst } from './lib.js';

const STEP = Math.PI / 10;
const STEP_EVERY = 2.6;
const ATTACK_EVERY = 7.8;

export function buildRatchet(THREE, scene) {
  const camera = new THREE.PerspectiveCamera(42, 2, 0.1, 100);
  camera.position.set(0.5, 1.6, 5.7);
  camera.lookAt(0, 0.1, 0);
  stdLights(THREE, scene);

  const rig = new THREE.Group();
  rig.rotation.x = 0.14;
  scene.add(rig);

  const fill = new THREE.PointLight(0xbfefff, 0.8, 14, 1.6);
  fill.position.set(0.5, 1.4, 4.2);
  scene.add(fill);

  const wheel = new THREE.Group();
  const drum = new THREE.CylinderGeometry(1.35, 1.35, 0.5, 40);
  wheel.add(new THREE.Mesh(drum, new THREE.MeshStandardMaterial({
    color: 0x1a232c, metalness: 0.55, roughness: 0.38,
    emissive: CYAN, emissiveIntensity: 0.04,
  })));
  wheel.add(edges(THREE, drum, CYAN, 0.3));
  for (const r of [0.55, 1.0]) {
    const face = new THREE.Mesh(
      new THREE.TorusGeometry(r, 0.02, 8, 48),
      new THREE.MeshBasicMaterial({ color: CYAN, transparent: true, opacity: 0.25 }),
    );
    face.rotation.x = Math.PI / 2;
    face.position.y = 0.26;
    wheel.add(face);
  }
  for (let i = 0; i < 10; i++) {
    const notch = new THREE.Mesh(
      new THREE.BoxGeometry(0.05, 0.02, 0.28),
      new THREE.MeshBasicMaterial({ color: CYAN, transparent: true, opacity: 0.3 }),
    );
    const a = (i / 10) * Math.PI * 2;
    notch.position.set(Math.cos(a) * 0.78, 0.26, Math.sin(a) * 0.78);
    notch.rotation.y = -a;
    wheel.add(notch);
  }
  for (let i = 0; i < 20; i++) {
    const tooth = new THREE.Mesh(
      new THREE.BoxGeometry(0.12, 0.5, 0.18),
      new THREE.MeshStandardMaterial({
        color: 0x1c232b, metalness: 0.55, roughness: 0.35,
        emissive: CYAN, emissiveIntensity: 0.14,
      }),
    );
    const a = (i / 20) * Math.PI * 2;
    tooth.position.set(Math.cos(a) * 1.42, 0, Math.sin(a) * 1.42);
    tooth.rotation.y = -a + 0.32;
    wheel.add(tooth);
  }
  const hub = new THREE.Mesh(
    new THREE.CylinderGeometry(0.3, 0.3, 0.62, 20),
    new THREE.MeshStandardMaterial({
      color: 0x263038, metalness: 0.7, roughness: 0.25,
      emissive: CYAN, emissiveIntensity: 0.25,
    }),
  );
  wheel.add(hub);
  wheel.rotation.x = Math.PI / 2;
  rig.add(wheel);

  /* pawl resting on the teeth: the reason the counter cannot reverse */
  const pawl = new THREE.Group();
  const arm = new THREE.Mesh(
    new THREE.BoxGeometry(0.14, 0.85, 0.14),
    new THREE.MeshStandardMaterial({
      color: 0x2b333c, metalness: 0.6, roughness: 0.3,
      emissive: CYAN, emissiveIntensity: 0.18,
    }),
  );
  arm.position.y = -0.42;
  const tip = new THREE.Mesh(
    new THREE.ConeGeometry(0.11, 0.3, 4),
    arm.material.clone(),
  );
  tip.position.y = -0.95;
  tip.rotation.x = Math.PI;
  pawl.add(arm, tip);
  pawl.position.set(0.62, 2.05, 0);
  pawl.rotation.z = -0.42;
  rig.add(pawl);

  const halo = glow(THREE, { scale: 3.6, opacity: 0.1 });
  scene.add(halo);
  dust(THREE, scene, { count: 60, spread: 6 });

  const index = textSprite(THREE, 'index 1000', { scale: 0.8 });
  index.position.set(0, 1.5, 0.6);
  scene.add(index);

  const attacker = textSprite(THREE, '300', { scale: 0.66, color: 'rgba(255,138,138,0.9)' });
  scene.add(attacker);

  const flashMat = new THREE.MeshBasicMaterial({ color: RED, transparent: true, opacity: 0 });
  const flashRing = new THREE.Mesh(new THREE.TorusGeometry(1.55, 0.05, 10, 48), flashMat);
  flashRing.rotation.x = Math.PI / 2;
  flashRing.position.y = 0;
  rig.add(flashRing);

  const burst = makeBurst(THREE, scene, RED);

  let spin = 0;
  let target = 0;
  let steps = 0;
  let lastAttack = -1;

  return {
    camera,
    update(t) {
      const due = Math.floor(t / STEP_EVERY);
      if (due > steps) {
        steps = due;
        target += STEP;
      }
      const gap = target - spin;
      spin += gap * 0.14;
      wheel.rotation.y = spin;

      pawl.rotation.z = -0.42 + Math.min(gap * 1.6, 0.16);

      const a = (t % ATTACK_EVERY) / ATTACK_EVERY;
      const attackId = Math.floor(t / ATTACK_EVERY);
      if (a < 0.3) {
        const q = a / 0.3;
        attacker.position.set(3.3 - q * 1.6, 0.4, 0.7);
        attacker.material.opacity = Math.min(q * 3, 0.9);
      } else if (a < 0.55) {
        const q = (a - 0.3) / 0.25;
        if (attackId !== lastAttack) {
          lastAttack = attackId;
          burst.fire(new THREE.Vector3(1.65, 0.4, 0.7), t);
        }
        attacker.position.set(1.7 + q * 2, 0.4 + q * 0.6, 0.7);
        attacker.material.opacity = 0.9 * (1 - q);
        flashMat.opacity = Math.max(flashMat.opacity, (1 - q) * 0.8);
        wheel.rotation.y = spin + Math.sin(q * 30) * 0.012 * (1 - q);
      } else {
        attacker.material.opacity = 0;
      }
      flashMat.opacity *= 0.93;
      burst.update(t);

      halo.material.color.setHex(flashMat.opacity > 0.12 ? RED : CYAN);
      halo.material.opacity = 0.08 + flashMat.opacity * 0.35 + Math.abs(gap) * 0.3;

      camera.position.x = 0.5 + Math.sin(t * 0.12) * 0.25;
      camera.lookAt(0, 0.1, 0);
    },
  };
}
