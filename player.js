  // ===== 通用：文件选择器（优先 File System Access API）=====
  /**
   * @param {{multiple?: boolean}} [opts]
   * @returns {Promise<false | FileSystemFileHandle[]>>}
   */
  const tryOpenWithPicker = async (opts = {}) => {
    const { multiple = true } = opts;
    try {
      // @ts-ignore
      if (window.showOpenFilePicker) {
        // 读取上次目录句柄
        let startIn = undefined;
        try {
          const lastDir = await HandleDB.get('last_dir');
          if (lastDir) startIn = lastDir;
        } catch {}
        // @ts-ignore
        const handles = await window.showOpenFilePicker({
          multiple,
          types: [{ description: 'Video', accept: { 'video/*': ['.mp4', '.mkv', '.webm', '.mov', '.avi', '.flv', '.m3u8'] } }],
          startIn
        });
        if (handles && handles.length > 0) {
          return handles;
        }
      }
    } catch (e) {
      console.warn('showOpenFilePicker failed', e);
    }
    return false;
  };

  /**
   * 重新绑定本地列表项：提示选择文件并更新此项为新句柄和URL
   * @param {PlaylistItem} item
   */
  async function rebindLocalItem(item) {
    const handles = await tryOpenWithPicker({ multiple: false });
    if (handles && handles.length > 0) {
      try {
        const handle = handles[0];
        const file = await handle.getFile();
        // @ts-ignore
        file.handle = handle;
        const url = URL.createObjectURL(file);
        item.url = url;
        item.title = file.name || item.title;
        item.localMeta = { name: file.name, size: file.size, lastModified: file.lastModified };
        item.sessionId = CURRENT_SESSION;
        item.hasHandle = true;
        try { await HandleDB.put(item.id, handle); } catch {}
        persistPlaylist();
        setSource(url, item.title);
        // 重新绑定后开始播放
        videoElement.play().catch(e => console.warn('Auto-play failed:', e));
        toast('已重新绑定本地文件');
        return true;
      } catch (e) {
        toast('重新绑定本地文件失败');
      }
    } else {
      toast('请重新选择本地文件以恢复播放');
    }
    return false;
  }

/*
  网盘视频播放器核心逻辑
  - 镜像翻转
  - AB 循环
  - 倍速播放
  - 全屏
  - 截图
  - 进度拖动、音量调节、键盘快捷键
  - 播放列表
*/

(() => {
  /**
   * @typedef {{ id:string, title:string, url:string, isLocal?:boolean, hasHandle?:boolean, localMeta?:{ name:string, size:number, lastModified:number }, sessionId?:string }} PlaylistItem
   */

  const videoElement = /** @type {HTMLVideoElement} */ (document.getElementById('video'));
  const videoWrapper = /** @type {HTMLDivElement} */ (document.getElementById('videoWrapper'));
  const toastElement = /** @type {HTMLDivElement} */ (document.getElementById('toast'));

  const playPauseButton = document.getElementById('playPauseBtn');
  const prevButton = document.getElementById('prevBtn');
  const nextButton = document.getElementById('nextBtn');
  const mirrorButton = document.getElementById('mirrorBtn');
  const loopBtn = document.getElementById('loopBtn');
  let mirrorMode = 'none'; // 'none' | 'h'
  let isLoopEnabled = false;
  const setAButton = document.getElementById('setAButton');
  const setBButton = document.getElementById('setBButton');
  const clearABButton = document.getElementById('clearABButton');
  const rateSelect = /** @type {HTMLSelectElement} */ (document.getElementById('rateSelect'));
  const fullscreenButton = document.getElementById('fullscreenBtn');
  const snapshotButton = document.getElementById('snapshotBtn');
  const saveABBtn = document.getElementById('saveABBtn');
  const timeLabel = document.getElementById('timeLabel');
  const seekBar = /** @type {HTMLInputElement} */ (document.getElementById('seekBar'));
  const volumeBar = /** @type {HTMLInputElement} */ (document.getElementById('volumeBar'));
  const controls = document.getElementById('controls');
  const markerAEl = /** @type {HTMLDivElement|null} */ (document.getElementById('markerA'));
  const markerBEl = /** @type {HTMLDivElement|null} */ (document.getElementById('markerB'));

  // 顶部直链输入已移除，以下保留空引用并在使用处做空值判断
  const sourceUrlInput = /** @type {HTMLInputElement|null} */ (document.getElementById('sourceUrlInput'));
  const loadSourceBtn = /** @type {HTMLButtonElement|null} */ (document.getElementById('loadSourceBtn'));
  const openFileInput = /** @type {HTMLInputElement} */ (document.getElementById('openFileInput'));
  const openFileLabel = /** @type {HTMLLabelElement} */ (document.getElementById('openFileLabel'));

  // 字幕 UI 已移除

  const playlistPanel = document.getElementById('playlistPanel');
  const playlistElement = document.getElementById('playlist');
  const addToPlaylistBtn = document.getElementById('addToPlaylistBtn');
  const playlistUrlInput = /** @type {HTMLInputElement} */ (document.getElementById('playlistUrlInput'));
  // 修复按钮已移除
  const clearPlaylistBtn = document.getElementById('clearPlaylistBtn');

  /**
   * 内部状态
   */
  /** @type {number|null} */ let loopPointASeconds = null;
  /** @type {number|null} */ let loopPointBSeconds = null;
  /** @type {boolean} */ let isUserSeeking = false;
  /** @type {boolean} */ let isMirrored = false;
  /** @type {PlaylistItem[]} */ let playlistItems = [];
  /** @type {number} */ let playlistIndex = -1;

  // 当前会话 ID，用于判断本地文件是否需要重新选择
  const CURRENT_SESSION = (() => {
    try {
      const key = 'yp_player_session';
      let sid = sessionStorage.getItem(key);
      if (!sid) {
        sid = `${Date.now()}_${Math.random().toString(36).slice(2)}`;
        sessionStorage.setItem(key, sid);
      }
      return sid;
    } catch {
      return `${Date.now()}`;
    }
  })();

  /**
   * 本地存储键名
   */
  const LS_KEYS = {
    PLAYLIST: 'yp_player_playlist',
    INDEX: 'yp_player_playlist_index',
    ENTRY_META_PREFIX: 'yp_player_entry_', // + id => { a:number|null, b:number|null, time:number, rate:number }
  };

  // ==== IndexedDB：存储本地文件句柄（FileSystemFileHandle）====
  const HandleDB = (() => {
    /** @type {IDBDatabase|null} */ let db = null;
    function open() {
      return new Promise((resolve, reject) => {
        try {
          const req = indexedDB.open('yp_player_db', 1);
          req.onupgradeneeded = () => {
            const database = req.result;
            if (!database.objectStoreNames.contains('handles')) {
              database.createObjectStore('handles', { keyPath: 'id' });
            }
          };
          req.onsuccess = () => { db = req.result; resolve(db); };
          req.onerror = () => reject(req.error);
        } catch (e) { reject(e); }
      });
    }
    async function ensure() { if (db) return db; return await open(); }
    async function put(id, handle) {
      const database = await ensure();
      return new Promise((resolve, reject) => {
        const tx = database.transaction('handles', 'readwrite');
        tx.objectStore('handles').put({ id, handle });
        tx.oncomplete = () => resolve(true);
        tx.onerror = () => reject(tx.error);
      });
    }
    async function get(id) {
      const database = await ensure();
      return new Promise((resolve, reject) => {
        const tx = database.transaction('handles', 'readonly');
        const req = tx.objectStore('handles').get(id);
        req.onsuccess = () => resolve(req.result?.handle || null);
        req.onerror = () => reject(req.error);
      });
    }
    async function del(id) {
      const database = await ensure();
      return new Promise((resolve, reject) => {
        const tx = database.transaction('handles', 'readwrite');
        tx.objectStore('handles').delete(id);
        tx.oncomplete = () => resolve(true);
        tx.onerror = () => reject(tx.error);
      });
    }
    return { put, get, del };
  })();

  function formatTime(totalSeconds) {
    if (!Number.isFinite(totalSeconds)) return '00:00';
    const s = Math.max(0, Math.floor(totalSeconds));
    const hours = Math.floor(s / 3600);
    const minutes = Math.floor((s % 3600) / 60);
    const seconds = s % 60;
    if (hours > 0) {
      return `${hours.toString().padStart(2, '0')}:${minutes
        .toString()
        .padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`;
    }
    return `${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`;
  }

  function updateTimeUI() {
    const current = videoElement.currentTime || 0;
    const duration = Number.isFinite(videoElement.duration) ? videoElement.duration : 0;
    timeLabel.textContent = `${formatTime(current)} / ${formatTime(duration)}`;
    if (!isUserSeeking) {
      const val = duration > 0 ? Math.floor((current / duration) * 1000) : 0;
      seekBar.value = String(val);
    }
  }

  function updateABMarkers() {
    if (!markerAEl || !markerBEl) return;
    const duration = Number.isFinite(videoElement.duration) ? videoElement.duration : 0;
    const seekRectProvider = () => {
      const el = /** @type {HTMLInputElement} */(seekBar);
      return el.getBoundingClientRect();
    };
    const rect = seekRectProvider();
    const width = rect.width || 0;

    if (duration > 0 && typeof loopPointASeconds === 'number') {
      const pct = Math.max(0, Math.min(100, (loopPointASeconds / duration) * 100));
      markerAEl.style.left = pct + '%';
      markerAEl.hidden = false;
    } else {
      markerAEl.hidden = true;
    }

    if (duration > 0 && typeof loopPointBSeconds === 'number') {
      const pct = Math.max(0, Math.min(100, (loopPointBSeconds / duration) * 100));
      markerBEl.style.left = pct + '%';
      markerBEl.hidden = false;
    } else {
      markerBEl.hidden = true;
    }
    if (saveABBtn) {
      const ok = duration > 0 && typeof loopPointASeconds === 'number' && typeof loopPointBSeconds === 'number' && loopPointBSeconds > loopPointASeconds;
      saveABBtn.disabled = !ok;
      saveABBtn.style.opacity = ok ? '' : '0.5';
    }
  }

  function setSource(url, title = '') {
    if (!url) return;
    // 清除AB循环
    loopPointASeconds = null;
    loopPointBSeconds = null;
    videoElement.src = url;
    // 不要恢复进度，从头开始播放
    videoElement.currentTime = 0;
    
    document.title = title ? `${title} - ReRe Player` : 'ReRe Player';
  }

  function tryPlayAfterSourceSet() {
    const tryPlay = () => {
      videoElement.play().catch(e => console.warn('Play failed (will retry on canplay):', e));
    };
    tryPlay();
    const onCanPlay = () => {
      tryPlay();
      videoElement.removeEventListener('canplay', onCanPlay);
    };
    videoElement.addEventListener('canplay', onCanPlay);
  }

  /**
   * @param {File} file
   * @param {{ selectAndPlay?: boolean }} [opts]
   */
  async function loadFile(file, opts = { selectAndPlay: true }) {
    const objectUrl = URL.createObjectURL(file);
    // 将本地文件加入播放列表（blob URL 仅当前会话有效）
    const itemUrl = objectUrl;
    /** @type {PlaylistItem} */
    const item = { id: String(Date.now()), title: file.name, url: itemUrl, isLocal: true, hasHandle: !!file.handle, localMeta: { name: file.name, size: file.size, lastModified: file.lastModified }, sessionId: CURRENT_SESSION };
    playlistItems.push(item);
    if (opts.selectAndPlay) {
      playlistIndex = playlistItems.length - 1;
      renderPlaylist();
      persistPlaylist();
      setSource(itemUrl, file.name);
    } else {
      renderPlaylist();
      persistPlaylist();
    }
    // 存储句柄（如果浏览器支持且有权限）
    try {
      // @ts-ignore: 非标准属性
      const handle = file.handle;
      if (handle && 'kind' in handle) {
        await HandleDB.put(item.id, handle);
        item.hasHandle = true;
        persistPlaylist();
      }
    } catch {}
  }

  function togglePlayPause() {
    if (videoElement.paused) {
      videoElement.play();
    } else {
      videoElement.pause();
    }
  }

  function applyMirrorMode() {
    videoWrapper.classList.toggle('mirrored', mirrorMode === 'h');
    videoWrapper.classList.remove('mirrored-v');
    mirrorButton.textContent = mirrorMode === 'h' ? '取消镜像' : '镜像';
  }
  function toggleMirror() {
    mirrorMode = mirrorMode === 'none' ? 'h' : 'none';
    applyMirrorMode();
  }

  function setLoopPointA() {
    loopPointASeconds = videoElement.currentTime;
    const aStr = formatTime(loopPointASeconds);
    if (loopPointBSeconds === null) {
      toast(`已设置 A 点: ${aStr}`);
    } else {
      toast(`已更新 A 点: ${aStr}`);
    }
    persistEntryStateDebounced();
    updateABMarkers();
  }

  function setLoopPointB() {
    if (loopPointASeconds === null) {
      loopPointBSeconds = null;
      toast('请先设置 A 点');
      return;
    }
    if (videoElement.currentTime <= loopPointASeconds) {
      loopPointBSeconds = null;
      toast('B 点需大于 A 点');
      return;
    }
    loopPointBSeconds = videoElement.currentTime;
    toast(`已设置 B 点: ${formatTime(loopPointBSeconds)}`);
    persistEntryStateDebounced();
    updateABMarkers();
  }

  function clearABLoop() {
    loopPointASeconds = null;
    loopPointBSeconds = null;
    toast('AB 循环已清除');
    persistEntryStateDebounced();
    updateABMarkers();
  }

  async function saveABSegment() {
    const duration = Number.isFinite(videoElement.duration) ? videoElement.duration : 0;
    if (!(duration > 0) || typeof loopPointASeconds !== 'number' || typeof loopPointBSeconds !== 'number' || loopPointBSeconds <= loopPointASeconds) {
      toast('请先设置有效的 A/B 点');
      return;
    }
    const A = Math.max(0, loopPointASeconds);
    const B = Math.min(duration, loopPointBSeconds);
    const src = videoElement.currentSrc || videoElement.src;
    if (!src) { toast('无可导出的源'); return; }
    // 在用户手势下，优先请求保存位置与文件名
    const tA0 = formatTime(A).replace(/:/g, '-');
    const tB0 = formatTime(B).replace(/:/g, '-');
    let pickedHandle = null;
    let pickedName = `segment_${tA0}_${tB0}.mp4`;
    try {
      // @ts-ignore
      if (window.showSaveFilePicker) {
        // @ts-ignore
        pickedHandle = await window.showSaveFilePicker({
          suggestedName: pickedName,
          types: [
            { description: 'MP4 Video', accept: { 'video/mp4': ['.mp4'] } },
            { description: 'WebM Video', accept: { 'video/webm': ['.webm'] } }
          ]
        });
        // 用户可重命名：记录最终文件名（不同浏览器不直给文件名，这里保留建议名用于回退下载名）
      }
    } catch (e) {
      // 用户取消或不支持，将在完成后回退到 a[download]
    }
    try {
      const tv = document.createElement('video');
      tv.crossOrigin = 'anonymous';
      tv.preload = 'auto';
      tv.playsInline = true;
      tv.muted = false;
      tv.src = src;

      await new Promise((res) => {
        if (Number.isFinite(tv.duration)) return res(null);
        tv.addEventListener('loadedmetadata', () => res(null), { once: true });
      });
      tv.currentTime = A;
      await new Promise((res) => tv.addEventListener('seeked', () => res(null), { once: true }));

      const capture = tv.captureStream ? tv.captureStream() : (/** @type {any} */(tv)).mozCaptureStream?.();
      if (!capture) { toast('浏览器不支持媒体捕获'); return; }

      // 优先尝试 MP4（受限于浏览器支持情况）
      let mimeOrder = [
        'video/mp4;codecs=avc1.42E01E,mp4a.40.2',
        'video/mp4',
        'video/webm;codecs=vp9,opus',
        'video/webm;codecs=vp8,opus',
        'video/webm'
      ];
      let mime = mimeOrder.find(m => MediaRecorder.isTypeSupported?.(m));
      if (!mime) mime = '';
      const recorder = mime ? new MediaRecorder(capture, { mimeType: mime }) : new MediaRecorder(capture);
      const chunks = [];
      recorder.ondataavailable = (e) => { if (e.data && e.data.size) chunks.push(e.data); };
      const stopAndSave = () => {
        try { recorder.stop(); } catch {}
      };
      recorder.onstop = () => {
        const outType = recorder.mimeType || mime || 'video/webm';
        const blob = new Blob(chunks, { type: outType });
        const tA = formatTime(A).replace(/:/g, '-');
        const tB = formatTime(B).replace(/:/g, '-');
        const ext = /mp4/i.test(outType) ? 'mp4' : 'webm';
        const defaultName = `segment_${tA}_${tB}.${ext}`;
        (async () => {
          if (pickedHandle) {
            try {
              const writable = await pickedHandle.createWritable();
              await writable.write(blob);
              await writable.close();
              toast('已保存到选择的位置');
              tv.pause();
              return;
            } catch (e) {
              console.warn('Write to picked handle failed, fallback to download', e);
            }
          }
          // 回退：a[download]
          const url = URL.createObjectURL(blob);
          const a = document.createElement('a');
          a.href = url;
          a.download = pickedName || defaultName;
          a.click();
          setTimeout(() => URL.revokeObjectURL(url), 0);
          tv.pause();
        })();
      };
      tv.addEventListener('timeupdate', () => {
        if (tv.currentTime >= B - 0.02) {
          stopAndSave();
        }
      });
      recorder.start(500);
      await tv.play();
      toast('开始导出 AB 片段');
    } catch (e) {
      toast('导出失败');
    }
  }

  function onTimeUpdate() {
    updateTimeUI();
    if (loopPointASeconds !== null && loopPointBSeconds !== null) {
      if (videoElement.currentTime > loopPointBSeconds - 0.02) {
        videoElement.currentTime = loopPointASeconds;
      }
    }
  }

  function onSeekBarInput() {
    isUserSeeking = true;
    const duration = Number.isFinite(videoElement.duration) ? videoElement.duration : 0;
    const target = (Number(seekBar.value) / 1000) * duration;
    timeLabel.textContent = `${formatTime(target)} / ${formatTime(duration)}`;
  }

  function onSeekBarChange() {
    const duration = Number.isFinite(videoElement.duration) ? videoElement.duration : 0;
    const target = (Number(seekBar.value) / 1000) * duration;
    videoElement.currentTime = target;
    isUserSeeking = false;
    persistEntryStateDebounced();
  }

  function onVolumeChange() {
    videoElement.volume = Number(volumeBar.value);
  }

  function setPlaybackRate(rate) {
    const r = Number(rate);
    if (!Number.isFinite(r) || r <= 0) return;
    videoElement.playbackRate = r;
    persistEntryStateDebounced();
  }

  function toggleFullscreen() {
    const wrapper = videoWrapper;
    const doc = document;
    if (!doc.fullscreenElement) {
      wrapper.requestFullscreen?.();
    } else {
      doc.exitFullscreen?.();
    }
  }

  function toggleLoop() {
    isLoopEnabled = !isLoopEnabled;
    videoElement.loop = isLoopEnabled;
    // 更新按钮样式或状态
    loopBtn.style.opacity = isLoopEnabled ? '1' : '0.5';
    toast(isLoopEnabled ? '已开启循环播放' : '已关闭循环播放');
  }

  function takeSnapshot() {
    const video = videoElement;
    const width = video.videoWidth || 0;
    const height = video.videoHeight || 0;
    if (!width || !height) return;
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    if (mirrorMode === 'h') {
      ctx.translate(width, 0);
      ctx.scale(-1, 1);
    } else if (mirrorMode === 'v') {
      ctx.translate(0, height);
      ctx.scale(1, -1);
    }
    ctx.drawImage(video, 0, 0, width, height);
    canvas.toBlob((blob) => {
      if (!blob) return;
      const a = document.createElement('a');
      const url = URL.createObjectURL(blob);
      a.href = url;
      a.download = `snapshot_${Date.now()}.png`;
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 0);
    }, 'image/png');
  }

  function toast(text) {
    if (!toastElement) { console.log(text); return; }
    toastElement.textContent = text;
    toastElement.classList.add('show');
    clearTimeout(toast._t);
    // @ts-ignore
    toast._t = setTimeout(() => {
      toastElement.classList.remove('show');
    }, 1400);
  }
  // 字幕相关逻辑已移除

  function bindKeyboardShortcuts() {
    window.addEventListener('keydown', (e) => {
      if ((e.target instanceof HTMLInputElement) || (e.target instanceof HTMLTextAreaElement)) return;
      
      // 播放下一个视频 (CTRL键)
      if (e.ctrlKey && !e.altKey && !e.shiftKey) {
        e.preventDefault();
        playNext();
        toast('下一个视频');
        return;
      }
      
      // 播放上一个视频 (ALT键)
      if (e.altKey && !e.ctrlKey && !e.shiftKey) {
        e.preventDefault();
        playPrev();
        toast('上一个视频');
        return;
      }
      
      switch (e.key) {
        case ' ': // Space
          e.preventDefault();
          togglePlayPause();
          break;
        case 'ArrowLeft':
          videoElement.currentTime = Math.max(0, videoElement.currentTime - 5);
          toast('后退 5 秒');
          break;
        case 'ArrowRight':
          videoElement.currentTime = Math.min(videoElement.duration || Infinity, videoElement.currentTime + 5);
          toast('前进 5 秒');
          break;
        case 'ArrowUp':
          e.preventDefault();
          const newVolume = Math.min(1, videoElement.volume + 0.05);
          videoElement.volume = newVolume;
          volumeBar.value = String(newVolume);
          toast(`音量: ${Math.round(newVolume * 100)}%`);
          break;
        case 'ArrowDown':
          e.preventDefault();
          const newVolumeDown = Math.max(0, videoElement.volume - 0.05);
          videoElement.volume = newVolumeDown;
          volumeBar.value = String(newVolumeDown);
          toast(`音量: ${Math.round(newVolumeDown * 100)}%`);
          break;
        case '[':
          setPlaybackRate(Math.max(0.25, videoElement.playbackRate - 0.25));
          rateSelect.value = String(videoElement.playbackRate);
          break;
        case ']':
          setPlaybackRate(Math.min(4, videoElement.playbackRate + 0.25));
          rateSelect.value = String(videoElement.playbackRate);
          break;
        case 'm':
        case 'M':
          videoElement.muted = !videoElement.muted;
          break;
        case 'f':
        case 'F':
          toggleFullscreen();
          break;
        case 'l':
        case 'L':
          toggleLoop();
          break;
        case 'a':
        case 'A':
          setLoopPointA();
          break;
        case 'b':
        case 'B':
          setLoopPointB();
          break;
        case 'Escape':
          // 退出 AB 循环
          clearABLoop();
          break;
        case 'r':
        case 'R':
          // 重新开始播放
          videoElement.currentTime = 0;
          toast('重新开始播放');
          break;

        default:
          break;
      }
    });
  }

  function needsLocalRebind(item) {
    // 优先使用句柄能力，如果有句柄则可跨会话恢复
    if (item.isLocal && item.hasHandle) return false;
    return !!item.isLocal && item.sessionId !== CURRENT_SESSION;
  }

  function renderPlaylist() {
    playlistElement.innerHTML = '';
    playlistItems.forEach((item, idx) => {
      const li = document.createElement('li');
      li.className = idx === playlistIndex ? 'active' : '';
      const titleSpan = document.createElement('span');
      titleSpan.textContent = item.title || item.url;
      const right = document.createElement('div');
      const playBtn = document.createElement('button');
      playBtn.textContent = '播放';
      const mustRebind = needsLocalRebind(item);
      // 对于需要重新绑定的项目，先不自动恢复，等待用户点击播放时再请求权限
      playBtn.disabled = false;
      playBtn.addEventListener('click', async () => {
        playlistIndex = idx;
        // 优先使用已有 URL 播放；仅在需要跨会话重绑时走句柄路径
        if (!needsLocalRebind(item)) {
          setSource(item.url, item.title);
          tryPlayAfterSourceSet();
        } else if (item.hasHandle) {
          try {
            const handle = await HandleDB.get(item.id);
            if (!handle) { toast('本地文件句柄缺失，无法播放'); return; }
            let perm = 'granted';
            if (handle.queryPermission) perm = await handle.queryPermission({ mode: 'read' });
            if (perm !== 'granted' && handle.requestPermission) perm = await handle.requestPermission({ mode: 'read' });
            if (perm !== 'granted') { toast('未授予文件读取权限'); return; }
            const file = await handle.getFile();
            const url = URL.createObjectURL(file);
            item.url = url;
            item.title = file.name || item.title;
            item.localMeta = { name: file.name, size: file.size, lastModified: file.lastModified };
            item.sessionId = CURRENT_SESSION;
            persistPlaylist();
            setSource(url, item.title);
            tryPlayAfterSourceSet();
          } catch {
            toast('读取本地文件失败');
            return;
          }
        } else {
          // 需要重新绑定但没有可用句柄：引导用户选择对应本地文件并自动播放
          await rebindLocalItem(item);
          return;
        }
        renderPlaylist();
        persistPlaylist();
      });
      const delBtn = document.createElement('button');
      delBtn.textContent = '删除';
      delBtn.addEventListener('click', () => {
        const removed = playlistItems.splice(idx, 1)[0];
        // 清理此条目的存储
        try { localStorage.removeItem(LS_KEYS.ENTRY_META_PREFIX + removed.id); } catch {}
        if (playlistIndex >= playlistItems.length) playlistIndex = playlistItems.length - 1;
        renderPlaylist();
        persistPlaylist();
      });
      right.appendChild(playBtn);
      right.appendChild(delBtn);
      // 点击整行（非按钮区域）选中并加载但不自动播放
      li.addEventListener('click', (ev) => {
        const target = ev.target;
        if (target instanceof HTMLButtonElement) return;
        playlistIndex = idx;
        setSource(item.url, item.title);
        renderPlaylist();
        persistPlaylist();
      });
      li.appendChild(titleSpan);
      li.appendChild(right);
      playlistElement.appendChild(li);
    });
  }

  function addToPlaylist(urls) {
    // 处理单个URL的情况
    if (typeof urls === 'string') {
      if (!urls.trim()) return;
      /** @type {PlaylistItem} */
      const item = { id: String(Date.now()), title: guessTitleFromUrl(urls), url: urls, isLocal: false };
      playlistItems.push(item);
    }
    // 处理URL数组的情况
    else if (Array.isArray(urls)) {
      urls.forEach(url => {
        if (!url.trim()) return;
        /** @type {PlaylistItem} */
        const item = { id: String(Date.now() + Math.random() * 1000), title: guessTitleFromUrl(url), url: url, isLocal: false };
        playlistItems.push(item);
      });
    }
    renderPlaylist();
    persistPlaylist();
  }

  function guessTitleFromUrl(url) {
    try {
      const u = new URL(url);
      const pathname = u.pathname || '';
      const last = pathname.split('/').filter(Boolean).pop() || url;
      return decodeURIComponent(last);
    } catch {
      return url;
    }
  }

  function playPrev() {
    if (playlistItems.length === 0) return;
    playlistIndex = (playlistIndex - 1 + playlistItems.length) % playlistItems.length;
    const item = playlistItems[playlistIndex];
    setSource(item.url, item.title);
    // 切换视频后自动播放
    videoElement.play().catch(e => console.warn('Auto-play failed:', e));
    renderPlaylist();
    persistPlaylist();
  }

  function clearPlaylist() {
    // 清除所有播放列表项的本地存储和IndexedDB数据
    playlistItems.forEach(item => {
      try { localStorage.removeItem(LS_KEYS.ENTRY_META_PREFIX + item.id); } catch {}
      if (item.hasHandle) {
        try { HandleDB.del(item.id); } catch {}
      }
    });
    
    // 清空播放列表数据
    playlistItems = [];
    playlistIndex = -1;
    
    // 更新UI和持久化存储
    renderPlaylist();
    persistPlaylist();
    
    // 显示提示
    toast('播放列表已清空');
  }

  function playNext(auto = false) {
    if (playlistItems.length === 0) return;
    if (!auto) {
      playlistIndex = (playlistIndex + 1) % playlistItems.length;
    } else {
      playlistIndex = Math.min(playlistIndex + 1, playlistItems.length - 1);
    }
    const item = playlistItems[playlistIndex];
    setSource(item.url, item.title);
    // 切换视频后自动播放
    videoElement.play().catch(e => console.warn('Auto-play failed:', e));
    renderPlaylist();
    persistPlaylist();
  }

  /**
   * 持久化：播放列表与索引
   */
  function persistPlaylist() {
    try {
      localStorage.setItem(LS_KEYS.PLAYLIST, JSON.stringify(playlistItems));
      localStorage.setItem(LS_KEYS.INDEX, String(playlistIndex));
    } catch {}
  }

  function restorePlaylist() {
    try {
      const raw = localStorage.getItem(LS_KEYS.PLAYLIST);
      const idxRaw = localStorage.getItem(LS_KEYS.INDEX);
      if (raw) {
        const arr = JSON.parse(raw);
        if (Array.isArray(arr)) {
          playlistItems = arr.filter(it => it && typeof it.url === 'string');
        }
      }
      if (idxRaw != null) {
        const idx = Number(idxRaw);
        if (Number.isInteger(idx)) playlistIndex = idx;
      }
    } catch {}
    renderPlaylist();
    // 自动恢复当前源
    if (playlistItems.length > 0 && playlistIndex >= 0 && playlistIndex < playlistItems.length) {
      const item = playlistItems[playlistIndex];
      if (item.isLocal && item.hasHandle) {
        // 静默尝试使用句柄恢复 URL（不弹权限对话框）
        HandleDB.get(item.id).then(async (handle) => {
          try {
            if (handle && (await handle.queryPermission?.({ mode: 'read' })) === 'granted') {
              const file = await handle.getFile();
              const url = URL.createObjectURL(file);
              item.url = url;
              item.title = file.name || item.title;
              item.localMeta = { name: file.name, size: file.size, lastModified: file.lastModified };
              item.sessionId = CURRENT_SESSION;
              persistPlaylist();
              setSource(url, item.title);
              renderPlaylist();
              return;
            }
          } catch {}
          // 无权限则先不自动播放，等待用户点击播放时再请求权限
          renderPlaylist();
        });
      } else if (!needsLocalRebind(item)) {
        setSource(item.url, item.title);
      } else {
        // 无句柄且跨会话，无法自动恢复
        renderPlaylist();
      }
    }
  }

  /**
   * 每条目：AB、进度、倍速
   */
  function getCurrentEntryId() {
    if (playlistIndex >= 0 && playlistIndex < playlistItems.length) return playlistItems[playlistIndex].id;
    return null;
  }

  function persistEntryState() {
    const id = getCurrentEntryId();
    if (!id) return;
    const data = {
      a: loopPointASeconds,
      b: loopPointBSeconds,
      time: Number.isFinite(videoElement.currentTime) ? Math.max(0, Math.floor(videoElement.currentTime)) : 0,
      rate: Number(videoElement.playbackRate) || 1,
    };
    try { localStorage.setItem(LS_KEYS.ENTRY_META_PREFIX + id, JSON.stringify(data)); } catch {}
  }

  const persistEntryStateDebounced = debounce(persistEntryState, 300);

  function restoreEntryState() {
    const id = getCurrentEntryId();
    if (!id) return;
    try {
      const raw = localStorage.getItem(LS_KEYS.ENTRY_META_PREFIX + id);
      if (!raw) return;
      const data = JSON.parse(raw);
      if (data) {
        loopPointASeconds = (typeof data.a === 'number') ? data.a : null;
        loopPointBSeconds = (typeof data.b === 'number') ? data.b : null;
        const rate = (typeof data.rate === 'number' && data.rate > 0) ? data.rate : 1;
        setPlaybackRate(rate);
        // 等待元数据可用再恢复进度
        const onCanPlay = () => {
          videoElement.currentTime = Math.min(videoElement.duration || Infinity, Math.max(0, Number(data.time) || 0));
          videoElement.removeEventListener('loadedmetadata', onCanPlay);
          updateTimeUI();
        };
        videoElement.addEventListener('loadedmetadata', onCanPlay);
      }
    } catch {}
  }

  function debounce(fn, wait) {
    let t;
    return function() {
      clearTimeout(t);
      // @ts-ignore
      const self = this; const args = arguments;
      t = setTimeout(() => fn.apply(self, args), wait);
    }
  }

  function initEvents() {
    playPauseButton.addEventListener('click', togglePlayPause);
    mirrorButton.addEventListener('click', toggleMirror);
    setAButton.addEventListener('click', setLoopPointA);
    setBButton.addEventListener('click', setLoopPointB);
    clearABButton.addEventListener('click', clearABLoop);
    fullscreenButton.addEventListener('click', toggleFullscreen);
    snapshotButton.addEventListener('click', takeSnapshot);
    saveABBtn?.addEventListener('click', saveABSegment);
    loopBtn.addEventListener('click', toggleLoop);

    rateSelect.addEventListener('change', () => setPlaybackRate(rateSelect.value));
    volumeBar.addEventListener('input', onVolumeChange);

    seekBar.addEventListener('input', onSeekBarInput);
    seekBar.addEventListener('change', onSeekBarChange);

    videoElement.addEventListener('timeupdate', onTimeUpdate);
    videoElement.addEventListener('durationchange', () => { updateTimeUI(); updateABMarkers(); });
    videoElement.addEventListener('loadedmetadata', () => { updateTimeUI(); updateABMarkers(); });
    videoElement.addEventListener('play', updatePlayPauseUI);
    videoElement.addEventListener('pause', updatePlayPauseUI);
    videoElement.addEventListener('ended', () => {
      if (loopPointASeconds !== null && loopPointBSeconds !== null) return;
      playNext(true);
    });

    if (loadSourceBtn && sourceUrlInput) {
      loadSourceBtn.addEventListener('click', () => {
        const url = sourceUrlInput.value.trim();
        if (url) setSource(url);
      });
    }
    // 选择文件（多选）：批量添加后将选中索引重置为本次批量的第一个

    openFileLabel?.addEventListener('click', async (e) => {
      // 先阻止 label 触发隐藏 input 的默认行为，避免双弹窗
      e.preventDefault();
      e.stopPropagation();
      const handles = await tryOpenWithPicker({ multiple: true });
      if (handles && handles.length > 0) {
        const startIndex = playlistItems.length;
        for (const handle of handles) {
          const file = await handle.getFile();
          // @ts-ignore
          file.handle = handle;
          await loadFile(file, { selectAndPlay: false });
          const current = playlistItems[playlistItems.length - 1];
          if (current) {
            try { await HandleDB.put(current.id, handle); current.hasHandle = true; persistPlaylist(); } catch {}
          }
        }
        try { await HandleDB.put('last_dir', handles[0]); } catch {}
        // 批量结束后，选中第一条新增项
        playlistIndex = startIndex;
        renderPlaylist();
        persistPlaylist();
        // 加载第一条新增视频（而不是最后一条）
        const firstNew = playlistItems[startIndex];
        if (firstNew) {
          setSource(firstNew.url, firstNew.title);
        }
        toast(`已添加 ${handles.length} 个本地视频到播放列表`);
      } else {
        // 回退到原生 <input type="file">
        openFileInput.click();
      }
    });

    openFileInput.addEventListener('change', () => {
      const files = openFileInput.files;
      if (files && files.length > 0) {
        // 先清除之前的文件选择，这有助于关闭文件选择窗口
        openFileInput.value = '';
        
        // 使用setTimeout确保文件选择窗口有足够时间关闭
        setTimeout(() => {
          const startIndex = playlistItems.length;
          // 循环处理所有选中的文件
          for (let i = 0; i < files.length; i++) {
            loadFile(files[i], { selectAndPlay: false });
          }
          // 批量结束后，选中第一条新增项
          playlistIndex = startIndex;
          renderPlaylist();
          persistPlaylist();
          const firstNew = playlistItems[startIndex];
          if (firstNew) {
            setSource(firstNew.url, firstNew.title);
          }
        }, 0);
      }
    });

    // 字幕加载入口已移除

    clearPlaylistBtn.addEventListener('click', () => {
      // 确认清空操作
      if (playlistItems.length > 0 && confirm('确定要清空播放列表吗？')) {
        clearPlaylist();
      }
    });

    addToPlaylistBtn.addEventListener('click', () => {
      const input = playlistUrlInput.value.trim();
      if (!input) return;
      
      // 按换行符分割输入，支持多个URL
      const urls = input.split('\n')
        .map(url => url.trim())
        .filter(url => url && url.length > 0);
      
      if (urls.length > 0) {
        addToPlaylist(urls);
        playlistUrlInput.value = '';
        toast(`已添加 ${urls.length} 个视频到播放列表`);
      }
    });
    // 批量修复功能已移除
    prevButton.addEventListener('click', () => playPrev());
    nextButton.addEventListener('click', () => playNext());

    // 点击视频区切换播放
    videoElement.addEventListener('click', togglePlayPause);

    // 定期保存进度
    videoElement.addEventListener('timeupdate', persistEntryStateDebounced);
  }

  function updatePlayPauseUI() {
    playPauseButton.textContent = videoElement.paused ? '▶️' : '⏸';
  }

  function initDefaults() {
    videoElement.controls = false;
    videoElement.preload = 'metadata';
    videoElement.playsInline = true;
    videoElement.loop = isLoopEnabled;
    setPlaybackRate(rateSelect.value);
    onVolumeChange();
    updateTimeUI();
    applyMirrorMode();
    // 设置循环按钮初始状态
    loopBtn.style.opacity = isLoopEnabled ? '1' : '0.5';
    // 恢复播放列表和当前源
    restorePlaylist();
  }

  // 启用键盘快捷键
  bindKeyboardShortcuts();
  // 初始化 UI/事件
  initEvents();
  initDefaults();

  // 说明：
  // - 若要播放百度网盘分享资源，请在输入框粘贴可直播的媒体 URL（需满足 CORS）。
  // - 通常需要后端代理服务，将分享链接交换为临时直链并加上 CORS 头。
})();


