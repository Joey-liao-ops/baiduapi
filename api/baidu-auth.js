// api/baidu-auth.js
// 处理百度网盘 OAuth 认证流程

module.exports = async (req, res) => {
  // 允许跨域请求
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  
  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  const { action } = req.query;

  // 从环境变量获取配置
  const APP_KEY = process.env.BAIDU_APP_KEY;
  const SECRET_KEY = process.env.BAIDU_SECRET_KEY;
  const REDIRECT_URI = process.env.BAIDU_REDIRECT_URI || 'https://rereplayer.com/callback';

  try {
    if (action === 'login') {
      // 生成授权登录 URL
      const authUrl = `https://openapi.baidu.com/oauth/2.0/authorize?response_type=code&client_id=${APP_KEY}&redirect_uri=${encodeURIComponent(REDIRECT_URI)}&scope=basic,netdisk&display=popup`;
      
      return res.status(200).json({ 
        success: true, 
        authUrl 
      });
    }

    if (action === 'callback') {
      // 处理回调，用 code 换取 access_token
      const { code } = req.query;
      
      if (!code) {
        return res.status(400).json({ 
          success: false, 
          error: 'Missing authorization code' 
        });
      }

      const tokenUrl = `https://openapi.baidu.com/oauth/2.0/token?grant_type=authorization_code&code=${code}&client_id=${APP_KEY}&client_secret=${SECRET_KEY}&redirect_uri=${encodeURIComponent(REDIRECT_URI)}`;
      
      const response = await fetch(tokenUrl, { method: 'GET' });
      const data = await response.json();

      if (data.error) {
        return res.status(400).json({ 
          success: false, 
          error: data.error_description || data.error 
        });
      }

      return res.status(200).json({ 
        success: true, 
        access_token: data.access_token,
        refresh_token: data.refresh_token,
        expires_in: data.expires_in
      });
    }

    if (action === 'refresh') {
      // 刷新 access_token
      const { refresh_token } = req.query;
      
      if (!refresh_token) {
        return res.status(400).json({ 
          success: false, 
          error: 'Missing refresh token' 
        });
      }

      const refreshUrl = `https://openapi.baidu.com/oauth/2.0/token?grant_type=refresh_token&refresh_token=${refresh_token}&client_id=${APP_KEY}&client_secret=${SECRET_KEY}`;
      
      const response = await fetch(refreshUrl, { method: 'GET' });
      const data = await response.json();

      if (data.error) {
        return res.status(400).json({ 
          success: false, 
          error: data.error_description || data.error 
        });
      }

      return res.status(200).json({ 
        success: true, 
        access_token: data.access_token,
        refresh_token: data.refresh_token,
        expires_in: data.expires_in
      });
    }

    return res.status(400).json({ 
      success: false, 
      error: 'Invalid action' 
    });

  } catch (error) {
    console.error('Auth error:', error);
    return res.status(500).json({ 
      success: false, 
      error: error.message 
    });
  }
}