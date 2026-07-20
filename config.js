// Classic script: attaches CONFIG to the global (window in pages, self in the SW).
// ponytail: every knob lives here. Linear ramp with a cap; change the numbers, not the code.
var CONFIG = {
  base: 1.0,            // seconds of delay in the first days
  step: 0.1,            // seconds added each ramp period
  rampEveryDays: 3,     // how many days between +step increments
  cap: 60,              // never wait longer than this
  continueBypassSeconds: 60, // how long YouTube stays reachable after you click Continue
  maxBooks: 3,          // how many books can be loaded at once
  startMinChars: 500,   // min block length that counts as "the book started" (auto-detect)
  // Highlight variants — each needs a matching mark.hl-<name> rule in reader.html.
  highlightVariants: ['yellow', 'green', 'pink', 'blue', 'underline'],
  // Reading appearance (global, tweakable in the reader's panel).
  readerDefaults: { fontSize: 19, lineHeight: 1.7, width: 660, theme: 'system', font: 'serif' },
  // Pro — Gumroad. proUrl is the product page; gumroadProductId is the "product ID"
  // Gumroad shows on the license-key block ("Use your product ID to verify licenses").
  proUrl: 'https://shaahid82.gumroad.com/l/nnrwcr',
  gumroadProductId: 'AK2AtR6DqA9jRsYQk2wPMQ==',
};
