<script lang="ts">
  // Zahlenfeld, das Komma und Punkt versteht (deutsche Tastatur, Handy).
  // Ungültiges oder leeres Feld ändert den Wert nicht; beim Verlassen wird der gültige Wert wieder angezeigt.
  let { value = $bindable(), min = -Infinity, max = Infinity, ...rest }: { value: number; min?: number; max?: number; [k: string]: any } = $props();
  let el: HTMLInputElement;
  let focused = false;
  let bad = $state(false);
  const show = (v: number) => (Number.isFinite(+v) ? String(Math.round(+v * 100) / 100).replace('.', ',') : '');
  $effect(() => { const v = value; if (el && !focused) el.value = show(v); });
  function parse() {
    const t = el.value.trim().replace(/\s/g, '').replace(',', '.');
    const x = t === '' ? NaN : Number(t);
    bad = !(Number.isFinite(x) && x >= min && x <= max);
    if (Number.isFinite(x)) value = x;
  }
</script>

<input bind:this={el} type="text" inputmode="decimal" autocomplete="off" spellcheck="false" aria-invalid={bad}
  {...rest} oninput={parse} onfocus={() => (focused = true)}
  onblur={() => { focused = false; bad = false; el.value = show(value); }}>
