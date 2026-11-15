// Sentinel bots: a 5-state machine (PATROL / CHASE / ATTACK / SEARCH / FLEE)
// plus DEFUSE when the bomb is planted. Navigation is BFS over the map's
// hand-placed node graph; steering is seek/arrive/pursue in ~60 lines.
// Vision is one analytic ray vs the AABB list per scan tick (0.25 s), never
// per frame. Difficulty is one aggression scalar that ramps with rounds won.
import * as THREE from 'three';
import { CONFIG } from './config.js';
import { PALETTE } from './palette.js';

const B = CONFIG.bots;

function bfsPath(nodes, from, to) {
  if (from === to) return [to];
  const prev = new Array(nodes.length).fill(-1);
  const queue = [from];
  prev[from] = from;
  while (queue.length > 0) {
    const cur = queue.shift();
    for (const next of nodes[cur].links) {
      if (prev[next] !== -1) continue;
      prev[next] = cur;
      if (next === to) {
        const path = [to];
        let node = to;
        while (node !== from) { node = prev[node]; path.unshift(node); }
        return path;
      }
      queue.push(next);
    }
  }
  return [];
}

function nearestNode(nodes, x, z) {
  let best = 0;
  let bestD = Infinity;
  for (let i = 0; i < nodes.length; i += 1) {
    const d = (nodes[i].x - x) ** 2 + (nodes[i].z - z) ** 2;
    if (d < bestD) { bestD = d; best = i; }
  }
  return best;
}

function buildBotMesh(scene, name) {
  const group = new THREE.Group();
  const bodyMat = new THREE.MeshStandardMaterial({ color: 0x3a3f45, roughness: 0.7, metalness: 0.25 });
  const trimMat = new THREE.MeshStandardMaterial({
    color: new THREE.Color(PALETTE.enemy), roughness: 0.5, metalness: 0.3,
    emissive: new THREE.Color(PALETTE.enemy), emissiveIntensity: 0.35,
  });
  const darkMat = new THREE.MeshStandardMaterial({ color: 0x1c1e22, roughness: 0.6, metalness: 0.4 });
  const body = new THREE.Mesh(new THREE.CapsuleGeometry(0.34, 0.62, 6, 12), bodyMat);
  body.position.y = 0.95;
  body.castShadow = true;
  const head = new THREE.Mesh(new THREE.SphereGeometry(0.22, 14, 10), darkMat);
  head.position.y = 1.56;
  head.castShadow = true;
  const visor = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.06, 0.05), trimMat);
  visor.position.set(0, 1.58, 0.19);
  const gun = new THREE.Mesh(new THREE.BoxGeometry(0.07, 0.1, 0.62), darkMat);
  gun.position.set(0.28, 1.15, -0.2);
  gun.castShadow = true;
  const chest = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.12, 0.06), trimMat);
  chest.position.set(0, 1.15, 0.32);
  const legL = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.55, 0.18), darkMat);
  legL.position.set(-0.14, 0.28, 0);
  const legR = legL.clone();
  legR.position.x = 0.14;
  group.add(body, head, visor, gun, chest, legL, legR);
  group.visible = false;
  scene.add(group);
  return { group, body, head, legL, legR, bodyMat, name };
}

export function createEnemies(scene, world, rng, resolveCircle) {
  const bots = [];
  for (let i = 0; i < B.maxAlive; i += 1) {
    const mesh = buildBotMesh(scene, `SENTINEL-${i + 1}`);
    bots.push({
      mesh,
      pos: new THREE.Vector3(),
      yaw: 0,
      hp: B.hp,
      maxHp: B.hp,
      alive: false,
      state: 'PATROL',
      stateTime: 0,
      node: 0,
      path: [],
      pathIdx: 0,
      lastKnown: new THREE.Vector3(),
      scanTimer: rng.next() * B.scanInterval,
      burstLeft: 0,
      burstTimer: 0,
      gapTimer: 0,
      strafeDir: 1,
      strafeTimer: 0,
      aggression: 0,
      aimError: 4,
      reaction: 0.9,
      speed: B.patrolSpeed,
      walkPhase: rng.next() * Math.PI * 2,
      flashTimer: 0,
      defuseProgress: 0,
      stuckTimer: 0,
      lastPos: new THREE.Vector3(),
    });
  }

  const tmp = new THREE.Vector3();
  const tmp2 = new THREE.Vector3();

  function spawnRound(roundNum) {
    const aggression = Math.min(1, roundNum * B.aggressionPerRound);
    let spawned = 0;
    for (const bot of bots) {
      const spawn = world.spawns.bots[spawned % world.spawns.bots.length];
      bot.pos.set(spawn.x, spawn.z, 0);
      bot.pos.y = 0;
      bot.yaw = Math.PI; // face south, toward the player spawn
      bot.maxHp = Math.round(80 + aggression * 40);
      bot.hp = bot.maxHp;
      bot.alive = true;
      bot.state = 'PATROL';
      bot.stateTime = 0;
      bot.node = nearestNode(world.navNodes, bot.pos.x, bot.pos.z);
      bot.path = [];
      bot.pathIdx = 0;
      bot.aggression = aggression;
      bot.aimError = 4 - aggression * 2.5;
      bot.reaction = 0.9 - aggression * 0.55;
      bot.defuseProgress = 0;
      bot.mesh.group.visible = true;
      bot.mesh.bodyMat.emissive.setHex(0x000000);
      spawned += 1;
    }
    return spawned;
  }

  function setState(bot, next) {
    bot.state = next;
    bot.stateTime = 0;
  }

  function pickPatrolTarget(bot) {
    // A node far from the player spawn (bots never camp the player's door).
    const candidates = [];
    for (let i = 0; i < world.navNodes.length; i += 1) {
      const n = world.navNodes[i];
      if (Math.hypot(n.x - 0, n.z - 15) < 8) continue;
      candidates.push(i);
    }
    const target = candidates[(rng.next() * candidates.length) | 0];
    bot.path = bfsPath(world.navNodes, bot.node, target);
    bot.pathIdx = 0;
  }

  function canSee(bot, playerInfo) {
    const eye = tmp.set(bot.pos.x, 1.5, bot.pos.z);
    const target = tmp2.set(playerInfo.pos.x, playerInfo.pos.y + 1.5, playerInfo.pos.z);
    const dir = tmp2.clone().sub(eye);
    const dist = dir.length();
    if (dist > 60) return false;
    dir.normalize();
    // Facing: bots see in a 110-degree cone.
    const fx = -Math.sin(bot.yaw);
    const fz = -Math.cos(bot.yaw);
    if (fx * dir.x + fz * dir.z < Math.cos(0.96)) return false;
    const wall = world.raycastWalls(eye, dir, dist);
    return wall === null;
  }

  function moveToward(bot, tx, tz, speed, dt) {
    const dx = tx - bot.pos.x;
    const dz = tz - bot.pos.z;
    const dist = Math.hypot(dx, dz);
    if (dist < 0.05) return true;
    const vx = (dx / dist) * speed;
    const vz = (dz / dist) * speed;
    bot.pos.x += vx * dt;
    bot.pos.z += vz * dt;
    resolveCircle(bot.pos, 0.4, 1.7);
    bot.yaw = Math.atan2(-vx, -vz);
    bot.walkPhase += dt * speed * 2.2;
    return dist < 0.4;
  }

  function followPath(bot, speed, dt) {
    if (bot.pathIdx >= bot.path.length) return true;
    const node = world.navNodes[bot.path[bot.pathIdx]];
    if (moveToward(bot, node.x, node.z, speed, dt)) bot.pathIdx += 1;
    bot.node = nearestNode(world.navNodes, bot.pos.x, bot.pos.z);
    return bot.pathIdx >= bot.path.length;
  }

  // Analytic ray vs bot hit shapes: body sphere (r 0.45 at y 0.95) and
  // head sphere (r 0.22 at y 1.56). Head hits deal 2x damage.
  function rayHit(origin, dir, maxDist) {
    let best = null;
    for (const bot of bots) {
      if (!bot.alive) continue;
      const shapes = [
        { part: 'body', c: tmp.set(bot.pos.x, 0.95, bot.pos.z), r: B.bodyRadius, mul: 1 },
        { part: 'head', c: tmp2.set(bot.pos.x, 1.56, bot.pos.z), r: B.headRadius, mul: 2 },
      ];
      for (const s of shapes) {
        const ox = origin.x - s.c.x;
        const oy = origin.y - s.c.y;
        const oz = origin.z - s.c.z;
        const b = ox * dir.x + oy * dir.y + oz * dir.z;
        const c = ox * ox + oy * oy + oz * oz - s.r * s.r;
        const disc = b * b - c;
        if (disc < 0) continue;
        const t = -b - Math.sqrt(disc);
        if (t < 0 || t > maxDist) continue;
        if (!best || t < best.t) {
          best = {
            bot, part: s.part, mul: s.mul, t,
            point: new THREE.Vector3(origin.x + dir.x * t, origin.y + dir.y * t, origin.z + dir.z * t),
          };
        }
      }
    }
    return best;
  }

  function damage(bot, dmg, part) {
    if (!bot.alive) return false;
    bot.hp -= dmg;
    bot.flashTimer = 0.12;
    bot.mesh.bodyMat.emissive.setHex(0xaa1100);
    bot.mesh.bodyMat.emissiveIntensity = 0.9;
    if (bot.hp <= 0) {
      bot.alive = false;
      bot.state = 'DEAD';
      bot.mesh.group.visible = false;
      return true;
    }
    // Being shot at snaps the bot to attention: it knows where you are.
    if (bot.state === 'PATROL' || bot.state === 'SEARCH') {
      bot.lastKnown.copy(bot.pos);
      setState(bot, 'CHASE');
    }
    return false;
  }

  function step(dt, playerInfo, bombPlanted, bombSite, events) {
    for (const bot of bots) {
      if (!bot.alive) continue;
      bot.stateTime += dt;
      bot.flashTimer -= dt;
      if (bot.flashTimer <= 0) {
        bot.mesh.bodyMat.emissive.setHex(0x000000);
        bot.mesh.bodyMat.emissiveIntensity = 0;
      }

      // --- vision scan, 4x a second, never per frame ---
      bot.scanTimer -= dt;
      let sees = false;
      if (bot.scanTimer <= 0) {
        bot.scanTimer = B.scanInterval;
        if (playerInfo.alive) sees = canSee(bot, playerInfo);
        if (sees) {
          bot.lastKnown.set(playerInfo.pos.x, playerInfo.pos.y, playerInfo.pos.z);
          if (bot.state === 'PATROL' || bot.state === 'SEARCH') {
            // Reaction time: the bot needs a beat before it engages.
            if (bot.stateTime > bot.reaction) setState(bot, 'CHASE');
          }
        }
      }

      // --- bomb planted: the nearest bot breaks off to defuse ---
      if (bombPlanted && bot.state !== 'DEFUSE') {
        const d = Math.hypot(bot.pos.x - bombSite.x, bot.pos.z - bombSite.z);
        let nearest = true;
        for (const other of bots) {
          if (other === bot || !other.alive || other.state === 'DEFUSE') continue;
          if (Math.hypot(other.pos.x - bombSite.x, other.pos.z - bombSite.z) < d) { nearest = false; break; }
        }
        if (nearest && bot.state !== 'FLEE') setState(bot, 'DEFUSE');
      }

      // --- state behaviours ---
      if (bot.state === 'PATROL') {
        if (bot.pathIdx >= bot.path.length) pickPatrolTarget(bot);
        followPath(bot, B.patrolSpeed, dt);
        if (sees && bot.stateTime > bot.reaction) setState(bot, 'CHASE');
      } else if (bot.state === 'CHASE') {
        // Pursuit: aim at where the player will be, not where they are.
        const lead = Math.min(0.6, Math.hypot(playerInfo.pos.x - bot.pos.x, playerInfo.pos.z - bot.pos.z) / 40);
        const tx = playerInfo.pos.x + playerInfo.vel.x * lead;
        const tz = playerInfo.pos.z + playerInfo.vel.z * lead;
        moveToward(bot, tx, tz, B.chaseSpeed * (1 + bot.aggression * 0.15), dt);
        const dist = Math.hypot(playerInfo.pos.x - bot.pos.x, playerInfo.pos.z - bot.pos.z);
        if (sees && dist < B.attackRange[1] && dist > 3) setState(bot, 'ATTACK');
        else if (!sees && bot.stateTime > B.loseSight) setState(bot, 'SEARCH');
      } else if (bot.state === 'ATTACK') {
        const dist = Math.hypot(playerInfo.pos.x - bot.pos.x, playerInfo.pos.z - bot.pos.z);
        // Arrive: hold 8-18 m, strafe sideways, flip direction on a timer.
        bot.strafeTimer -= dt;
        if (bot.strafeTimer <= 0) {
          bot.strafeDir *= -1;
          bot.strafeTimer = 1.5 + rng.next() * 1.0;
        }
        const dx = playerInfo.pos.x - bot.pos.x;
        const dz = playerInfo.pos.z - bot.pos.z;
        const len = Math.hypot(dx, dz) || 1;
        const px = (-dz / len) * bot.strafeDir;
        const pz = (dx / len) * bot.strafeDir;
        let tx = bot.pos.x + px * 3;
        let tz = bot.pos.z + pz * 3;
        if (dist > B.attackRange[1]) { tx = playerInfo.pos.x; tz = playerInfo.pos.z; }
        else if (dist < B.attackRange[0]) { tx = bot.pos.x - (dx / len) * 3; tz = bot.pos.z - (dz / len) * 3; }
        moveToward(bot, tx, tz, B.patrolSpeed * 0.9, dt);
        bot.yaw = Math.atan2(-dx, -dz);
        // Burst fire: 3-6 shots, 0.11 s apart, then a 0.9-1.4 s gap.
        bot.burstTimer -= dt;
        if (bot.burstLeft > 0 && bot.burstTimer <= 0 && sees) {
          bot.burstLeft -= 1;
          bot.burstTimer = 0.11;
          events.push({ type: 'botShot', bot });
        } else if (bot.burstLeft <= 0) {
          bot.gapTimer -= dt;
          if (bot.gapTimer <= 0) {
            bot.burstLeft = Math.round(3 + bot.aggression * 3 + rng.next() * 2);
            bot.gapTimer = B.burstGap[0] + rng.next() * (B.burstGap[1] - B.burstGap[0]);
          }
        }
        if (!sees && bot.stateTime > B.attackLoseSight) setState(bot, 'CHASE');
        if (bot.hp < bot.maxHp * 0.25 && bot.aggression < 0.4) setState(bot, 'FLEE');
      } else if (bot.state === 'SEARCH') {
        if (followPath(bot, B.chaseSpeed, dt) || bot.stateTime > B.searchTime) {
          if (bot.stateTime > 2) {
            // Look around at the last known spot, then give up and patrol.
            bot.yaw += dt * 1.2;
            if (bot.stateTime > B.searchTime) {
              bot.path = bfsPath(world.navNodes, bot.node, nearestNode(world.navNodes, bot.pos.x, bot.pos.z));
              bot.pathIdx = 0;
              setState(bot, 'PATROL');
            }
          }
        } else if (bot.pathIdx >= bot.path.length) {
          bot.path = bfsPath(world.navNodes, bot.node, nearestNode(world.navNodes, bot.lastKnown.x, bot.lastKnown.z));
          bot.pathIdx = 0;
        }
        if (sees) setState(bot, 'CHASE');
      } else if (bot.state === 'FLEE') {
        const spawn = world.spawns.bots[0];
        if (moveToward(bot, spawn.x, spawn.z, B.chaseSpeed, dt)) {
          bot.hp = Math.min(bot.maxHp * 0.5, bot.hp + dt * 12);
          if (bot.hp >= bot.maxHp * 0.5) setState(bot, 'PATROL');
        }
      } else if (bot.state === 'DEFUSE') {
        if (!bombPlanted) { setState(bot, 'PATROL'); continue; }
        const d = Math.hypot(bot.pos.x - bombSite.x, bot.pos.z - bombSite.z);
        if (d > 1.2) {
          moveToward(bot, bombSite.x, bombSite.z, B.chaseSpeed, dt);
        } else {
          bot.defuseProgress += dt;
          events.push({ type: 'defuseTick', bot, progress: bot.defuseProgress });
          if (bot.defuseProgress >= CONFIG.rounds.defuseTime) {
            events.push({ type: 'defused', bot });
          }
        }
        if (sees && d < 12) setState(bot, 'ATTACK');
      }

      // Unstick: no progress for 2 s -> pick a new patrol target.
      const moved = Math.hypot(bot.pos.x - bot.lastPos.x, bot.pos.z - bot.lastPos.z);
      if (moved > 0.05) { bot.stuckTimer = 0; bot.lastPos.copy(bot.pos); }
      else {
        bot.stuckTimer += dt;
        if (bot.stuckTimer > 2 && bot.state !== 'ATTACK' && bot.state !== 'DEFUSE') {
          bot.stuckTimer = 0;
          pickPatrolTarget(bot);
        }
      }

      // Walk cycle: legs swing, body bobs — procedural, no animation clips.
      const speed = bot.state === 'PATROL' ? B.patrolSpeed : B.chaseSpeed;
      const moving = bot.state !== 'ATTACK' || Math.hypot(bot.pos.x - bot.lastPos.x, bot.pos.z - bot.lastPos.z) > 0.001;
      const swing = moving ? Math.sin(bot.walkPhase) * 0.45 : 0;
      bot.mesh.legL.rotation.x = swing;
      bot.mesh.legR.rotation.x = -swing;
      bot.mesh.group.position.set(bot.pos.x, bot.pos.y + (moving ? Math.abs(Math.sin(bot.walkPhase)) * 0.04 : 0), bot.pos.z);
      bot.mesh.group.rotation.y = bot.yaw;
    }

    // Bot-vs-bot separation: cheap circle push-apart.
    for (let i = 0; i < bots.length; i += 1) {
      if (!bots[i].alive) continue;
      for (let j = i + 1; j < bots.length; j += 1) {
        if (!bots[j].alive) continue;
        const dx = bots[j].pos.x - bots[i].pos.x;
        const dz = bots[j].pos.z - bots[i].pos.z;
        const d = Math.hypot(dx, dz);
        if (d > 0.01 && d < 0.9) {
          const push = (0.9 - d) / 2;
          const nx = dx / d;
          const nz = dz / d;
          bots[i].pos.x -= nx * push;
          bots[i].pos.z -= nz * push;
          bots[j].pos.x += nx * push;
          bots[j].pos.z += nz * push;
        }
      }
    }
  }

  function aliveCount() {
    let n = 0;
    for (const bot of bots) if (bot.alive) n += 1;
    return n;
  }

  function reset() {
    for (const bot of bots) {
      bot.alive = false;
      bot.mesh.group.visible = false;
    }
  }

  function muzzleWorld(bot, out) {
    out.set(bot.pos.x - Math.sin(bot.yaw) * 0.4, 1.25, bot.pos.z - Math.cos(bot.yaw) * 0.4);
    return out;
  }

  return { bots, spawnRound, step, rayHit, damage, aliveCount, reset, muzzleWorld };
}
