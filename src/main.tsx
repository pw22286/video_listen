import React from "react";
import { createRoot } from "react-dom/client";
import { EditorView } from "./components/EditorView";
import { HomeView } from "./components/HomeView";
import { VoiceLibraryModal } from "./components/VoiceLibraryModal";
import type { AnalyzedScript, LoadedProject, RecentProject, TtsConfig } from "./electron";
import { initialSteps, type AppStage, type TaskStep } from "./lib/tasks";
import "./styles.css";

function App() {
  const [project, setProject] = React.useState<LoadedProject | null>(null);
  const [recentProjects, setRecentProjects] = React.useState<RecentProject[]>([]);
  const [selectedId, setSelectedId] = React.useState<string | null>(null);
  const [stage, setStage] = React.useState<AppStage>("idle");
  const [steps, setSteps] = React.useState<TaskStep[]>(initialSteps);
  const [taskText, setTaskText] = React.useState("等待创建或打开项目");
  const [error, setError] = React.useState<string | null>(null);
  const [exportPath, setExportPath] = React.useState<string | null>(null);
  const [voiceLibraryOpen, setVoiceLibraryOpen] = React.useState(false);
  const [playingScriptId, setPlayingScriptId] = React.useState<string | null>(null);
  const [generatingScriptId, setGeneratingScriptId] = React.useState<string | null>(null);
  const [currentTimeMs, setCurrentTimeMs] = React.useState(0);
  const videoRef = React.useRef<HTMLVideoElement | null>(null);
  const audioRef = React.useRef<HTMLAudioElement | null>(null);
  const autoPlayedScriptIdRef = React.useRef<string | null>(null);

  React.useEffect(() => {
    void refreshRecentProjects();
  }, []);

  const scripts = project?.scripts ?? [];
  const selectedItem = scripts.find((item) => item.id === selectedId) ?? null;
  const conflictCount = scripts.filter((item) => item.status === "conflict").length;

  React.useEffect(() => {
    const video = videoRef.current;
    if (!video || !project) return;
    const currentVideo = video;
    const currentProject = project;

    function findScriptAtTime(currentSeconds: number) {
      const currentMs = currentSeconds * 1000;
      return scripts.find((item) => (
        item.status !== "disabled" &&
        currentMs >= item.startMs &&
        currentMs < item.startMs + item.durationMs
      )) ?? null;
    }

    function stopNarration() {
      audioRef.current?.pause();
      setPlayingScriptId(null);
    }

    function syncNarration() {
      setCurrentTimeMs(Math.round(currentVideo.currentTime * 1000));
      const current = findScriptAtTime(currentVideo.currentTime);
      if (current && current.id !== selectedId) {
        setSelectedId(current.id);
      }

      if (!currentProject.autoPlayNarration || currentVideo.paused || !current?.ttsUrl) {
        return;
      }

      if (autoPlayedScriptIdRef.current === current.id) {
        return;
      }

      autoPlayedScriptIdRef.current = current.id;
      playAudio(current.ttsUrl);
      setPlayingScriptId(current.id);
    }

    function handleSeeked() {
      autoPlayedScriptIdRef.current = null;
      syncNarration();
    }

    function handlePause() {
      setCurrentTimeMs(Math.round(currentVideo.currentTime * 1000));
      stopNarration();
    }

    currentVideo.addEventListener("timeupdate", syncNarration);
    currentVideo.addEventListener("play", syncNarration);
    currentVideo.addEventListener("seeked", handleSeeked);
    currentVideo.addEventListener("pause", handlePause);
    currentVideo.addEventListener("ended", handlePause);

    return () => {
      currentVideo.removeEventListener("timeupdate", syncNarration);
      currentVideo.removeEventListener("play", syncNarration);
      currentVideo.removeEventListener("seeked", handleSeeked);
      currentVideo.removeEventListener("pause", handlePause);
      currentVideo.removeEventListener("ended", handlePause);
    };
  }, [project, scripts, selectedId]);

  async function refreshRecentProjects() {
    const recent = await window.videoListen?.listRecentProjects();
    setRecentProjects(recent ?? []);
  }

  function applyProject(nextProject: LoadedProject | null) {
    setProject(nextProject);
    setSelectedId(nextProject?.scripts[0]?.id ?? null);
    setSteps(initialSteps);
    setStage("idle");
    setExportPath(null);
    setCurrentTimeMs(0);
    setPlayingScriptId(null);
    autoPlayedScriptIdRef.current = null;
    setTaskText(nextProject ? "项目已打开" : "等待创建或打开项目");
    void refreshRecentProjects();
  }

  async function createProject() {
    setError(null);
    const created = await window.videoListen?.createProject();
    if (created) applyProject(created);
  }

  async function openProject(projectPath?: string) {
    setError(null);
    const opened = await window.videoListen?.openProject(projectPath ? { projectPath } : undefined);
    if (opened) applyProject(opened);
  }

  async function importVideo() {
    if (!project) return;
    setError(null);
    setTaskText("正在复制视频到项目");
    const updated = await window.videoListen?.importVideoToProject({
      projectPath: project.projectPath,
    });
    if (updated) {
      applyProject(updated);
      setTaskText("视频已导入，可以开始分析");
    }
  }

  async function analyzeVideo() {
    if (!project?.video) return;

    setStage("analyzing");
    setError(null);
    setTaskText("正在进行整段理解和 3 秒片段分析");
    setSteps(
      initialSteps.map((step, index) => ({
        ...step,
        status: index === 0 ? "running" : "pending",
      })),
    );

    try {
      const result = await window.videoListen?.analyzeVideo({
        projectPath: project.projectPath,
      });
      if (!result) throw new Error("分析服务没有返回结果");

      setProject(result);
      setSelectedId(result.scripts[0]?.id ?? null);
      setSteps(initialSteps.map((step) => ({ ...step, status: "done" })));
      setTaskText(
        `已生成 ${result.scripts.length} 个片段描述，检测到 ${
          result.analysis?.silences.length ?? 0
        } 个参考静音事件`,
      );
      setStage("idle");
      void refreshRecentProjects();
    } catch (err) {
      setSteps((current) =>
        current.map((step) =>
          step.status === "running" ? { ...step, status: "error" } : step,
        ),
      );
      setError(err instanceof Error ? err.message : "分析失败");
      setTaskText("分析失败");
      setStage("error");
    }
  }

  async function updateScript(patch: Partial<AnalyzedScript>) {
    if (!project || !selectedItem) return;
    const textChanged = patch.text !== undefined && patch.text !== selectedItem.text;
    const nextScript = {
      ...selectedItem,
      ...patch,
      ...(textChanged
        ? {
            ttsPath: undefined,
            ttsUrl: undefined,
            ttsStatus: undefined,
            ttsError: undefined,
            ttsTextHash: undefined,
            ttsConfigHash: undefined,
          }
        : {}),
    };
    setProject({
      ...project,
      scripts: project.scripts.map((item) => (item.id === nextScript.id ? nextScript : item)),
    });
    const updated = await window.videoListen?.updateScript({
      projectPath: project.projectPath,
      script: nextScript,
    });
    if (updated) setProject(updated);
  }

  async function deleteSelected() {
    if (!selectedItem) return;
    await updateScript({ status: "disabled" });
  }

  async function toggleAutoPlayNarration(value: boolean) {
    if (!project) return;
    setProject({ ...project, autoPlayNarration: value });
    const updated = await window.videoListen?.updateSetting({
      projectPath: project.projectPath,
      key: "autoPlayNarration",
      value,
    });
    if (updated) setProject(updated);
  }

  function selectScript(item: AnalyzedScript) {
    setSelectedId(item.id);
    autoPlayedScriptIdRef.current = null;
    if (videoRef.current) {
      videoRef.current.currentTime = item.startMs / 1000;
    }
  }

  function playAudio(url: string) {
    const audio = audioRef.current;
    if (!audio) return;
    // Drive src imperatively only. Binding src to React state and calling
    // play() in the same tick makes the re-render re-issue a load that
    // aborts the in-flight play() (AbortError), so narration never sounds.
    if (audio.src !== url) {
      audio.src = url;
    }
    audio.currentTime = 0;
    void audio.play().catch((err) => {
      if (err?.name !== "AbortError") {
        console.error("旁白播放失败", err);
      }
      setPlayingScriptId(null);
    });
  }

  function scriptHasReusableAudio(item: AnalyzedScript, config = project?.ttsConfig) {
    if (!config || !item.ttsUrl) return false;
    return (
      item.ttsVoiceType === config.speaker &&
      item.ttsSpeechRate === config.speechRate &&
      item.ttsLoudnessRate === config.loudnessRate &&
      item.ttsPitch === config.pitch
    );
  }

  async function previewScript(item: AnalyzedScript, force = false) {
    if (!project) return;
    if (!force && scriptHasReusableAudio(item)) {
      setTaskText("正在播放已生成旁白");
      playAudio(item.ttsUrl!);
      setPlayingScriptId(item.id);
      return;
    }

    setStage("voicing");
    setGeneratingScriptId(item.id);
    setTaskText("正在生成当前脚本旁白");
    setError(null);

    try {
      const updated = await window.videoListen?.generateScriptTts({
        projectPath: project.projectPath,
        scriptId: item.id,
        config: project.ttsConfig,
        force,
      });
      if (updated) {
        setProject(updated);
        const nextItem = updated.scripts.find((script) => script.id === item.id);
        if (nextItem?.ttsUrl) {
          playAudio(nextItem.ttsUrl);
          setPlayingScriptId(item.id);
        }
      }
      setTaskText("当前脚本旁白已生成");
      setStage("idle");
    } catch (err) {
      setError(err instanceof Error ? err.message : "当前脚本旁白生成失败");
      setTaskText("当前脚本旁白生成失败");
      setStage("error");
    } finally {
      setGeneratingScriptId(null);
    }
  }

  const previewVoiceInLibrary = React.useCallback(async (
    voiceType: string,
    text: string,
    config: TtsConfig,
    options?: { force?: boolean },
  ) => {
    if (!project) throw new Error("项目未打开");
    const result = await window.videoListen?.previewTtsVoice({
      projectPath: project.projectPath,
      voiceType,
      config,
      text,
      force: options?.force,
    });
    if (!result?.url) throw new Error("音色试听没有返回音频");
    return result;
  }, [project]);

  const getVoicePreviewCache = React.useCallback(async (
    voiceType: string,
    text: string,
    config: TtsConfig,
  ) => {
    if (!project) throw new Error("项目未打开");
    return window.videoListen?.getTtsPreviewCache({
      projectPath: project.projectPath,
      voiceType,
      config,
      text,
    }) ?? null;
  }, [project]);

  async function updateTtsConfig(config: TtsConfig) {
    if (!project) return;
    setProject({ ...project, ttsConfig: config });
    const updated = await window.videoListen?.updateTtsConfig({
      projectPath: project.projectPath,
      config,
    });
    if (updated) setProject(updated);
  }

  async function generateVoices() {
    if (!project || scripts.length === 0) return;
    setStage("voicing");
    setTaskText("正在调用火山 TTS 生成旁白");
    setError(null);

    try {
      const updated = await window.videoListen?.generateAllTts({
        projectPath: project.projectPath,
        config: project.ttsConfig,
      });
      if (updated) setProject(updated);
      setTaskText("旁白音频已生成");
      setStage("idle");
    } catch (err) {
      setError(err instanceof Error ? err.message : "旁白生成失败");
      setTaskText("旁白生成失败");
      setStage("error");
    }
  }

  async function exportScript() {
    if (!project) return;
    setStage("exporting");
    setTaskText("正在导出口述脚本");

    try {
      const result = await window.videoListen?.exportScript({
        project,
        scripts,
        exportedAt: new Date().toISOString(),
      });

      if (result) {
        setExportPath(result.path);
        setStage("done");
        setTaskText("导出完成");
      } else {
        setStage("idle");
        setTaskText("已取消导出");
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "导出失败");
      setStage("error");
      setTaskText("处理失败");
    }
  }

  if (!project) {
    return (
      <HomeView
        recentProjects={recentProjects}
        onCreateProject={createProject}
        onOpenProject={() => openProject()}
        onOpenRecent={(item) => openProject(item.projectPath)}
      />
    );
  }

  return (
    <>
      <EditorView
        project={project}
        scripts={scripts}
        selectedItem={selectedItem}
        selectedId={selectedId}
        conflictCount={conflictCount}
        steps={steps}
        stage={stage}
        taskText={taskText}
        error={error}
        exportPath={exportPath}
        videoRef={videoRef}
        onBackHome={() => setProject(null)}
        onImportVideo={importVideo}
        onAnalyze={analyzeVideo}
        onVoice={generateVoices}
        onExport={exportScript}
        onSelectScript={selectScript}
        onSpeak={previewScript}
        onUpdateScript={updateScript}
        onDeleteSelected={deleteSelected}
        onDismissError={() => setError(null)}
        onToggleAutoPlay={toggleAutoPlayNarration}
        onUpdateTtsConfig={updateTtsConfig}
        onOpenVoiceLibrary={() => setVoiceLibraryOpen(true)}
        onForceSpeak={(item) => previewScript(item, true)}
        playingScriptId={playingScriptId}
        generatingScriptId={generatingScriptId}
        canReuseScriptAudio={(item) => scriptHasReusableAudio(item)}
        currentTimeMs={currentTimeMs}
      />
      {voiceLibraryOpen ? (
        <VoiceLibraryModal
          project={project}
          currentVoiceType={project.ttsConfig.speaker}
          onClose={() => setVoiceLibraryOpen(false)}
          onPreview={previewVoiceInLibrary}
          onGetCache={getVoicePreviewCache}
          onSelectVoice={(voiceType) =>
            updateTtsConfig({
              ...project.ttsConfig,
              speaker: voiceType,
            })
          }
          onError={(message) => {
            setError(message);
            setTaskText("音色试听失败");
          }}
        />
      ) : null}
      <audio
        ref={audioRef}
        onEnded={() => setPlayingScriptId(null)}
        onPause={() => setPlayingScriptId(null)}
      />
    </>
  );
}

createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
