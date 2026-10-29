export type SelectedVideo = {
  path: string;
  name: string;
  url: string;
};

export type RecentProject = {
  id: number;
  name: string;
  projectPath: string;
  projectFilePath: string;
  lastOpenedAt: string;
  videoName?: string | null;
};

export type VideoAsset = {
  id: number;
  fileName: string;
  relativePath: string;
  path: string;
  url: string;
  duration: string;
  resolution: string;
};

export type ExportResult = {
  path: string;
};

export type TtsVoice = {
  id: number;
  provider: string;
  providerVoiceId: string;
  displayName: string;
  model: string;
  scene: string;
  name: string;
  voiceType: string;
  language: string;
  capability: string;
  capabilities?: {
    speechRate?: boolean;
    loudnessRate?: boolean;
    pitch?: boolean;
  };
  tags: string;
  previewRelativePath?: string | null;
  previewUrl?: string;
};

export type TtsConfig = {
  speaker: string;
  speechRate: number;
  loudnessRate: number;
  pitch: number;
};

export type AnalyzedScript = {
  id: string;
  startMs: number;
  durationMs: number;
  text: string;
  status: "draft" | "voiced" | "conflict" | "disabled";
  frameLabel: string;
  framePath?: string;
  frameUrl?: string;
  segmentPath?: string;
  segmentUrl?: string;
  ttsPath?: string;
  ttsUrl?: string;
  ttsStatus?: "running" | "completed" | "error";
  ttsError?: string;
  ttsVoiceType?: string;
  ttsSpeechRate?: number;
  ttsLoudnessRate?: number;
  ttsPitch?: number;
  ttsTextHash?: string;
  ttsConfigHash?: string;
  note?: string;
};

export type AnalyzeResult = {
  metadata: {
    duration: string;
    resolution: string;
    durationSeconds?: number;
  };
  silences: Array<{
    type: "start" | "end";
    time: number;
    duration?: number;
  }>;
  globalContext?: string;
  scripts: AnalyzedScript[];
};

export type LoadedProject = {
  name: string;
  projectPath: string;
  projectFilePath: string;
  video: VideoAsset | null;
  globalContext?: string;
  autoPlayNarration: boolean;
  ttsConfig: TtsConfig;
  ttsVoices: TtsVoice[];
  scripts: AnalyzedScript[];
  analysis?: {
    metadata: {
      duration: string;
      resolution: string;
      durationSeconds?: number;
    };
    silences: Array<{
      type: "start" | "end";
      time: number;
      duration?: number;
    }>;
    globalContext?: string;
  };
};

declare global {
  interface Window {
    videoListen?: {
      createProject: () => Promise<LoadedProject | null>;
      openProject: (payload?: { projectPath?: string }) => Promise<LoadedProject | null>;
      listRecentProjects: () => Promise<RecentProject[]>;
      saveProject: (payload: { projectPath: string; name?: string }) => Promise<LoadedProject>;
      updateScript: (payload: {
        projectPath: string;
        script: AnalyzedScript;
      }) => Promise<LoadedProject>;
      updateSetting: (payload: {
        projectPath: string;
        key: string;
        value: string | boolean;
      }) => Promise<LoadedProject>;
      updateTtsConfig: (payload: {
        projectPath: string;
        config: TtsConfig;
      }) => Promise<LoadedProject>;
      previewTtsVoice: (payload: {
        projectPath: string;
        config: TtsConfig;
        voiceType?: string;
        text?: string;
        force?: boolean;
      }) => Promise<{ path: string; url: string }>;
      getTtsPreviewCache: (payload: {
        projectPath: string;
        config: TtsConfig;
        voiceType?: string;
        text?: string;
      }) => Promise<{ path: string; url: string } | null>;
      generateScriptTts: (payload: {
        projectPath: string;
        scriptId: string;
        config: TtsConfig;
        force?: boolean;
      }) => Promise<LoadedProject>;
      generateAllTts: (payload: {
        projectPath: string;
        config: TtsConfig;
      }) => Promise<LoadedProject>;
      importVideoToProject: (payload: { projectPath: string }) => Promise<LoadedProject | null>;
      analyzeVideo: (payload: { projectPath: string }) => Promise<LoadedProject>;
      exportScript: (payload: unknown) => Promise<ExportResult | null>;
    };
  }
}

export {};
