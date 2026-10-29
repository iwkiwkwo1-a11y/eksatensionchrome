// Service worker background script for extension "ab"

// Map to hold detected media items per tab: tabId -> Array of media objects
const tabMediaMap = {};

function addMediaItem(tabId, item) {
  if (!tabId || tabId < 0) return;
  if (!tabMediaMap[tabId]) {
    tabMediaMap[tabId] = [];
  }

  // Prevent duplicate URLs per tab
  const exists = tabMediaMap[tabId].some(m => m.url === item.url);
  if (!exists) {
    tabMediaMap[tabId].push({
      ...item,
      id: Date.now().toString(36) + Math.random().toString(36).substring(2, 5),
      timestamp: Date.now()
    });

    // Update extension badge count for this tab
    const count = tabMediaMap[tabId].length;
    chrome.action.setBadgeText({ tabId, text: count > 0 ? count.toString() : '' });
    chrome.action.setBadgeBackgroundColor({ tabId, color: '#4CAF50' });

    // Sync to storage for persistence
    chrome.storage.local.set({ [`media_${tabId}`]: tabMediaMap[tabId] });
  }
}

// Network Request Listener for media streams
chrome.webRequest.onBeforeRequest.addListener(
  (details) => {
    const url = details.url;
    if (!url) return;

    const lowerUrl = url.toLowerCase();
    const isM3u8 = lowerUrl.includes('.m3u8');
    const isMp4 = lowerUrl.includes('.mp4');
    const isMedia = details.type === 'media' || isM3u8 || isMp4;

    if (isMedia) {
      let mediaType = 'video';
      if (isM3u8) mediaType = 'hls';
      else if (isMp4) mediaType = 'mp4';

      addMediaItem(details.tabId, {
        url: url,
        type: mediaType,
        source: 'network',
        method: details.method || 'GET',
        initiator: details.initiator || ''
      });
    }
  },
  { urls: ['<all_urls>'] }
);

// Clean up when a tab is closed or navigated
chrome.tabs.onRemoved.addListener((tabId) => {
  delete tabMediaMap[tabId];
  chrome.storage.local.remove([`media_${tabId}`]);
});

chrome.tabs.onUpdated.addListener((tabId, changeInfo) => {
  if (changeInfo.status === 'loading') {
    tabMediaMap[tabId] = [];
    chrome.action.setBadgeText({ tabId, text: '' });
    chrome.storage.local.remove([`media_${tabId}`]);
  }
});

// Communication with Content Scripts and Popup
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  const tabId = sender.tab ? sender.tab.id : message.tabId;

  if (message.action === 'DOM_MEDIA_DETECTED') {
    if (message.items && Array.isArray(message.items)) {
      message.items.forEach(item => {
        addMediaItem(tabId, {
          url: item.url,
          type: item.type || 'video',
          source: 'dom',
          title: item.title || '',
          attributes: item.attributes || {}
        });
      });
    }
    sendResponse({ status: 'ok' });
  } else if (message.action === 'GET_MEDIA_LIST') {
    const list = tabMediaMap[tabId] || [];
    sendResponse({ items: list });
  } else if (message.action === 'CLEAR_MEDIA_LIST') {
    tabMediaMap[tabId] = [];
    chrome.action.setBadgeText({ tabId, text: '' });
    chrome.storage.local.remove([`media_${tabId}`]);
    sendResponse({ status: 'cleared' });
  } else if (message.action === 'DOWNLOAD_MEDIA') {
    if (message.url) {
      const filename = message.filename || message.url.split('/').pop().split('?')[0] || 'media_file';
      chrome.downloads.download({
        url: message.url,
        filename: filename,
        saveAs: true
      }, (downloadId) => {
        if (chrome.runtime.lastError) {
          sendResponse({ success: false, error: chrome.runtime.lastError.message });
        } else {
          sendResponse({ success: true, downloadId });
        }
      });
      return true; // async response
    }
  }
});
