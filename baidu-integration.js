// baidu-integration.js
// 百度网盘功能集成

(() => {
  // 配置 API 地址
  const API_BASE = window.location.origin + '/api';
  
  // DOM 元素
  const baiduLoginBtn = document.getElementById('baiduLoginBtn');
  const baiduLogoutBtn = document.getElementById('baiduLogoutBtn');
  const baiduAuthStatus = document.getElementById('baiduAuthStatus');
  const baiduFileSection = document.getElementById('baiduFileSection');
  const baiduPathInput = document.getElementById('baiduPathInput');
  const baiduLoadBtn = document.getElementById('baiduLoadBtn');
  const baiduFileList = document.getElementById('baiduFileList');
  
  // 状态管理
  let accessToken = localStorage.getItem('baidu_access_token');
  let refreshToken = localStorage.getItem('baidu_refresh_token');
  let userName = localStorage.getItem('baidu_user_name') || '';
  
  // 工具函数
  function formatFileSize(bytes) {
    if (!bytes || bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return (bytes / Math.pow(k, i)).toFixed(1) + ' ' + sizes[i];
  }
  
  function showToast(message) {
    if (window.toast) {
      window.toast(message);
    } else {
      console.log(message);
    }
  }
  
  function updateAuthUI(loggedIn, name = '') {
    if (loggedIn) {
      baiduAuthStatus.textContent = name ? `已登录: ${name}` : '已登录';
      baiduAuthStatus.classList.add('logged-in');
      baiduLoginBtn.style.display = 'none';
      baiduLogoutBtn.style.display = 'block';
      baiduFileSection.style.display = 'block';
    } else {
      baiduAuthStatus.textContent = '未登录';
      baiduAuthStatus.classList.remove('logged-in');
      baiduLoginBtn.style.display = 'block';
      baiduLogoutBtn.style.display = 'none';
      baiduFileSection.style.display = 'none';
      baiduFileList.innerHTML = '';
    }
  }
  
  // 登录功能
  async function login() {
    try {
      showToast('正在打开授权页面...');
      
      const response = await fetch(`${API_BASE}/baidu-auth?action=login`);
      const data = await response.json();
      
      if (!data.success) {
        showToast('获取授权链接失败: ' + data.error);
        return;
      }
      
      // 打开授权窗口
      const width = 600;
      const height = 700;
      const left = (screen.width - width) / 2;
      const top = (screen.height - height) / 2;
      
      const authWindow = window.open(
        data.authUrl,
        'BaiduAuth',
        `width=${width},height=${height},left=${left},top=${top}`
      );
      
      if (!authWindow) {
        showToast('请允许弹出窗口以完成授权');
        return;
      }
      
      showToast('请在弹窗中完成百度账号授权...');
      
      // 监听授权回调
      const handleMessage = async (event) => {
        // 验证来源
        if (event.origin !== window.location.origin) return;
        
        const { code } = event.data;
        if (!code) return;
        
        try {
          showToast('正在获取访问令牌...');
          
          const tokenResponse = await fetch(
            `${API_BASE}/baidu-auth?action=callback&code=${code}`
          );
          const tokenData = await tokenResponse.json();
          
          if (!tokenData.success) {
            showToast('授权失败: ' + tokenData.error);
            return;
          }
          
          // 保存 token
          accessToken = tokenData.access_token;
          refreshToken = tokenData.refresh_token;
          localStorage.setItem('baidu_access_token', accessToken);
          localStorage.setItem('baidu_refresh_token', refreshToken);
          
          // 获取用户信息
          await loadUserInfo();
          
          updateAuthUI(true, userName);
          showToast('百度网盘登录成功！');
          
          // 自动加载根目录文件
          loadFiles();
          
        } catch (error) {
          showToast('授权失败: ' + error.message);
        }
        
        window.removeEventListener('message', handleMessage);
      };
      
      window.addEventListener('message', handleMessage);
      
    } catch (error) {
      showToast('登录失败: ' + error.message);
      console.error('Login error:', error);
    }
  }
  
  // 获取用户信息
  async function loadUserInfo() {
    try {
      const response = await fetch(
        `${API_BASE}/baidu-files?action=userinfo&access_token=${accessToken}`
      );
      const data = await response.json();
      
      if (data.success && data.userinfo) {
        userName = data.userinfo.baidu_name || data.userinfo.netdisk_name || '用户';
        localStorage.setItem('baidu_user_name', userName);
      }
    } catch (error) {
      console.error('Failed to load user info:', error);
    }
  }
  
  // 登出功能
  function logout() {
    accessToken = null;
    refreshToken = null;
    userName = '';
    localStorage.removeItem('baidu_access_token');
    localStorage.removeItem('baidu_refresh_token');
    localStorage.removeItem('baidu_user_name');
    updateAuthUI(false);
    showToast('已退出百度网盘登录');
  }
  
  // 加载文件列表
  async function loadFiles(dir = null) {
    if (!accessToken) {
      showToast('请先登录百度网盘');
      return;
    }
    
    const path = dir || baiduPathInput.value.trim() || '/';
    
    try {
      baiduFileList.innerHTML = '<div class="baidu-loading">加载中...</div>';
      baiduLoadBtn.disabled = true;
      
      const response = await fetch(
        `${API_BASE}/baidu-files?action=list&access_token=${accessToken}&dir=${encodeURIComponent(path)}`
      );
      const data = await response.json();
      
      if (!data.success) {
        // 如果 token 过期，尝试刷新
        if (data.error && data.error.includes('token')) {
          const refreshed = await refreshAccessToken();
          if (refreshed) {
            // 刷新成功后重试
            return loadFiles(path);
          }
        }
        
        baiduFileList.innerHTML = `<div class="baidu-empty">加载失败: ${data.error}</div>`;
        showToast('加载失败: ' + data.error);
        return;
      }
      
      if (!data.files || data.files.length === 0) {
        baiduFileList.innerHTML = '<div class="baidu-empty">该目录下没有视频文件</div>';
        showToast(`${path} 目录下没有找到视频文件`);
        return;
      }
      
      // 渲染文件列表
      renderFileList(data.files);
      showToast(`找到 ${data.files.length} 个视频文件`);
      
    } catch (error) {
      baiduFileList.innerHTML = `<div class="baidu-empty">加载失败: ${error.message}</div>`;
      showToast('加载失败: ' + error.message);
      console.error('Load files error:', error);
    } finally {
      baiduLoadBtn.disabled = false;
    }
  }
  
  // 刷新 access token
  async function refreshAccessToken() {
    if (!refreshToken) return false;
    
    try {
      const response = await fetch(
        `${API_BASE}/baidu-auth?action=refresh&refresh_token=${refreshToken}`
      );
      const data = await response.json();
      
      if (data.success) {
        accessToken = data.access_token;
        refreshToken = data.refresh_token;
        localStorage.setItem('baidu_access_token', accessToken);
        localStorage.setItem('baidu_refresh_token', refreshToken);
        showToast('令牌已刷新');
        return true;
      }
    } catch (error) {
      console.error('Failed to refresh token:', error);
    }
    
    return false;
  }
  
  // 渲染文件列表
  function renderFileList(files) {
    baiduFileList.innerHTML = files.map(file => `
      <div class="baidu-file-item" data-fsid="${file.fs_id}">
        <div class="baidu-file-info">
          <div class="baidu-file-name" title="${file.path}">${file.server_filename}</div>
          <div class="baidu-file-size">${formatFileSize(file.size)}</div>
        </div>
        <button onclick="window.playBaiduVideo(${file.fs_id}, '${file.server_filename.replace(/'/g, "\\'")}')">播放</button>
      </div>
    `).join('');
  }
  
  // 播放视频
  async function playBaiduVideo(fsid, filename) {
    if (!accessToken) {
      showToast('请先登录百度网盘');
      return;
    }
    
    try {
      showToast('正在获取播放链接...');
      
      const response = await fetch(
        `${API_BASE}/baidu-files?action=download&access_token=${accessToken}&fsids=${fsid}`
      );
      const data = await response.json();
      
      if (!data.success || !data.files || !data.files[0]) {
        showToast('获取播放链接失败');
        return;
      }
      
      const dlink = data.files[0].dlink;
      
      // 使用代理 URL 播放视频
      const proxyUrl = `${API_BASE}/proxy?url=${encodeURIComponent(dlink)}&access_token=${accessToken}`;
      
      // 添加到播放列表
      if (window.addToPlaylist) {
        // 使用现有的 addToPlaylist 函数
        const videoItem = {
          id: String(Date.now()),
          title: `☁️ ${filename}`,
          url: proxyUrl,
          isLocal: false,
          isBaidu: true
        };
        
        // 如果存在 playlistItems，直接添加
        if (window.playlistItems && Array.isArray(window.playlistItems)) {
          window.playlistItems.push(videoItem);
          if (window.renderPlaylist) window.renderPlaylist();
          if (window.persistPlaylist) window.persistPlaylist();
          
          // 选中并播放
          window.playlistIndex = window.playlistItems.length - 1;
          if (window.setSource) {
            window.setSource(proxyUrl, videoItem.title);
          }
          
          // 自动播放
          const videoElement = document.getElementById('video');
          if (videoElement) {
            videoElement.play().catch(e => console.warn('Auto-play failed:', e));
          }
        } else {
          // 直接设置视频源
          const videoElement = document.getElementById('video');
          if (videoElement) {
            videoElement.src = proxyUrl;
            document.title = `${filename} - ReRe Player`;
            videoElement.play().catch(e => console.warn('Auto-play failed:', e));
          }
        }
        
        showToast(`正在播放: ${filename}`);
      }
      
    } catch (error) {
      showToast('播放失败: ' + error.message);
      console.error('Play video error:', error);
    }
  }
  
  // 初始化
  function init() {
    // 绑定事件
    baiduLoginBtn.addEventListener('click', login);
    baiduLogoutBtn.addEventListener('click', logout);
    baiduLoadBtn.addEventListener('click', () => loadFiles());
    
    // 路径输入框回车加载
    baiduPathInput.addEventListener('keypress', (e) => {
      if (e.key === 'Enter') {
        loadFiles();
      }
    });
    
    // 恢复登录状态
    if (accessToken) {
      updateAuthUI(true, userName);
      loadUserInfo(); // 刷新用户信息
    } else {
      updateAuthUI(false);
    }
    
    // 暴露全局函数供 HTML 调用
    window.playBaiduVideo = playBaiduVideo;
  }
  
  // DOM 加载完成后初始化
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();