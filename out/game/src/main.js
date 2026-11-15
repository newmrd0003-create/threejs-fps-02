// DUSTLINE — boot and the one loop: a fixed 60 Hz simulation feeding a
// render at the display's rate. ?shot=start|play|tactics|economy&seed=N sets
// up a deterministic frame for a capture, renders it twice, then freezes it
// and sets window.__shotReady. ?selftest=1 plays a scripted 40 s combat and
// reports the result as window.__selftest / console SELFTEST.
import * as THREE from 'three';
import { CONFIG } from './config.js';
import { PALETTE } from './palette.js';
import { makeRng } from './rng.js';
import { ABOUT } from './about.js';
import { createWorld } from './world.js';
import { createPlayer } from './player.js';
import { createInput } from './input.js';
import { createWeapons } from './weapons.js';
import { createFx } from './fx.js';
import { createEnemies } from './enemies.js';
import { createRounds } from './rounds.js';
import { createAudio } from './audio.js';
import { createHud } from './hud.js';

const FIXED_STEP = 1 / 60;
const params = new URLSearchParams(window.location.search);
const shot = params.get('shot');
const selftest = params.get('selftest') === '1';
const seed = Number.parseInt(params.get('seed') ?? String(CONFIG.seed), 10) || CONFIG.seed;
const rng = makeRng(seed);
void ABOUT;

const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, CONFIG.perf.pixelRatioCap));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFShadowMap; // PCFSoft removed in three 0.187
document.getElementById('game').appendChild(renderer.domElement);

const scene = new THREE.Scene();
scene.background = new THREE.Color(PALETTE.canvas);
scene.fog = new THREE.Fog(new THREE.Color(PALETTE.canvas), CONFIG.perf.fogNear, CONFIG.perf.fogFar);
const camera = new THREE.PerspectiveCamera(CONFIG.baseFov, window.innerWidth / window.innerHeight, 0.05, 200);
scene.add(camera);

const world = createWorld(scene);
const fx = createFx(scene);
const audio = createAudio();
const hud = createHud();
const player = createPlayer(world.colliders);
const input = createInput(renderer.domElement, onLockChange);
const weapons = createWeapons(camera, scene, fx, audio, rng, world.colliders);
const enemies = createEnemies(scene, world, rng, player.resolveCircle);
const rounds = createRounds();

const body = player.state;
let hp = CONFIG.player.health;
let armor = 0;
let armorBought = false;
let playerAlive = true;
let trauma = 0;
let kills = 0;
let shotsFired = 0;
let shotsHit = 0;
let frozen = false;
let started = false;
let accumulator = 0;
let lastTime = performance.now();
let elapsed = 0;
let stepCount = 0;
let footstepAt = 0;
let defusedFlag = false;
let buyOpen = false;
let nowSec = 0;

const dirV = new THREE.Vector3();
const tmpV = new THREE.Vector3();
const tmpV2 = new THREE.Vector3();
const tmpV3 = new THREE.Vector3();

hud.setAmmo(weapons.slot().mag, weapons.slot().reserve, false);
hud.setHealth(hp, armor);
hud.setCredits(rounds.state.credits);
hud.setScore(0, 0, 1);

function resetPlayerForRound() {
  const s = world.spawns.player;
  body.position.set(s.x, 0, s.z);
  body.velocity.set(0, 0, 0);
  body.yaw = s.yaw;
  body.pitch = 0;
  body.eye = CONFIG.player.standEye;
  hp = CONFIG.player.health;
  armor = armorBought ? CONFIG.player.armor : 0;
  playerAlive = true;
  trauma = 0;
  hud.setHealth(hp, armor);
}

function syncCamera() {
  camera.position.set(body.position.x, body.position.y + body.eye, body.position.z);
  camera.rotation.set(body.pitch, body.yaw, 0, 'YXZ');
  if (trauma > 0.001) {
    const s = trauma * trauma;
    camera.rotation.x += Math.sin(elapsed * 61.7) * 0.02 * s;
    camera.rotation.y += Math.sin(elapsed * 47.3) * 0.02 * s;
    camera.rotation.z += Math.sin(elapsed * 55.1) * 0.015 * s;
  }
  const targetFov = CONFIG.baseFov - (CONFIG.baseFov - CONFIG.adsFov) * weapons.state.adsAmount;
  if (Math.abs(camera.fov - targetFov) > 0.01) {
    camera.fov = targetFov;
    camera.updateProjectionMatrix();
  }
}

function damagePlayer(dmg, fromPos) {
  if (!playerAlive) return;
  const absorbed = Math.min(armor, dmg * 0.5);
  armor -= absorbed;
  hp -= (dmg - absorbed);
  trauma = Math.min(1, trauma + 0.35);
  hud.setHealth(hp, armor);
  hud.damageFlash();
  audio.hurt();
  if (hp <= 0) {
    hp = 0;
    playerAlive = false;
    hud.setHealth(0, armor);
  }
}

function damageBot(bot, dmg, part, point) {
  const killed = enemies.damage(bot, dmg, part);
  if (killed) {
    kills += 1;
    rounds.awardKill();
    hud.setCredits(rounds.state.credits);
    hud.killfeed(`You ▸ ${bot.mesh.name}`, true);
    hud.setEnemiesLeft(enemies.aliveCount());
    audio.hit(true, part === 'head');
    fx.burst(point, tmpV.set(0, 1, 0), 18, 0xc94f3d, 5);
  } else {
    audio.hit(false, part === 'head');
  }
  return killed;
}

function tryShoot(now) {
  const moving = player.groundSpeed() > 0.5;
  const spread = weapons.currentSpread(moving, !body.onGround, body.crouching, input.state.ads);
  camera.getWorldDirection(dirV);
  const shotRes = weapons.fire(now, camera.position, dirV, spread);
  if (!shotRes) return;
  shotsFired += 1;
  // Recoil: the pitch spring moves the viewmodel; the player pitch kick is the felt recoil.
  player.recoil(shotRes.def.kick * (0.9 + rng.next() * 0.2), (rng.next() * 2 - 1) * 0.002);
  trauma = Math.min(1, trauma + 0.08);
  weapons.muzzleWorld(tmpV);
  const muzzle = tmpV.clone();
  const wall = world.raycastWalls(shotRes.origin, shotRes.direction, 120);
  const botHit = enemies.rayHit(shotRes.origin, shotRes.direction, wall ? wall.t : 120);
  const right = tmpV2.set(Math.cos(body.yaw), 0, -Math.sin(body.yaw));
  fx.shell(muzzle, right);
  if (botHit && (!wall || botHit.t < wall.t)) {
    shotsHit += 1;
    const dmg = Math.round(shotRes.def.dmg * botHit.mul);
    fx.tracer(muzzle, botHit.point, shotRes.def.tracer);
    fx.burst(botHit.point, tmpV3.set(0, 1, 0), 10, 0xc94f3d, 4);
    hud.hitmarker(false, botHit.part === 'head', dmg);
    damageBot(botHit.bot, dmg, botHit.part, botHit.point);
    if (botHit.bot.hp <= 0) hud.hitmarker(true, botHit.part === 'head', dmg);
  } else if (wall) {
    fx.tracer(muzzle, wall.point, shotRes.def.tracer);
    fx.impact(wall.point, wall.normal);
  } else {
    fx.tracer(muzzle, tmpV3.copy(shotRes.origin).addScaledVector(shotRes.direction, 60), shotRes.def.tracer);
  }
  hud.setAmmo(weapons.slot().mag, weapons.slot().reserve, weapons.state.reloading);
}

function resolveBotShot(bot) {
  const muzzle = enemies.muzzleWorld(bot, tmpV);
  const aimErr = (bot.aimError * Math.PI) / 180;
  tmpV2.set(body.position.x, body.position.y + body.eye, body.position.z);
  tmpV3.copy(tmpV2).sub(muzzle);
  const dist = tmpV3.length();
  tmpV3.normalize();
  // Aim error cone, seeded so replays match.
  tmpV3.x += (rng.next() * 2 - 1) * aimErr;
  tmpV3.y += (rng.next() * 2 - 1) * aimErr;
  tmpV3.z += (rng.next() * 2 - 1) * aimErr;
  tmpV3.normalize();
  const wall = world.raycastWalls(muzzle, tmpV3, 80);
  fx.muzzle(muzzle);
  audio.enemyShot();
  if (!wall || wall.t > dist) {
    fx.tracer(muzzle, tmpV2, 0xff6a4a);
    damagePlayer(CONFIG.bots.shotDmg, bot.pos);
  } else {
    fx.tracer(muzzle, wall.point, 0xff6a4a);
    fx.impact(wall.point, wall.normal);
  }
}

function explodeGrenade(pos) {
  fx.explosion(pos);
  audio.explosion();
  trauma = Math.min(1, trauma + 0.5);
  const R = CONFIG.grenade;
  for (const bot of enemies.bots) {
    if (!bot.alive) continue;
    const d = Math.hypot(bot.pos.x - pos.x, bot.pos.z - pos.z, 1.0 - pos.y);
    if (d > R.radius) continue;
    const dmg = Math.round(R.dmgMax - ((R.dmgMax - R.dmgMin) * d) / R.radius);
    const killed = enemies.damage(bot, dmg, 'body');
    if (killed) {
      kills += 1;
      rounds.awardKill();
      hud.setCredits(rounds.state.credits);
      hud.killfeed(`FRAG-12 ▸ ${bot.mesh.name}`, true);
      hud.setEnemiesLeft(enemies.aliveCount());
    }
  }
  const pd = Math.hypot(body.position.x - pos.x, body.position.z - pos.z, (body.position.y + 1) - pos.y);
  if (pd < R.radius && playerAlive) {
    damagePlayer(Math.round(R.dmgMax - ((R.dmgMax - R.dmgMin) * pd) / R.radius) * 0.5, pos);
  }
}

function buyItems() {
  const credits = rounds.state.credits;
  const items = [];
  for (const key of ['rifle', 'smg', 'pistol']) {
    const d = CONFIG.weapons[key];
    const owned = weapons.state.slots[key].owned;
    items.push({
      id: key, name: d.name, price: d.price, owned,
      affordable: credits >= d.price,
      desc: `${d.dmg} dmg · ${d.rate}/s · ${d.mag}/${d.reserve} · reload ${d.reload}s`,
    });
  }
  items.push({
    id: 'grenade', name: 'FRAG-12 grenade', price: CONFIG.grenade.price,
    owned: weapons.state.grenadeCount >= CONFIG.grenade.maxCarry,
    affordable: credits >= CONFIG.grenade.price && weapons.state.grenadeCount < CONFIG.grenade.maxCarry,
    desc: `Fuse ${CONFIG.grenade.fuse}s · radius ${CONFIG.grenade.radius}m · ${weapons.state.grenadeCount}/${CONFIG.grenade.maxCarry} carried`,
  });
  items.push({
    id: 'armor', name: 'Vest + Helmet', price: CONFIG.armor.price,
    owned: armorBought, affordable: credits >= CONFIG.armor.price,
    desc: `+${CONFIG.armor.amount} armor, absorbs 50% of damage`,
  });
  return items;
}

function refreshBuy() {
  hud.showBuy(buyOpen, rounds.state.credits, buyItems());
}

function setBuyOpen(open) {
  if (open && rounds.state.phase !== 'freeze') return;
  buyOpen = open;
  refreshBuy();
  if (open && document.pointerLockElement) document.exitPointerLock();
}

function onBuy(id) {
  const price = weapons.priceOf(id);
  if (!rounds.buy(id, price)) return;
  if (id === 'armor') {
    armorBought = true;
    armor = CONFIG.player.armor;
    hud.setHealth(hp, armor);
  } else {
    weapons.buy(id);
    if (CONFIG.weapons[id]) weapons.select(id);
  }
  audio.buy();
  hud.setCredits(rounds.state.credits);
  hud.setWeapon(weapons.def().name, weapons.state.grenadeCount);
  hud.setAmmo(weapons.slot().mag, weapons.slot().reserve, false);
  refreshBuy();
}

hud.onBuy(onBuy);

hud.onPlay(() => {
  audio.unlock();
  if (shot || selftest) return;
  if (rounds.state.phase === 'matchEnd') {
    rounds.startMatch();
    resetPlayerForRound();
    enemies.spawnRound(1);
    weapons.refill();
    hud.setScore(0, 0, 1);
    hud.setCredits(rounds.state.credits);
    hud.setEnemiesLeft(enemies.aliveCount());
    setBuyOpen(true);
    return;
  }
  if (buyOpen) {
    setBuyOpen(false);
    input.requestLock();
    return;
  }
  input.requestLock();
});

function onLockChange(locked) {
  if (shot || selftest) return;
  if (locked) {
    started = true;
    hud.hideOverlay();
    if (buyOpen) setBuyOpen(false);
  } else if (rounds.state.phase !== 'matchEnd') {
    hud.showOverlay(started ? 'paused' : 'start', {
      round: rounds.state.round,
      score: `${rounds.state.score.you} — ${rounds.state.score.them}`,
    });
  }
}

function handleRoundEvents(events) {
  for (const e of events) {
    if (e === 'roundStart') {
      resetPlayerForRound();
      enemies.spawnRound(rounds.state.round);
      weapons.refill();
      hud.setScore(rounds.state.score.you, rounds.state.score.them, rounds.state.round);
      hud.setEnemiesLeft(enemies.aliveCount());
      hud.setCredits(rounds.state.credits);
      if (rounds.state.banner) hud.banner(rounds.state.banner.title, rounds.state.banner.sub, 3000);
      if (rounds.state.round === 1 && !shot && !selftest) setBuyOpen(true);
    } else if (e === 'roundLive') {
      hud.clearBanner();
      setBuyOpen(false);
    } else if (e === 'bombPlanted') {
      hud.banner('CHARGE PLANTED', `Defend site ${rounds.state.bomb.site} — 40 seconds`, 3000);
      audio.plantBeep();
    } else if (e === 'bombBeep') {
      audio.plantBeep();
    } else if (e === 'bombExploded') {
      const site = world.sites[rounds.state.bomb.site || 'A'];
      explodeGrenade(tmpV.set(site.x, 1, site.z));
    } else if (e === 'roundEnd') {
      const won = rounds.state.history[rounds.state.history.length - 1] === 'W';
      if (won) audio.roundWin(); else audio.roundLose();
      if (rounds.state.banner) hud.banner(rounds.state.banner.title, rounds.state.banner.sub, 3000);
      hud.setScore(rounds.state.score.you, rounds.state.score.them, rounds.state.round);
      hud.setCredits(rounds.state.credits);
    } else if (e === 'matchEnd') {
      const won = rounds.state.matchWinner === 'you';
      hud.showOverlay('end', {
        won,
        detail: won
          ? `You took the match ${rounds.state.score.you} — ${rounds.state.score.them} on YARD 7. ${kills} eliminations.`
          : `The Sentinels took the match ${rounds.state.score.them} — ${rounds.state.score.you}. ${kills} eliminations.`,
      });
      if (document.pointerLockElement) document.exitPointerLock();
    }
  }
}

function step(dt, now) {
  stepCount += 1;
  elapsed += dt;
  trauma = Math.max(0, trauma - dt * 1.6);

  // Edge-triggered keys.
  for (const code of input.takePressed()) {
    if (code === 'KeyB') setBuyOpen(!buyOpen);
    else if (code === 'Digit1') weapons.select('rifle');
    else if (code === 'Digit2') weapons.select('smg');
    else if (code === 'Digit3') weapons.select('pistol');
    else if (code === 'KeyG') {
      camera.getWorldDirection(dirV);
      if (weapons.throwGrenade(tmpV.copy(camera.position), dirV)) {
        hud.setWeapon(weapons.def().name, weapons.state.grenadeCount);
      }
    } else if (code === 'KeyR') {
      weapons.reload(now);
    } else if (buyOpen && code === 'Digit4') onBuy('grenade');
    else if (buyOpen && code === 'Digit5') onBuy('armor');
  }

  player.step(dt, input.state.keys);
  const moveSpeed = player.groundSpeed();
  if (moveSpeed > 3 && body.onGround && elapsed - footstepAt > 0.38) {
    footstepAt = elapsed;
    audio.footstep();
  }

  const grenadeEvents = weapons.step(dt, now, moveSpeed, !body.onGround, body.crouching, input.state.ads, input.takeLook());
  for (const ev of grenadeEvents) {
    if (ev.type === 'explosion') explodeGrenade(ev.pos);
  }

  const bomb = rounds.state.bomb;
  const livePhase = rounds.state.phase === 'live';
  if (livePhase && playerAlive) {
    const enemyEvents = [];
    enemies.step(dt, {
      pos: body.position, vel: body.velocity, alive: playerAlive,
    }, bomb.state === 'planted', bomb.site ? world.sites[bomb.site] : null, enemyEvents);
    for (const ev of enemyEvents) {
      if (ev.type === 'botShot') resolveBotShot(ev.bot);
      else if (ev.type === 'defuseTick') hud.setSiteHint('A Sentinel is defusing the charge!');
      else if (ev.type === 'defused') defusedFlag = true;
    }
  }

  // Planting: hold E inside a site while the bomb is idle.
  const site = rounds.plantingSite(body.position.x, body.position.z, world.sites);
  const planting = livePhase && playerAlive && input.state.keys.has('KeyE') && site !== null && bomb.state !== 'planted';
  if (livePhase && site && bomb.state === 'idle' && playerAlive) {
    hud.setSiteHint(`Site ${site} (${world.sites[site].name}) — hold E to plant the charge`);
  } else if (!(livePhase && bomb.state === 'planted')) {
    hud.setSiteHint(null);
  }

  const roundEvents = rounds.update(dt, {
    enemiesAlive: enemies.aliveCount(),
    playerAlive,
    planting,
    plantSite: site,
    defused: defusedFlag,
  });
  defusedFlag = false;
  handleRoundEvents(roundEvents);

  // HUD: bomb + timer + spread.
  if (bomb.state === 'planting') hud.setBomb('planting', bomb.progress / CONFIG.rounds.plantTime, 0);
  else if (bomb.state === 'planted') hud.setBomb('planted', 0, bomb.timer);
  else hud.setBomb('idle', 0, 0);
  const timerVal = bomb.state === 'planted' ? bomb.timer : rounds.state.timer;
  hud.setTimer(timerVal, bomb.state === 'planted');
  const spreadPx = weapons.currentSpread(moveSpeed > 0.5, !body.onGround, body.crouching, input.state.ads) * 900;
  hud.setCrosshairSpread(Math.min(26, spreadPx));
  hud.setAmmo(weapons.slot().mag, weapons.slot().reserve, weapons.state.reloading);

  // Bomb site rings pulse while a plant is possible.
  const pulse = 0.3 + Math.sin(elapsed * 3) * 0.12;
  world.ringA.material.opacity = bomb.state === 'planted' && bomb.site === 'A' ? 0.8 : pulse;
  world.ringB.material.opacity = bomb.state === 'planted' && bomb.site === 'B' ? 0.8 : pulse;

  fx.step(dt);
  input.watchdog();
}

function frame(nowMs) {
  requestAnimationFrame(frame);
  const now = nowMs / 1000;
  nowSec = now;
  const dt = Math.min((nowMs - lastTime) / 1000, 0.1);
  lastTime = nowMs;
  if (!frozen) {
    const look = input.takeLook();
    player.look(look.x, look.y);
    if (input.state.firing && (shot || selftest || input.state.locked)) tryShoot(now);
    accumulator += dt;
    let steps = 0;
    while (accumulator >= FIXED_STEP && steps < 5) {
      step(FIXED_STEP, now);
      accumulator -= FIXED_STEP;
      steps += 1;
    }
    if (accumulator > FIXED_STEP * 5) accumulator = 0;
    syncCamera();
  }
  renderer.render(scene, camera);
}

function aimAt(point) {
  const dx = point.x - body.position.x;
  const dy = point.y - (body.position.y + body.eye);
  const dz = point.z - body.position.z;
  const len = Math.hypot(dx, dy, dz) || 1;
  body.yaw = Math.atan2(-dx, -dz);
  body.pitch = Math.asin(Math.max(-1, Math.min(1, dy / len)));
  syncCamera();
}

function settle(steps) {
  for (let i = 0; i < steps; i += 1) step(FIXED_STEP, nowSec);
}

function paintTwiceThenReady() {
  let painted = 0;
  function paint() {
    requestAnimationFrame(paint);
    syncCamera();
    renderer.render(scene, camera);
    painted += 1;
    if (painted === 2) {
      window.__shotReady = true;
      frozen = true;
    }
  }
  requestAnimationFrame(paint);
}

function runShot(name) {
  hud.hideOverlay();
  setBuyOpen(false);
  rounds.startMatch();
  resetPlayerForRound();
  enemies.spawnRound(1);
  // Skip the freeze: go live immediately for the capture.
  rounds.state.phase = 'live';
  rounds.state.timer = CONFIG.rounds.roundTime;
  hud.setScore(0, 0, 1);
  hud.setEnemiesLeft(enemies.aliveCount());
  hud.setCredits(rounds.state.credits);
  body.pitch = 0;
  body.yaw = 0;
  if (name === 'start') {
    // Hero: spawn view down mid lane, Sentinels holding mid, banner up.
    body.position.set(0, 0, 14);
    settle(30);
    aimAt(tmpV.set(0, 1.4, -12));
    hud.banner('ROUND 1 — YARD 7', 'Eliminate the Sentinels or plant the charge', 10000);
  } else if (name === 'play') {
    // Combat: mid-lane firefight, one Sentinel down, tracer in flight.
    body.position.set(-1.5, 0, 7);
    settle(30);
    const bot = enemies.bots[1];
    aimAt(tmpV.set(bot.pos.x, 1.2, bot.pos.z));
    for (let r = 0; r < 3; r += 1) {
      tryShoot(nowSec);
      settle(6);
    }
    // A second Sentinel fires back at the player: tracer + impact.
    const bot2 = enemies.bots[3];
    bot2.pos.set(4.5, 0, -2);
    bot2.mesh.group.position.set(4.5, 0, -2);
    resolveBotShot(bot2);
    settle(4);
    aimAt(tmpV.set(bot2.pos.x, 1.3, bot2.pos.z));
    tryShoot(nowSec);
    settle(2);
  } else if (name === 'tactics') {
    // Bomb plant at site A: progress ring, two Sentinels closing in.
    body.position.set(-15.5, 0, -8.5);
    settle(20);
    aimAt(tmpV.set(-20, 1.2, -12));
    rounds.state.bomb.state = 'planting';
    rounds.state.bomb.site = 'A';
    rounds.state.bomb.progress = 1.65;
    hud.setBomb('planting', 0.55, 0);
    const b0 = enemies.bots[0];
    const b1 = enemies.bots[2];
    b0.pos.set(-12, 0, -12);
    b0.mesh.group.position.set(-12, 0, -12);
    b0.yaw = Math.PI / 2;
    b0.mesh.group.rotation.y = b0.yaw;
    b1.pos.set(-20, 0, -4);
    b1.mesh.group.position.set(-20, 0, -4);
    b1.yaw = Math.PI;
    b1.mesh.group.rotation.y = b1.yaw;
    settle(6);
  } else if (name === 'economy') {
    // Buy menu: round 2, $3,250, score 1-0, freeze phase.
    rounds.state.phase = 'freeze';
    rounds.state.round = 2;
    rounds.state.score = { you: 1, them: 0 };
    rounds.state.credits = 3250;
    rounds.state.history = ['W'];
    hud.setScore(1, 0, 2);
    hud.setCredits(3250);
    hud.banner('ROUND 2', 'Buy up — B opens the shop', 10000);
    setBuyOpen(true);
    body.position.set(0, 0, 14);
    settle(10);
    aimAt(tmpV.set(0, 1.4, -12));
  }
  hud.setAmmo(weapons.slot().mag, weapons.slot().reserve, weapons.state.reloading);
  paintTwiceThenReady();
}

function runSelftest() {
  const log = [];
  rounds.startMatch();
  resetPlayerForRound();
  enemies.spawnRound(1);
  rounds.state.phase = 'live';
  rounds.state.timer = CONFIG.rounds.roundTime;
  let simNow = 0;
  const t0 = Date.now();
  // Scripted player: aim at the nearest alive bot's head, fire, strafe.
  let simSeconds = 0;
  let stuck = 0;
  while (simSeconds < 40 && enemies.aliveCount() > 0 && playerAlive && rounds.state.phase === 'live') {
    let nearest = null;
    let nearestD = Infinity;
    for (const bot of enemies.bots) {
      if (!bot.alive) continue;
      const d = Math.hypot(bot.pos.x - body.position.x, bot.pos.z - body.position.z);
      if (d < nearestD) { nearestD = d; nearest = bot; }
    }
    if (nearest) {
      aimAt(tmpV.set(nearest.pos.x, 1.5, nearest.pos.z));
      if (weapons.ready(simNow)) tryShoot(simNow);
      if (weapons.slot().mag === 0) weapons.reload(simNow);
    }
    // Strafe: alternate A/D every second so bots must track a moving target.
    input.state.keys.clear();
    input.state.keys.add(Math.floor(simSeconds) % 2 === 0 ? 'KeyA' : 'KeyD');
    if (Math.floor(simSeconds) % 3 === 0) input.state.keys.add('KeyW');
    step(FIXED_STEP, simNow);
    simNow += FIXED_STEP;
    simSeconds += FIXED_STEP;
    stuck += 1;
    if (stuck > 60 * 45) break;
  }
  const result = {
    ok: true,
    seconds: Math.round(simSeconds * 100) / 100,
    botsAlive: enemies.aliveCount(),
    kills,
    shotsFired,
    shotsHit,
    accuracy: shotsFired ? Math.round((shotsHit / shotsFired) * 1000) / 10 : 0,
    playerHp: Math.round(hp),
    playerAlive,
    roundPhase: rounds.state.phase,
    score: rounds.state.score,
    steps: stepCount,
    wallMs: Date.now() - t0,
    drawCalls: renderer.info.render.calls,
    triangles: renderer.info.render.triangles,
  };
  window.__selftest = result;
  console.log(`SELFTEST ${JSON.stringify(result)}`);
  log.push(result);
  syncCamera();
  paintTwiceThenReady();
}

window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});

window.__game = {
  get state() {
    return {
      phase: rounds.state.phase, round: rounds.state.round,
      score: rounds.state.score, credits: rounds.state.credits,
      hp, armor, playerAlive, kills, shotsFired, shotsHit,
      enemiesAlive: enemies.aliveCount(), steps: stepCount,
      drawCalls: renderer.info.render.calls, triangles: renderer.info.render.triangles,
    };
  },
};

syncCamera();
if (shot) runShot(shot);
else if (selftest) runSelftest();
else requestAnimationFrame(frame);
