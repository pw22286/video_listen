import {
  AlertCircle,
  ChevronDown,
  Clock3,
  Loader2,
  Pause,
  Play,
  RefreshCcw,
  Trash2,
} from "lucide-react";
import type { AnalyzedScript, TtsConfig, TtsVoice } from "../electron";
import { rangeStyle } from "../lib/format";
import { getVoiceTextCompatibilityWarning, providerName } from "../lib/voice";
import { PanelHeader } from "./common";

export function ScriptEditor({
  item,
  conflictCount,
  onChange,
  onDelete,
  onSpeak,
  ttsConfig,
  selectedVoice,
  onUpdateTtsConfig,
  onOpenVoiceLibrary,
  onForceSpeak,
  isGenerating,
  isPlaying,
  canReuseAudio,
}: {
  item: AnalyzedScript | null;
  conflictCount: number;
  onChange: (patch: Partial<AnalyzedScript>) => void;
  onDelete: () => void;
  onSpeak: () => void;
  ttsConfig: TtsConfig;
  selectedVoice?: TtsVoice;
  onUpdateTtsConfig: (config: TtsConfig) => void;
  onOpenVoiceLibrary: () => void;
  onForceSpeak: () => void;
  isGenerating: boolean;
  isPlaying: boolean;
  canReuseAudio: boolean;
}) {
  const capabilities = selectedVoice?.capabilities ?? {
    speechRate: true,
    loudnessRate: true,
    pitch: true,
  };
  const voiceWarning = item
    ? getVoiceTextCompatibilityWarning(selectedVoice, item.text)
    : null;
  const canPlayCachedAudio = Boolean(item?.ttsUrl && canReuseAudio);

  return (
    <aside className="inspector-panel dark-panel">
      <PanelHeader title="脚本参数" subtitle={`${conflictCount} 条需要处理`} />

      {!item ? (
        <div className="empty-panel">
          <Pause size={28} />
          <p>选择一条脚本后，可以编辑文本、试听或禁用。</p>
        </div>
      ) : (
        <>
          <div className="inspector-scroll">
            <div className="script-meta-card">
              <div>
                <Clock3 size={15} />
                <span>起始时间</span>
              </div>
              <input
                value={item.startMs}
                type="number"
                onChange={(event) => onChange({ startMs: Number(event.target.value) })}
              />
            </div>

            <label className="field script-text-field">
              <span>口述文本</span>
              <textarea
                value={item.text}
                onChange={(event) => onChange({ text: event.target.value })}
              />
            </label>

            {canPlayCachedAudio ? (
              <div className="script-audio-card">
                <div>
                  <span>已生成旁白</span>
                  <strong>{isPlaying ? "正在播放" : "可直接试听"}</strong>
                </div>
                <audio src={item.ttsUrl} controls />
              </div>
            ) : null}

            {item.status === "conflict" ? (
              <div className="warning-box">
                <AlertCircle size={16} />
                {item.note ?? "这条描述需要检查"}
              </div>
            ) : null}

            {voiceWarning ? (
              <div className="warning-box">
                <AlertCircle size={16} />
                {voiceWarning}
              </div>
            ) : null}

            <details className="inspector-section">
              <summary>对应片段</summary>
              <div className="segment-preview">
                <div>
                  {item.segmentUrl ? (
                    <video src={item.segmentUrl} muted controls />
                  ) : item.frameUrl ? (
                    <img src={item.frameUrl} alt={item.frameLabel} />
                  ) : (
                    item.frameLabel
                  )}
                </div>
              </div>
            </details>

            <details className="inspector-section" open>
              <summary>TTS 基础配置</summary>
              <div className="tts-config">
                <div className="current-voice-card">
                  <div>
                    <span>当前音色</span>
                    <strong>
                      {selectedVoice
                        ? `${selectedVoice.displayName || selectedVoice.name} · ${providerName(selectedVoice.provider)}`
                        : "未选择音色"}
                    </strong>
                    <small>{selectedVoice ? `${selectedVoice.scene} · ${selectedVoice.language}` : "从音色库选择"}</small>
                  </div>
                  <button onClick={onOpenVoiceLibrary}>
                    <ChevronDown size={15} />
                    更换
                  </button>
                </div>

                {capabilities.speechRate ? (
                  <label className="field compact">
                    <span>语速 {ttsConfig.speechRate}</span>
                    <input
                      type="range"
                      min={-50}
                      max={100}
                      value={ttsConfig.speechRate}
                      style={rangeStyle(ttsConfig.speechRate, -50, 100)}
                      onChange={(event) =>
                        onUpdateTtsConfig({ ...ttsConfig, speechRate: Number(event.target.value) })
                      }
                    />
                  </label>
                ) : null}

                {capabilities.loudnessRate ? (
                  <label className="field compact">
                    <span>音量 {ttsConfig.loudnessRate}</span>
                    <input
                      type="range"
                      min={-50}
                      max={100}
                      value={ttsConfig.loudnessRate}
                      style={rangeStyle(ttsConfig.loudnessRate, -50, 100)}
                      onChange={(event) =>
                        onUpdateTtsConfig({ ...ttsConfig, loudnessRate: Number(event.target.value) })
                      }
                    />
                  </label>
                ) : null}

                {capabilities.pitch ? (
                  <label className="field compact">
                    <span>音高 {ttsConfig.pitch}</span>
                    <input
                      type="range"
                      min={-12}
                      max={12}
                      value={ttsConfig.pitch}
                      style={rangeStyle(ttsConfig.pitch, -12, 12)}
                      onChange={(event) =>
                        onUpdateTtsConfig({ ...ttsConfig, pitch: Number(event.target.value) })
                      }
                    />
                  </label>
                ) : null}
              </div>
            </details>
          </div>

          <div className="inspector-actions">
            <button onClick={onSpeak} disabled={isGenerating || Boolean(voiceWarning)}>
              {isGenerating ? <Loader2 className="spin" size={16} /> : <Play size={16} />}
              {isGenerating ? "生成中..." : isPlaying ? "正在播放" : canPlayCachedAudio ? "播放旁白" : "生成并试听"}
            </button>
            {item.ttsUrl ? (
              <button onClick={onForceSpeak} disabled={isGenerating || Boolean(voiceWarning)}>
                <RefreshCcw size={16} />
                重新生成
              </button>
            ) : null}
            <button
              onClick={() =>
                onChange({
                  text: "这条描述需要重新分析或手动改写。",
                  status: "draft",
                  note: undefined,
                })
              }
            >
              <RefreshCcw size={16} />
              标记重写
            </button>
            <button className="danger" onClick={onDelete}>
              <Trash2 size={16} />
              {item.status === "disabled" ? "已禁用" : "禁用"}
            </button>
          </div>
        </>
      )}
    </aside>
  );
}
