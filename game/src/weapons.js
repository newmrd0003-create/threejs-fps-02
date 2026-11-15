// Weapons: three hitscan guns + a frag grenade, one viewmodel per gun,
// 3-spring recoil (kick / pitch / sway, 8 ms substeps), spread bloom that
// punishes firing on the move, reloads, ADS. Grenades are real projectiles
// with gravity, wall bounces and a timed fuse.
import * as THREE from 'three';
import { CONFIG } from './config.js';

const W = CONFIG.weapons;
const G = CONFIG.grenade;
const S = CONFIG.springs;

function makeSpring(def) {
  return { x: 0, v: 0, k: def.k, c: def.c };
}

function springStep(s, target, dt) {
  const n = Math.max(1, Math.ceil(dt / 0.008));
  const h = dt / n;
  for (let i = 0; i < n; i += 1) {
    s.v += ((target - s.x) * s.k - s.v * s.c) * h;
    s.x += s.v * h;
  }
}

function buildViewmodel(def, color) {
  const group = new THREE.Group();
  const dark = new THREE.MeshStandardMaterial({ color: 0x23211d, roughness: 0.5, metalness: 0.6 });
  const accent = new THREE.MeshStandardMaterial({ color, roughness: 0.45, metalness: 0.4 });
  const body = new THREE.Mesh(new THREE.BoxGeometry(0.09, 0.13, 0.52), dark);
  const barrel = new THREE.Mesh(new THREE.CylinderGeometry(0.022, 0.022, 0.3, 8), dark);
  barrel.rotation.x = Math.PI / 2;
  barrel.position.set(0, 0.02, -0.38);
  const mag = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.2, 0.1), accent);
  mag.position.set(0, -0.14, -0.02);
  mag.rotation.x = 0.25;
  const stock = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.11, 0.2), dark);
  stock.position.set(0, -0.01, 0.32);
  const sight = new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.06, 0.12), accent);
  sight.position.set(0, 0.09, -0.08);
  const grip = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.14, 0.07), dark);
  grip.position.set(0, -0.12, 0.18);
  grip.rotation.x = 0.4;
  group.add(body, barrel, mag, stock, sight, grip);
  const muzzle = new THREE.Object3D();
  muzzle.position.set(0, 0.02, -0.55);
  group.add(muzzle);
  group.position.set(0.22, -0.22, -0.45);
  return { group, muzzle };
}

export function createWeapons(camera, scene, fx, audio, rng, colliders) {
  const viewmodels = {
    rifle: buildViewmodel(W.rifle, 0xf0a830),
    smg: buildViewmodel(W.smg, 0x9fd8ff),
    pistol: buildViewmodel(W.pistol, 0xe9e6df),
  };
  for (const key of Object.keys(viewmodels)) {
    viewmodels[key].group.visible = key === 'rifle';
    camera.add(viewmodels[key].group);
  }

  const grenadeGeo = new THREE.SphereGeometry(0.07, 10, 8);
  const grenadeMat = new THREE.MeshStandardMaterial({ color: 0x2e4d2a, roughness: 0.6, metalness: 0.3 });
  const grenades = [];
  for (let i = 0; i < 4; i += 1) {
    const mesh = new THREE.Mesh(grenadeGeo, grenadeMat);
    mesh.visible = false;
    scene.add(mesh);
    grenades.push({ mesh, alive: false, pos: new THREE.Vector3(), vel: new THREE.Vector3(), fuse: 0 });
  }

  const state = {
    current: 'rifle',
    slots: {
      rifle: { mag: W.rifle.mag, reserve: W.rifle.reserve, owned: true },
      smg: { mag: W.smg.mag, reserve: W.smg.reserve, owned: false },
      pistol: { mag: W.pistol.mag, reserve: W.pistol.reserve, owned: true },
    },
    grenadeCount: 1,
    reloading: false,
    reloadEnd: 0,
    switchEnd: 0,
    nextShotAt: 0,
    bloom: 0,
    adsAmount: 0,
    bobPhase: 0,
    kick: makeSpring(S.kick),
    pitch: makeSpring(S.pitch),
    sway: makeSpring(S.sway),
  };

  const tmp = new THREE.Vector3();
  const tmp2 = new THREE.Vector3();

  function def() { return W[state.current]; }
  function slot() { return state.slots[state.current]; }

  function select(id) {
    if (!state.slots[id] || !state.slots[id].owned || id === state.current) return false;
    state.current = id;
    state.reloading = false;
    state.switchEnd = performance.now() / 1000 + 0.25;
    for (const key of Object.keys(viewmodels)) viewmodels[key].group.visible = key === id;
    audio.select();
    return true;
  }

  function buy(id) {
    if (id === 'grenade') {
      if (state.grenadeCount >= G.maxCarry) return false;
      state.grenadeCount += 1;
      return true;
    }
    if (id === 'armor') return true; // armor is a player stat, handled by rounds
    const slotDef = W[id];
    if (!slotDef || state.slots[id].owned) return false;
    state.slots[id].owned = true;
    state.slots[id].mag = slotDef.mag;
    state.slots[id].reserve = slotDef.reserve;
    return true;
  }

  function priceOf(id) {
    if (id === 'grenade') return G.price;
    if (id === 'armor') return CONFIG.armor.price;
    return W[id] ? W[id].price : 0;
  }

  function reload(now) {
    const s = slot();
    const d = def();
    if (state.reloading || s.mag === d.mag || s.reserve === 0) return false;
    state.reloading = true;
    state.reloadEnd = now + d.reload;
    audio.reload();
    return true;
  }

  function ready(now) {
    return !state.reloading && now >= state.nextShotAt && now >= state.switchEnd;
  }

  // Fires one round: consumes ammo, kicks the springs, flashes the muzzle.
  // Returns the shot's direction origin data for main.js to ray-test, or null.
  function fire(now, origin, direction, spread) {
    const s = slot();
    const d = def();
    if (!ready(now)) return null;
    if (s.mag <= 0) {
      audio.dry();
      state.nextShotAt = now + 0.25;
      return null;
    }
    s.mag -= 1;
    state.nextShotAt = now + 1 / d.rate;
    state.bloom = Math.min(2.2, state.bloom + d.bloomPerShot);
    state.kick.v -= S.kick.impulse;
    state.pitch.v += S.pitch.impulse * (0.9 + rng.next() * 0.2);
    state.sway.v += (rng.next() * 2 - 1) * 0.4;
    viewmodels[state.current].muzzle.getWorldPosition(tmp);
    fx.muzzle(tmp);
    audio.shot(d);
    const dir = direction.clone();
    dir.x += (rng.next() * 2 - 1) * spread;
    dir.y += (rng.next() * 2 - 1) * spread;
    dir.z += (rng.next() * 2 - 1) * spread;
    dir.normalize();
    return { origin: origin.clone(), direction: dir, def: d };
  }

  function currentSpread(moving, airborne, crouched, ads) {
    const d = def();
    let s = d.spreadBase + state.bloom * 0.12;
    if (moving) s *= CONFIG.spread.move;
    if (airborne) s *= CONFIG.spread.air;
    if (crouched) s *= CONFIG.spread.crouch;
    if (ads) s *= CONFIG.spread.ads;
    return s * 0.0174533; // degrees -> radians
  }

  function throwGrenade(origin, direction) {
    if (state.grenadeCount <= 0) return false;
    const g = grenades.find((item) => !item.alive);
    if (!g) return false;
    state.grenadeCount -= 1;
    g.alive = true;
    g.mesh.visible = true;
    g.pos.copy(origin);
    g.vel.copy(direction).multiplyScalar(G.throwSpeed);
    g.vel.y += 3.5;
    g.fuse = G.fuse;
    audio.throwGrenade();
    return true;
  }

  function collideGrenade(g, dt) {
    // Cheap sphere-vs-AABB bounce: reflect the velocity component of the
    // smallest-penetration axis, damp the rest.
    for (const box of colliders) {
      if (g.pos.x < box.min.x - 0.07 || g.pos.x > box.max.x + 0.07) continue;
      if (g.pos.y < box.min.y - 0.07 || g.pos.y > box.max.y + 0.07) continue;
      if (g.pos.z < box.min.z - 0.07 || g.pos.z > box.max.z + 0.07) continue;
      const dxl = g.pos.x - (box.min.x - 0.07);
      const dxr = (box.max.x + 0.07) - g.pos.x;
      const dyl = g.pos.y - (box.min.y - 0.07);
      const dyr = (box.max.y + 0.07) - g.pos.y;
      const dzl = g.pos.z - (box.min.z - 0.07);
      const dzr = (box.max.z + 0.07) - g.pos.z;
      const m = Math.min(dxl, dxr, dyl, dyr, dzl, dzr);
      if (m === dxl || m === dxr) { g.vel.x *= -0.45; g.pos.x += m === dxl ? -0.02 : 0.02; }
      else if (m === dyl || m === dyr) { g.vel.y *= -0.45; g.pos.y += m === dyl ? -0.02 : 0.02; }
      else { g.vel.z *= -0.45; g.pos.z += m === dzl ? -0.02 : 0.02; }
      g.vel.multiplyScalar(0.85);
      break;
    }
    void dt;
  }

  function step(dt, now, moveSpeed, airborne, crouched, ads, lookDelta) {
    const s = slot();
    const d = def();
    if (state.reloading && now >= state.reloadEnd) {
      const need = d.mag - s.mag;
      const take = Math.min(need, s.reserve);
      s.mag += take;
      s.reserve -= take;
      state.reloading = false;
    }
    state.bloom = Math.max(0, state.bloom - d.bloomRecover * dt);
    // Recoil springs, 8 ms substeps so a long frame never blows them up.
    springStep(state.kick, 0, dt);
    springStep(state.pitch, 0, dt);
    springStep(state.sway, lookDelta.x * -0.02, dt);
    // Walk bob is tied to actual movement speed, never to time.
    state.bobPhase += moveSpeed * dt * 1.6;
    const bobY = Math.sin(state.bobPhase * 2) * 0.008 * Math.min(1, moveSpeed / 4);
    const bobX = Math.cos(state.bobPhase) * 0.006 * Math.min(1, moveSpeed / 4);
    // ADS: gun recentres, FOV narrows (main reads adsAmount).
    const adsTarget = ads ? 1 : 0;
    state.adsAmount += (adsTarget - state.adsAmount) * Math.min(1, dt * 10);
    const vm = viewmodels[state.current].group;
    const adsX = 0.22 * (1 - state.adsAmount);
    const adsY = -0.22 + 0.055 * state.adsAmount;
    vm.position.set(
      adsX + bobX + state.sway.x * 0.02,
      adsY + bobY,
      -0.45 + state.kick.x * 0.06,
    );
    vm.rotation.x = state.pitch.x * 0.12;
    vm.rotation.z = state.sway.x * 0.05;
    // Grenades: gravity, bounce, fuse -> explosion event for main.js.
    const events = [];
    for (const g of grenades) {
      if (!g.alive) continue;
      g.vel.y -= 20 * dt;
      g.pos.addScaledVector(g.vel, dt);
      collideGrenade(g, dt);
      if (g.pos.y < 0.07) { g.pos.y = 0.07; g.vel.y *= -0.45; g.vel.x *= 0.8; g.vel.z *= 0.8; }
      g.mesh.position.copy(g.pos);
      g.mesh.rotation.x += dt * 7;
      g.mesh.rotation.z += dt * 5;
      g.fuse -= dt;
      if (g.fuse <= 0) {
        g.alive = false;
        g.mesh.visible = false;
        events.push({ type: 'explosion', pos: g.pos.clone() });
      }
    }
    return events;
  }

  function refill() {
    for (const key of Object.keys(state.slots)) {
      const s = state.slots[key];
      if (!s.owned) continue;
      s.mag = W[key].mag;
      s.reserve = W[key].reserve;
    }
    state.reloading = false;
  }

  function muzzleWorld(out) {
    viewmodels[state.current].muzzle.getWorldPosition(out || tmp2);
    return out || tmp2;
  }

  return {
    state, def, slot, select, buy, priceOf, reload, ready, fire,
    currentSpread, throwGrenade, step, refill, muzzleWorld,
  };
}
