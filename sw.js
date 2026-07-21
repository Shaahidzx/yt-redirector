import { CONFIG } from './config.js';
import { buildRedirectRules } from './logic.js';

// Record install date once (drives the growing delay) and clear any stale bypass rules.
chrome.runtime.onInstalled.addListener(async () => {
  const { installDate } = await chrome.storage.local.get('installDate');
  if (!installDate) await chrome.storage.local.set({ installDate: Date.now() });
  clearAllPasses();
  syncBlockRules();
});
chrome.runtime.onStartup.addListener(() => { clearAllPasses(); syncBlockRules(); });

// Keep the redirect rules in step with the user's blocked-site list.
chrome.storage.onChanged.addListener((changes, area) => {
  if (area === 'local' && changes.blocked) syncBlockRules();
});

// YouTube is always blocked; Pro users add their own sites on top.
async function syncBlockRules() {
  const { blocked = [] } = await chrome.storage.local.get('blocked');
  const domains = ['youtube.com', ...blocked.filter(d => d !== 'youtube.com')];
  const rules = buildRedirectRules(domains, chrome.runtime.id);
  const old = await chrome.declarativeNetRequest.getDynamicRules();
  await chrome.declarativeNetRequest.updateDynamicRules({
    removeRuleIds: old.map(r => r.id),
    addRules: rules,
  });
}

// Toolbar button: open the reader on demand (no YouTube gate) so you can read
// and keep your streak without a YouTube urge.
chrome.action.onClicked.addListener(() => {
  chrome.tabs.create({ url: chrome.runtime.getURL('reader.html?ondemand=1') });
});

async function clearAllPasses() {
  const rules = await chrome.declarativeNetRequest.getSessionRules();
  const removeRuleIds = rules.map(r => r.id);
  if (removeRuleIds.length) {
    await chrome.declarativeNetRequest.updateSessionRules({ removeRuleIds });
  }
}

// The reader page asks for a pass once its countdown finishes. We open a short,
// tab-scoped hole in the redirect so YouTube can load, then close it again.
// This is the ONLY bypass — there is no user-facing "skip".
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg.type === 'continue' && sender.tab) {
    grantPass(sender.tab.id).then(() => sendResponse({ ok: true }));
    return true; // async response
  }
});

async function grantPass(tabId) {
  // ponytail: ruleId === tabId keeps it unique per tab without bookkeeping.
  await chrome.declarativeNetRequest.updateSessionRules({
    removeRuleIds: [tabId],
    addRules: [{
      id: tabId,
      priority: 10, // beats the redirect rules (priority 1)
      // Tab-scoped and short-lived, so it covers whichever blocked site this tab was headed to.
      action: { type: 'allowAllRequests' },
      condition: { resourceTypes: ['main_frame'], tabIds: [tabId] }
    }]
  });
  setTimeout(() => {
    chrome.declarativeNetRequest.updateSessionRules({ removeRuleIds: [tabId] });
  }, CONFIG.continueBypassSeconds * 1000);
}
