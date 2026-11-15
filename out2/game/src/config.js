// DUSTLINE — all tunables in one place. Every number the dossier quotes lives here,
// so the balance table and the code can never drift apart.
// Units: metres, seconds, degrees where noted. Seeded RNG drives spread, bot
// decisions and spawns; the same seed replays the same round.
export const CONFIG = {
  seed: 7,
  map: { name: 'YARD 7', width: 52, depth: 36, wallHeight: 4.6 },

  // --- player (m/s) ---
  player: {
    radius: 0.34, standHeight: 1.72, crouchHeight: 1.12,
    standEye: 1.6, crouchEye: 1.02,
    walkSpeed: 5.2, sprintSpeed: 6.8, crouchSpeed: 2.4,
    groundAccel: 42, airAccel: 9, friction: 9,
    gravity: 20, jumpSpeed: 6.2, maxFall: -30,
    health: 100, armor: 50, // armor absorbs 50% of incoming damage while it lasts
    sensitivity: 0.0022,
  },

  // --- weapons: dmg is per body hit; headMul multiplies on a head hit ---
  weapons: {
    rifle: {
      id: 'rifle', name: "AR-7 'Jackal'", price: 2700, slot: 1,
      dmg: 34, headMul: 2, rate: 10, mag: 25, reserve: 75,
      reload: 2.2, spreadBase: 0.15, bloomPerShot: 0.35, bloomRecover: 1.2,
      kick: 0.011, auto: true, tracer: 0xf0a830,
    },
    smg: {
      id: 'smg', name: "SMG-9 'Wasp'", price: 1500, slot: 2,
      dmg: 22, headMul: 2, rate: 13, mag: 32, reserve: 96,
      reload: 1.6, spreadBase: 0.25, bloomPerShot: 0.3, bloomRecover: 1.5,
      kick: 0.007, auto: true, tracer: 0x9fd8ff,
    },
    pistol: {
      id: 'pistol', name: "P9 'Sidearm'", price: 0, slot: 3,
      dmg: 40, headMul: 2, rate: 4, mag: 12, reserve: 48,
      reload: 1.4, spreadBase: 0.1, bloomPerShot: 0.5, bloomRecover: 1.8,
      kick: 0.014, auto: false, tracer: 0xffffff,
    },
  },
  grenade: {
    id: 'grenade', name: 'FRAG-12', price: 200, maxCarry: 2,
    fuse: 1.6, radius: 6, dmgMax: 100, dmgMin: 20, throwSpeed: 14,
  },
  armor: { id: 'armor', name: 'Vest + Helmet', price: 650, amount: 50 },

  // spread multipliers: standing still is accurate; moving, airborne or
  // firing on the move is punished; crouching and aiming down sights pay off.
  spread: { move: 1.8, air: 2.5, crouch: 0.55, ads: 0.45 },
  adsFov: 55, baseFov: 75,

  // --- bots: 5-state AI (PATROL / CHASE / ATTACK / SEARCH / FLEE) ---
  bots: {
    maxAlive: 5, perRound: 5, spawnInterval: 2.5, spawnMinDist: 12,
    patrolSpeed: 2.2, chaseSpeed: 3.4, attackRange: [8, 18],
    burst: [3, 5], burstGap: [0.9, 1.4], shotDmg: 9,
    hp: 100, headRadius: 0.22, bodyRadius: 0.45,
    scanInterval: 0.25, loseSight: 5, searchTime: 8, attackLoseSight: 3,
    // aggression ramps with rounds won: reaction 0.9s -> 0.35s,
    // aim error +-4deg -> +-1.5deg, burst 3 -> 6, hp 80 -> 120
    aggressionPerRound: 0.12,
  },

  // --- rounds & economy ---
  rounds: {
    roundTime: 100, freezeTime: 12, winRounds: 5, maxRounds: 9,
    startCredits: 800, winCredits: 3250, lossCredits: 1900,
    killCredits: 300, plantCredits: 300,
    plantTime: 3.0, defuseTime: 5.0, bombTimer: 40,
    bombBeepInterval: 1.0,
  },

  // --- viewmodel recoil: 3 damped springs (kick / pitch / sway), 8 ms substeps ---
  springs: {
    kick: { k: 180, c: 22, impulse: 1.0 },
    pitch: { k: 140, c: 18, impulse: 0.35 },
    sway: { k: 90, c: 14 },
  },

  // --- fixed VFX budgets (pooled, never allocated per shot) ---
  fx: { tracers: 48, decals: 160, shells: 60, sparks: 240, debris: 64 },

  // --- performance ---
  perf: { pixelRatioCap: 1.5, shadowMap: 2048, fogNear: 18, fogFar: 62 },
};
