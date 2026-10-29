import React from "react";
import {
  Clock3,
  Download,
  FileVideo,
  Home,
  Info,
  Plus,
  SlidersHorizontal,
  Upload,
  Volume2,
  Wand2,
} from "lucide-react";
import type { AnalyzedScript, LoadedProject, TtsConfig } from "../electron";
import type { AppStage, TaskStep } from "../lib/tasks";
import { ErrorBanner, ExportToast, PanelHeader } from "./common";
import { ScriptEditor } from "./ScriptEditor";
import { ScriptRow } from "./ScriptRow";
import { TaskProgress } from "./TaskProgress";
import { Timeline } from "./Timeline";

export function EditorView({
  project,
  scripts,
  selectedItem,
  selectedId,
  conflictCount,
  steps,
  stage,
  taskText,
  error,
  exportPath,
  videoRef,
  onBackHome,
  onImportVideo,
  onAnalyze,
  onVoice,
  onExport,
  onSelectScript,
  onSpeak,
  onUpdateScript,
  onDeleteSelected,
  onDismissError,
  onToggleAutoPlay,
  onUpdateTtsConfig,
  onOpenVoiceLibrary,
  onForceSpeak,
  playingScriptId,
  generatingScriptId,
  canReuseScriptAudio,
  currentTimeMs,
}: {
  project: LoadedProject;
  scripts: AnalyzedScript[];
  selectedItem: AnalyzedScript | null;
  selectedId: string | null;
  conflictCount: number;
  steps: TaskStep[];
  stage: AppStage;
  taskText: string;
  error: string | null;
  exportPath: string | null;
  videoRef: React.RefObject<HTMLVideoElement | null>;
  onBackHome: () => void;
  onImportVideo: () => void;
  onAnalyze: () => void;
  onVoice: () => void;
  onExport: () => void;
  onSelectScript: (item: AnalyzedScript) => void;
  onSpeak: (item: AnalyzedScript) => void;
  onUpdateScript: (patch: Partial<AnalyzedScript>) => void;
  onDeleteSelected: () => void;
  onDismissError: () => void;
  onToggleAutoPlay: (value: boolean) => void;
  onUpdateTtsConfig: (config: TtsConfig) => void;
  onOpenVoiceLibrary: () => void;
  onForceSpeak: (item: AnalyzedScript) => void;
  playingScriptId: string | null;
  generatingScriptId: string | null;
  canReuseScriptAudio: (item: AnalyzedScript) => boolean;
  currentTimeMs: number;
}) {
  const [leftWidth, setLeftWidth] = React.useState(390);
  const [rightWidth, setRightWidth] = React.useState(360);
  const [timelineHeight, setTimelineHeight] = React.useState(210);
  const [scriptFilter, setScriptFilter] = React.useState<"all" | "unvoiced" | "voiced" | "conflict" | "disabled">("all");
  const dragStartRef = React.useRef<{
    type: "left" | "right" | "timeline";
    x: number;
    y: number;
    leftWidth: number;
    rightWidth: number;
    timelineHeight: number;
  } | null>(null);

  React.useEffect(() => {
    function handlePointerMove(event: PointerEvent) {
      const drag = dragStartRef.current;
      if (!drag) return;

      if (drag.type === "timeline") {
        const maxTimeline = Math.min(220, Math.max(120, window.innerHeight - 50 - 360));
        setTimelineHeight(Math.min(maxTimeline, Math.max(120, drag.timelineHeight - (event.clientY - drag.y))));
      }
    }

    function handlePointerUp() {
      dragStartRef.current = null;
      document.body.classList.remove("is-resizing");
    }

    window.addEventListener("pointermove", handlePointerMove);
    window.addEventListener("pointerup", handlePointerUp);
    return () => {
      window.removeEventListener("pointermove", handlePointerMove);
      window.removeEventListener("pointerup", handlePointerUp);
    };
  }, []);

  function startResize(type: "left" | "right" | "timeline", event: React.PointerEvent) {
    dragStartRef.current = {
      type,
      x: event.clientX,
      y: event.clientY,
      leftWidth,
      rightWidth,
      timelineHeight,
    };
    document.body.classList.add("is-resizing");
  }

  const selectedVoice =
    project.ttsVoices.find((voice) => voice.voiceType === project.ttsConfig.speaker) ??
    project.ttsVoices[0];
  const visibleScripts = scripts.filter((item) => {
    if (scriptFilter === "all") return true;
    if (scriptFilter === "unvoiced") return !item.ttsUrl && item.status !== "disabled";
    if (scriptFilter === "voiced") return Boolean(item.ttsUrl);
    return item.status === scriptFilter;
  });
  const scriptFilters = [
    { key: "all", label: "全部", count: scripts.length },
    { key: "unvoiced", label: "未生成", count: scripts.filter((item) => !item.ttsUrl && item.status !== "disabled").length },
    { key: "voiced", label: "已生成", count: scripts.filter((item) => item.ttsUrl).length },
    { key: "conflict", label: "异常", count: scripts.filter((item) => item.status === "conflict").length },
    { key: "disabled", label: "禁用", count: scripts.filter((item) => item.status === "disabled").length },
  ] as const;

  return (
    <div
      className="editor-shell"
      style={
        {
          "--left-panel-width": `${leftWidth}px`,
          "--right-panel-width": `${rightWidth}px`,
          "--timeline-height": `${timelineHeight}px`,
        } as React.CSSProperties
      }
    >
      <header className="editor-topbar">
        <div className="project-title">
          <button className="icon-button" onClick={onBackHome}>
            <Home size={17} />
          </button>
          <div>
            <strong>{project.name}</strong>
            <span>已自动保存到本地</span>
          </div>
        </div>

        <div className="editor-actions-main">
          <button onClick={onImportVideo}>
            <Upload size={16} />
            导入视频
          </button>
          <button onClick={onAnalyze} disabled={!project.video || stage === "analyzing"}>
            <Wand2 size={16} />
            分析
          </button>
          <button onClick={onVoice} disabled={scripts.length === 0}>
            <Volume2 size={16} />
            生成旁白
          </button>
          <button onClick={onOpenVoiceLibrary}>
            <SlidersHorizontal size={16} />
            音色库
          </button>
          <button className="primary" onClick={onExport} disabled={scripts.length === 0}>
            <Download size={16} />
            导出脚本
          </button>
        </div>
      </header>

      {error ? <ErrorBanner message={error} onDismiss={onDismissError} /> : null}

      <main className="editor-grid">
        <section className="media-panel dark-panel">
          <PanelHeader title="素材与脚本" subtitle={project.video?.fileName ?? "尚未导入视频"} />
          <div className="source-box">
            <FileVideo size={18} />
            <div>
              <strong>{project.video?.fileName ?? "未导入视频"}</strong>
              <span>
                {project.video ? `${project.video.duration} · ${project.video.resolution}` : "导入视频后开始分析"}
              </span>
            </div>
          </div>

          <div className="script-filter-bar">
            {scriptFilters.map((filter) => (
              <button
                key={filter.key}
                className={scriptFilter === filter.key ? "active" : ""}
                onClick={() => setScriptFilter(filter.key)}
              >
                {filter.label}
                <span>{filter.count}</span>
              </button>
            ))}
          </div>

          <div className="script-list dark-list">
            {scripts.length === 0 ? (
              <div className="empty-panel">
                <Clock3 size={24} />
                <p>分析后这里会显示口述脚本。</p>
              </div>
            ) : visibleScripts.length === 0 ? (
              <div className="empty-panel compact-empty">
                <Clock3 size={22} />
                <p>当前筛选下没有脚本。</p>
              </div>
            ) : (
              visibleScripts.map((item) => (
                <ScriptRow
                  key={item.id}
                  item={item}
                  active={item.id === selectedId}
                  isPlaying={playingScriptId === item.id}
                  isGenerating={generatingScriptId === item.id}
                  onClick={() => onSelectScript(item)}
                  onSpeak={() => onSpeak(item)}
                />
              ))
            )}
          </div>

          <div className="project-status-dock">
            {project.globalContext ? (
              <details className="global-context">
                <summary>
                  <Info size={14} />
                  全局理解
                </summary>
                <p>{project.globalContext}</p>
              </details>
            ) : null}
            <TaskProgress steps={steps} stage={stage} taskText={taskText} />
          </div>
        </section>

        <section className="player-panel dark-panel">
          <PanelHeader
            title="播放器"
            subtitle={project.video ? `${project.video.duration} · ${project.video.resolution}` : "等待导入视频"}
          />
          {project.video ? (
            <div className="video-frame">
              <video
                key={project.video.url}
                ref={videoRef}
                className="video"
                src={project.video.url}
                controls
                preload="metadata"
              />
            </div>
          ) : (
            <button className="import-drop" onClick={onImportVideo}>
              <Plus size={20} />
              导入视频
            </button>
          )}
        </section>

        <ScriptEditor
          item={selectedItem}
          conflictCount={conflictCount}
          onChange={onUpdateScript}
          onDelete={onDeleteSelected}
          onSpeak={() => selectedItem && onSpeak(selectedItem)}
          ttsConfig={project.ttsConfig}
          selectedVoice={selectedVoice}
          onUpdateTtsConfig={onUpdateTtsConfig}
          onOpenVoiceLibrary={onOpenVoiceLibrary}
          onForceSpeak={() => selectedItem && onForceSpeak(selectedItem)}
          isGenerating={selectedItem ? generatingScriptId === selectedItem.id : false}
          isPlaying={selectedItem ? playingScriptId === selectedItem.id : false}
          canReuseAudio={selectedItem ? canReuseScriptAudio(selectedItem) : false}
        />
      </main>

      <button
        className="resize-handle horizontal"
        aria-label="调整时间轴高度"
        onPointerDown={(event) => startResize("timeline", event)}
      />
      <Timeline
        scripts={scripts}
        selectedId={selectedId}
        onSelect={onSelectScript}
        autoPlayNarration={project.autoPlayNarration}
        onToggleAutoPlay={onToggleAutoPlay}
        currentTimeMs={currentTimeMs}
      />

      {stage === "done" && exportPath ? <ExportToast path={exportPath} /> : null}
    </div>
  );
}
