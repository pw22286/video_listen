import type { AnalyzedScript, TtsConfig, TtsVoice } from "../electron";

export const VOICE_LIBRARY_PREVIEW_CONFIG: Omit<TtsConfig, "speaker"> = {
  speechRate: 0,
  loudnessRate: 0,
  pitch: 0,
};

export function providerName(provider?: string) {
  if (provider === "volcengine") return "火山引擎";
  if (provider === "aliyun") return "阿里云";
  if (provider === "local") return "本地 TTS";
  return provider || "未知平台";
}

export function getDefaultPreviewTextForVoice(voice?: TtsVoice) {
  const voiceType = voice?.voiceType ?? "";
  const language = voice?.language ?? "";
  if (voiceType.startsWith("en_") || language.includes("英语")) {
    return "This is a Yuying voice preview. A person stands by the window as city lights unfold in the distance.";
  }
  if (voiceType.startsWith("ja_") || language.includes("日文") || language.includes("日语")) {
    return "これは語映の音声プレビューです。人物が窓辺に立ち、遠くに街の明かりが広がっています。";
  }
  return "这是语映的音色试听。画面中，人物站在窗边，城市灯光从远处铺开。";
}

export function statusText(status: AnalyzedScript["status"]) {
  switch (status) {
    case "draft":
      return "待生成";
    case "voiced":
      return "已生成";
    case "conflict":
      return "有冲突";
    case "disabled":
      return "已禁用";
  }
}

export function getVoiceTextCompatibilityWarning(voice: TtsVoice | undefined, text: string) {
  if (!voice || !text.trim()) return null;

  const voiceType = voice.voiceType ?? "";
  const language = voice.language ?? "";
  const isEnglishVoice = voiceType.startsWith("en_") || language.includes("英语");
  const isChineseVoice = voiceType.startsWith("zh_") || language.includes("中文");
  const hasCjk = /[\u3400-\u9fff\u3040-\u30ff\uac00-\ud7af]/.test(text);
  const hasLatin = /[A-Za-z]/.test(text);
  const voiceName = voice.displayName || voice.name;

  if (isEnglishVoice && hasCjk) {
    return `当前音色「${voiceName}」是英文音色，不能直接合成中文脚本。请更换中文音色，或把脚本改成英文。`;
  }

  if (isChineseVoice && hasLatin && !hasCjk) {
    return `当前音色「${voiceName}」是中文音色，当前脚本文本看起来是英文。请更换英文音色，或把脚本改成中文。`;
  }

  return null;
}
