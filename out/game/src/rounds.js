// Rounds: a pure state machine — no three.js, no DOM, one store for the
// whole match. freeze -> live -> (planted) -> ended -> freeze ...
// First to 5 round wins, at most 9 rounds. Economy: kill +300, plant +300,
// win +3250, loss +1900. The bomb is planted by holding E inside a site
// for 3 s; it explodes after 40 s unless a Sentinel defuses it (5 s channel).
import { CONFIG } from './config.js';

const R = CONFIG.rounds;

export function createRounds() {
  const state = {
    phase: 'menu', // menu | freeze | live | ended | matchEnd
    round: 1,
    score: { you: 0, them: 0 },
    credits: R.startCredits,
    timer: R.freezeTime,
    history: [],
    bomb: { state: 'idle', site: null, progress: 0, timer: 0, beepAt: 0 },
    banner: null,
    matchWinner: null,
  };

  function startMatch() {
    state.phase = 'freeze';
    state.round = 1;
    state.score = { you: 0, them: 0 };
    state.credits = R.startCredits;
    state.timer = R.freezeTime;
    state.history = [];
    state.bomb = { state: 'idle', site: null, progress: 0, timer: 0, beepAt: 0 };
    state.matchWinner = null;
    state.banner = { title: 'ROUND 1 — YARD 7', sub: 'Eliminate the Sentinels or plant the charge' };
    return ['roundStart'];
  }

  function startRound() {
    state.phase = 'freeze';
    state.timer = R.freezeTime;
    state.bomb = { state: 'idle', site: null, progress: 0, timer: 0, beepAt: 0 };
    state.banner = { title: `ROUND ${state.round}`, sub: state.round === 1 ? 'Buy up — B opens the shop' : 'Buy up — B opens the shop' };
    return ['roundStart'];
  }

  function endRound(won, reason) {
    state.phase = 'ended';
    state.timer = 3;
    if (won) {
      state.score.you += 1;
      state.credits += R.winCredits;
      state.history.push('W');
      state.banner = { title: 'ROUND WON', sub: reason };
    } else {
      state.score.them += 1;
      state.credits += R.lossCredits;
      state.history.push('L');
      state.banner = { title: 'ROUND LOST', sub: reason };
    }
    if (state.score.you >= R.winRounds) {
      state.matchWinner = 'you';
      return ['matchEnd'];
    }
    if (state.score.them >= R.winRounds || state.round >= R.maxRounds) {
      state.matchWinner = 'them';
      return ['matchEnd'];
    }
    return ['roundEnd'];
  }

  function update(dt, ctx) {
    // ctx: { enemiesAlive, playerAlive, planting, plantSite, defused }
    const events = [];
    if (state.phase === 'freeze') {
      state.timer -= dt;
      if (state.timer <= 0) {
        state.phase = 'live';
        state.timer = R.roundTime;
        state.banner = null;
        events.push('roundLive');
      }
      return events;
    }
    if (state.phase === 'ended') {
      state.timer -= dt;
      if (state.timer <= 0) {
        if (state.matchWinner) {
          state.phase = 'matchEnd';
          events.push('matchEnd');
        } else {
          state.round += 1;
          events.push(...startRound());
        }
      }
      return events;
    }
    if (state.phase !== 'live') return events;

    state.timer -= dt;
    // Planting: hold E inside a site.
    if (state.bomb.state === 'idle') {
      if (ctx.planting && ctx.plantSite) {
        state.bomb.state = 'planting';
        state.bomb.site = ctx.plantSite;
        state.bomb.progress = 0;
      }
    } else if (state.bomb.state === 'planting') {
      if (ctx.planting && ctx.plantSite === state.bomb.site) {
        state.bomb.progress += dt;
        if (state.bomb.progress >= R.plantTime) {
          state.bomb.state = 'planted';
          state.bomb.timer = R.bombTimer;
          state.bomb.beepAt = 0;
          state.credits += R.plantCredits;
          state.banner = { title: 'CHARGE PLANTED', sub: `Defend site ${state.bomb.site} — 40 seconds` };
          events.push('bombPlanted');
        }
      } else {
        state.bomb.state = 'idle';
        state.bomb.site = null;
        state.bomb.progress = 0;
      }
    } else if (state.bomb.state === 'planted') {
      state.bomb.timer -= dt;
      state.bomb.beepAt -= dt;
      if (state.bomb.beepAt <= 0) {
        state.bomb.beepAt = R.bombBeepInterval;
        events.push('bombBeep');
      }
      if (ctx.defused) {
        state.bomb.state = 'defused';
        events.push(...endRound(false, 'The charge was defused'));
        return events;
      }
      if (state.bomb.timer <= 0) {
        state.bomb.state = 'exploded';
        events.push('bombExploded');
        events.push(...endRound(true, 'The charge detonated'));
        return events;
      }
    }

    if (!ctx.playerAlive) {
      events.push(...endRound(false, 'You were eliminated'));
      return events;
    }
    if (ctx.enemiesAlive === 0) {
      events.push(...endRound(true, state.bomb.state === 'planted' ? 'Site cleared — the charge will detonate' : 'All Sentinels eliminated'));
      return events;
    }
    if (state.timer <= 0) {
      events.push(...endRound(false, 'Time expired — the site held'));
      return events;
    }
    return events;
  }

  function buy(id, price) {
    if (state.phase !== 'freeze' && state.phase !== 'menu') return false;
    if (state.credits < price) return false;
    state.credits -= price;
    return true;
  }

  function awardKill() {
    state.credits += R.killCredits;
  }

  function plantingSite(playerX, playerZ, sites) {
    for (const key of Object.keys(sites)) {
      const s = sites[key];
      if (Math.hypot(playerX - s.x, playerZ - s.z) <= s.r) return key;
    }
    return null;
  }

  return {
    state, startMatch, startRound, update, buy, awardKill, plantingSite, endRound,
  };
}
