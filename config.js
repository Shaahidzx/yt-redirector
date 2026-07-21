// ES module — imported by the pages, the reader, and the service worker.
// ponytail: every knob lives here. Linear ramp with a cap; change the numbers, not the code.
export const CONFIG = {
  // The delay grows by the same PERCENTAGE every day, so consecutive days never feel
  // different. Defaults: 1s on day 0 → 5 minutes on day 100 (+5.87%/day). Pro users can
  // change these in Options → Focus; their values live in storage.local.delay.
  delay: { startSeconds: 1, targetSeconds: 300, targetDays: 100 },
  continueBypassSeconds: 60, // how long the site stays reachable after you click Continue
  maxBooks: 3,          // how many books can be loaded at once
  startMinChars: 500,   // min block length that counts as "the book started" (auto-detect)
  // Highlight variants — each needs a matching mark.hl-<name> rule in reader.html.
  highlightVariants: ['yellow', 'green', 'pink', 'blue', 'underline'],
  // Reading appearance (global, tweakable in the reader's panel).
  readerDefaults: { fontSize: 19, lineHeight: 1.7, width: 660, theme: 'system', font: 'serif',
    letterSpacing: 0, customBg: '#faf8f3', customFg: '#2b2b2b' },
  // Pro — Gumroad. proUrl is the product page; gumroadProductId is the "product ID"
  // Gumroad shows on the license-key block ("Use your product ID to verify licenses").
  proUrl: 'https://shaahid82.gumroad.com/l/nnrwcr',
  gumroadProductId: 'AK2AtR6DqA9jRsYQk2wPMQ==',
};
