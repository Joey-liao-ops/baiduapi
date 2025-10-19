// baidu-integration.js
// 百度网盘功能集成 - 修复版

(() => {
  // 配置 API 地址
  const API_BASE = window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1'
    ? 'http://localhost:3000/api'  // 本地开发
    : window.location.origin + '/api';  // 生产环境
  
  console.log('🔧 百度网盘模块初始化');
  console.log('API Base URL:', API_BASE);
  
  // DOM 元素
  const baiduLoginBtn = document.getElementById('baiduLoginBtn');
  const baiduLogoutBtn = document.getElementById('baiduLogoutBtn');
  const baiduAuthStatus = document.getElementById('baiduAuthStatus');
  const baiduFileSection = document.getElementById('baiduFileSection');
  const baiduPathInput = document.getElementById('baiduPathInput');
  const baiduLoadBtn = document.getElementById('baiduLoadBtn');
  const baiduFileList = document.getElementById('baiduFileList');
  const toastElement = document.getElementById('toast');
  
  // 检查 DOM 元素
  if (!baiduLoginBtn) {
    console.error('❌ 找不到 baiduLoginBtn 元素！请检查 HTML');
    return;
  }
  console.log('✅ DOM 元素加载成功');
  
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
    console.log('📢', message);
    
    // 直接使用 toast 元素显示消息
    if (toastElement) {
      toastElement.textContent = message;
      toastElement.classList.add('show');
      
      // 清除之前的定时器
      if (showToast._timer) {
        clearTimeout(showToast._timer);
      }
      
      // 1.4秒后隐藏
      showToast._timer = setTimeout(() => {
        toastElement.classList.remove('show');
      }, 1400);
    } else {
      // 如果找不到 toast 元素，使用 console
      console.log('💬', message);
    }
  }
  
  function updateAuthUI(loggedIn, name = '') {
    console.log('🔄 更新 UI 状态:', loggedIn ? '已登录' : '未登录');
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
    console.log('🔐 开始登录流程...');
    
    try {
      showToast('正在打开授权页面...');
      
      console.log('📡 请求授权 URL:', `${API_BASE}/baidu-auth?action=login`);
      const response = await fetch(`${API_BASE}/baidu-auth?action=login`);
      
      console.log('📥 响应状态:', response.status);
      const data = await response.json();
      console.log('📥 响应数据:', data);
      
      if (!data.success) {
        showToast('获取授权链接失败: ' + data.error);
        console.error('❌ 授权失败:', data.error);
        return;
      }
      
      // 打开授权窗口
      const width = 600;
      const height = 700;
      const left = (screen.width - width) / 2;
      const top = (screen.height - height) / 2;
      
      console.log('🪟 打开授权窗口:', data.authUrl);
      const authWindow = window.open(
        data.authUrl,
        'BaiduAuth',
        `width=${width},height=${height},left=${left},top=${top}`
      );
      
      if (!authWindow) {
        showToast('请允许弹出窗口以完成授权');
        console.warn('⚠️ 弹窗被阻止');
        return;
      }
      
      showToast('请在弹窗中完成百度账号授权...');
      
      // 监听授权回调
      const handleMessage = async (event) => {
        console.log('📨 收到消息:', event.origin, event.data);
        
        // 验证来源
        if (event.origin !== window.location.origin) {
          console.warn('⚠️ 消息来源不匹配:', event.origin);
          return;
        }
        
        const { code } = event.data;
        if (!code) {
          console.log('⚠️ 消息中没有 code');
          return;
        }
        
        try {
          showToast('正在获取访问令牌...');
          console.log('🔑 使用 code 获取 token...');
          
          const tokenResponse = await fetch(
            `${API_BASE}/baidu-auth?action=callback&code=${code}`
          );
          const tokenData = await tokenResponse.json();
          console.log('📥 Token 响应:', tokenData);
          
          if (!tokenData.success) {
            showToast('授权失败: ' + tokenData.error);
            console.error('❌ Token 获取失败:', tokenData.error);
            return;
          }
          
          // 保存 token
          accessToken = tokenData.access_token;
          refreshToken = tokenData.refresh_token;
          localStorage.setItem('baidu_access_token', accessToken);
          localStorage.setItem('baidu_refresh_token', refreshToken);
          console.log('✅ Token 已保存');
          
          // 获取用户信息
          await loadUserInfo();
          
          updateAuthUI(true, userName);
          showToast('百度网盘登录成功！');
          
          // 自动加载根目录文件
          loadFiles();
          
        } catch (error) {
          showToast('授权失败: ' + error.message);
          console.error('❌ 授权流程错误:', error);
        }
        
        window.removeEventListener('message', handleMessage);
      };
      
      window.addEventListener('message', handleMessage);
      console.log('✅ 消息监听器已添加');
      
    } catch (error) {
      showToast('登录失败: ' + error.message);
      console.error('❌ 登录错误:', error);
    }
  }
  
  // 获取用户信息
  async function loadUserInfo() {
    console.log('👤 加载用户信息...');
    try {
      const response = await fetch(
        `${API_BASE}/baidu-files?action=userinfo&access_token=${accessToken}`
      );
      const data = await response.json();
      console.log('📥 用户信息:', data);
      
      if (data.success && data.userinfo) {
        userName = data.userinfo.baidu_name || data.userinfo.netdisk_name || '用户';
        localStorage.setItem('baidu_user_name', userName);
        console.log('✅ 用户名:', userName);
      }
    } catch (error) {
      console.error('❌ 加载用户信息失败:', error);
    }
  }
  
  // 登出功能
  function logout() {
    console.log('👋 退出登录');
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
      console.warn('⚠️ 未登录');
      return;
    }
    
    const path = dir || baiduPathInput.value.trim() || '/';
    console.log('📂 加载文件列表:', path);
    
    try {
      baiduFileList.innerHTML = '<div class="baidu-loading">加载中...</div>';
      baiduLoadBtn.disabled = true;
      
      const url = `${API_BASE}/baidu-files?action=list&access_token=${accessToken}&dir=${encodeURIComponent(path)}`;
      console.log('📡 请求 URL:', url);
      
      const response = await fetch(url);
      const data = await response.json();
      console.log('📥 文件列表响应:', data);
      
      if (!data.success) {
        // 如果 token 过期，尝试刷新
        if (data.error && data.error.includes('token')) {
          console.log('🔄 Token 可能过期，尝试刷新...');
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
      console.error('❌ 加载文件错误:', error);
    } finally {
      baiduLoadBtn.disabled = false;
    }
  }
  
  // 刷新 access token
  async function refreshAccessToken() {
    if (!refreshToken) {
      console.warn('⚠️ 没有 refresh token');
      return false;
    }
    
    console.log('🔄 刷新 access token...');
    try {
      const response = await fetch(
        `${API_BASE}/baidu-auth?action=refresh&refresh_token=${refreshToken}`
      );
      const data = await response.json();
      console.log('📥 刷新响应:', data);
      
      if (data.success) {
        accessToken = data.access_token;
        refreshToken = data.refresh_token;
        localStorage.setItem('baidu_access_token', accessToken);
        localStorage.setItem('baidu_refresh_token', refreshToken);
        showToast('令牌已刷新');
        console.log('✅ Token 刷新成功');
        return true;
      }
    } catch (error) {
      console.error('❌ 刷新 token 失败:', error);
    }
    
    return false;
  }
  
  // 渲染文件列表
  function renderFileList(files) {
    console.log('🎨 渲染文件列表:', files.length, '个文件');
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
      console.warn('⚠️ 未登录');
      return;
    }
    
    console.log('▶️ 播放视频:', filename, 'fsid:', fsid);
    
    try {
      showToast('正在获取播放链接...');
      
      const response = await fetch(
        `${API_BASE}/baidu-files?action=download&access_token=${accessToken}&fsids=${fsid}`
      );
      const data = await response.json();
      console.log('📥 下载链接响应:', data);
      
      if (!data.success || !data.files || !data.files[0]) {
        showToast('获取播放链接失败');
        console.error('❌ 获取下载链接失败');
        return;
      }
      
      const dlink = data.files[0].dlink;
      console.log('🔗 下载链接:', dlink);
      
      // 使用代理 URL 播放视频
      const proxyUrl = `${API_BASE}/proxy?url=${encodeURIComponent(dlink)}&access_token=${accessToken}`;
      console.log('🔗 代理 URL:', proxyUrl);
      
      // 直接设置视频源
      const videoElement = document.getElementById('video');
      if (videoElement) {
        videoElement.src = proxyUrl;
        document.title = `☁️ ${filename} - ReRe Player`;
        
        // 尝试自动播放
        const playPromise = videoElement.play();
        if (playPromise !== undefined) {
          playPromise
            .then(() => {
              console.log('✅ 视频自动播放成功');
              showToast(`正在播放: ${filename}`);
            })
            .catch(e => {
              console.warn('⚠️ 自动播放失败:', e);
              showToast('视频已加载，请点击播放按钮');
            });
        }
        
        console.log('✅ 视频已设置');
      } else {
        console.error('❌ 找不到 video 元素');
        showToast('播放器初始化失败');
      }
      
    } catch (error) {
      showToast('播放失败: ' + error.message);
      console.error('❌ 播放错误:', error);
    }
  }
  
  // 初始化
  function init() {
    console.log('🚀 初始化百度网盘模块...');
    
    // 绑定事件
    if (baiduLoginBtn) {
      baiduLoginBtn.addEventListener('click', () => {
        console.log('🖱️ 点击登录按钮');
        login();
      });
      console.log('✅ 登录按钮事件已绑定');
    }
    
    if (baiduLogoutBtn) {
      baiduLogoutBtn.addEventListener('click', logout);
      console.log('✅ 退出按钮事件已绑定');
    }
    
    if (baiduLoadBtn) {
      baiduLoadBtn.addEventListener('click', () => loadFiles());
      console.log('✅ 加载按钮事件已绑定');
    }
    
    // 路径输入框回车加载
    if (baiduPathInput) {
      baiduPathInput.addEventListener('keypress', (e) => {
        if (e.key === 'Enter') {
          loadFiles();
        }
      });
      console.log('✅ 路径输入框事件已绑定');
    }
    
    // 恢复登录状态
    if (accessToken) {
      console.log('🔐 检测到已保存的 token，恢复登录状态');
      updateAuthUI(true, userName);
      loadUserInfo(); // 刷新用户信息
    } else {
      console.log('👤 当前未登录');
      updateAuthUI(false);
    }
    
    // 暴露全局函数供 HTML 调用
    window.playBaiduVideo = playBaiduVideo;
    console.log('✅ 全局函数已暴露');
    
    console.log('🎉 百度网盘模块初始化完成！');
  }
  
  // DOM 加载完成后初始化
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
    console.log('⏳ 等待 DOM 加载...');
  } else {
    init();
  }
})();