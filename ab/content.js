// Content script for extension "ab" - scans DOM for valid video elements and sources

function isValidMediaUrl(url) {
  if (!url || typeof url !== 'string') return false;
  const trimmed = url.trim();
  if (trimmed.startsWith('javascript:') || trimmed.startsWith('blob:') || trimmed.startsWith('data:')) return false;
  if (trimmed.includes('${') || trimmed.includes('item.dvd_id') || trimmed.includes('cdnUrl(')) return false; // ignore unparsed code/template strings
  if (!trimmed.startsWith('http://') && !trimmed.startsWith('https://') && !trimmed.startsWith('//')) return false;
  return true;
}

function scanDOMForMedia() {
  const mediaItems = [];
  const seenUrls = new Set();

  // Helper to collect valid URLs
  const addUrl = (url, title, isPreview = false) => {
    if (!url) return;
    let fullUrl = url.trim();
    if (fullUrl.startsWith('//')) {
      fullUrl = window.location.protocol + fullUrl;
    }
    if (isValidMediaUrl(fullUrl) && !seenUrls.has(fullUrl)) {
      seenUrls.add(fullUrl);
      const isHls = fullUrl.includes('.m3u8');
      const isMp4 = fullUrl.includes('.mp4');
      const isPreviewUrl = isPreview || fullUrl.includes('preview.mp4');

      mediaItems.push({
        url: fullUrl,
        type: isHls ? 'hls' : (isMp4 ? 'mp4' : 'video'),
        category: isHls ? 'main' : (isPreviewUrl ? 'preview' : 'video'),
        title: title || document.title || 'Video'
      });
    }
  };

  // 1. Scan <video> elements
  const videos = document.querySelectorAll('video');
  videos.forEach((video, idx) => {
    const src = video.currentSrc || video.src || video.getAttribute('src');
    addUrl(src, `Video Element #${idx + 1}`);

    // Check data attributes
    if (video.attributes) {
      Array.from(video.attributes).forEach(attr => {
        if (attr.name.includes('src') || attr.name.includes('data-src')) {
          addUrl(attr.value, `Video Attribute ${attr.name}`);
        }
      });
    }
  });

  // 2. Scan <source> elements
  const sources = document.querySelectorAll('source');
  sources.forEach((source) => {
    const src = source.src || source.getAttribute('src');
    addUrl(src, 'Source Element');
  });

  // Send found DOM media items to background script
  if (mediaItems.length > 0) {
    chrome.runtime.sendMessage({
      action: 'DOM_MEDIA_DETECTED',
      items: mediaItems
    });
  }
}

// Initial scan
scanDOMForMedia();

// Observe DOM mutations for dynamically added video elements
const observer = new MutationObserver((mutations) => {
  let shouldScan = false;
  for (const mutation of mutations) {
    if (mutation.addedNodes.length > 0) {
      shouldScan = true;
      break;
    }
  }
  if (shouldScan) {
    scanDOMForMedia();
  }
});

observer.observe(document.body || document.documentElement, {
  childList: true,
  subtree: true
});
