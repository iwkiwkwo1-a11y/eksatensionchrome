// Service worker background script for extension "ab"

const tabMediaMap = {};

function isValidMediaUrl(url) {
  if (!url || typeof url !== 'string') return false;
  const trimmed = url.trim();
  if (trimmed.startsWith('javascript:') || trimmed.startsWith('blob:') || trimmed.startsWith('data:')) return false;
  if (trimmed.includes('${') || trimmed.includes('item.dvd_id') || trimmed.includes('cdnUrl(')) return false;
  if (!trimmed.startsWith('http://') && !trimmed.startsWith('https://')) return false;
  return true;
}

function addMediaItem(tabId, item) {
  if (!tabId || tabId < 0) return;
  if (!isValidMediaUrl(item.url)) return;

  if (!tabMediaMap[tabId]) {
    tabMediaMap[tabId] = [];
  }

  // Prevent duplicate URLs per tab
  const exists = tabMediaMap[tabId].some(m => m.url === item.url);
  if (!exists) {
    const isHls = item.url.includes('.m3u8');
    const isPreview = item.url.includes('preview.mp4') || item.category === 'preview';

    tabMediaMap[tabId].push({
      ...item,
      category: isHls ? 'main' : (isPreview ? 'preview' : (item.category || 'video')),
      id: Date.now().toString(36) + Math.random().toString(36).substring(2, 5),
      timestamp: Date.now()
    });

    const count = tabMediaMap[tabId].length;
    chrome.action.setBadgeText({ tabId, text: count > 0 ? count.toString() : '' });
    chrome.action.setBadgeBackgroundColor({ tabId, color: '#2196F3' });

    chrome.storage.local.set({ [`media_${tabId}`]: tabMediaMap[tabId] });
  }
}

// Network Request Listener
chrome.webRequest.onBeforeRequest.addListener(
  (details) => {
    const url = details.url;
    if (!url || !isValidMediaUrl(url)) return;

    const lowerUrl = url.toLowerCase();
    const isM3u8 = lowerUrl.includes('.m3u8');
    const isMp4 = lowerUrl.includes('.mp4');

    if (isM3u8 || isMp4 || details.type === 'media') {
      addMediaItem(details.tabId, {
        url: url,
        type: isM3u8 ? 'hls' : 'mp4',
        source: 'network',
        method: details.method || 'GET'
      });
    }
  },
  { urls: ['<all_urls>'] }
);

// Tab cleanup
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

// Download Manager tracking
const downloadsStore = {};

chrome.downloads.onCreated.addListener((downloadItem) => {
  downloadsStore[downloadItem.id] = {
    id: downloadItem.id,
    url: downloadItem.url,
    filename: downloadItem.filename || downloadItem.url.split('/').pop().split('?')[0] || 'media_file',
    fileSize: downloadItem.fileSize,
    bytesReceived: downloadItem.bytesReceived,
    state: downloadItem.state, // in_progress, interrupted, complete
    paused: downloadItem.paused,
    error: downloadItem.error,
    startTime: Date.now()
  };
});

chrome.downloads.onChanged.addListener((delta) => {
  if (!downloadsStore[delta.id]) return;
  const item = downloadsStore[delta.id];

  if (delta.bytesReceived) item.bytesReceived = delta.bytesReceived.current;
  if (delta.totalBytes) item.fileSize = delta.totalBytes.current;
  if (delta.state) item.state = delta.state.current;
  if (delta.paused) item.paused = delta.paused.current;
  if (delta.error) item.error = delta.error.current;
  if (delta.filename) item.filename = delta.filename.current;
});

// Communication
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  const tabId = sender.tab ? sender.tab.id : message.tabId;

  if (message.action === 'DOM_MEDIA_DETECTED') {
    if (message.items && Array.isArray(message.items)) {
      message.items.forEach(item => {
        addMediaItem(tabId, {
          url: item.url,
          type: item.type || 'video',
          category: item.category,
          source: 'dom',
          title: item.title || ''
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
      const filename = message.filename || message.url.split('/').pop().split('?')[0] || 'media_video';
      chrome.downloads.download({
        url: message.url,
        filename: filename,
        saveAs: false
      }, (downloadId) => {
        if (chrome.runtime.lastError) {
          sendResponse({ success: false, error: chrome.runtime.lastError.message });
        } else {
          sendResponse({ success: true, downloadId });
        }
      });
      return true;
    }
  } else if (message.action === 'GET_DOWNLOADS') {
    chrome.downloads.search({ limit: 20, orderBy: ['-startTime'] }, (items) => {
      sendResponse({ downloads: items || [] });
    });
    return true;
  } else if (message.action === 'PAUSE_DOWNLOAD') {
    chrome.downloads.pause(message.downloadId, () => sendResponse({ success: true }));
    return true;
  } else if (message.action === 'RESUME_DOWNLOAD') {
    chrome.downloads.resume(message.downloadId, () => sendResponse({ success: true }));
    return true;
  } else if (message.action === 'CANCEL_DOWNLOAD') {
    chrome.downloads.cancel(message.downloadId, () => sendResponse({ success: true }));
    return true;
  }
});
