import type { AnalyzedScript } from "../electron";
import { formatTime } from "../lib/format";

export function Timeline({
  scripts,
  selectedId,
  onSelect,
  autoPlayNarration,
  onToggleAutoPlay,
  currentTimeMs,
}: {
  scripts: AnalyzedScript[];
  selectedId: string | null;
  onSelect: (item: AnalyzedScript) => void;
  autoPlayNarration: boolean;
  onToggleAutoPlay: (value: boolean) => void;
  currentTimeMs: number;
}) {
  const total = Math.max(...scripts.map((item) => item.startMs + item.durationMs), 1);
  const selectedItem = scripts.find((item) => item.id === selectedId) ?? null;
  const totalSeconds = Math.max(1, Math.ceil(total / 1000));
  const pixelsPerSecond = 34;
  const timelineWidth = Math.max(960, totalSeconds * pixelsPerSecond);
  const playheadLeft = Math.max(0, Math.min(timelineWidth, (currentTimeMs / total) * timelineWidth));
  const tickIntervalSeconds = totalSeconds > 600 ? 60 : totalSeconds > 180 ? 30 : 15;
  const ticks = Array.from(
    { length: Math.floor(totalSeconds / tickIntervalSeconds) + 1 },
    (_, index) => index * tickIntervalSeconds,
  );

  return (
    <section className="timeline-bar">
      <div className="timeline-tools">
        <div>
          <strong>时间轴</strong>
          <span>{scripts.length} 条脚本</span>
          {selectedItem ? <span>当前 {formatTime(selectedItem.startMs)}</span> : null}
        </div>
        <label className="timeline-switch">
          <span>自动播放口述</span>
          <input
            type="checkbox"
            checked={autoPlayNarration}
            onChange={(event) => onToggleAutoPlay(event.target.checked)}
          />
        </label>
      </div>
      <div className="timeline-viewport">
        <div className="timeline-canvas" style={{ width: `${timelineWidth}px` }}>
          <div className="timeline-ruler">
            {ticks.map((seconds) => (
              <span
                key={seconds}
                className="timeline-tick"
                style={{ left: `${(seconds * 1000 / total) * timelineWidth}px` }}
              >
                {formatTime(seconds * 1000)}
              </span>
            ))}
          </div>
          <div className="timeline-track">
            {scripts.length === 0 ? (
              <div className="timeline-empty">导入并分析视频后，脚本片段会显示在这里。</div>
            ) : (
              scripts.map((item) => {
                const left = (item.startMs / total) * timelineWidth;
                const width = Math.max(32, (item.durationMs / total) * timelineWidth);
                return (
                  <button
                    key={item.id}
                    className={`timeline-block ${item.id === selectedId ? "active" : ""} ${item.ttsUrl ? "voiced" : ""} ${item.status}`}
                    style={{
                      left: `${left}px`,
                      width: `${width}px`,
                    }}
                    onClick={() => onSelect(item)}
                    title={`${formatTime(item.startMs)} ${item.text}`}
                  >
                    <span>{formatTime(item.startMs)}</span>
                  </button>
                );
              })
            )}
            <div className="timeline-playhead" style={{ left: `${playheadLeft}px` }} />
          </div>
        </div>
      </div>
    </section>
  );
}
