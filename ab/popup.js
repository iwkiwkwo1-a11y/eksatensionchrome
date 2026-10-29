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

  // Setup Filter Buttons
  document.querySelectorAll('.filter-btn').forEach(btn => {
    btn.addEventListener('click', (e) => {
      document.querySelectorAll('.filter-btn').forEach(b => b.classList.remove('active'));
      e.target.classList.add('active');
      activeFilter = e.target.getAttribute('data-filter');
      renderMediaItems();
    });
  });

  // Setup Clear Button
  document.getElementById('clear-btn').addEventListener('click', () => {
    if (!currentTabId) return;
    chrome.runtime.sendMessage({ action: 'CLEAR_MEDIA_LIST', tabId: currentTabId }, () => {
      currentMediaList = [];
      renderMediaItems();
    });
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

function renderMediaItems() {
  const mediaListContainer = document.getElementById('media-list');
  mediaListContainer.innerHTML = '';

  // Calculate counts
  const countAll = currentMediaList.length;
  const countHls = currentMediaList.filter(item => item.type === 'hls').length;
  const countMp4 = currentMediaList.filter(item => item.type === 'mp4').length;

  document.getElementById('cnt-all').textContent = countAll;
  document.getElementById('cnt-hls').textContent = countHls;
  document.getElementById('cnt-mp4').textContent = countMp4;

  // Filter items
  let filteredItems = currentMediaList;
  if (activeFilter === 'hls') {
    filteredItems = currentMediaList.filter(item => item.type === 'hls');
  } else if (activeFilter === 'mp4') {
    filteredItems = currentMediaList.filter(item => item.type === 'mp4');
  }

  if (filteredItems.length === 0) {
    mediaListContainer.innerHTML = `<div class="empty-state">No ${activeFilter === 'all' ? '' : activeFilter.toUpperCase()} media detected.</div>`;
    return;
  }

  filteredItems.forEach(item => {
    const card = document.createElement('div');
    card.className = 'media-card';

    const typeClass = item.type || 'video';
    const sourceLabel = item.source ? item.source.toUpperCase() : 'DOM';

    card.innerHTML = `
      <div class="media-card-header">
        <span class="type-tag ${typeClass}">${typeClass.toUpperCase()}</span>
        <span class="source-tag">${sourceLabel}</span>
      </div>
      <div class="media-url" title="${escapeHtml(item.url)}">${escapeHtml(item.url)}</div>
      <div class="media-actions">
        <button class="action-btn copy-btn">Copy Link</button>
        <button class="action-btn download-btn">Download</button>
      </div>
    `;

    // Copy event
    const copyBtn = card.querySelector('.copy-btn');
    copyBtn.addEventListener('click', () => {
      navigator.clipboard.writeText(item.url).then(() => {
        copyBtn.textContent = 'Copied!';
        setTimeout(() => copyBtn.textContent = 'Copy Link', 1500);
      });
    });

    // Download event
    const downloadBtn = card.querySelector('.download-btn');
    downloadBtn.addEventListener('click', () => {
      chrome.runtime.sendMessage({
        action: 'DOWNLOAD_MEDIA',
        url: item.url
      }, (res) => {
        if (res && res.success) {
          downloadBtn.textContent = 'Started!';
        } else {
          downloadBtn.textContent = 'Failed';
        }
        setTimeout(() => downloadBtn.textContent = 'Download', 1500);
      });
    });

    mediaListContainer.appendChild(card);
  });
}

function escapeHtml(str) {
  return str.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#039;");
}
