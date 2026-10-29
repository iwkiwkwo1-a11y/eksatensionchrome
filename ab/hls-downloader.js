// HLS Stream Downloader & Segment Merger Engine for Extension "ab"

class HlsDownloader {
  constructor(options = {}) {
    this.onProgress = options.onProgress || (() => {});
    this.onError = options.onError || (() => {});
    this.onComplete = options.onComplete || (() => {});
    this.activeTask = null;
  }

  async downloadHlsStream(m3u8Url, pageReferrer = 'https://missav.ws/') {
    try {
      this.onProgress({ status: 'fetching_playlist', percent: 0, text: 'Fetching M3U8 Playlist...' });

      // Fetch playlist
      const playlistText = await this.fetchWithHeader(m3u8Url, pageReferrer);
      let segmentUrls = this.parseM3u8(playlistText, m3u8Url);

      // If master playlist, resolve variant stream
      if (segmentUrls.isMaster && segmentUrls.variantUrls.length > 0) {
        const selectedVariant = segmentUrls.variantUrls[0];
        this.onProgress({ status: 'fetching_variant', percent: 5, text: `Loading quality variant...` });
        const variantText = await this.fetchWithHeader(selectedVariant, pageReferrer);
        segmentUrls = this.parseM3u8(variantText, selectedVariant);
      }

      if (!segmentUrls.segments || segmentUrls.segments.length === 0) {
        throw new Error('No valid TS video segments found in playlist.');
      }

      const total = segmentUrls.segments.length;
      this.onProgress({ status: 'downloading_segments', percent: 10, total, current: 0, text: `Downloading 0/${total} segments...` });

      const buffers = [];
      const concurrency = 3;
      let completed = 0;

      // Download segments in chunks
      for (let i = 0; i < total; i += concurrency) {
        const batch = segmentUrls.segments.slice(i, i + concurrency);
        const results = await Promise.all(batch.map(async (segUrl) => {
          const buf = await this.fetchArrayBuffer(segUrl, pageReferrer);
          return buf;
        }));

        buffers.push(...results);
        completed += batch.length;
        const percent = Math.min(95, Math.round(10 + (completed / total) * 85));
        this.onProgress({
          status: 'downloading_segments',
          percent,
          total,
          current: completed,
          text: `Downloading ${completed}/${total} segments (${percent}%)`
        });
      }

      // Merge Uint8Array buffers
      this.onProgress({ status: 'merging', percent: 96, text: 'Merging video segments into TS file...' });
      const totalLength = buffers.reduce((acc, b) => acc + b.byteLength, 0);
      const combined = new Uint8Array(totalLength);
      let offset = 0;
      for (const b of buffers) {
        combined.set(new Uint8Array(b), offset);
        offset += b.byteLength;
      }

      const blob = new Blob([combined], { type: 'video/mp2t' });
      this.onProgress({ status: 'complete', percent: 100, text: 'Download complete!' });
      this.onComplete(blob);
      return blob;

    } catch (err) {
      console.error('HLS Download Error:', err);
      this.onError(err.message || 'Failed to download HLS video');
    }
  }

  async fetchWithHeader(url, referrer) {
    const res = await fetch(url, {
      headers: {
        'Accept': '*/*',
        'Referer': referrer || url
      }
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}: ${res.statusText}`);
    return await res.text();
  }

  async fetchArrayBuffer(url, referrer) {
    const res = await fetch(url, {
      headers: {
        'Accept': '*/*',
        'Referer': referrer || url
      }
    });
    if (!res.ok) throw new Error(`HTTP ${res.status} fetching segment`);
    return await res.arrayBuffer();
  }

  parseM3u8(text, baseUrl) {
    const lines = text.split('\n').map(l => l.trim()).filter(Boolean);
    const isMaster = lines.some(l => l.startsWith('#EXT-X-STREAM-INF'));

    if (isMaster) {
      const variantUrls = [];
      for (let i = 0; i < lines.length; i++) {
        if (lines[i].startsWith('#EXT-X-STREAM-INF')) {
          if (i + 1 < lines.length && !lines[i + 1].startsWith('#')) {
            variantUrls.push(this.resolveUrl(lines[i + 1], baseUrl));
          }
        }
      }
      return { isMaster: true, variantUrls, segments: [] };
    }

    const segments = [];
    for (let i = 0; i < lines.length; i++) {
      if (!lines[i].startsWith('#')) {
        segments.push(this.resolveUrl(lines[i], baseUrl));
      }
    }
    return { isMaster: false, variantUrls: [], segments };
  }

  resolveUrl(relative, base) {
    try {
      return new URL(relative, base).href;
    } catch (e) {
      return relative;
    }
  }
}

if (typeof module !== 'undefined') {
  module.exports = HlsDownloader;
}
