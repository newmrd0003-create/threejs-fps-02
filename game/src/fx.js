// Fixed-budget VFX: tracers, sparks, decals, shells, muzzle light, explosions.
// Every pool is pre-allocated at boot; a shot never allocates. All pools fit
// in ~6 draw calls (tracers share one geometry/material family, sparks are
// one Points cloud, shells + debris are InstancedMeshes).
import * as THREE from 'three';
import { CONFIG } from './config.js';

const F = CONFIG.fx;

export function createFx(scene) {
  // --- tracers: 48 stretched additive boxes, ring buffer ---
  const tracerGeo = new THREE.BoxGeometry(0.02, 0.02, 1);
  const tracerMat = new THREE.MeshBasicMaterial({
    color: 0xffffff, transparent: true, opacity: 0.9,
    blending: THREE.AdditiveBlending, depthWrite: false,
  });
  const tracers = [];
  for (let i = 0; i < F.tracers; i += 1) {
    const mesh = new THREE.Mesh(tracerGeo, tracerMat.clone());
    mesh.visible = false;
    scene.add(mesh);
    tracers.push({ mesh, life: 0, max: 0.08 });
  }
  let tracerIdx = 0;

  // --- sparks: one Points cloud, 240 slots, struct-of-arrays velocities ---
  const sparkGeo = new THREE.BufferGeometry();
  const sparkPos = new Float32Array(F.sparks * 3);
  const sparkCol = new Float32Array(F.sparks * 3);
  const sparkVel = new Float32Array(F.sparks * 3);
  const sparkLife = new Float32Array(F.sparks);
  sparkGeo.setAttribute('position', new THREE.BufferAttribute(sparkPos, 3));
  sparkGeo.setAttribute('color', new THREE.BufferAttribute(sparkCol, 3));
  const sparkMat = new THREE.PointsMaterial({
    size: 0.07, vertexColors: true, transparent: true, opacity: 0.95,
    blending: THREE.AdditiveBlending, depthWrite: false, sizeAttenuation: true,
  });
  const sparks = new THREE.Points(sparkGeo, sparkMat);
  sparks.frustumCulled = false;
  scene.add(sparks);
  let sparkIdx = 0;

  // --- decals: 160 bullet-hole quads, recycled oldest-first ---
  const decalCanvas = document.createElement('canvas');
  decalCanvas.width = 64;
  decalCanvas.height = 64;
  const dctx = decalCanvas.getContext('2d');
  const grad = dctx.createRadialGradient(32, 32, 2, 32, 32, 30);
  grad.addColorStop(0, 'rgba(8,6,4,0.95)');
  grad.addColorStop(0.5, 'rgba(20,14,8,0.6)');
  grad.addColorStop(1, 'rgba(20,14,8,0)');
  dctx.fillStyle = grad;
  dctx.fillRect(0, 0, 64, 64);
  const decalTex = new THREE.CanvasTexture(decalCanvas);
  const decalGeo = new THREE.PlaneGeometry(0.16, 0.16);
  const decalMat = new THREE.MeshBasicMaterial({
    map: decalTex, transparent: true, depthWrite: false,
    polygonOffset: true, polygonOffsetFactor: -2,
  });
  const decals = [];
  for (let i = 0; i < F.decals; i += 1) {
    const mesh = new THREE.Mesh(decalGeo, decalMat);
    mesh.visible = false;
    scene.add(mesh);
    decals.push(mesh);
  }
  let decalIdx = 0;

  // --- shells: 60 instanced brass cases ---
  const shellGeo = new THREE.BoxGeometry(0.02, 0.02, 0.05);
  const shellMat = new THREE.MeshStandardMaterial({ color: 0xc8a848, roughness: 0.35, metalness: 0.8 });
  const shells = new THREE.InstancedMesh(shellGeo, shellMat, F.shells);
  shells.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  shells.count = F.shells;
  scene.add(shells);
  const shellState = [];
  for (let i = 0; i < F.shells; i += 1) {
    shellState.push({ alive: false, pos: new THREE.Vector3(), vel: new THREE.Vector3(), life: 0 });
    shells.setMatrixAt(i, new THREE.Matrix4().makeScale(0, 0, 0));
  }
  let shellIdx = 0;
  const dummy = new THREE.Object3D();

  // --- muzzle: one shared light + one flash quad ---
  const muzzleLight = new THREE.PointLight(0xffc266, 0, 9, 2);
  scene.add(muzzleLight);
  let muzzleLife = 0;

  // --- explosion: expanding additive sphere + light + debris ---
  const boomGeo = new THREE.SphereGeometry(1, 16, 12);
  const boomMat = new THREE.MeshBasicMaterial({
    color: 0xff9a2a, transparent: true, opacity: 0,
    blending: THREE.AdditiveBlending, depthWrite: false,
  });
  const boom = new THREE.Mesh(boomGeo, boomMat);
  boom.visible = false;
  scene.add(boom);
  const boomLight = new THREE.PointLight(0xff7a1a, 0, 18, 2);
  scene.add(boomLight);
  let boomLife = 0;
  const debris = new THREE.InstancedMesh(
    new THREE.BoxGeometry(0.12, 0.12, 0.12),
    new THREE.MeshStandardMaterial({ color: 0x4a4034, roughness: 0.9 }),
    F.debris,
  );
  debris.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  debris.count = F.debris;
  scene.add(debris);
  const debrisState = [];
  for (let i = 0; i < F.debris; i += 1) {
    debrisState.push({ alive: false, pos: new THREE.Vector3(), vel: new THREE.Vector3(), life: 0, rot: 0 });
    debris.setMatrixAt(i, new THREE.Matrix4().makeScale(0, 0, 0));
  }
  let debrisIdx = 0;

  const tmpV = new THREE.Vector3();
  const tmpV2 = new THREE.Vector3();

  function tracer(from, to, color = 0xf0a830) {
    const t = tracers[tracerIdx];
    tracerIdx = (tracerIdx + 1) % tracers.length;
    const len = tmpV.copy(to).sub(from).length();
    if (len < 0.1) return;
    t.mesh.visible = true;
    t.mesh.material.color.setHex(color);
    t.mesh.material.opacity = 0.9;
    t.mesh.position.copy(from).add(to).multiplyScalar(0.5);
    t.mesh.lookAt(to);
    t.mesh.scale.set(1, 1, len);
    t.life = t.max;
  }

  function burst(point, normal, count, colorHex, speed = 4) {
    const r = (colorHex >> 16 & 255) / 255;
    const g = (colorHex >> 8 & 255) / 255;
    const b = (colorHex & 255) / 255;
    for (let n = 0; n < count; n += 1) {
      const i = sparkIdx;
      sparkIdx = (sparkIdx + 1) % F.sparks;
      sparkPos[i * 3] = point.x;
      sparkPos[i * 3 + 1] = point.y;
      sparkPos[i * 3 + 2] = point.z;
      tmpV2.set(Math.random() * 2 - 1, Math.random() * 2 - 1, Math.random() * 2 - 1).normalize();
      tmpV2.addScaledVector(normal, 0.8).normalize().multiplyScalar(speed * (0.4 + Math.random() * 0.8));
      sparkVel[i * 3] = tmpV2.x;
      sparkVel[i * 3 + 1] = tmpV2.y;
      sparkVel[i * 3 + 2] = tmpV2.z;
      sparkCol[i * 3] = r;
      sparkCol[i * 3 + 1] = g;
      sparkCol[i * 3 + 2] = b;
      sparkLife[i] = 0.35 + Math.random() * 0.25;
    }
    sparkGeo.attributes.position.needsUpdate = true;
    sparkGeo.attributes.color.needsUpdate = true;
  }

  function impact(point, normal) {
    burst(point, normal, 8, 0xffc266, 4);
    const d = decals[decalIdx];
    decalIdx = (decalIdx + 1) % decals.length;
    d.visible = true;
    d.position.copy(point).addScaledVector(normal, 0.012);
    d.lookAt(tmpV.copy(point).add(normal));
    d.rotateZ(Math.random() * Math.PI);
  }

  function muzzle(pos) {
    muzzleLight.position.copy(pos);
    muzzleLight.intensity = 3.5;
    muzzleLife = 0.045;
  }

  function shell(pos, rightDir) {
    const s = shellState[shellIdx];
    shellIdx = (shellIdx + 1) % shellState.length;
    s.alive = true;
    s.pos.copy(pos);
    s.vel.copy(rightDir).multiplyScalar(1.6);
    s.vel.y += 2.2;
    s.vel.x += (Math.random() - 0.5) * 0.6;
    s.vel.z += (Math.random() - 0.5) * 0.6;
    s.life = 1.6;
  }

  function explosion(pos) {
    boom.visible = true;
    boom.position.copy(pos);
    boom.scale.setScalar(0.5);
    boomMat.opacity = 0.9;
    boomLife = 0.45;
    boomLight.position.copy(pos);
    boomLight.intensity = 12;
    burst(pos, new THREE.Vector3(0, 1, 0), 40, 0xff7a1a, 8);
    for (let n = 0; n < 10; n += 1) {
      const d = debrisState[debrisIdx];
      debrisIdx = (debrisIdx + 1) % debrisState.length;
      d.alive = true;
      d.pos.copy(pos);
      d.vel.set(Math.random() * 2 - 1, Math.random() * 1.4 + 0.4, Math.random() * 2 - 1)
        .normalize().multiplyScalar(3 + Math.random() * 5);
      d.life = 0.9;
      d.rot = Math.random() * Math.PI;
    }
  }

  function step(dt) {
    for (const t of tracers) {
      if (t.life <= 0) continue;
      t.life -= dt;
      if (t.life <= 0) t.mesh.visible = false;
      else t.mesh.material.opacity = 0.9 * (t.life / t.max);
    }
    let sparkDirty = false;
    for (let i = 0; i < F.sparks; i += 1) {
      if (sparkLife[i] <= 0) continue;
      sparkDirty = true;
      sparkLife[i] -= dt;
      sparkVel[i * 3 + 1] -= 9 * dt;
      sparkPos[i * 3] += sparkVel[i * 3] * dt;
      sparkPos[i * 3 + 1] += sparkVel[i * 3 + 1] * dt;
      sparkPos[i * 3 + 2] += sparkVel[i * 3 + 2] * dt;
      if (sparkPos[i * 3 + 1] < 0.02) { sparkPos[i * 3 + 1] = 0.02; sparkVel[i * 3 + 1] *= -0.4; }
      const f = Math.max(0, sparkLife[i] / 0.6);
      sparkCol[i * 3] *= 0.92 + f * 0.06;
      sparkCol[i * 3 + 1] *= 0.92 + f * 0.06;
      sparkCol[i * 3 + 2] *= 0.92 + f * 0.06;
      if (sparkLife[i] <= 0) { sparkCol[i * 3] = 0; sparkCol[i * 3 + 1] = 0; sparkCol[i * 3 + 2] = 0; }
    }
    if (sparkDirty) {
      sparkGeo.attributes.position.needsUpdate = true;
      sparkGeo.attributes.color.needsUpdate = true;
    }
    for (let i = 0; i < shellState.length; i += 1) {
      const s = shellState[i];
      if (!s.alive) continue;
      s.life -= dt;
      if (s.life <= 0) {
        s.alive = false;
        dummy.position.set(0, -10, 0);
        dummy.scale.setScalar(0);
        dummy.updateMatrix();
        shells.setMatrixAt(i, dummy.matrix);
        continue;
      }
      s.vel.y -= 12 * dt;
      s.pos.addScaledVector(s.vel, dt);
      if (s.pos.y < 0.02) { s.pos.y = 0.02; s.vel.y *= -0.35; s.vel.x *= 0.7; s.vel.z *= 0.7; }
      dummy.position.copy(s.pos);
      dummy.rotation.set(s.life * 9, s.life * 7, 0);
      dummy.scale.setScalar(1);
      dummy.updateMatrix();
      shells.setMatrixAt(i, dummy.matrix);
    }
    shells.instanceMatrix.needsUpdate = true;
    if (muzzleLife > 0) {
      muzzleLife -= dt;
      muzzleLight.intensity = Math.max(0, muzzleLife / 0.045) * 3.5;
      if (muzzleLife <= 0) muzzleLight.intensity = 0;
    }
    if (boomLife > 0) {
      boomLife -= dt;
      const f = Math.max(0, boomLife / 0.45);
      boom.scale.setScalar(0.5 + (1 - f) * 5.5);
      boomMat.opacity = 0.9 * f;
      boomLight.intensity = 12 * f;
      if (boomLife <= 0) { boom.visible = false; boomLight.intensity = 0; }
    }
    for (let i = 0; i < debrisState.length; i += 1) {
      const d = debrisState[i];
      if (!d.alive) continue;
      d.life -= dt;
      if (d.life <= 0) {
        d.alive = false;
        dummy.position.set(0, -10, 0);
        dummy.scale.setScalar(0);
        dummy.updateMatrix();
        debris.setMatrixAt(i, dummy.matrix);
        continue;
      }
      d.vel.y -= 14 * dt;
      d.pos.addScaledVector(d.vel, dt);
      if (d.pos.y < 0.06) { d.pos.y = 0.06; d.vel.y *= -0.4; }
      dummy.position.copy(d.pos);
      dummy.rotation.set(d.rot + d.life * 6, d.rot, 0);
      dummy.scale.setScalar(1);
      dummy.updateMatrix();
      debris.setMatrixAt(i, dummy.matrix);
    }
    debris.instanceMatrix.needsUpdate = true;
  }

  return { tracer, burst, impact, muzzle, shell, explosion, step };
}
