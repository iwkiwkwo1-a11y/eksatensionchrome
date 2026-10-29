// popup.js for extension "ab"

let currentTabId = null;
let currentMediaList = [];
let activeFilter = 'all';

document.addEventListener('DOMContentLoaded', async () => {
  // Query active tab
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (tab) {
    currentTabId = tab.id;
    loadMediaItems();
  }

  // Navigation Tabs (Sniffer vs Downloads)
  document.querySelectorAll('.nav-tab').forEach(tabBtn => {
    tabBtn.addEventListener('click', (e) => {
      document.querySelectorAll('.nav-tab').forEach(b => b.classList.remove('active'));
      document.querySelectorAll('.tab-content').forEach(c => c.classList.remove('active'));

      tabBtn.classList.add('active');
      const targetTab = tabBtn.getAttribute('data-tab');
      document.getElementById(`tab-${targetTab}`).classList.add('active');

      if (targetTab === 'downloads') {
        loadDownloads();
      }
    });
  });

  // Sniffer Filter Chips
  document.querySelectorAll('.chip').forEach(chip => {
    chip.addEventListener('click', (e) => {
      document.querySelectorAll('.chip').forEach(c => c.classList.remove('active'));
      chip.classList.add('active');
      activeFilter = chip.getAttribute('data-filter');
      renderMediaItems();
    });
  });

  // Batch buttons
  document.getElementById('copy-all-btn').addEventListener('click', () => {
    const filtered = getFilteredMedia();
    if (filtered.length === 0) return;
    const links = filtered.map(item => item.url).join('\n');
    navigator.clipboard.writeText(links).then(() => {
      const btn = document.getElementById('copy-all-btn');
      btn.textContent = 'Copied!';
      setTimeout(() => btn.textContent = 'Copy All', 1500);
    });
  });

  document.getElementById('download-all-btn').addEventListener('click', () => {
    const filtered = getFilteredMedia();
    if (filtered.length === 0) return;
    filtered.forEach(item => {
      chrome.runtime.sendMessage({ action: 'DOWNLOAD_MEDIA', url: item.url });
    });
    const btn = document.getElementById('download-all-btn');
    btn.textContent = 'Queued!';
    setTimeout(() => btn.textContent = 'Download All', 1500);
  });

  document.getElementById('clear-btn').addEventListener('click', () => {
    if (!currentTabId) return;
    chrome.runtime.sendMessage({ action: 'CLEAR_MEDIA_LIST', tabId: currentTabId }, () => {
      currentMediaList = [];
      renderMediaItems();
    });
  });

  document.getElementById('refresh-downloads-btn').addEventListener('click', () => {
    loadDownloads();
  });
});

function loadMediaItems() {
  if (!currentTabId) return;
  chrome.runtime.sendMessage({ action: 'GET_MEDIA_LIST', tabId: currentTabId }, (response) => {
    if (response && response.items) {
      currentMediaList = response.items;
    } else {
      currentMediaList = [];
    }
    renderMediaItems();
  });
}

function getFilteredMedia() {
  if (activeFilter === 'main') {
    return currentMediaList.filter(m => m.category === 'main' || m.type === 'hls');
  } else if (activeFilter === 'preview') {
    return currentMediaList.filter(m => m.category === 'preview' || m.url.includes('preview.mp4'));
  }
  return currentMediaList;
}

function renderMediaItems() {
  const container = document.getElementById('media-list');
  container.innerHTML = '';

  document.getElementById('total-media-cnt').textContent = currentMediaList.length;

  const items = getFilteredMedia();

  if (items.length === 0) {
    container.innerHTML = `<div class="empty-state">No ${activeFilter === 'all' ? '' : activeFilter} media found on this tab.</div>`;
    return;
  }

  items.forEach(item => {
    const card = document.createElement('div');
    card.className = 'card';

    const isMain = item.category === 'main' || item.type === 'hls';
    const tagClass = isMain ? 'tag-main' : (item.category === 'preview' ? 'tag-preview' : 'tag-video');
    const tagLabel = isMain ? 'MAIN HLS' : (item.category === 'preview' ? 'PREVIEW MP4' : 'MP4 VIDEO');

    card.innerHTML = `
      <div class="card-header">
        <span class="tag ${tagClass}">${tagLabel}</span>
        <span class="source-text">${(item.source || 'DOM').toUpperCase()}</span>
      </div>
      <div class="media-url" title="${escapeHtml(item.url)}">${escapeHtml(item.url)}</div>
      <div class="card-actions">
        <button class="secondary-btn copy-btn">Copy Link</button>
        <button class="primary-btn download-btn">Download</button>
      </div>
    `;

    const copyBtn = card.querySelector('.copy-btn');
    copyBtn.addEventListener('click', () => {
      navigator.clipboard.writeText(item.url).then(() => {
        copyBtn.textContent = 'Copied!';
        setTimeout(() => copyBtn.textContent = 'Copy Link', 1500);
      });
    });

    const downloadBtn = card.querySelector('.download-btn');
    downloadBtn.addEventListener('click', () => {
      chrome.runtime.sendMessage({ action: 'DOWNLOAD_MEDIA', url: item.url }, (res) => {
        downloadBtn.textContent = res && res.success ? 'Started' : 'Failed';
        setTimeout(() => downloadBtn.textContent = 'Download', 1500);
      });
    });

    container.appendChild(card);
  });
}

function loadDownloads() {
  chrome.runtime.sendMessage({ action: 'GET_DOWNLOADS' }, (response) => {
    const container = document.getElementById('download-list');
    container.innerHTML = '';

    if (!response || !response.downloads || response.downloads.length === 0) {
      container.innerHTML = '<div class="empty-state">No active or recent downloads.</div>';
      return;
    }

    response.downloads.forEach(dl => {
      const card = document.createElement('div');
      card.className = 'download-card';

      const fileName = dl.filename ? dl.filename.split('/').pop().split('\\').pop() : 'video_download';
      const percent = dl.totalBytes && dl.totalBytes > 0 ? Math.round((dl.bytesReceived / dl.totalBytes) * 100) : (dl.state === 'complete' ? 100 : 0);

      card.innerHTML = `
        <div class="download-title" title="${escapeHtml(fileName)}">${escapeHtml(fileName)}</div>
        <div class="download-progress-bar">
          <div class="download-progress-fill" style="width: ${percent}%;"></div>
        </div>
        <div class="download-meta">
          <span>Status: ${dl.state ? dl.state.toUpperCase() : 'UNKNOWN'}</span>
          <span>${percent}%</span>
        </div>
      `;

      container.appendChild(card);
    });
  });
}

function escapeHtml(str) {
  return str.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#039;");
}
