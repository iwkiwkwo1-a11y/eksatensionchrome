// Content script for extension "ab" - scans DOM for video elements and sources

function scanDOMForMedia() {
  const mediaItems = [];

  // 1. Scan <video> elements
  const videos = document.querySelectorAll('video');
  videos.forEach((video, idx) => {
    const src = video.currentSrc || video.src || video.getAttribute('src') || video.getAttribute('data-src');
    if (src && !src.startsWith('blob:') && !src.startsWith('javascript:')) {
      mediaItems.push({
        url: src,
        type: src.includes('.m3u8') ? 'hls' : 'mp4',
        title: document.title || `Video Element #${idx + 1}`
      });
    }

    // Check data-src or custom attributes like in recon (e.g. preview side/bottom)
    video.attributes && Array.from(video.attributes).forEach(attr => {
      if (attr.name.includes('src') || attr.name.includes('data-src')) {
        const val = attr.value;
        if (val && (val.includes('.mp4') || val.includes('.m3u8')) && !val.startsWith('javascript:')) {
          mediaItems.push({
            url: val,
            type: val.includes('.m3u8') ? 'hls' : 'mp4',
            title: `Attribute ${attr.name}`
          });
        }
      }
    });
  });

  // 2. Scan <source> elements
  const sources = document.querySelectorAll('source');
  sources.forEach((source) => {
    const src = source.src || source.getAttribute('src');
    if (src && !src.startsWith('blob:') && !src.startsWith('javascript:')) {
      mediaItems.push({
        url: src,
        type: src.includes('.m3u8') ? 'hls' : 'mp4',
        title: 'Source Element'
      });
    }
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
