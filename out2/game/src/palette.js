// DUSTLINE palette — six colours, one desert-dusk look.
// canvas = ground haze, surface = walls, hairline = cover, ink = light,
// muted = cool fill, accent = amber (tracers, markers, HUD highlights).
// Sky / page / fog colour. Chosen one stop brighter than the dusk base
// (#1a1712) so the map's upper half never reads as a black void: the sky
// stays warm and the terrain still dominates the frame.
export const PALETTE = {
  canvas: '#2b2119',
  surface: '#3a342a',
  hairline: '#57503f',
  ink: '#f2ead8',
  muted: '#8a94a3',
  accent: '#f0a830',
  // team / site accents (kept inside the same six-colour family + two signals)
  enemy: '#c94f3d', // Sentinel red trim
  ally: '#7fb069', // Vanguard green trim
  siteA: '#f0a830',
  siteB: '#5aa9e6',
};
