importScripts('config.js');

// Record install date once (drives the growing delay) and clear any stale bypass rules.
chrome.runtime.onInstalled.addListener(async () => {
  const { installDate } = await chrome.storage.local.get('installDate');
  if (!installDate) await chrome.storage.local.set({ installDate: Date.now() });
  clearAllPasses();
});
chrome.runtime.onStartup.addListener(clearAllPasses);

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
      priority: 10, // beats the static redirect (priority 1)
      action: { type: 'allowAllRequests' },
      condition: { resourceTypes: ['main_frame'], tabIds: [tabId], requestDomains: ['youtube.com'] }
    }]
  });
  setTimeout(() => {
    chrome.declarativeNetRequest.updateSessionRules({ removeRuleIds: [tabId] });
  }, CONFIG.continueBypassSeconds * 1000);
}
