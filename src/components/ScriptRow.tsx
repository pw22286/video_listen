import { Loader2, Play, Volume2 } from "lucide-react";
import type { AnalyzedScript } from "../electron";
import { formatTime } from "../lib/format";
import { statusText } from "../lib/voice";

export function ScriptRow({
  item,
  active,
  isPlaying,
  isGenerating,
  onClick,
  onSpeak,
}: {
  item: AnalyzedScript;
  active: boolean;
  isPlaying: boolean;
  isGenerating: boolean;
  onClick: () => void;
  onSpeak: () => void;
}) {
  return (
    <button className={`script-row ${active ? "active" : ""}`} onClick={onClick}>
      <div className="script-row-top">
        <div>
          <span className="timecode">{formatTime(item.startMs)}</span>
          <span className="script-duration">{(item.durationMs / 1000).toFixed(1)}s</span>
        </div>
        <span className={`script-status ${item.status}`}>{statusText(item.status)}</span>
      </div>
      <p>{item.text}</p>
      <div className="script-row-bottom">
        <span className={`audio-state ${item.ttsUrl ? "ready" : "empty"}`}>
          <Volume2 size={13} />
          {item.ttsUrl ? "已生成" : "未生成"}
        </span>
        <span
          className="inline-action"
          onClick={(event) => {
            event.stopPropagation();
            onSpeak();
          }}
        >
          {isGenerating ? <Loader2 className="spin" size={13} /> : <Play size={13} />}
          {isGenerating ? "生成中" : isPlaying ? "正在播放" : "试听"}
        </span>
      </div>
      {item.note ? <small>{item.note}</small> : null}
    </button>
  );
}
