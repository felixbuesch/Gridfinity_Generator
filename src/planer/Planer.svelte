<script lang="ts">
  // Planer in drei Schritten: Maße → Raster → Drucken. Profi-Werte liegen in einer Schublade rechts.
  import { onMount } from 'svelte';
  import { loadOpts, saveOpts, clean, posText, TIPS, type Opts, type Align } from './opts';
  import { plan, stats as calcStats, jobOf, jobName, jobWhat, buildZip, jobZip, offer, fmt, cellsOf, plateKey, spacerKey, PLA_DENSITY, GF } from './core.js';
  import Stage, { MiniView, partGroup, bedsGroup } from './stage.js';

  interface Use { id: 'desk' | 'drawer' | 'box'; name: string; area: string; hint: string; q: string }
  let { use, initial, onBack }: { use: Use; initial: Partial<Opts>; onBack: () => void } = $props();

  // Startwerte kommen einmalig aus dem Startbildschirm; danach gehört der Zustand dem Planer
  const start = () => ({ ...loadOpts(), ...initial });
  let o: Opts = $state(start());
  let step = $state(1);
  let profi = $state(false);
  let sel: { kind: 'P' | 'R'; idx: number } | null = $state(null);
  let tip: { text: string; x: number; y: number } | null = $state(null);
  let busy: Record<string, string> = $state({});
  let narrow = $state(false);

  // Rechnen mit kurzer Verzögerung, damit Tippen flüssig bleibt
  let P: any = $state.raw(plan(clean(o)));
  let timer: any;
  $effect(() => {
    const snap = JSON.stringify(o);
    clearTimeout(timer);
    timer = setTimeout(() => { saveOpts(JSON.parse(snap)); P = plan(clean(JSON.parse(snap))); }, 180);
  });
  const R = $derived(P.R);
  const S = $derived(calcStats(P));

  let canvas: HTMLCanvasElement, mini: HTMLCanvasElement, panelEl: HTMLElement;
  let stage: any, mv: any;
  onMount(() => {
    stage = new Stage(canvas, {
      onHover: (t: string | null, x = 0, y = 0) => { tip = t ? { text: t, x, y } : null; },
      onPick: (s: any) => { sel = s; },
    });
    mv = new MiniView(mini);
    const mq = matchMedia('(max-width: 760px)');
    const upd = () => { narrow = mq.matches; stage.setPanel(narrow ? 0 : (panelEl?.offsetWidth || 380) + 40); };
    mq.addEventListener('change', upd); upd();
    (window as any).__planer = { stage, setStep: (n: number) => (step = n), select: (s: any) => (sel = s), get P() { return P; }, zip: () => buildZip(P, use) };
    return () => { stage.dispose(); mv.dispose(); mq.removeEventListener('change', upd); };
  });
  $effect(() => { if (stage) { stage.setPlan(P, use); if (sel && !(sel.kind === 'P' ? P.R.pieces?.[sel.idx] : P.R.spacers?.list[sel.idx])) sel = null; } });
  $effect(() => { if (stage) stage.goStep(step); });
  $effect(() => { if (stage) stage.setSelected(sel); });
  $effect(() => {
    if (!mv || P.R.error) return;
    if (sel) mv.show(partGroup(P, sel.kind === 'P' ? plateKey(P, P.R.pieces[sel.idx]) : spacerKey(P, P.R.spacers.list[sel.idx]), true), [-0.35, -1.1, 1.25]);
    else mv.show(bedsGroup(P), [0, -0.4, 1]);
  });

  const steps = ['Maße', 'Raster', 'Drucken'];
  const isDesk = $derived(use.id === 'desk');
  const marg = $derived(R.error ? '' : `links ${fmt(R.AX.mLow + R.AX.gapLow, 1)} · rechts ${fmt(R.AX.mHigh + R.AX.gapHigh, 1)} · vorne ${fmt(R.AY.mLow + R.AY.gapLow, 1)} · hinten ${fmt(R.AY.mHigh + R.AY.gapHigh, 1)} mm`);
  const POS: [Align, Align, string][] = [
    ['start', 'end', 'hinten links'], ['center', 'end', 'hinten mittig'], ['end', 'end', 'hinten rechts'],
    ['start', 'center', 'links mittig'], ['center', 'center', 'Mitte'], ['end', 'center', 'rechts mittig'],
    ['start', 'start', 'vorne links'], ['center', 'start', 'vorne mittig'], ['end', 'start', 'vorne rechts'],
  ];

  // Teilekarte
  const card = $derived.by(() => {
    if (!sel || R.error) return null;
    const ox = R.AX.gapLow, oy = R.AY.gapLow, j = jobOf(P, sel);
    if (sel.kind === 'P') {
      const p = R.pieces[sel.idx]; if (!p) return null;
      const petg = !!(j && j.flip), v = GF.volume(P.mesh(plateKey(P, p)).pla);
      return { tag: p.type.label, title: 'Platte', sub: cellsOf(p), rows: [['Maße', `${fmt(p.w)} × ${fmt(p.d)} × 4,65 mm`], ['Position', `${fmt(ox + p.x)} / ${fmt(oy + p.y)} mm ab links / vorne`], ['Gleiche Teile', `${p.type.pieces.length}×`], [petg ? 'PETG' : 'PLA', `${fmt(v * (petg ? 1.27 : PLA_DENSITY), 0)} g${petg ? ' · kopfüber gedruckt' : ''}`]], j };
    }
    const s = R.spacers.list[sel.idx]; if (!s) return null; const t = s.type;
    const petg = !!(j && j.flip), v = GF.volume(P.mesh(spacerKey(P, s)).spacer);
    return { tag: t.label, title: 'Leiste', sub: '', rows: [['Maße', `${fmt(t.w, 2)} × ${fmt(t.d, 2)} × ${fmt(t.h, 2)} mm`], ['Form', o.spacerStyle === 'solid' || t.tiles.length === 1 ? 'voll' : `Leiter, ${fmt(o.rail, 2)} mm Schienen`], ['Position', `${fmt(ox + s.x0)} / ${fmt(oy + s.y0)} mm ab links / vorne`], ['Gleiche Teile', `${t.items.length}×`], [petg ? 'PETG' : 'PLA', `${fmt(v * (petg ? 1.27 : PLA_DENSITY), 1)} g`]], j };
  });

  async function download(id: string, name: string, make: () => Uint8Array) {
    busy[id] = 'Erzeuge …';
    await new Promise((r) => setTimeout(r, 30));
    try { const z = make(); busy[id] = `${(z.length / 1048576).toFixed(1)} MB · ` + (await offer(name, z)); }
    catch (e: any) { busy[id] = 'Fehler: ' + e.message; }
    setTimeout(() => { delete busy[id]; }, 6000);
  }
  const zipAll = () => download('all', `gridfinity_${Math.round(o.boxW)}x${Math.round(o.boxD)}.zip`, () => buildZip(P, use));
  const zipJob = (i: number) => download('job' + i, `${R.stacks[i].label}.zip`, () => jobZip(P, i));
  const petgOf = (i: number) => { const m = P.mesh('S:' + i); return m.petg.f.length ? GF.volume(m.petg) * 1.27 : 0; };
  const go = (n: number) => { step = n; sel = null; panelEl?.scrollTo({ top: 0, behavior: 'smooth' }); };

  const PROFI: [keyof Opts, string, number, number][] = [
    ['minSpacer', 'Mindestbreite Leiste (mm)', 0.5, 0], ['spacerH', 'Leistenhöhe (mm)', 0.2, 0.6], ['rail', 'Schiene (mm)', 0.2, 0.8], ['ribPitch', 'Streben alle (mm)', 5, 8],
    ['bedX', 'Bett X (mm)', 1, 50], ['bedY', 'Bett Y (mm)', 1, 50], ['bedZ', 'Höhe Z (mm)', 1, 10],
    ['sepT', 'PETG-Basisschicht (mm)', 0.1, 0.1], ['overhang', 'Überhang (°)', 5, 20], ['maxStack', 'Max. Platten je Stapel', 1, 1], ['towerReserve', 'Platz Prime-Tower (mm)', 5, 0],
  ];
</script>

<div class="planer" class:narrow>
  <canvas bind:this={canvas} class="stage" aria-label="3D-Ansicht: {use.name} mit Gridfinity-Raster" data-tip={TIPS.view}></canvas>

  <header class="top">
    <button class="pill" type="button" onclick={onBack} data-tip={TIPS.toIntro}>← Einsatzort</button>
    <div class="brand">Gridfinity <span>Planer</span> <em>{use.name} · {fmt(o.boxW)} × {fmt(o.boxD)} mm</em></div>
    <nav class="steps" aria-label="Schritte">
      {#each steps as s, i}
        <button type="button" class:on={step === i + 1} class:done={step > i + 1} onclick={() => go(i + 1)} aria-current={step === i + 1 ? 'step' : undefined} data-tip="Schritt {i + 1}: {s}">
          <b>{step > i + 1 ? '✓' : i + 1}</b>{s}
        </button>
      {/each}
    </nav>
  </header>

  {#if tip}<div class="htip" style="left:{tip.x + 14}px; top:{tip.y + 16}px">{tip.text}</div>{/if}

  <aside class="panel" bind:this={panelEl}>
    {#key step}
    <div class="pane">
      <div class="kick">Schritt {step} von 3</div>
      {#if step === 1}
        <h2>{use.q}</h2>
        <div class="dims">
          <label data-tip={TIPS.boxW}><span>Breite</span><span class="in"><input type="number" inputmode="decimal" min="42" step="0.5" bind:value={o.boxW}><em>mm</em></span></label>
          <span class="x">×</span>
          <label data-tip={TIPS.boxD}><span>Tiefe</span><span class="in"><input type="number" inputmode="decimal" min="42" step="0.5" bind:value={o.boxD}><em>mm</em></span></label>
        </div>
        <p class="hint">{use.hint}</p>
        {#if !isDesk}
          <div class="row2">
            <label class="f" data-tip={TIPS.clearance}>Spiel je Achse<input type="number" min="0" step="0.1" bind:value={o.clearance}></label>
            <label class="f" data-tip={TIPS.cornerR}>Eckenradius<input type="number" min="0" step="0.5" bind:value={o.cornerR}></label>
          </div>
        {/if}
      {:else if step === 2}
        <h2>Wo soll das Raster anliegen?</h2>
        <div class="posrow">
          <div class="pos" role="group" aria-label="Position des Rasters" data-tip={TIPS.pos}>
            {#each POS as [x, y, l]}
              <button type="button" aria-label={l} aria-pressed={o.alignX === x && o.alignY === y} onclick={() => { o.alignX = x; o.alignY = y; }}></button>
            {/each}
          </div>
          <div><span class="lbl">Raster liegt an</span><b>{posText(o.alignX, o.alignY)}</b><span class="lbl">{isDesk ? 'Der Rest bleibt frei.' : 'Leisten füllen die Gegenseite.'}</span></div>
        </div>
        <label class="tog" data-tip={TIPS.half}><input type="checkbox" bind:checked={o.half}> Halbe Zellen (21 mm) am Rand</label>
        {#if !isDesk}
          <div class="f" data-tip={TIPS.spacers}>Abstandshalter
            <div class="seg">
              <button type="button" aria-pressed={o.spacers === 'separate'} onclick={() => (o.spacers = 'separate')}>separate Leisten</button>
              <button type="button" aria-pressed={o.spacers === 'integrated'} onclick={() => (o.spacers = 'integrated')}>in Platten</button>
            </div>
          </div>
        {/if}
        {#if marg}<p class="hint">Rand: {marg}</p>{/if}
      {:else}
        <h2>So wird gedruckt</h2>
        <label class="tog" data-tip={TIPS.stack}><input type="checkbox" bind:checked={o.stack}> Platten stapeln (PLA + PETG)</label>
        {#if o.stack}
          <div class="f" data-tip={TIPS.sepStyle}>Trennung zwischen den Platten
            <div class="seg">
              <button type="button" aria-pressed={o.sepStyle !== 'flip'} onclick={() => (o.sepStyle = 'grow')}>Aus Stegspitze</button>
              <button type="button" aria-pressed={o.sepStyle === 'flip'} onclick={() => (o.sepStyle = 'flip')} data-tip={TIPS.flip}>Wendeplatte</button>
            </div>
          </div>
          {#if o.sepStyle === 'flip'}<p class="hint">Jede zweite Platte wird aus <b class="pe">PETG kopfüber</b> gedruckt und trennt die PLA-Platten. Nach dem Druck umdrehen, dann ist sie eine normale Grundplatte. Die Leisten sind dann 4,65 mm hoch und wechseln im Turm genauso zwischen PLA und <b class="pe">PETG</b>. In der 3D-Ansicht orange.</p>{/if}
        {/if}
        {#if !R.error}
          <div class="jobs">
            {#each R.stacks as s, i (s.label + i)}
              {@const m = P.mesh('S:' + i)}
              <div class="job">
                <div class="jh"><span class="tag">{s.label}</span><b>{jobWhat(s)}</b></div>
                <div class="jm">Höhe {fmt(m.height, 1)} mm{#if petgOf(i)} · PETG {fmt(petgOf(i), 0)} g{/if}</div>
                <button class="ghost" type="button" onclick={() => zipJob(i)} data-tip={TIPS.job}>Druckdatei ↓</button>
                {#if busy['job' + i]}<span class="msg">{busy['job' + i]}</span>{/if}
              </div>
            {/each}
          </div>
          <details class="more"><summary>So druckst du in Bambu Studio</summary>
            <ol>
              <li>Die 3MF des Druckbetts öffnen. PLA-Teil = Filament 1, PETG-Teil = Filament 2. Ausweichweg: <code>…_PLA.stl</code> und <code>…_PETG.stl</code> zusammen importieren und „als ein Objekt mit mehreren Teilen“ laden.</li>
              <li>X2D: PLA auf die linke Düse, PETG auf die rechte.</li>
              <li>Stützen aus, die Trennschichten sind schon im Modell. Prime-Tower an, Schichthöhe 0,2 mm.</li>
              <li>Nach dem Druck den Stapel von oben nach unten auseinanderziehen.</li>
            </ol>
          </details>
          <details class="more"><summary>Teileliste</summary>
            <table>
              <tbody>
                {#each R.types as t}
                  <tr><td><span class="tag">{t.label}</span> Platte</td><td class="n">{cellsOf(t.rep)}</td><td class="n">{fmt(t.rep.w)} × {fmt(t.rep.d)}</td><td class="n">{t.pieces.length}×</td></tr>
                {/each}
                {#each R.spacers.types as t}
                  <tr><td><span class="tag">{t.label}</span> Leiste</td><td class="n">–</td><td class="n">{fmt(t.w, 1)} × {fmt(t.d, 1)}</td><td class="n">{t.items.length}×</td></tr>
                {/each}
              </tbody>
            </table>
          </details>
        {/if}
      {/if}

      {#if R.error}
        <p class="err">{R.error}</p>
      {:else if S}
        <div class="stats">
          <div><b>{S.nx} × {S.ny}</b><span>Felder</span></div>
          <div><b>{S.plates}{S.spacers ? ' + ' + S.spacers : ''}</b><span>Platten{S.spacers ? ' + Leisten' : ''}</span></div>
          <div><b>{S.jobs}</b><span>{S.jobs === 1 ? 'Druckjob' : 'Druckjobs'}</span></div>
          {#if step === 3}<div><b>{fmt(S.pla, 0)} g</b><span>PLA</span></div>{#if S.petg}<div><b>{fmt(S.petg, 0)} g</b><span>PETG{S.flips ? ` · ${S.flips} Platten` : ''}{S.flipSp ? ` + ${S.flipSp} Leisten` : ''}</span></div>{/if}{/if}
        </div>
      {/if}

      {#if step < 3}
        <button class="go" type="button" disabled={!!R.error} onclick={() => go(step + 1)}>Weiter: {steps[step]} <span>→</span></button>
      {:else}
        <button class="go" type="button" disabled={!!R.error} onclick={zipAll} data-tip={TIPS.zip}>Alles als ZIP <span>↓</span></button>
        {#if busy.all}<p class="msg c">{busy.all}</p>{/if}
      {/if}
      <button class="profi-btn" type="button" onclick={() => (profi = true)} data-tip={TIPS.profi}>⚙ Profi-Einstellungen</button>
    </div>
    {/key}
  </aside>

  <section class="card" class:hidden={!card && step === 3}>
    <canvas bind:this={mini} aria-label={card ? 'Gewähltes Teil in 3D' : 'Druckbetten in der Übersicht'}></canvas>
    {#if card}
      <div class="ch"><span class="tag">{card.tag}</span><b>{card.title}</b>{#if card.sub}<em>{card.sub}</em>{/if}<button class="x" type="button" aria-label="Auswahl schließen" onclick={() => (sel = null)}>×</button></div>
      <dl>{#each card.rows as [k, v]}<dt>{k}</dt><dd>{v}</dd>{/each}</dl>
      {#if card.j}
        {@const j = card.j}
        <div class="cj">{jobName(R.stacks[j.i])}{j.of > 1 ? ` · Ebene ${j.level + 1}/${j.of}` : ''}{j.flip ? ' · PETG kopfüber' : ''}
          <button class="ghost" type="button" onclick={() => zipJob(j.i)} data-tip={TIPS.job}>↓</button></div>
      {/if}
    {:else}
      <div class="ch"><b>Druckansicht</b><em>{S ? `${S.jobs} ${S.jobs === 1 ? 'Druckbett' : 'Druckbetten'}` : ''}</em></div>
      <p class="mut">Teil in der 3D-Ansicht anklicken für Maße und Druckjob.</p>
    {/if}
  </section>

  <div class="scrim" class:on={profi} onclick={() => (profi = false)} role="presentation"></div>
  <aside class="drawer" class:on={profi} aria-hidden={!profi}>
    <div class="dh"><b>Profi-Einstellungen</b><button class="x" type="button" aria-label="Schließen" onclick={() => (profi = false)}>×</button></div>
    <div class="f" data-tip={TIPS.spacerStyle}>Leistenform
      <div class="seg">
        <button type="button" aria-pressed={o.spacerStyle === 'ladder'} onclick={() => (o.spacerStyle = 'ladder')}>Leiter (sparsam)</button>
        <button type="button" aria-pressed={o.spacerStyle === 'solid'} onclick={() => (o.spacerStyle = 'solid')}>voll</button>
      </div>
    </div>
    <div class="f" data-tip={TIPS.sepStyle}>PETG-Trennschicht
      <div class="seg wrap">
        {#each [['grow', 'Aus Stegspitze'], ['flip', 'Wendeplatte'], ['ring', 'Netz'], ['wedge', 'Netz + Keil'], ['sheet', 'Folie']] as [v, l]}
          <button type="button" aria-pressed={o.sepStyle === v} onclick={() => (o.sepStyle = v as Opts['sepStyle'])}>{l}</button>
        {/each}
      </div>
    </div>
    <div class="grid2">
      {#each PROFI as [k, l, st, mn]}
        {@const locked = k === 'spacerH' && o.stack && o.sepStyle === 'flip'}
        <label class="f" data-tip={locked ? 'Bei Wendeplatte sind die Leisten so hoch wie eine Platte (4,65 mm), damit PLA und PETG auf denselben Höhen wechseln.' : TIPS[k]}>{l}<input type="number" step={st} min={mn} bind:value={o[k] as number} disabled={locked}></label>
      {/each}
    </div>
    <p class="hint">Bambu Lab X2D im Zwei-Düsen-Druck: 235,5 × 256 × 256 mm.</p>
  </aside>
</div>

<style>
  .planer { position: fixed; inset: 0; background: #000; color: var(--ink); font-family: var(--f-ui); overflow: hidden; }
  .stage { position: absolute; inset: 0; width: 100%; height: 100%; display: block; touch-action: none; cursor: grab; }
  .top { position: absolute; left: 0; right: 0; top: 0; display: flex; align-items: center; gap: 14px 20px; padding: 16px max(20px, env(safe-area-inset-right, 0px)) 0 max(20px, env(safe-area-inset-left, 0px)); pointer-events: none; flex-wrap: wrap; }
  .top > * { pointer-events: auto; }
  .pill { background: rgba(255,255,255,.06); border: 1px solid rgba(255,255,255,.1); color: var(--ink); font: 500 14px var(--f-ui); padding: 8px 14px; border-radius: 999px; cursor: pointer; }
  .pill:hover { background: rgba(255,255,255,.12); }
  .brand { font: 600 12px var(--f-mono); letter-spacing: .28em; text-transform: uppercase; color: #8f867c; }
  .brand span { color: var(--accent); }
  .brand em { font-style: normal; letter-spacing: .04em; text-transform: none; color: var(--muted); margin-left: 12px; font-weight: 500; }
  .steps { margin-left: auto; margin-right: auto; display: flex; gap: 4px; background: rgba(18,14,11,.72); border: 1px solid var(--line); border-radius: 999px; padding: 4px; backdrop-filter: blur(14px); -webkit-backdrop-filter: blur(14px); }
  .steps button { background: none; border: 0; color: var(--muted); font: 600 14px var(--f-ui); padding: 7px 14px 7px 8px; border-radius: 999px; cursor: pointer; display: flex; align-items: center; gap: 8px; transition: background .2s, color .2s; }
  .steps b { width: 22px; height: 22px; border-radius: 50%; display: grid; place-items: center; font: 600 12px var(--f-mono); background: rgba(255,255,255,.07); }
  .steps button.done { color: var(--ink); } .steps button.done b { background: rgba(242,166,90,.18); color: var(--accent); }
  .steps button.on { background: var(--accent); color: var(--accent-ink); } .steps button.on b { background: rgba(0,0,0,.15); }

  .htip { position: fixed; z-index: 30; pointer-events: none; background: rgba(18,14,11,.9); border: 1px solid var(--line); border-radius: 8px; padding: 6px 10px; font: 500 13px var(--f-mono); color: var(--ink); white-space: nowrap; }

  .panel { position: absolute; right: max(20px, env(safe-area-inset-right, 0px)); top: 76px; bottom: 20px; width: min(380px, calc(100vw - 40px)); overflow-y: auto; background: rgba(18,14,11,.74); backdrop-filter: blur(18px); -webkit-backdrop-filter: blur(18px); border: 1px solid rgba(255,255,255,.08); border-radius: 18px; box-shadow: 0 30px 80px rgba(0,0,0,.6); }
  .pane { padding: 24px 22px 18px; display: flex; flex-direction: column; gap: 14px; animation: in .45s cubic-bezier(.2,.8,.2,1); }
  @keyframes in { from { opacity: 0; transform: translateX(14px); } to { opacity: 1; transform: none; } }
  .kick { font: 600 11px var(--f-mono); letter-spacing: .24em; text-transform: uppercase; color: var(--accent); }
  h2 { font-size: 24px; font-weight: 800; letter-spacing: -.02em; line-height: 1.15; margin: -4px 0 4px; color: #fff; text-transform: none; }
  .dims { display: flex; align-items: flex-end; gap: 10px; }
  .dims label { flex: 1; display: flex; flex-direction: column; gap: 6px; font-size: 12px; color: #8f867c; min-width: 0; }
  .in { display: flex; align-items: baseline; gap: 6px; border-bottom: 2px solid rgba(255,255,255,.14); transition: border-color .2s; }
  .in:focus-within { border-color: var(--accent); }
  .in input { all: unset; width: 100%; min-width: 0; font: 600 34px var(--f-mono); color: #fff; padding: 2px 0 6px; -moz-appearance: textfield; appearance: textfield; }
  .in input::-webkit-outer-spin-button, .in input::-webkit-inner-spin-button { -webkit-appearance: none; margin: 0; }
  .in em { font: 500 13px var(--f-mono); font-style: normal; color: #8f867c; }
  .x { font: 400 22px var(--f-mono); color: #5e564e; padding-bottom: 12px; }
  .hint { font-size: 13px; color: var(--muted); margin: 0; line-height: 1.45; }
  .row2, .grid2 { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; }
  .f { display: flex; flex-direction: column; gap: 5px; font-size: 12.5px; color: var(--muted); min-width: 0; }
  .f input { font: 500 15px var(--f-mono); color: var(--ink); background: rgba(255,255,255,.04); border: 1px solid var(--line); border-radius: 8px; padding: 8px 9px; width: 100%; min-width: 0; }
  .f input:disabled { opacity: .45; }
  .f input:focus-visible { outline: 2px solid var(--accent); outline-offset: 0; }
  .seg { display: inline-flex; flex-wrap: nowrap; border: 1px solid var(--line); border-radius: 9px; overflow: hidden; align-self: flex-start; }
  .seg.wrap { flex-wrap: wrap; }
  .seg button { font: 500 13px var(--f-ui); background: transparent; color: var(--ink); border: 0; padding: 8px 11px; cursor: pointer; }
  .seg button[aria-pressed=true] { background: var(--accent); color: var(--accent-ink); }
  .tog { display: flex; gap: 10px; align-items: center; font-size: 14px; cursor: pointer; }
  .tog input { width: 18px; height: 18px; accent-color: var(--accent); }
  .posrow { display: flex; gap: 16px; align-items: center; }
  .posrow > div:last-child { display: flex; flex-direction: column; gap: 2px; }
  .posrow b { font-size: 18px; }
  .lbl { font-size: 12.5px; color: var(--muted); }
  .pos { display: grid; grid-template-columns: repeat(3, 30px); grid-template-rows: repeat(3, 30px); gap: 5px; padding: 7px; border: 2px solid rgba(255,255,255,.35); border-radius: 8px; flex: none; }
  .pos button { border: 1px solid var(--line); background: rgba(255,255,255,.05); border-radius: 5px; cursor: pointer; padding: 0; transition: background .2s; }
  .pos button:hover { background: rgba(242,166,90,.25); }
  .pos button[aria-pressed=true] { background: var(--accent); border-color: var(--accent); box-shadow: 0 0 14px rgba(242,166,90,.5); }
  .stats { display: flex; gap: 8px; flex-wrap: wrap; }
  .stats div { flex: 1 1 70px; background: rgba(255,255,255,.04); border: 1px solid rgba(255,255,255,.06); border-radius: 10px; padding: 8px 10px; }
  .stats b { display: block; font: 600 18px var(--f-mono); color: #fff; white-space: nowrap; }
  .stats span { font-size: 12px; color: #8f867c; }
  .pe { color: var(--petg); font-weight: 600; }
  .err { color: var(--warn); font-weight: 600; font-size: 14px; margin: 0; }
  .go { width: 100%; border: 0; border-radius: 12px; background: var(--accent); color: var(--accent-ink); font: 700 16px var(--f-ui); padding: 15px 18px; cursor: pointer; display: flex; justify-content: center; gap: 10px; transition: transform .15s, box-shadow .2s, opacity .2s; }
  .go:hover:not(:disabled) { box-shadow: 0 0 34px rgba(242,166,90,.45); transform: translateY(-1px); }
  .go span { transition: transform .2s; } .go:hover span { transform: translateX(3px); }
  .go:disabled { opacity: .35; cursor: not-allowed; }
  .profi-btn { background: none; border: 0; color: var(--muted); font: 500 13px var(--f-ui); cursor: pointer; padding: 4px; align-self: center; }
  .profi-btn:hover { color: var(--ink); }
  .jobs { display: flex; flex-direction: column; gap: 8px; }
  .job { display: grid; grid-template-columns: 1fr auto; gap: 2px 10px; align-items: center; background: rgba(255,255,255,.04); border: 1px solid rgba(255,255,255,.07); border-radius: 12px; padding: 10px 12px; }
  .jh { display: flex; gap: 8px; align-items: center; } .jm { font: 500 12.5px var(--f-mono); color: var(--muted); grid-column: 1; }
  .job .ghost { grid-row: 1 / span 2; grid-column: 2; }
  .job .msg { grid-column: 1 / -1; }
  .tag { display: inline-block; font: 600 12px var(--f-mono); padding: 2px 7px; border-radius: 5px; background: rgba(242,166,90,.16); color: var(--accent); }
  .ghost { background: transparent; border: 1px solid var(--accent); color: var(--accent); border-radius: 8px; font: 600 13px var(--f-ui); padding: 6px 10px; cursor: pointer; }
  .ghost:hover { background: rgba(242,166,90,.12); }
  .msg { font-size: 12.5px; color: var(--muted); margin: 0; } .msg.c { text-align: center; }
  .more summary { cursor: pointer; font: 600 14px var(--f-ui); color: var(--ink); padding: 4px 0; }
  .more ol { margin: 8px 0 0; padding-left: 20px; display: flex; flex-direction: column; gap: 6px; font-size: 13.5px; color: #d9d0c5; }
  table { width: 100%; border-collapse: collapse; font-size: 13px; margin-top: 6px; }
  td { padding: 6px 4px; border-bottom: 1px solid var(--line); } td.n { font-family: var(--f-mono); white-space: nowrap; text-align: right; }

  .card { position: absolute; left: max(20px, env(safe-area-inset-left, 0px)); bottom: 20px; width: 300px; background: rgba(18,14,11,.8); backdrop-filter: blur(16px); -webkit-backdrop-filter: blur(16px); border: 1px solid rgba(255,255,255,.08); border-radius: 16px; padding: 10px; display: flex; flex-direction: column; gap: 8px; transition: opacity .3s, transform .3s; }
  .card.hidden { opacity: 0; transform: translateY(12px); pointer-events: none; }
  .card canvas { width: 100%; aspect-ratio: 16 / 10; border-radius: 10px; display: block; touch-action: none; }
  .ch { display: flex; align-items: center; gap: 8px; padding: 0 4px; } .ch em { font-style: normal; color: var(--muted); font-size: 13px; margin-left: auto; }
  .ch .x { margin-left: auto; padding: 0 4px; background: none; border: 0; cursor: pointer; color: var(--muted); font-size: 22px; line-height: 1; }
  .ch em + .x { margin-left: 4px; }
  dl { display: grid; grid-template-columns: auto 1fr; gap: 3px 12px; margin: 0; padding: 0 4px; font-size: 13px; }
  dt { color: var(--muted); } dd { margin: 0; font-family: var(--f-mono); }
  .cj { display: flex; align-items: center; gap: 8px; justify-content: space-between; font-size: 13px; color: var(--ink); padding: 4px 4px 2px; border-top: 1px solid var(--line); }
  .mut { margin: 0; padding: 0 4px 2px; font-size: 12.5px; color: var(--muted); }

  .scrim { position: absolute; inset: 0; background: rgba(0,0,0,.45); opacity: 0; pointer-events: none; transition: opacity .3s; }
  .scrim.on { opacity: 1; pointer-events: auto; }
  .drawer { position: absolute; top: 0; right: 0; bottom: 0; width: min(420px, 100vw); background: #0f0c0a; border-left: 1px solid var(--line); padding: 22px; display: flex; flex-direction: column; gap: 16px; overflow-y: auto; transform: translateX(100%); transition: transform .45s cubic-bezier(.2,.8,.2,1); }
  .drawer.on { transform: none; }
  .dh { display: flex; align-items: center; justify-content: space-between; font-size: 18px; }
  .dh .x { background: none; border: 0; color: var(--muted); font-size: 26px; cursor: pointer; padding: 0 4px; }

  /* Handy: 3D oben, darunter das Blatt mit dem Schritt */
  .planer.narrow .stage { height: 46%; }
  .planer.narrow .top { padding-top: 10px; gap: 8px; }
  .planer.narrow .brand { display: none; }
  .planer.narrow .steps { margin-right: 0; }
  .planer.narrow .steps button { padding: 6px 9px 6px 6px; font-size: 13px; }
  .planer.narrow .panel { left: 0; right: 0; top: 46%; bottom: 0; width: auto; border-radius: 18px 18px 0 0; }
  .planer.narrow .card { display: none; }
  @media (prefers-reduced-motion: reduce) { .pane { animation: none; } .drawer, .card { transition: none; } }
</style>
