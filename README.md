# 语映

语映是一款面向视频创作者的口述影像桌面工具。用户可以导入本地视频，按片段生成可编辑的无障碍旁白脚本，并为脚本生成 TTS 试听音频。

## 主要功能

- 使用 Electron、React 和 TypeScript 构建桌面界面
- 以项目目录和 SQLite 保存视频、片段、脚本及旁白状态
- 使用 FFmpeg/FFprobe 读取视频信息、检测静音区间并切分片段
- 使用 Kimi 视频模型生成整段上下文和逐段画面描述
- 支持脚本编辑、异常标记、单条试听和批量旁白生成
- 使用火山引擎 TTS 生成旁白，并按文本和配置缓存音频
- 支持导出口述脚本 JSON

## 本地运行

1. 安装 Node.js 24 和 FFmpeg。
2. 执行 `npm install`。
3. 在项目根目录创建 `.env`，按实际环境配置以下变量：

```env
MOONSHOT_API_KEY=
KIMI_BASE_URL=https://api.moonshot.cn/v1
KIMI_MODEL=
VOLCENGINE_TTS_API_KEY=
VOLCENGINE_TTS_RESOURCE_ID=
```

4. 执行 `npm run dev`。

当前版本仍未实现最终视频混音导出，导出的内容为口述脚本 JSON。
