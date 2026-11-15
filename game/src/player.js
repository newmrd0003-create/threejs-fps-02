// Player movement: acceleration, friction, gravity, crouch and jump, resolved
// as a circle against the world's AABBs one axis at a time, so the player
// slides along walls instead of sticking. One resolver is shared with the bots.
import * as THREE from 'three';
import { CONFIG } from './config.js';

const P = CONFIG.player;

export function createPlayer(colliders) {
  const player = {
    position: new THREE.Vector3(0, 0, 15),
    velocity: new THREE.Vector3(),
    yaw: 0,
    pitch: 0,
    eye: P.standEye,
    onGround: true,
    crouching: false,
    height: P.standHeight,
  };
  const probe = new THREE.Box3();
  const wish = new THREE.Vector3();

  function overlaps(x, y, z, height, lift) {
    probe.min.set(x - P.radius, y + lift, z - P.radius);
    probe.max.set(x + P.radius, y + height - lift, z + P.radius);
    for (const collider of colliders) if (probe.intersectsBox(collider)) return collider;
    return null;
  }

  function look(dx, dy, sensitivity = P.sensitivity) {
    player.yaw -= dx * sensitivity;
    player.pitch = Math.max(-1.553, Math.min(1.553, player.pitch - dy * sensitivity));
  }

  function recoil(pitchKick, yawKick) {
    player.pitch = Math.min(1.553, player.pitch + pitchKick);
    player.yaw += yawKick;
  }

  function step(dt, keys) {
    const crouching = keys.has('ControlLeft') || keys.has('ControlRight') || keys.has('KeyC');
    if (crouching && !player.crouching) {
      player.crouching = true;
      player.height = P.crouchHeight;
    } else if (!crouching && player.crouching
      && !overlaps(player.position.x, player.position.y, player.position.z, P.standHeight, 0.02)) {
      player.crouching = false;
      player.height = P.standHeight;
    }
    const eyeTarget = player.crouching ? P.crouchEye : P.standEye;
    player.eye += (eyeTarget - player.eye) * Math.min(1, dt * 12);

    const forward = (keys.has('KeyW') ? 1 : 0) - (keys.has('KeyS') ? 1 : 0);
    const strafe = (keys.has('KeyD') ? 1 : 0) - (keys.has('KeyA') ? 1 : 0);
    wish.set(0, 0, 0);
    if (forward || strafe) {
      const sin = Math.sin(player.yaw);
      const cos = Math.cos(player.yaw);
      wish.set(-sin * forward + cos * strafe, 0, -cos * forward - sin * strafe).normalize();
    }

    const sprinting = keys.has('ShiftLeft') || keys.has('ShiftRight');
    const speed = player.crouching ? P.crouchSpeed : (sprinting ? P.sprintSpeed : P.walkSpeed);
    const blend = Math.min(1, (player.onGround ? P.groundAccel : P.airAccel) * dt / speed);
    player.velocity.x += (wish.x * speed - player.velocity.x) * blend;
    player.velocity.z += (wish.z * speed - player.velocity.z) * blend;
    if (player.onGround && !wish.lengthSq()) {
      const damp = Math.max(0, 1 - P.friction * dt);
      player.velocity.x *= damp;
      player.velocity.z *= damp;
    }

    if (keys.has('Space') && player.onGround) {
      player.velocity.y = P.jumpSpeed;
      player.onGround = false;
    }
    player.velocity.y -= P.gravity * dt;

    const nextX = player.position.x + player.velocity.x * dt;
    if (!overlaps(nextX, player.position.y, player.position.z, player.height, 0.04)) player.position.x = nextX;
    else player.velocity.x = 0;
    const nextZ = player.position.z + player.velocity.z * dt;
    if (!overlaps(player.position.x, player.position.y, nextZ, player.height, 0.04)) player.position.z = nextZ;
    else player.velocity.z = 0;

    player.position.y += player.velocity.y * dt;
    player.onGround = false;
    const hit = overlaps(player.position.x, player.position.y, player.position.z, player.height, 0);
    if (hit && player.velocity.y <= 0) {
      player.position.y = hit.max.y;
      player.velocity.y = 0;
      player.onGround = true;
    } else if (hit) {
      player.position.y = hit.min.y - player.height;
      player.velocity.y = 0;
    }
    if (player.position.y < 0) {
      player.position.y = 0;
      player.velocity.y = 0;
      player.onGround = true;
    }
    player.velocity.y = Math.max(P.maxFall, player.velocity.y);
  }

  // Shared circle-vs-AABB resolver: bots slide on the same walls.
  function resolveCircle(pos, radius, height) {
    probe.min.set(pos.x - radius, pos.y + 0.04, pos.z - radius);
    probe.max.set(pos.x + radius, pos.y + height - 0.04, pos.z + radius);
    for (const collider of colliders) {
      if (!probe.intersectsBox(collider)) continue;
      const dxl = probe.max.x - collider.min.x;
      const dxr = collider.max.x - probe.min.x;
      const dzl = probe.max.z - collider.min.z;
      const dzr = collider.max.z - probe.min.z;
      const m = Math.min(dxl, dxr, dzl, dzr);
      if (m === dxl) pos.x = collider.min.x - radius;
      else if (m === dxr) pos.x = collider.max.x + radius;
      else if (m === dzl) pos.z = collider.min.z - radius;
      else pos.z = collider.max.z + radius;
      probe.min.set(pos.x - radius, pos.y + 0.04, pos.z - radius);
      probe.max.set(pos.x + radius, pos.y + height - 0.04, pos.z + radius);
    }
  }

  return {
    state: player,
    step,
    look,
    recoil,
    resolveCircle,
    groundSpeed() {
      return Math.hypot(player.velocity.x, player.velocity.z);
    },
  };
}
