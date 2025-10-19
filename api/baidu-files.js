// api/baidu-files.js
// 获取百度网盘文件列表和下载链接

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  
  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  const { action, access_token } = req.query;

  if (!access_token) {
    return res.status(401).json({ 
      success: false, 
      error: 'Missing access token' 
    });
  }

  try {
    if (action === 'list') {
      // 获取文件列表
      const { dir = '/', recursion = 0 } = req.query;
      
      const listUrl = `https://pan.baidu.com/rest/2.0/xpan/file?method=list&access_token=${access_token}&dir=${encodeURIComponent(dir)}&order=name&limit=1000&recursion=${recursion}`;
      
      const response = await fetch(listUrl, { method: 'GET' });
      const data = await response.json();

      if (data.errno !== 0) {
        return res.status(400).json({ 
          success: false, 
          error: `Error ${data.errno}: ${data.errmsg || 'Unknown error'}` 
        });
      }

      // 过滤出视频文件
      const videoExtensions = ['.mp4', '.mkv', '.avi', '.mov', '.flv', '.wmv', '.webm', '.m4v'];
      const videos = data.list.filter(file => {
        if (file.isdir === 1) return false;
        const ext = file.path.toLowerCase().substring(file.path.lastIndexOf('.'));
        return videoExtensions.includes(ext);
      });

      return res.status(200).json({ 
        success: true, 
        files: videos,
        total: videos.length
      });
    }

    if (action === 'download') {
      // 获取文件下载链接
      const { fsids } = req.query;
      
      if (!fsids) {
        return res.status(400).json({ 
          success: false, 
          error: 'Missing fsids parameter' 
        });
      }

      const downloadUrl = `https://pan.baidu.com/rest/2.0/xpan/multimedia?method=filemetas&access_token=${access_token}&fsids=[${fsids}]&dlink=1`;
      
      const response = await fetch(downloadUrl, { method: 'GET' });
      const data = await response.json();

      if (data.errno !== 0) {
        return res.status(400).json({ 
          success: false, 
          error: `Error ${data.errno}: ${data.errmsg || 'Unknown error'}` 
        });
      }

      return res.status(200).json({ 
        success: true, 
        files: data.list
      });
    }

    if (action === 'userinfo') {
      // 获取用户信息
      const infoUrl = `https://pan.baidu.com/rest/2.0/xpan/nas?method=uinfo&access_token=${access_token}`;
      
      const response = await fetch(infoUrl, { method: 'GET' });
      const data = await response.json();

      if (data.errno !== 0) {
        return res.status(400).json({ 
          success: false, 
          error: `Error ${data.errno}: ${data.errmsg || 'Unknown error'}` 
        });
      }

      return res.status(200).json({ 
        success: true, 
        userinfo: data
      });
    }

    return res.status(400).json({ 
      success: false, 
      error: 'Invalid action' 
    });

  } catch (error) {
    console.error('Files API error:', error);
    return res.status(500).json({ 
      success: false, 
      error: error.message 
    });
  }
}