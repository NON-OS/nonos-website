export function buildField(THREE) {
  const n = 720;
  const pos = new Float32Array(n * 3);

  for (let i = 0; i < n; i++) {
    const r = 26 + Math.random() * 34;
    const th = Math.random() * Math.PI * 2;
    const ph = Math.acos(2 * Math.random() - 1);
    pos[i * 3] = r * Math.sin(ph) * Math.cos(th);
    pos[i * 3 + 1] = r * Math.cos(ph) * 0.6;
    pos[i * 3 + 2] = r * Math.sin(ph) * Math.sin(th);
  }

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));

  const points = new THREE.Points(geo, new THREE.PointsMaterial({
    color: 0x9fe8ec,
    size: 0.055,
    transparent: true,
    opacity: 0.55,
    depthWrite: false,
  }));

  return {
    points,
    update(t) { points.rotation.y = t * 0.008; },
  };
}
