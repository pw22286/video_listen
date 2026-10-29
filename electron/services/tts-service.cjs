const crypto = require("node:crypto");
const fs = require("node:fs/promises");
const {
  DEFAULT_TTS_CONFIG,
  DEFAULT_TTS_RESOURCE_ID,
  VOLCENGINE_PROVIDER,
  VOLCENGINE_TTS_URL,
} = require("./constants.cjs");
const { clampNumber } = require("./format.cjs");

function normalizeTtsConfig(config = {}) {
  return {
    speaker: String(config.speaker || DEFAULT_TTS_CONFIG.speaker),
    speechRate: clampNumber(config.speechRate, -50, 100, DEFAULT_TTS_CONFIG.speechRate),
    loudnessRate: clampNumber(config.loudnessRate, -50, 100, DEFAULT_TTS_CONFIG.loudnessRate),
    pitch: clampNumber(config.pitch, -12, 12, DEFAULT_TTS_CONFIG.pitch),
  };
}

function makeTextHash(text) {
  return crypto.createHash("sha1").update(String(text ?? "")).digest("hex");
}

function makeTtsConfigHash(config, voice) {
  const normalized = normalizeTtsConfig(config);
  return crypto
    .createHash("sha1")
    .update(JSON.stringify({
      provider: voice?.provider || VOLCENGINE_PROVIDER,
      providerVoiceId: voice?.providerVoiceId || normalized.speaker,
      speaker: normalized.speaker,
      speechRate: normalized.speechRate,
      loudnessRate: normalized.loudnessRate,
      pitch: normalized.pitch,
    }))
    .digest("hex");
}

function parseJsonLines(text) {
  const objects = [];
  let depth = 0;
  let start = -1;
  let inString = false;
  let escaped = false;

  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];

    if (inString) {
      if (escaped) {
        escaped = false;
      } else if (char === "\\") {
        escaped = true;
      } else if (char === "\"") {
        inString = false;
      }
      continue;
    }

    if (char === "\"") {
      inString = true;
      continue;
    }

    if (char === "{") {
      if (depth === 0) start = index;
      depth += 1;
    } else if (char === "}") {
      depth -= 1;
      if (depth === 0 && start !== -1) {
        const jsonText = text.slice(start, index + 1);
        try {
          objects.push(JSON.parse(jsonText));
        } catch {
          // Ignore malformed fragments.
        }
        start = -1;
      }
    }
  }

  if (objects.length > 0) return objects;

  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || !trimmed.startsWith("{")) continue;
    try {
      objects.push(JSON.parse(trimmed));
    } catch {
      // Ignore incomplete stream fragments.
    }
  }
  return objects;
}

function previewResponseText(text) {
  return String(text ?? "")
    .replace(/\s+/g, " ")
    .slice(0, 600);
}

function getVolcengineExplicitLanguage(voice) {
  const voiceType = voice?.providerVoiceId || voice?.voiceType || "";
  const language = voice?.language || "";
  if (voiceType.startsWith("en_") || language.includes("英语")) return "en";
  if (voiceType.startsWith("ja_") || language.includes("日文") || language.includes("日语")) return "ja";
  if (voiceType.startsWith("id_") || language.includes("印尼")) return "id";
  if (voiceType.startsWith("ko_") || language.includes("韩")) return "ko";
  if (voiceType.startsWith("pt_") || language.includes("葡")) return "pt-br";
  if (voiceType.startsWith("es_") || language.includes("西班牙")) return "es-mx";
  if (voiceType.startsWith("zh_") || language.includes("中文")) return "zh-cn";
  return undefined;
}

function assertTextCompatibleWithVoice(text, voice) {
  const explicitLanguage = getVolcengineExplicitLanguage(voice);
  const inputText = String(text ?? "").trim();
  const hasCjk = /[\u3400-\u9fff\u3040-\u30ff\uac00-\ud7af]/.test(inputText);
  const hasLatin = /[A-Za-z]/.test(inputText);
  const voiceName = voice?.displayName || voice?.name || voice?.voiceType || "当前音色";

  if (explicitLanguage === "en" && hasCjk) {
    throw new Error(`当前音色「${voiceName}」是英文音色，不能直接合成中文脚本文本。请在音色库切换为中文音色，或把这条脚本改成英文。`);
  }

  if (explicitLanguage === "zh-cn" && hasLatin && !hasCjk) {
    throw new Error(`当前音色「${voiceName}」是中文音色，当前脚本文本看起来是英文。请切换为英文音色，或把脚本改成中文。`);
  }
}

async function callVolcengineTts({ text, config, voice, outputPath }) {
  const apiKey = process.env.VOLCENGINE_TTS_API_KEY;
  if (!apiKey) {
    throw new Error("未配置 VOLCENGINE_TTS_API_KEY");
  }

  const inputText = String(text ?? "").trim();
  if (!inputText) {
    throw new Error("TTS 文本为空，已取消请求");
  }
  assertTextCompatibleWithVoice(inputText, voice);

  const normalized = normalizeTtsConfig(config);
  const speaker = voice?.providerVoiceId || voice?.voiceType || normalized.speaker;
  const resourceId = process.env.VOLCENGINE_TTS_RESOURCE_ID || DEFAULT_TTS_RESOURCE_ID;
  const additions = {
    post_process: {
      pitch: normalized.pitch,
    },
  };
  const explicitLanguage = getVolcengineExplicitLanguage(voice);
  if (explicitLanguage) {
    additions.explicit_language = explicitLanguage;
  }

  const response = await fetch(VOLCENGINE_TTS_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Api-Key": apiKey,
      "X-Api-Resource-Id": resourceId,
      "X-Api-Request-Id": crypto.randomUUID(),
      "X-Control-Require-Usage-Tokens-Return": "text_words",
    },
    body: JSON.stringify({
      user: {
        uid: "yuying-desktop",
      },
      namespace: "BidirectionalTTS",
      req_params: {
        text: inputText,
        speaker,
        audio_params: {
          format: "mp3",
          sample_rate: 24000,
          speech_rate: normalized.speechRate,
          loudness_rate: normalized.loudnessRate,
        },
        additions: JSON.stringify(additions),
      },
    }),
  });

  const body = await response.text();
  if (!response.ok) {
    let message = body;
    try {
      const parsed = JSON.parse(body);
      const header = parsed.header;
      if (header?.code === 45000030) {
        message = `火山 TTS 资源未授权。当前发送的 X-Api-Resource-Id=${resourceId}；服务端返回 code=${header.code}，reqid=${header.reqid}，message=${header.message}`;
      }
    } catch {
      // Keep original body when it is not JSON.
    }
    throw new Error(`火山 TTS 请求失败：${response.status} ${message}`);
  }

  const responseItems = parseJsonLines(body);
  const chunks = [];
  let usage = null;
  for (const item of responseItems) {
    if (item.code === 0 && item.data) {
      chunks.push(Buffer.from(item.data, "base64"));
    } else if (item.code === 20000000) {
      usage = item.usage ?? null;
    } else if (item.code && item.code !== 0) {
      throw new Error(`火山 TTS 返回错误：${item.code} ${item.message || ""}`.trim());
    } else if (item.header?.code && item.header.code !== 0) {
      throw new Error(
        `火山 TTS 返回错误：${item.header.code} ${item.header.message || ""} reqid=${item.header.reqid || ""}`.trim(),
      );
    }
  }

  if (chunks.length === 0) {
    const logId = response.headers.get("x-tt-logid") ?? "unknown";
    const codes = responseItems
      .map((item) => item.code ?? item.header?.code)
      .filter((code) => code !== undefined)
      .join(",");
    throw new Error(
      `火山 TTS 未返回音频数据：logid=${logId}，speaker=${speaker}，textLength=${inputText.length}，解析到 ${responseItems.length} 个响应对象，code=${codes || "无"}，响应片段=${previewResponseText(body)}`,
    );
  }

  await fs.writeFile(outputPath, Buffer.concat(chunks));
  return {
    path: outputPath,
    usage,
    logId: response.headers.get("x-tt-logid") ?? undefined,
    config: normalized,
  };
}

async function synthesizeSpeech({ text, config, voice, outputPath }) {
  const provider = voice?.provider || VOLCENGINE_PROVIDER;
  if (provider === VOLCENGINE_PROVIDER) {
    return callVolcengineTts({ text, config, voice, outputPath });
  }
  throw new Error(`暂不支持 ${provider} TTS 生成`);
}

module.exports = {
  makeTextHash,
  makeTtsConfigHash,
  normalizeTtsConfig,
  synthesizeSpeech,
};
