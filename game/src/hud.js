// HUD: every DOM write in one module. The crosshair gap mirrors the live
// spread exactly; the damage vignette, hitmarker and kill feed are CSS/DOM
// so they cost zero draw calls.
export function createHud() {
  const el = (id) => document.getElementById(id);
  const crosshair = el('crosshair');
  const hitmarker = el('hitmarker');
  const dmgnum = el('dmgnum');
  const ammoMag = el('ammo-mag');
  const ammoReserve = el('ammo-reserve');
  const ammoBox = el('ammo');
  const weaponName = el('weapon-name');
  const grenadeCount = el('grenade-count');
  const hpFill = el('hp-fill');
  const hpNum = el('hp-num');
  const armorFill = el('armor-fill');
  const timerEl = el('timer');
  const scoreEl = el('score-value');
  const roundEl = el('round-value');
  const creditsEl = el('credits-value');
  const killfeedEl = el('killfeed');
  const bannerEl = el('banner');
  const bannerTitle = el('banner-title');
  const bannerSub = el('banner-sub');
  const bombEl = el('bomb-status');
  const bombFill = el('bomb-fill');
  const bombText = el('bomb-text');
  const vignette = el('vignette');
  const siteHint = el('site-hint');
  const enemiesEl = el('enemies-value');
  const overlay = el('overlay');
  const overlayTitle = el('overlay-title');
  const overlayCopy = el('overlay-copy');
  const playBtn = el('play');
  const buyMenu = el('buymenu');
  const buyCredits = el('buy-credits');
  const buyGrid = el('buy-grid');

  let hitTimer = null;
  let bannerTimer = null;
  let onPlayCb = null;
  let onBuyCb = null;

  playBtn.addEventListener('click', () => { if (onPlayCb) onPlayCb(); });

  function fmtTime(s) {
    const v = Math.max(0, Math.ceil(s));
    return `${Math.floor(v / 60)}:${String(v % 60).padStart(2, '0')}`;
  }

  return {
    onPlay(cb) { onPlayCb = cb; },
    onBuy(cb) { onBuyCb = cb; },

    setHealth(hp, armor) {
      hpNum.textContent = String(Math.max(0, Math.ceil(hp)));
      hpFill.style.width = `${Math.max(0, Math.min(100, hp))}%`;
      hpFill.style.background = hp < 30 ? '#c94f3d' : '#e9e6df';
      armorFill.style.width = `${Math.max(0, Math.min(100, armor))}%`;
    },
    setAmmo(mag, reserve, reloading) {
      ammoMag.textContent = String(mag);
      ammoReserve.textContent = `/ ${reserve}${reloading ? ' — RELOADING' : ''}`;
      ammoBox.classList.toggle('empty', mag === 0);
    },
    setWeapon(name, grenades) {
      weaponName.textContent = name;
      grenadeCount.textContent = `◉ ${grenades}`;
    },
    setTimer(seconds, planted) {
      timerEl.textContent = fmtTime(seconds);
      timerEl.classList.toggle('urgent', seconds <= 10 || planted);
    },
    setScore(you, them, round) {
      scoreEl.textContent = `${you} — ${them}`;
      roundEl.textContent = `ROUND ${round} / 9`;
    },
    setCredits(n) {
      creditsEl.textContent = `$${n.toLocaleString('en-US')}`;
    },
    setEnemiesLeft(n) {
      enemiesEl.textContent = String(n);
    },
    setCrosshairSpread(px) {
      crosshair.style.setProperty('--gap', `${Math.round(4 + px)}px`);
    },
    hitmarker(kill, head, dmg) {
      hitmarker.classList.add('on');
      hitmarker.classList.toggle('kill', kill);
      if (hitTimer) clearTimeout(hitTimer);
      hitTimer = setTimeout(() => hitmarker.classList.remove('on', 'kill'), 140);
      if (dmg !== undefined) {
        dmgnum.textContent = head ? `HEADSHOT ${dmg}` : `${dmg}`;
        dmgnum.classList.add('on');
        setTimeout(() => dmgnum.classList.remove('on'), 450);
      }
    },
    damageFlash() {
      vignette.classList.remove('flash');
      void vignette.offsetWidth; // restart the animation
      vignette.classList.add('flash');
      vignette.style.opacity = '1';
      setTimeout(() => { vignette.style.opacity = '0'; }, 120);
    },
    killfeed(text, good) {
      const div = document.createElement('div');
      div.className = `feed-item${good ? ' good' : ''}`;
      div.textContent = text;
      killfeedEl.prepend(div);
      while (killfeedEl.children.length > 5) killfeedEl.removeChild(killfeedEl.lastChild);
      setTimeout(() => div.remove(), 6000);
    },
    banner(title, sub, ms = 2600) {
      bannerTitle.textContent = title;
      bannerSub.textContent = sub || '';
      bannerEl.classList.add('show');
      if (bannerTimer) clearTimeout(bannerTimer);
      bannerTimer = setTimeout(() => bannerEl.classList.remove('show'), ms);
    },
    clearBanner() {
      bannerEl.classList.remove('show');
      if (bannerTimer) clearTimeout(bannerTimer);
    },
    setBomb(state, progress, timer) {
      if (state === 'idle') {
        bombEl.classList.add('hidden');
        return;
      }
      bombEl.classList.remove('hidden');
      if (state === 'planting') {
        bombText.textContent = `PLANTING ${Math.round(progress * 100)}% — hold E`;
        bombFill.style.width = `${progress * 100}%`;
      } else if (state === 'planted') {
        bombText.textContent = `CHARGE LIVE — ${fmtTime(timer)}`;
        bombFill.style.width = `${(timer / 40) * 100}%`;
      }
    },
    setSiteHint(text) {
      if (text) {
        siteHint.textContent = text;
        siteHint.classList.remove('hidden');
      } else {
        siteHint.classList.add('hidden');
      }
    },
    showBuy(visible, credits, items) {
      buyMenu.classList.toggle('hidden', !visible);
      if (!visible) return;
      buyCredits.textContent = `$${credits.toLocaleString('en-US')}`;
      buyGrid.innerHTML = '';
      for (const item of items) {
        const card = document.createElement('button');
        card.type = 'button';
        card.className = `buy-card${item.owned ? ' owned' : ''}${!item.owned && !item.affordable ? ' poor' : ''}`;
        card.innerHTML = `<b>${item.name}</b><span>${item.desc}</span><i>${item.owned ? 'OWNED' : '$' + item.price.toLocaleString('en-US')}</i>`;
        card.disabled = item.owned || !item.affordable;
        card.addEventListener('click', () => { if (onBuyCb) onBuyCb(item.id); });
        buyGrid.appendChild(card);
      }
    },
    showOverlay(kind, data = {}) {
      overlay.classList.remove('hidden');
      if (kind === 'start') {
        overlayTitle.textContent = 'DUSTLINE';
        overlayCopy.textContent = 'YARD 7 — you are the Vanguard. Eliminate all five Sentinels or plant the charge at site A or B. First to 5 rounds takes the match. Click to play.';
        playBtn.textContent = 'Click to play';
      } else if (kind === 'paused') {
        overlayTitle.textContent = 'PAUSED';
        overlayCopy.textContent = `Round ${data.round || 1} — score ${data.score || '0 — 0'}. Click to resume.`;
        playBtn.textContent = 'Resume';
      } else if (kind === 'end') {
        overlayTitle.textContent = data.won ? 'MATCH WON' : 'MATCH LOST';
        overlayCopy.textContent = data.detail || '';
        playBtn.textContent = 'Play again';
      }
    },
    hideOverlay() {
      overlay.classList.add('hidden');
    },
  };
}
