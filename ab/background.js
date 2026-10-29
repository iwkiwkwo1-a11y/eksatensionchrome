importScripts('hls-downloader.js');

const tabMediaMap = {};
const activeHlsDownloads = {};

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

// Intercept & Capture Network Media Requests
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
        initiator: details.initiator || 'https://missav.ws/'
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

// Communication & Advanced Downloads
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
    const mediaUrl = message.url;
    if (!mediaUrl) return;

    // Check if URL is HLS (.m3u8) -> Use HLS Segment Downloader & Merger
    if (mediaUrl.includes('.m3u8')) {
      const taskId = 'hls_' + Date.now();
      const downloader = new HlsDownloader({
        onProgress: (progress) => {
          activeHlsDownloads[taskId] = {
            id: taskId,
            url: mediaUrl,
            filename: 'video_' + Date.now() + '.ts',
            state: progress.status === 'complete' ? 'complete' : 'in_progress',
            statusText: progress.text,
            percent: progress.percent
          };
        },
        onError: (errMsg) => {
          activeHlsDownloads[taskId] = {
            id: taskId,
            url: mediaUrl,
            state: 'interrupted',
            error: errMsg,
            percent: 0
          };
        },
        onComplete: (blob) => {
          // Convert Blob to Blob URL and trigger Chrome download
          const blobUrl = URL.createObjectURL(blob);
          const filename = 'video_' + Date.now() + '.ts';
          chrome.downloads.download({
            url: blobUrl,
            filename: filename,
            saveAs: false
          });
        }
      });

      downloader.downloadHlsStream(mediaUrl, 'https://missav.ws/');
      sendResponse({ success: true, taskId, type: 'hls' });
      return true;

    } else {
      // Standard Direct / MP4 Download
      const filename = message.filename || mediaUrl.split('/').pop().split('?')[0] || 'video.mp4';
      chrome.downloads.download({
        url: mediaUrl,
        filename: filename,
        saveAs: false
      }, (downloadId) => {
        if (chrome.runtime.lastError) {
          // Fallback fetch as Blob if direct download fails due to CORS/Referer
          fetch(mediaUrl, { headers: { 'Referer': 'https://missav.ws/' } })
            .then(res => res.blob())
            .then(blob => {
              const blobUrl = URL.createObjectURL(blob);
              chrome.downloads.download({ url: blobUrl, filename, saveAs: false });
              sendResponse({ success: true, mode: 'blob' });
            })
            .catch(e => {
              sendResponse({ success: false, error: e.message });
            });
        } else {
          sendResponse({ success: true, downloadId });
        }
      });
      return true;
    }

  } else if (message.action === 'GET_DOWNLOADS') {
    chrome.downloads.search({ limit: 20, orderBy: ['-startTime'] }, (items) => {
      const hlsTasks = Object.values(activeHlsDownloads);
      sendResponse({ downloads: items || [], hlsTasks });
    });
    return true;
  }
});
