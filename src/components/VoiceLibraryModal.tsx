import React from "react";
import { Check, Loader2, RefreshCcw, Search, X } from "lucide-react";
import type { LoadedProject, TtsConfig, TtsVoice } from "../electron";
import {
  getDefaultPreviewTextForVoice,
  providerName,
  VOICE_LIBRARY_PREVIEW_CONFIG,
} from "../lib/voice";

export function VoiceLibraryModal({
  project,
  currentVoiceType,
  onClose,
  onPreview,
  onGetCache,
  onSelectVoice,
  onError,
}: {
  project: LoadedProject;
  currentVoiceType: string;
  onClose: () => void;
  onPreview: (
    voiceType: string,
    text: string,
    config: TtsConfig,
    options?: { force?: boolean },
  ) => Promise<{ path: string; url: string }>;
  onGetCache: (
    voiceType: string,
    text: string,
    config: TtsConfig,
  ) => Promise<{ path: string; url: string } | null>;
  onSelectVoice: (voiceType: string) => void;
  onError: (message: string) => void;
}) {
  const voices = project.ttsVoices;
  const [selectedVoiceType, setSelectedVoiceType] = React.useState(currentVoiceType);
  const [previewText, setPreviewText] = React.useState(() => getDefaultPreviewTextForVoice(
    voices.find((voice) => voice.voiceType === currentVoiceType) ?? voices[0],
  ));
  const [previewStatus, setPreviewStatus] = React.useState<"idle" | "loading" | "ready" | "playing" | "error">("idle");
  const [previewUrl, setPreviewUrl] = React.useState<string | null>(null);
  const [previewCacheKey, setPreviewCacheKey] = React.useState<string | null>(null);
  const audioRef = React.useRef<HTMLAudioElement | null>(null);
  const selectedVoice =
    voices.find((voice) => voice.voiceType === selectedVoiceType) ??
    voices[0];
  const cacheKey = selectedVoice
    ? JSON.stringify({
        voiceType: selectedVoice.voiceType,
        text: previewText.trim(),
        ...VOICE_LIBRARY_PREVIEW_CONFIG,
      })
    : "";
  const hasCachedPreview = Boolean(previewUrl && previewCacheKey === cacheKey);

  React.useEffect(() => {
    let cancelled = false;
    async function loadCachedPreview() {
      if (!selectedVoice || !previewText.trim()) return;
      try {
        const result = await onGetCache(selectedVoice.voiceType, previewText, {
          speaker: selectedVoice.voiceType,
          ...VOICE_LIBRARY_PREVIEW_CONFIG,
        });
        if (cancelled) return;
        if (result?.url) {
          setPreviewUrl(result.url);
          setPreviewCacheKey(cacheKey);
          setPreviewStatus("ready");
        } else if (previewCacheKey !== cacheKey) {
          setPreviewUrl(null);
          setPreviewCacheKey(null);
          setPreviewStatus("idle");
        }
      } catch {
        if (!cancelled) {
          setPreviewUrl(null);
          setPreviewCacheKey(null);
          setPreviewStatus("idle");
        }
      }
    }

    void loadCachedPreview();
    return () => {
      cancelled = true;
    };
  }, [cacheKey, onGetCache, previewCacheKey, previewText, selectedVoice]);

  function selectVoiceForPreview(voice: TtsVoice) {
    setSelectedVoiceType(voice.voiceType);
    setPreviewText((current) => {
      if (current.trim() && current !== getDefaultPreviewTextForVoice(selectedVoice)) return current;
      return getDefaultPreviewTextForVoice(voice);
    });
  }

  function updatePreviewText(value: string) {
    setPreviewText(value);
  }

  async function handlePreview() {
    if (!selectedVoice) return;

    setPreviewStatus("loading");
    try {
      const result = await onPreview(selectedVoice.voiceType, previewText, {
        speaker: selectedVoice.voiceType,
        ...VOICE_LIBRARY_PREVIEW_CONFIG,
      }, {
        force: hasCachedPreview,
      });
      setPreviewUrl(result.url);
      setPreviewCacheKey(cacheKey);
      setPreviewStatus("ready");
    } catch (err) {
      setPreviewStatus("error");
      onError(err instanceof Error ? err.message : "音色试听失败");
    }
  }

  function handleSelectVoice() {
    if (!selectedVoice) return;
    onSelectVoice(selectedVoice.voiceType);
    onClose();
  }

  return (
    <div className="modal-backdrop">
      <section className="voice-library-modal" role="dialog" aria-modal="true">
        <header className="modal-header">
          <div>
            <strong>音色库</strong>
            <span>选择 TTS 平台音色，并在这里完成试听。</span>
          </div>
          <button className="icon-button" onClick={onClose} aria-label="关闭音色库">
            <X size={17} />
          </button>
        </header>

        <div className="voice-library-layout">
          <aside className="voice-filter">
            <button className="active">{providerName("volcengine")}</button>
          </aside>

          <div className="voice-library-center">
            <div className="voice-library-search">
              <Search size={15} />
              <span>{voices.length} 个音色</span>
            </div>
            <div className="voice-library-list">
              {voices.map((voice) => (
                <button
                  key={voice.voiceType}
                  className={voice.voiceType === selectedVoice?.voiceType ? "active" : ""}
                  onClick={() => selectVoiceForPreview(voice)}
                >
                  <div>
                    <strong>{voice.displayName || voice.name}</strong>
                    {voice.voiceType === currentVoiceType ? <span className="current-badge"><Check size={12} />当前</span> : null}
                  </div>
                  <span>{providerName(voice.provider)} · {voice.scene} · {voice.language}</span>
                  <small>{voice.capability}</small>
                </button>
              ))}
            </div>
          </div>

          <section className="voice-preview-panel">
            <div className="voice-preview-title">
              <span>当前选择</span>
              <strong>
                {selectedVoice
                  ? `${selectedVoice.displayName || selectedVoice.name} · ${providerName(selectedVoice.provider)}`
                  : "未选择"}
              </strong>
            </div>
            <label className="field grow preview-text-field">
              <span>试听文本</span>
              <textarea
                value={previewText}
                onChange={(event) => updatePreviewText(event.target.value)}
              />
            </label>
            {previewUrl ? (
              <audio
                ref={audioRef}
                className="voice-preview-audio"
                src={previewUrl}
                controls
                onPlay={() => setPreviewStatus("playing")}
                onPause={() => setPreviewStatus("ready")}
                onEnded={() => setPreviewStatus("ready")}
              />
            ) : null}
            <div className="voice-preview-actions">
              <button onClick={handlePreview} disabled={!selectedVoice || !previewText.trim() || previewStatus === "loading"}>
                {previewStatus === "loading" ? <Loader2 className="spin" size={16} /> : <RefreshCcw size={16} />}
                {previewStatus === "loading"
                  ? "生成中..."
                  : previewStatus === "playing"
                    ? "重新生成"
                    : hasCachedPreview
                      ? "重新生成"
                      : "生成试听"}
              </button>
              <button className="primary" onClick={handleSelectVoice} disabled={!selectedVoice}>
                设为当前音色
              </button>
            </div>
            {previewStatus === "playing" ? (
              <div className="inline-feedback">正在播放。</div>
            ) : null}
            {previewStatus === "ready" ? (
              <div className="inline-feedback">已生成试听音频；可用上方进度条播放。</div>
            ) : null}
            {previewStatus === "error" ? (
              <div className="inline-feedback error">试听失败，请检查平台 Key、音色权限或网络。</div>
            ) : null}
          </section>
        </div>
      </section>
    </div>
  );
}
