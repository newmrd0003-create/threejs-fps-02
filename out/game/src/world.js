// YARD 7 — DUSTLINE's map. A desert-industrial yard, 52 x 36 m, two bomb sites
// (A DEPOT west, B SILO east), three lanes: A-long, mid, B-long.
// Static geometry is merged into one mesh per material (4 draw calls for the
// whole level); every box is also an AABB collider and a bullet stop.
// One AABB list feeds movement, bullets and the bots' nav graph.
import * as THREE from 'three';
import { CONFIG } from './config.js';
import { PALETTE } from './palette.js';
import { createMaterials } from './materials.js';

// Merge many axis-aligned boxes into one BufferGeometry per material.
function mergeBoxes(specs) {
  const byMat = new Map();
  for (const s of specs) {
    if (!byMat.has(s.mat)) byMat.set(s.mat, []);
    byMat.get(s.mat).push(s);
  }
  const meshes = [];
  for (const [mat, list] of byMat) {
    const pos = [];
    const nor = [];
    const uv = [];
    const idx = [];
    let base = 0;
    for (const s of list) {
      const geo = new THREE.BoxGeometry(s.w, s.h, s.d);
      geo.translate(s.x, s.y, s.z);
      const p = geo.attributes.position.array;
      const n = geo.attributes.normal.array;
      const u = geo.attributes.uv.array;
      const ii = geo.index.array;
      for (let i = 0; i < p.length; i += 1) pos.push(p[i]);
      for (let i = 0; i < n.length; i += 1) nor.push(n[i]);
      for (let i = 0; i < u.length; i += 1) uv.push(u[i]);
      for (let i = 0; i < ii.length; i += 1) idx.push(ii[i] + base);
      base += geo.attributes.position.count;
      geo.dispose();
    }
    const merged = new THREE.BufferGeometry();
    merged.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    merged.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
    merged.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
    merged.setIndex(idx);
    const mesh = new THREE.Mesh(merged, mat);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    meshes.push(mesh);
  }
  return meshes;
}

// 2D segment vs AABB test (XZ plane), used to auto-link nav nodes.
function segmentHitsBox(ax, az, bx, bz, box, pad) {
  const minX = box.min.x - pad;
  const maxX = box.max.x + pad;
  const minZ = box.min.z - pad;
  const maxZ = box.max.z + pad;
  const dx = bx - ax;
  const dz = bz - az;
  let t0 = 0;
  let t1 = 1;
  for (const [p, d, lo, hi] of [[ax, dx, minX, maxX], [az, dz, minZ, maxZ]]) {
    if (Math.abs(d) < 1e-9) {
      if (p < lo || p > hi) return false;
    } else {
      let a = (lo - p) / d;
      let b = (hi - p) / d;
      if (a > b) { const t = a; a = b; b = t; }
      t0 = Math.max(t0, a);
      t1 = Math.min(t1, b);
      if (t0 > t1) return false;
    }
  }
  return true;
}

export function createWorld(scene) {
  const materials = createMaterials();
  const M = {
    floor: materials.floor, wall: materials.wall, container: materials.container,
    containerBlue: materials.containerBlue, hazard: materials.hazard,
    crate: materials.crate, crateDark: materials.crateDark, pillar: materials.pillar,
    silo: materials.silo,
  };

  // [w, h, d, x, y, z, material] — every box is a collider + a bullet stop.
  const specs = [
    // floor + perimeter
    [52.4, 0.4, 36.4, 0, -0.2, 0, M.floor],
    [0.4, 4.6, 36.4, -26.2, 2.3, 0, M.wall],
    [0.4, 4.6, 36.4, 26.2, 2.3, 0, M.wall],
    [52.4, 4.6, 0.4, 0, 2.3, -18.2, M.wall],
    [52.4, 4.6, 0.4, 0, 2.3, 18.2, M.wall],
    // mid lane
    [1.2, 3.2, 1.2, 0, 1.6, 0, M.pillar],
    [1.2, 1.1, 1.2, -2.2, 0.55, 4, M.crate],
    [1.2, 1.1, 1.2, 2.2, 0.55, 4, M.crate],
    [6, 2.6, 2.4, 0, 1.3, -7, M.container],
    [1.6, 0.7, 1.6, -4, 0.35, -10, M.crateDark],
    [1.6, 0.7, 1.6, 4, 0.35, -10, M.crateDark],
    // A site (DEPOT, west): back + side walls, gate open to east/south
    [8, 3.4, 0.4, -20, 1.7, -16, M.wall],
    [0.4, 3.4, 6, -24, 1.7, -13, M.wall],
    [6, 2.6, 2.4, -14, 1.3, -6, M.containerBlue],
    [2.4, 2.6, 6, -10, 1.3, -12, M.container],
    [1.2, 1.1, 3.6, -16, 0.55, -8, M.crate],
    [2.4, 0.9, 1.2, -20, 0.45, -6, M.crateDark],
    [3, 0.06, 0.8, -16, 0.03, -12, M.hazard],
    // B site (SILO, east)
    [8, 3.4, 0.4, 20, 1.7, -16, M.wall],
    [0.4, 3.4, 6, 24, 1.7, -13, M.wall],
    [6, 2.6, 2.4, 14, 1.3, -6, M.container],
    [2.4, 2.6, 6, 10, 1.3, -12, M.containerBlue],
    [1.2, 1.1, 3.6, 16, 0.55, -8, M.crate],
    [2.4, 0.9, 1.2, 20, 0.45, -6, M.crateDark],
    [3, 0.06, 0.8, 16, 0.03, -12, M.hazard],
    // south (player side)
    [2.4, 0.9, 1.2, -6, 0.45, 10, M.crate],
    [2.4, 0.9, 1.2, 6, 0.45, 10, M.crate],
    [0.9, 2.8, 0.9, -12, 1.4, 8, M.pillar],
    [0.9, 2.8, 0.9, 12, 1.4, 8, M.pillar],
    [3, 1.1, 0.6, -3, 0.55, 12, M.wall],
    [3, 1.1, 0.6, 3, 0.55, 12, M.wall],
    // north (bot side)
    [6, 2.6, 2.4, -6, 1.3, -15, M.containerBlue],
    [6, 2.6, 2.4, 6, 1.3, -15, M.container],
    // silo tank at B (visual cylinder; its collider is the box below)
    [4.4, 5, 4.4, 22, 2.5, -14, M.silo],
  ];

  const group = new THREE.Group();
  scene.add(group);
  const colliders = [];
  const shootables = [];
  for (const [w, h, d, x, y, z, mat] of specs) {
    colliders.push(new THREE.Box3(
      new THREE.Vector3(x - w / 2, y - h / 2, z - d / 2),
      new THREE.Vector3(x + w / 2, y + h / 2, z + d / 2),
    ));
  }
  for (const mesh of mergeBoxes(specs.map(([w, h, d, x, y, z, mat]) => ({ w, h, d, x, y, z, mat })))) {
    group.add(mesh);
    shootables.push(mesh);
  }

  // Silo cylinder visual (inside its box collider).
  const silo = new THREE.Mesh(new THREE.CylinderGeometry(2.1, 2.1, 5, 20), M.silo);
  silo.position.set(22, 2.5, -14);
  silo.castShadow = true;
  silo.receiveShadow = true;
  group.add(silo);
  const siloCap = new THREE.Mesh(new THREE.SphereGeometry(2.1, 20, 10, 0, Math.PI * 2, 0, Math.PI / 2), M.silo);
  siloCap.position.set(22, 5, -14);
  siloCap.castShadow = true;
  group.add(siloCap);

  // Site sign boards + floor rings.
  function sign(letterMat, x, z) {
    const board = new THREE.Mesh(new THREE.PlaneGeometry(3, 3), letterMat);
    board.position.set(x, 2.4, z);
    group.add(board);
    return board;
  }
  sign(materials.signA, -20, -15.75);
  sign(materials.signB, 20, -15.75);
  const ringGeo = new THREE.RingGeometry(3.6, 4.5, 40);
  const ringA = new THREE.Mesh(ringGeo, new THREE.MeshBasicMaterial({
    color: new THREE.Color(PALETTE.siteA), transparent: true, opacity: 0.4, side: THREE.DoubleSide,
  }));
  ringA.rotation.x = -Math.PI / 2;
  ringA.position.set(-20, 0.02, -12);
  group.add(ringA);
  const ringB = new THREE.Mesh(ringGeo, new THREE.MeshBasicMaterial({
    color: new THREE.Color(PALETTE.siteB), transparent: true, opacity: 0.4, side: THREE.DoubleSide,
  }));
  ringB.rotation.x = -Math.PI / 2;
  ringB.position.set(20, 0.02, -12);
  group.add(ringB);

  // Distant dunes for skyline depth (visual only, no colliders).
  const duneGeo = new THREE.ConeGeometry(18, 8, 5);
  for (const [x, z, ry] of [[-30, -30, 0.4], [12, -34, 1.2], [32, -28, 2.0], [-34, 30, 0.9], [28, 32, 2.6]]) {
    const dune = new THREE.Mesh(duneGeo, materials.dune);
    dune.position.set(x, -0.5, z);
    dune.rotation.y = ry;
    scene.add(dune);
  }

  // Lighting: warm key + cool fill + sky/ground gradient, one 2048 shadow map.
  scene.add(new THREE.HemisphereLight(new THREE.Color(0xcfd8e6), new THREE.Color(0x3a2f22), 0.85));
  const key = new THREE.DirectionalLight(new THREE.Color(0xffe6b8), 2.4);
  key.position.set(18, 26, 14);
  key.target.position.set(0, 0, -4);
  key.castShadow = true;
  key.shadow.mapSize.set(CONFIG.perf.shadowMap, CONFIG.perf.shadowMap);
  key.shadow.camera.left = -32;
  key.shadow.camera.right = 32;
  key.shadow.camera.top = 32;
  key.shadow.camera.bottom = -32;
  key.shadow.camera.far = 80;
  key.shadow.bias = -0.0006;
  scene.add(key, key.target);
  const fill = new THREE.DirectionalLight(new THREE.Color(PALETTE.muted), 0.5);
  fill.position.set(-14, 12, 16);
  scene.add(fill);

  // Nav graph: hand-placed nodes, auto-linked when the straight segment
  // between them stays clear of colliders (2D, padded 0.5 m).
  const nodePos = [
    [0, 14], [-6, 12], [6, 12], [-4, 6], [4, 6], [0, 2], [-4, 0], [4, 0],
    [0, -4], [-4, -6], [4, -6], [-10, -2], [-14, -6], [-16, -10], [-20, -12],
    [-12, -12], [-20, -6], [10, -2], [14, -6], [16, -10], [20, -12],
    [12, -12], [20, -6], [-8, -14], [0, -14], [8, -14], [-16, -15], [16, -15],
  ];
  const navNodes = nodePos.map(([x, z]) => ({ x, z, links: [] }));
  for (let i = 0; i < navNodes.length; i += 1) {
    for (let j = i + 1; j < navNodes.length; j += 1) {
      const a = navNodes[i];
      const b = navNodes[j];
      const dist = Math.hypot(a.x - b.x, a.z - b.z);
      if (dist > 8.5) continue;
      let blocked = false;
      for (const box of colliders) {
        // skip the floor slab and low flat strips (they never block walking)
        if (box.max.y < 0.3) continue;
        if (segmentHitsBox(a.x, a.z, b.x, b.z, box, 0.5)) { blocked = true; break; }
      }
      if (!blocked) {
        a.links.push(j);
        b.links.push(i);
      }
    }
  }

  const sites = {
    A: { name: 'DEPOT', x: -20, z: -12, r: 4.5, color: PALETTE.siteA },
    B: { name: 'SILO', x: 20, z: -12, r: 4.5, color: PALETTE.siteB },
  };

  // Analytic ray vs AABB list (slab test) — the same list feeds movement,
  // bullets and bot vision. Returns { t, point, normal } or null.
  function raycastWalls(origin, dir, maxDist) {
    let best = null;
    for (const box of colliders) {
      let t0 = 0;
      let t1 = maxDist;
      let axis = -1;
      let sign = 0;
      const o = [origin.x, origin.y, origin.z];
      const d = [dir.x, dir.y, dir.z];
      const mn = [box.min.x, box.min.y, box.min.z];
      const mx = [box.max.x, box.max.y, box.max.z];
      let ok = true;
      for (let a = 0; a < 3; a += 1) {
        if (Math.abs(d[a]) < 1e-9) {
          if (o[a] < mn[a] || o[a] > mx[a]) { ok = false; break; }
        } else {
          let ta = (mn[a] - o[a]) / d[a];
          let tb = (mx[a] - o[a]) / d[a];
          let s = -1;
          if (ta > tb) { const t = ta; ta = tb; tb = t; s = 1; }
          if (ta > t0) { t0 = ta; axis = a; sign = s; }
          t1 = Math.min(t1, tb);
          if (t0 > t1) { ok = false; break; }
        }
      }
      if (ok && t0 >= 0 && (!best || t0 < best.t)) {
        const normal = new THREE.Vector3();
        if (axis === 0) normal.set(sign, 0, 0);
        else if (axis === 1) normal.set(0, sign, 0);
        else if (axis === 2) normal.set(0, 0, sign);
        best = {
          t: t0,
          point: new THREE.Vector3(origin.x + dir.x * t0, origin.y + dir.y * t0, origin.z + dir.z * t0),
          normal,
        };
      }
    }
    return best;
  }

  return {
    colliders, shootables, navNodes, sites, group, ringA, ringB,
    spawns: {
      player: { x: 0, z: 15, yaw: 0 },
      bots: [{ x: -8, z: -15 }, { x: 0, z: -15 }, { x: 8, z: -15 }, { x: -16, z: -14 }, { x: 16, z: -14 }],
    },
    raycastWalls,
    pointInSite(x, z, site) {
      return Math.hypot(x - site.x, z - site.z) <= site.r;
    },
  };
}
