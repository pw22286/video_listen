const FFMPEG_BIN = process.env.FFMPEG_PATH || "/opt/homebrew/bin/ffmpeg";
const FFPROBE_BIN = process.env.FFPROBE_PATH || "/opt/homebrew/bin/ffprobe";
const DEFAULT_KIMI_BASE_URL = "https://api.moonshot.cn/v1";
const DEFAULT_KIMI_MODEL = "kimi-k2.6";
const SEGMENT_SECONDS = 3;
const PROJECT_FILE = "yuying.project.json";
const PROJECT_DB = "yuying.db";
const VOLCENGINE_TTS_URL = "https://openspeech.bytedance.com/api/v3/tts/unidirectional";
const DEFAULT_TTS_RESOURCE_ID = "seed-tts-2.0";
const DEFAULT_TTS_PREVIEW_TEXT = "这是一段语映口述影像的音色试听。";
const DEFAULT_TTS_CONFIG = {
  speaker: "zh_female_vv_uranus_bigtts",
  speechRate: 0,
  loudnessRate: 0,
  pitch: 0,
};
const VOLCENGINE_PROVIDER = "volcengine";
const VOLCENGINE_CAPABILITIES = {
  speechRate: true,
  loudnessRate: true,
  pitch: true,
};

module.exports = {
  FFMPEG_BIN,
  FFPROBE_BIN,
  DEFAULT_KIMI_BASE_URL,
  DEFAULT_KIMI_MODEL,
  SEGMENT_SECONDS,
  PROJECT_FILE,
  PROJECT_DB,
  VOLCENGINE_TTS_URL,
  DEFAULT_TTS_RESOURCE_ID,
  DEFAULT_TTS_PREVIEW_TEXT,
  DEFAULT_TTS_CONFIG,
  VOLCENGINE_PROVIDER,
  VOLCENGINE_CAPABILITIES,
};
