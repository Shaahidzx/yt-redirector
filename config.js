// ES module — imported by the pages, the reader, and the service worker.
// ponytail: every knob lives here; change the numbers, not the code.
export const CONFIG = {
  continueBypassSeconds: 60, // how long the site stays reachable after you click Continue
  energyGoals: [1, 2, 3, 5, 8, 13, 21, 34, 50], // sentences per energy-bar level; the last repeats
  idleMs: 60000,        // a gap longer than this between lines isn't counted as reading time
  startMinChars: 500,   // min block length that counts as "the book started" (auto-detect)
  // Reading appearance (global, tweakable in the reader's panel).
  readerDefaults: { fontSize: 19, lineHeight: 1.7, width: 660, theme: 'system', font: 'serif',
    customBg: '#faf8f3', customFg: '#2b2b2b', wpm: 300, bionic: false },
  // Reader themes: [background, text, accent?]. Buttons are generated from this list.
  // Everything after Solarized is a daisyUI palette (base-100 / base-content / primary),
  // approximated, nudged for long-form reading contrast.
  themes: {
    light: ['#faf8f3', '#2b2b2b'], dark: ['#14140f', '#d8d4c7'], sepia: ['#f4ecd8', '#5b4636'],
    nord: ['#2e3440', '#d8dee9', '#88c0d0'], solarized: ['#fdf6e3', '#586e75', '#b58900'],
    cupcake: ['#faf7f5', '#291334', '#44adb3'], retro: ['#ece3ca', '#282425', '#c4554d'],
    lofi: ['#ffffff', '#0d0d0d', '#0d0d0d'], silk: ['#f7f5f3', '#4b4743', '#1c1c29'],
    caramellatte: ['#fff7ed', '#7c2d12', '#b45309'], valentine: ['#fae7f4', '#632c3b', '#e96d7b'],
    garden: ['#e9e7e7', '#100f0f', '#d4006a'], autumn: ['#f1f1f1', '#141414', '#8c0327'],
    winter: ['#ffffff', '#394e6a', '#047aff'], emerald: ['#ffffff', '#333c4d', '#2e9e5b'],
    coffee: ['#20161f', '#c59f60', '#db924b'], dracula: ['#282a36', '#f8f8f2', '#ff79c6'],
    night: ['#0f172a', '#cbd5e1', '#38bdf8'], dim: ['#2a303c', '#b2ccd6', '#9fe88d'],
    forest: ['#171212', '#cac9c9', '#1eb854'], sunset: ['#121c22', '#9fb9d0', '#ff865b'],
    synthwave: ['#1a103d', '#f9f7fd', '#e779c1'], luxury: ['#09090b', '#dca54c', '#ffffff'],
  },
};
