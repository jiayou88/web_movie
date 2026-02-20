const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, DELETE, PUT, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

export default {
  async fetch(request, env) {
    // 处理预检请求
    if (request.method === 'OPTIONS') {
      return new Response(null, { headers: CORS_HEADERS });
    }

    const url = new URL(request.url);
    const path = url.pathname;

    try {
      // ========== 管理员验证 ==========
      if (path === '/api/admin/verify' && request.method === 'POST') {
        try {
          const { password } = await request.json();
          // 从 KV 获取正确的密码
          const correctPassword = await env.WEBTOOL_KV.get('admin_password') || '123456';
          const isValid = password === correctPassword;
          
          return new Response(JSON.stringify({
            success: isValid,
            message: isValid ? '验证成功' : '密码错误'
          }), {
            headers: { 'Content-Type': 'application/json', ...CORS_HEADERS }
          });
        } catch (e) {
          return new Response(JSON.stringify({ error: '请求格式错误' }), {
            status: 400,
            headers: { 'Content-Type': 'application/json', ...CORS_HEADERS }
          });
        }
      }

      // ========== 视频平台管理 ==========
      if (path === '/api/platforms') {
        if (request.method === 'GET') {
          return await handleGetPlatforms(env);
        }
        if (request.method === 'POST') {
          return await handleAddPlatform(request, env);
        }
        if (request.method === 'DELETE') {
          const { name } = await request.json();
          return await handleDeletePlatform(env, name);
        }
      }

      // ========== 视频管理 ==========
      if (path === '/api/videos') {
        if (request.method === 'GET') {
          return await handleGetVideos(env);
        }
        if (request.method === 'POST') {
          return await handleAddVideo(request, env);
        }
        if (request.method === 'DELETE') {
          const { id } = await request.json();
          return await handleDeleteVideo(env, id);
        }
        if (request.method === 'PUT') {
          return await handleUpdateVideo(request, env);
        }
      }

      // 按平台统计视频数量
      if (path === '/api/videos/stats' && request.method === 'GET') {
        return await handleGetVideoStats(env);
      }

      // 更新视频播放进度
      if (path === '/api/videos/progress' && request.method === 'POST') {
        return await handleUpdateProgress(request, env);
      }

      // ========== 获取视频帧 ==========
      if (path === '/api/videos/frames' && request.method === 'GET') {
        const videoId = url.searchParams.get('videoId');
        if (!videoId) {
          return new Response(JSON.stringify({ error: 'Missing videoId' }), {
            status: 400,
            headers: { 'Content-Type': 'application/json', ...CORS_HEADERS }
          });
        }
        return await handleGetVideoFrames(env, videoId);
      }

      return new Response(JSON.stringify({ error: 'Not Found' }), {
        status: 404,
        headers: { 'Content-Type': 'application/json', ...CORS_HEADERS }
      });

    } catch (error) {
      return new Response(JSON.stringify({ error: error.message }), {
        status: 500,
        headers: { 'Content-Type': 'application/json', ...CORS_HEADERS }
      });
    }
  }
};

// ========== 平台管理函数 ==========
async function handleGetPlatforms(env) {
  const platforms = await env.WEBTOOL_KV.get('platforms', 'json') || [
    { name: 'YouTube', count: 0 },
    { name: 'B站', count: 0 },
    { name: '其他', count: 0 }
  ];
  return new Response(JSON.stringify(platforms), {
    headers: { 'Content-Type': 'application/json', ...CORS_HEADERS }
  });
}

async function handleAddPlatform(request, env) {
  const { name } = await request.json();
  const platforms = await env.WEBTOOL_KV.get('platforms', 'json') || [];
  
  // 检查是否已存在
  if (!platforms.some(p => p.name === name)) {
    platforms.push({ name, count: 0 });
    await env.WEBTOOL_KV.put('platforms', JSON.stringify(platforms));
  }
  
  return new Response(JSON.stringify(platforms), {
    headers: { 'Content-Type': 'application/json', ...CORS_HEADERS }
  });
}

async function handleDeletePlatform(env, name) {
  let platforms = await env.WEBTOOL_KV.get('platforms', 'json') || [];
  platforms = platforms.filter(p => p.name !== name);
  await env.WEBTOOL_KV.put('platforms', JSON.stringify(platforms));
  
  return new Response(JSON.stringify(platforms), {
    headers: { 'Content-Type': 'application/json', ...CORS_HEADERS }
  });
}

// ========== 视频管理函数 ==========
async function handleGetVideos(env) {
  const videos = await env.WEBTOOL_KV.get('videos', 'json') || [];
  // 按平台分组
  const grouped = videos.reduce((acc, video) => {
    if (!acc[video.platform]) {
      acc[video.platform] = [];
    }
    acc[video.platform].push(video);
    return acc;
  }, {});
  
  return new Response(JSON.stringify({ videos, grouped }), {
    headers: { 'Content-Type': 'application/json', ...CORS_HEADERS }
  });
}

// 修改后的 handleAddVideo 支持帧截取
async function handleAddVideo(request, env) {
  try {
    const videoData = await request.json();
    
    // 生成唯一ID
    videoData.id = Date.now().toString(36) + Math.random().toString(36).substr(2, 5);
    videoData.addedAt = new Date().toISOString();
    
    // 如果没有提供封面，自动截取帧
    if (!videoData.cover) {
      const frames = await extractVideoFrames(videoData.url, videoData.id);
      if (frames) {
        videoData.frames = frames;
        videoData.cover = frames.default; // 使用默认帧作为封面
      }
    }
    
    // 如果没有提供平台，从URL中提取
    if (!videoData.platform) {
      if (videoData.url.includes('youtube')) {
        videoData.platform = 'YouTube';
      } else if (videoData.url.includes('bilibili')) {
        videoData.platform = 'B站';
      } else if (videoData.url.includes('v.qq.com')) {
        videoData.platform = '腾讯视频';
      } else if (videoData.url.includes('iqiyi.com')) {
        videoData.platform = '爱奇艺';
      } else if (videoData.url.includes('youku.com')) {
        videoData.platform = '优酷';
      } else {
        videoData.platform = '其他';
      }
    }
    
    // 获取现有视频列表
    const videos = await env.WEBTOOL_KV.get('videos', 'json') || [];
    
    // 添加到列表开头
    videos.unshift(videoData);
    
    // 限制数量（最多100个）
    if (videos.length > 100) {
      videos.pop();
    }
    
    // 保存到KV
    await env.WEBTOOL_KV.put('videos', JSON.stringify(videos));
    
    // 更新平台统计
    await updatePlatformStats(env);
    
    return new Response(JSON.stringify(videoData), {
      status: 201,
      headers: { 'Content-Type': 'application/json', ...CORS_HEADERS }
    });
    
  } catch (error) {
    console.error('添加视频失败:', error);
    return new Response(JSON.stringify({ error: error.message }), {
      status: 500,
      headers: { 'Content-Type': 'application/json', ...CORS_HEADERS }
    });
  }
}

async function handleDeleteVideo(env, id) {
  let videos = await env.WEBTOOL_KV.get('videos', 'json') || [];
  videos = videos.filter(v => v.id !== id);
  await env.WEBTOOL_KV.put('videos', JSON.stringify(videos));
  
  // 更新平台统计
  await updatePlatformStats(env);
  
  return new Response(JSON.stringify({ success: true }), {
    headers: { 'Content-Type': 'application/json', ...CORS_HEADERS }
  });
}

// 修改后的 handleUpdateVideo 支持帧更新
async function handleUpdateVideo(request, env) {
  try {
    const updatedVideo = await request.json();
    
    // 如果更新了URL但没有封面，重新截取帧
    if (updatedVideo.url && !updatedVideo.cover) {
      const frames = await extractVideoFrames(updatedVideo.url, updatedVideo.id);
      if (frames) {
        updatedVideo.frames = frames;
        updatedVideo.cover = updatedVideo.cover || frames.default;
      }
    }
    
    let videos = await env.WEBTOOL_KV.get('videos', 'json') || [];
    const index = videos.findIndex(v => v.id === updatedVideo.id);
    
    if (index !== -1) {
      videos[index] = { ...videos[index], ...updatedVideo };
      await env.WEBTOOL_KV.put('videos', JSON.stringify(videos));
      await updatePlatformStats(env);
      
      return new Response(JSON.stringify({ success: true }), {
        headers: { 'Content-Type': 'application/json', ...CORS_HEADERS }
      });
    }
    
    return new Response(JSON.stringify({ error: 'Video not found' }), {
      status: 404,
      headers: { 'Content-Type': 'application/json', ...CORS_HEADERS }
    });
    
  } catch (error) {
    console.error('更新视频失败:', error);
    return new Response(JSON.stringify({ error: error.message }), {
      status: 500,
      headers: { 'Content-Type': 'application/json', ...CORS_HEADERS }
    });
  }
}

async function handleGetVideoStats(env) {
  const videos = await env.WEBTOOL_KV.get('videos', 'json') || [];
  const stats = {};
  
  videos.forEach(video => {
    const platform = video.platform || '其他';
    stats[platform] = (stats[platform] || 0) + 1;
  });
  
  return new Response(JSON.stringify(stats), {
    headers: { 'Content-Type': 'application/json', ...CORS_HEADERS }
  });
}

// 更新视频进度
async function handleUpdateProgress(request, env) {
  const { videoId, currentTime, duration } = await request.json();
  
  const progress = {
    currentTime,
    duration,
    updatedAt: new Date().toISOString()
  };
  
  await env.WEBTOOL_KV.put(`video:${videoId}:progress`, JSON.stringify(progress));
  
  return new Response(JSON.stringify({ success: true }), {
    headers: { 'Content-Type': 'application/json', ...CORS_HEADERS }
  });
}

// ========== 视频帧截取相关 ==========
async function extractVideoFrames(videoUrl, videoId) {
  try {
    const frames = {};
    
    if (videoUrl.includes('youtube.com') || videoUrl.includes('youtu.be')) {
      // YouTube 视频 - 使用官方缩略图
      const videoId_yt = extractYouTubeId(videoUrl);
      if (videoId_yt) {
        frames.thumb1 = `https://img.youtube.com/vi/${videoId_yt}/1.jpg`;  // 第1帧
        frames.thumb2 = `https://img.youtube.com/vi/${videoId_yt}/2.jpg`;  // 第2帧
        frames.thumb3 = `https://img.youtube.com/vi/${videoId_yt}/3.jpg`;  // 第3帧
        frames.default = `https://img.youtube.com/vi/${videoId_yt}/0.jpg`; // 默认封面
      }
    } else if (videoUrl.includes('bilibili.com')) {
      // B站视频 - 需要提取BV号
      const bvId = extractBilibiliId(videoUrl);
      if (bvId) {
        // B站的帧截取需要调用API获取封面
        // 先使用占位图，后续可以改进
        frames.default = `https://via.placeholder.com/320x180?text=Bilibili+Video`;
        frames.thumb1 = `https://via.placeholder.com/320x180?text=Frame+1`;
        frames.thumb2 = `https://via.placeholder.com/320x180?text=Frame+2`;
        frames.thumb3 = `https://via.placeholder.com/320x180?text=Frame+3`;
      }
    } else {
      // 其他视频 - 使用占位图
      frames.default = `https://via.placeholder.com/320x180?text=Video+Cover`;
      frames.thumb1 = `https://via.placeholder.com/320x180?text=Frame+1`;
      frames.thumb2 = `https://via.placeholder.com/320x180?text=Frame+2`;
      frames.thumb3 = `https://via.placeholder.com/320x180?text=Frame+3`;
    }
    
    return frames;
  } catch (error) {
    console.error('提取帧失败:', error);
    return null;
  }
}

// 获取视频帧
async function handleGetVideoFrames(env, videoId) {
  try {
    const videos = await env.WEBTOOL_KV.get('videos', 'json') || [];
    const video = videos.find(v => v.id === videoId);
    
    if (video && video.frames) {
      return new Response(JSON.stringify(video.frames), {
        headers: { 'Content-Type': 'application/json', ...CORS_HEADERS }
      });
    }
    
    return new Response(JSON.stringify({ error: 'Frames not found' }), {
      status: 404,
      headers: { 'Content-Type': 'application/json', ...CORS_HEADERS }
    });
  } catch (error) {
    return new Response(JSON.stringify({ error: error.message }), {
      status: 500,
      headers: { 'Content-Type': 'application/json', ...CORS_HEADERS }
    });
  }
}

// 更新平台统计
async function updatePlatformStats(env) {
  try {
    const videos = await env.WEBTOOL_KV.get('videos', 'json') || [];
    const platforms = await env.WEBTOOL_KV.get('platforms', 'json') || [];
    
    // 统计各平台视频数量
    const stats = {};
    videos.forEach(video => {
      const platform = video.platform || '其他';
      stats[platform] = (stats[platform] || 0) + 1;
    });
    
    // 更新平台计数
    platforms.forEach(p => {
      p.count = stats[p.name] || 0;
    });
    
    await env.WEBTOOL_KV.put('platforms', JSON.stringify(platforms));
  } catch (error) {
    console.error('更新平台统计失败:', error);
  }
}

// 提取YouTube ID
function extractYouTubeId(url) {
  const patterns = [
    /(?:youtube\.com\/watch\?v=|youtu\.be\/)([^&?#]+)/,
    /youtube\.com\/embed\/([^/?]+)/
  ];
  for (let pattern of patterns) {
    const match = url.match(pattern);
    if (match) return match[1];
  }
  return null;
}

// 提取B站ID
function extractBilibiliId(url) {
  const match = url.match(/(BV\w+)/);
  return match ? match[1] : null;
}
