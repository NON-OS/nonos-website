export const CYAN = 0x66ffff;
export const RED = 0xff8a8a;

function fitFont(g, text, px) {
  let size = px;
  g.font = `${size}px "JetBrains Mono", monospace`;
  const w = g.measureText(text).width;
  if (w > 470) {
    size = Math.floor((size * 470) / w);
    g.font = `${size}px "JetBrains Mono", monospace`;
  }
}

export function setOrb(mesh, opacity) {
  mesh.material.opacity = opacity;
  const child = mesh.children[0];
  if (child) child.material.opacity = opacity * 0.65;
}

export function textSprite(THREE, text, opts = {}) {
  const color = opts.color || 'rgba(140,240,244,0.85)';
  const c = document.createElement('canvas');
  c.width = 512;
  c.height = 128;
  const g = c.getContext('2d');
  fitFont(g, text, opts.px || 44);
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.fillStyle = color;
  g.fillText(text, 256, 64);

  const tex = new THREE.CanvasTexture(c);
  tex.anisotropy = 4;
  const sprite = new THREE.Sprite(new THREE.SpriteMaterial({
    map: tex,
    transparent: true,
    depthWrite: false,
    depthTest: false,
  }));
  sprite.renderOrder = 20;
  const s = opts.scale || 1.6;
  sprite.scale.set(s * 4, s, 1);
  return sprite;
}

export function edges(THREE, geometry, color, opacity) {
  return new THREE.LineSegments(
    new THREE.EdgesGeometry(geometry),
    new THREE.LineBasicMaterial({ color, transparent: true, opacity }),
  );
}

export function glow(THREE, opts = {}) {
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const g = c.getContext('2d');
  const grad = g.createRadialGradient(64, 64, 0, 64, 64, 64);
  grad.addColorStop(0, 'rgba(180,255,255,0.9)');
  grad.addColorStop(0.3, 'rgba(80,220,228,0.28)');
  grad.addColorStop(1, 'rgba(0,0,0,0)');
  g.fillStyle = grad;
  g.fillRect(0, 0, 128, 128);

  const sprite = new THREE.Sprite(new THREE.SpriteMaterial({
    map: new THREE.CanvasTexture(c),
    color: opts.color === undefined ? CYAN : opts.color,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    transparent: true,
    opacity: opts.opacity === undefined ? 0.7 : opts.opacity,
  }));
  sprite.scale.setScalar(opts.scale || 2);
  return sprite;
}

export function dust(THREE, scene, opts = {}) {
  /* restrained: fewer, finer motes so scenes read calm, not busy */
  const n = Math.round((opts.count || 90) * 0.6);
  const spread = opts.spread || 9;
  const pos = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) {
    pos[i * 3] = (Math.random() - 0.5) * spread * 2;
    pos[i * 3 + 1] = (Math.random() - 0.5) * spread;
    pos[i * 3 + 2] = (Math.random() - 0.5) * spread - 1;
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  const points = new THREE.Points(geo, new THREE.PointsMaterial({
    color: 0x9fe8ec,
    size: 0.026,
    transparent: true,
    opacity: 0.26,
    depthWrite: false,
  }));
  scene.add(points);
  return points;
}

export function ease(k) {
  return k < 0.5 ? 2 * k * k : 1 - ((-2 * k + 2) ** 2) / 2;
}

export function ring(THREE, radius, opts = {}) {
  const pts = [];
  const n = 90;
  for (let i = 0; i <= n; i++) {
    const a = (i / n) * Math.PI * 2;
    pts.push(new THREE.Vector3(Math.cos(a) * radius, 0, Math.sin(a) * radius));
  }
  return new THREE.Line(
    new THREE.BufferGeometry().setFromPoints(pts),
    new THREE.LineBasicMaterial({
      color: opts.color === undefined ? CYAN : opts.color,
      transparent: true,
      opacity: opts.opacity === undefined ? 0.18 : opts.opacity,
    }),
  );
}

export function gridFloor(THREE, scene, opts = {}) {
  const grid = new THREE.GridHelper(
    opts.size || 34, opts.divisions || 34,
    0x225055, 0x122024,
  );
  grid.material.transparent = true;
  grid.material.opacity = opts.opacity === undefined ? 0.16 : opts.opacity;
  grid.position.y = opts.y === undefined ? -2.4 : opts.y;
  scene.add(grid);
  return grid;
}

export function makeBurst(THREE, scene, color) {
  const n = 26;
  const pos = new Float32Array(n * 3);
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  const mat = new THREE.PointsMaterial({
    color, size: 0.09, transparent: true, opacity: 0, depthWrite: false,
    blending: THREE.AdditiveBlending,
  });
  scene.add(new THREE.Points(geo, mat));

  const vel = [];
  for (let i = 0; i < n; i++) {
    vel.push(new THREE.Vector3(
      (Math.random() - 0.5), (Math.random() - 0.5), (Math.random() - 0.5),
    ).normalize().multiplyScalar(0.5 + Math.random() * 1.2));
  }
  let born = -1;

  return {
    fire(at, t) {
      born = t;
      for (let i = 0; i < n; i++) {
        pos[i * 3] = at.x;
        pos[i * 3 + 1] = at.y;
        pos[i * 3 + 2] = at.z;
      }
      geo.attributes.position.needsUpdate = true;
    },
    update(t) {
      if (born < 0) return;
      const age = t - born;
      if (age > 1.1) {
        mat.opacity = 0;
        return;
      }
      for (let i = 0; i < n; i++) {
        pos[i * 3] += vel[i].x * 0.016;
        pos[i * 3 + 1] += vel[i].y * 0.016;
        pos[i * 3 + 2] += vel[i].z * 0.016;
      }
      geo.attributes.position.needsUpdate = true;
      mat.opacity = Math.max(0.9 * (1 - age / 1.1), 0);
    },
  };
}

let pointerVal = 0;
let pointerInstalled = false;

export function pointerX() {
  if (!pointerInstalled) {
    pointerInstalled = true;
    window.addEventListener('pointermove', (e) => {
      pointerVal = (e.clientX / window.innerWidth - 0.5) * 2;
    }, { passive: true });
  }
  return () => pointerVal;
}

export function liveText(THREE, opts = {}) {
  const c = document.createElement('canvas');
  c.width = 512;
  c.height = 128;
  const g = c.getContext('2d');
  const tex = new THREE.CanvasTexture(c);
  tex.anisotropy = 4;
  const sprite = new THREE.Sprite(new THREE.SpriteMaterial({
    map: tex,
    transparent: true,
    depthWrite: false,
    depthTest: false,
  }));
  sprite.renderOrder = 20;
  const s = opts.scale || 1.6;
  sprite.scale.set(s * 4, s, 1);

  return {
    sprite,
    set(text) {
      g.clearRect(0, 0, 512, 128);
      fitFont(g, text, opts.px || 44);
      g.textAlign = 'center';
      g.textBaseline = 'middle';
      g.fillStyle = opts.color || 'rgba(200,255,255,0.95)';
      g.fillText(text, 256, 64);
      tex.needsUpdate = true;
    },
  };
}

export function stdLights(THREE, scene) {
  scene.add(new THREE.AmbientLight(0xbfd4d9, 0.55));
  const key = new THREE.DirectionalLight(0xffffff, 1.0);
  key.position.set(4, 7, 6);
  scene.add(key);
}

/* a baked studio: light cards reflected by every metal surface */
export function applyStudio(THREE, renderer, scene, fogDensity) {
  const rig = new THREE.Scene();
  const card = (r, g, b, w, h, x, y, z) => {
    const m = new THREE.Mesh(
      new THREE.PlaneGeometry(w, h),
      new THREE.MeshBasicMaterial({ side: THREE.DoubleSide }),
    );
    m.material.color.setRGB(r, g, b);
    m.position.set(x, y, z);
    m.lookAt(0, 0, 0);
    rig.add(m);
  };
  card(1.4, 1.4, 1.5, 7, 4, 0, 6, 2);
  card(0.15, 0.95, 1.05, 5, 6, -6, 1, 1);
  card(0.45, 0.55, 0.6, 4, 5, 6, 0, -1);
  card(0.05, 0.25, 0.28, 8, 3, 0, -5, 3);

  const pmrem = new THREE.PMREMGenerator(renderer);
  const env = pmrem.fromScene(rig, 0.05);
  scene.environment = env.texture;
  pmrem.dispose();

  scene.fog = new THREE.FogExp2(0x0b0d10, fogDensity === undefined ? 0.024 : fogDensity);
  return env.texture;
}
