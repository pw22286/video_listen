const { app, BrowserWindow, dialog, ipcMain, net, protocol } = require("electron");
const crypto = require("node:crypto");
const { execFile } = require("node:child_process");
const path = require("node:path");
const fs = require("node:fs/promises");
const fsSync = require("node:fs");
const { promisify } = require("node:util");
const {
  DEFAULT_KIMI_BASE_URL,
  DEFAULT_KIMI_MODEL,
  DEFAULT_TTS_PREVIEW_TEXT,
  FFMPEG_BIN,
  FFPROBE_BIN,
  PROJECT_FILE,
  SEGMENT_SECONDS,
} = require("./services/constants.cjs");
const { loadLocalEnv } = require("./services/env.cjs");
const { formatDuration, formatTimecode } = require("./services/format.cjs");
const { resolveProjectPath, toMediaUrl, toPosixRelative } = require("./services/paths.cjs");
const {
  getProjectMeta,
  getTtsConfig,
  getTtsVoiceByType,
  openAppDb: openAppDbBase,
  openProjectDb: openProjectDbBase,
  parseCapabilities,
  setProjectMeta,
  setTtsConfig,
} = require("./services/project-store.cjs");
const {
  makeTextHash,
  makeTtsConfigHash,
  normalizeTtsConfig,
  synthesizeSpeech,
} = require("./services/tts-service.cjs");

const isDev = !app.isPackaged;
const execFileAsync = promisify(execFile);
const SEGMENT_AD_PROMPT = `# Role
你是一名国际标准的影视剧“口述影像（Audio Description）”专家，专门为视障人士编写专业的视频无障碍解说脚本。

# Task
请仔细观看我提供的视频片段，并根据国际通用标准（WCAG 及 ISO 规范），为该片段生成规范的、可供配音员直接朗读的口述影像脚本。

# Strict Rules（铁律，必须严格执行）
1. 绝对客观，只描述“所见”：
   - 只描述视频画面中明确出现的动作、人物、场景、服装和光线。
   - 严禁解读、分析或脑补。严禁使用描述心理、动机或抽象情绪的词汇。
   - ❌ 错误示例：“他愤怒地握紧拳头，想要报仇。”
   -  正确示例：“他面部肌肉紧绷，右手握紧拳头。”

2. 零胡思乱想（反幻觉）：
   - 只能描述镜头内视野（FOV）内的实体。严禁添油加醋描述镜头外、画面中不存在、或者你猜测可能存在的景物。

3. 精炼、克制（见缝插针）：
   - 用词必须极度精简，避免长句。
   - 确保解说词字数极少，能无缝插入到角色不说话的转场和动作空白期中。

4. 语调中立：
   - 使用客观、第三方视角的叙述性语言，不要带有任何煽情或戏剧化的修饰词。`;

protocol.registerSchemesAsPrivileged([
  {
    scheme: "media",
    privileges: {
      standard: true,
      secure: true,
      stream: true,
      supportFetchAPI: true,
    },
  },
]);

function openAppDb() {
  return openAppDbBase(app.getPath("userData"));
}

function openProjectDb(projectPath) {
  return openProjectDbBase(projectPath, app.getAppPath());
}

async function ensureProjectDirs(projectPath) {
  await fs.mkdir(path.join(projectPath, "source"), { recursive: true });
  await fs.mkdir(path.join(projectPath, "cache", "segments"), { recursive: true });
  await fs.mkdir(path.join(projectPath, "cache", "context"), { recursive: true });
  await fs.mkdir(path.join(projectPath, "cache", "tts"), { recursive: true });
  await fs.mkdir(path.join(projectPath, "exports"), { recursive: true });
}

function readProjectFile(projectPath) {
  const filePath = path.join(projectPath, PROJECT_FILE);
  if (!fsSync.existsSync(filePath)) return null;
  return JSON.parse(fsSync.readFileSync(filePath, "utf8"));
}

async function writeProjectFile(projectPath, data) {
  await fs.writeFile(
    path.join(projectPath, PROJECT_FILE),
    JSON.stringify(data, null, 2),
    "utf8",
  );
}

function upsertRecentProject(project) {
  const db = openAppDb();
  try {
    db.prepare(`
      INSERT INTO recent_projects (name, project_path, project_file_path, last_opened_at, video_name)
      VALUES (@name, @projectPath, @projectFilePath, @lastOpenedAt, @videoName)
      ON CONFLICT(project_path) DO UPDATE SET
        name = excluded.name,
        project_file_path = excluded.project_file_path,
        last_opened_at = excluded.last_opened_at,
        video_name = excluded.video_name
    `).run({
      name: project.name,
      projectPath: project.projectPath,
      projectFilePath: path.join(project.projectPath, PROJECT_FILE),
      lastOpenedAt: new Date().toISOString(),
      videoName: project.video?.fileName ?? null,
    });
  } finally {
    db.close();
  }
}

function loadProject(projectPath) {
  const projectFile = readProjectFile(projectPath) ?? {
    name: path.basename(projectPath),
    projectPath,
    version: 1,
  };
  const db = openProjectDb(projectPath);

  try {
    const video = db.prepare("SELECT * FROM videos ORDER BY id DESC LIMIT 1").get();
    const scripts = db.prepare(`
      SELECT
        scripts.id,
        scripts.segment_id AS segmentId,
        scripts.start_ms AS startMs,
        scripts.duration_ms AS durationMs,
        scripts.text,
        scripts.status,
        scripts.note,
        scripts.tts_relative_path AS ttsRelativePath,
        scripts.tts_status AS ttsStatus,
        scripts.tts_error AS ttsError,
        scripts.tts_voice_type AS ttsVoiceType,
        scripts.tts_speech_rate AS ttsSpeechRate,
        scripts.tts_loudness_rate AS ttsLoudnessRate,
        scripts.tts_pitch AS ttsPitch,
        scripts.tts_text_hash AS ttsTextHash,
        scripts.tts_config_hash AS ttsConfigHash,
        segments.relative_path AS segmentRelativePath
      FROM scripts
      LEFT JOIN segments ON segments.id = scripts.segment_id
      ORDER BY scripts.start_ms ASC, scripts.id ASC
    `).all();
    const ttsVoices = db.prepare(`
      SELECT
        id,
        provider,
        provider_voice_id AS providerVoiceId,
        display_name AS displayName,
        model,
        scene,
        name,
        voice_type AS voiceType,
        language,
        capability,
        capabilities_json AS capabilitiesJson,
        preview_relative_path AS previewRelativePath,
        tags
      FROM tts_voices
      ORDER BY scene ASC, id ASC
    `).all().map((voice) => ({
      ...voice,
      provider: voice.provider || VOLCENGINE_PROVIDER,
      providerVoiceId: voice.providerVoiceId || voice.voiceType,
      displayName: voice.displayName || voice.name,
      capabilities: parseCapabilities(voice.capabilitiesJson),
      previewUrl: voice.previewRelativePath
        ? toMediaUrl(resolveProjectPath(projectPath, voice.previewRelativePath))
        : undefined,
    }));

    const loadedProject = {
      name: projectFile.name ?? path.basename(projectPath),
      projectPath,
      projectFilePath: path.join(projectPath, PROJECT_FILE),
      video: video
        ? {
            id: video.id,
            fileName: video.file_name,
            relativePath: video.relative_path,
            path: resolveProjectPath(projectPath, video.relative_path),
            url: toMediaUrl(resolveProjectPath(projectPath, video.relative_path)),
            duration: video.duration || "待分析",
            resolution: video.resolution || "待分析",
          }
        : null,
      globalContext: getProjectMeta(db, "globalContext"),
      autoPlayNarration: getProjectMeta(db, "autoPlayNarration") === "true",
      ttsConfig: getTtsConfig(db),
      ttsVoices,
      scripts: scripts.map((script) => ({
        id: String(script.id),
        segmentId: script.segmentId,
        startMs: script.startMs,
        durationMs: script.durationMs,
        text: script.text,
        status: script.status,
        note: script.note ?? undefined,
        frameLabel: formatTimecode(script.startMs),
        segmentPath: script.segmentRelativePath
          ? resolveProjectPath(projectPath, script.segmentRelativePath)
          : undefined,
        segmentUrl: script.segmentRelativePath
          ? toMediaUrl(resolveProjectPath(projectPath, script.segmentRelativePath))
          : undefined,
        ttsPath: script.ttsRelativePath
          ? resolveProjectPath(projectPath, script.ttsRelativePath)
          : undefined,
        ttsUrl: script.ttsRelativePath
          ? toMediaUrl(resolveProjectPath(projectPath, script.ttsRelativePath))
          : undefined,
        ttsStatus: script.ttsStatus ?? undefined,
        ttsError: script.ttsError ?? undefined,
        ttsVoiceType: script.ttsVoiceType ?? undefined,
        ttsSpeechRate: script.ttsSpeechRate ?? undefined,
        ttsLoudnessRate: script.ttsLoudnessRate ?? undefined,
        ttsPitch: script.ttsPitch ?? undefined,
        ttsTextHash: script.ttsTextHash ?? undefined,
        ttsConfigHash: script.ttsConfigHash ?? undefined,
      })),
    };
    upsertRecentProject(loadedProject);
    return loadedProject;
  } finally {
    db.close();
  }
}

function makeTtsRelativePath(projectPath, fileName) {
  return toPosixRelative(projectPath, path.join(projectPath, "cache", "tts", fileName));
}

function getScriptById(db, scriptId) {
  return db.prepare("SELECT * FROM scripts WHERE id = ?").get(Number(scriptId));
}

async function synthesizeScriptToProject(projectPath, scriptId, config, options = {}) {
  await ensureProjectDirs(projectPath);
  const db = openProjectDb(projectPath);
  const script = getScriptById(db, scriptId);
  const normalized = normalizeTtsConfig(config);
  const voice = getTtsVoiceByType(db, normalized.speaker);
  db.close();

  if (!script) {
    throw new Error("脚本不存在");
  }
  if (script.status === "disabled") {
    throw new Error("已禁用的脚本不生成旁白");
  }

  if (!voice) {
    throw new Error(`找不到音色：${normalized.speaker}`);
  }

  const textHash = makeTextHash(script.text);
  const configHash = makeTtsConfigHash(normalized, voice);
  if (
    !options.force &&
    script.tts_relative_path &&
    script.tts_text_hash === textHash &&
    script.tts_config_hash === configHash
  ) {
    const cachedPath = resolveProjectPath(projectPath, script.tts_relative_path);
    if (fsSync.existsSync(cachedPath)) {
      return {
        scriptId: String(script.id),
        relativePath: script.tts_relative_path,
        url: toMediaUrl(cachedPath),
        cached: true,
      };
    }
  }

  const outputFileName = `script-${script.id}-${Date.now()}.mp3`;
  const outputPath = path.join(projectPath, "cache", "tts", outputFileName);
  const relativePath = makeTtsRelativePath(projectPath, outputFileName);

  const writingDb = openProjectDb(projectPath);
  try {
    writingDb.prepare(`
      UPDATE scripts
      SET tts_status = ?, tts_error = NULL, tts_updated_at = ?
      WHERE id = ?
    `).run("running", new Date().toISOString(), script.id);
  } finally {
    writingDb.close();
  }

  try {
    const result = await synthesizeSpeech({
      text: script.text,
      config: normalized,
      voice,
      outputPath,
    });

    const doneDb = openProjectDb(projectPath);
    try {
      doneDb.prepare(`
        UPDATE scripts
        SET status = ?,
            tts_relative_path = ?,
            tts_status = ?,
            tts_error = NULL,
            tts_voice_type = ?,
            tts_speech_rate = ?,
            tts_loudness_rate = ?,
            tts_pitch = ?,
            tts_text_hash = ?,
            tts_config_hash = ?,
            tts_updated_at = ?
        WHERE id = ?
      `).run(
        "voiced",
        relativePath,
        "completed",
        normalized.speaker,
        normalized.speechRate,
        normalized.loudnessRate,
        normalized.pitch,
        textHash,
        configHash,
        new Date().toISOString(),
        script.id,
      );
    } finally {
      doneDb.close();
    }

    return {
      scriptId: String(script.id),
      relativePath,
      url: toMediaUrl(result.path),
      usage: result.usage,
    };
  } catch (error) {
    const errorDb = openProjectDb(projectPath);
    try {
      errorDb.prepare(`
        UPDATE scripts
        SET tts_status = ?, tts_error = ?, tts_updated_at = ?
        WHERE id = ?
      `).run(
        "error",
        error instanceof Error ? error.message : "TTS 生成失败",
        new Date().toISOString(),
        script.id,
      );
    } finally {
      errorDb.close();
    }
    throw error;
  }
}

function parseSilences(stderr) {
  const events = [];
  const startRegex = /silence_start: ([0-9.]+)/g;
  const endRegex = /silence_end: ([0-9.]+) \| silence_duration: ([0-9.]+)/g;
  let match;

  while ((match = startRegex.exec(stderr)) !== null) {
    events.push({
      type: "start",
      time: Number(match[1]),
    });
  }

  while ((match = endRegex.exec(stderr)) !== null) {
    events.push({
      type: "end",
      time: Number(match[1]),
      duration: Number(match[2]),
    });
  }

  return events
    .filter((event) => Number.isFinite(event.time))
    .sort((a, b) => a.time - b.time);
}

async function getVideoMetadata(filePath) {
  const { stdout } = await execFileAsync(FFPROBE_BIN, [
    "-v",
    "error",
    "-print_format",
    "json",
    "-show_format",
    "-show_streams",
    filePath,
  ]);
  const info = JSON.parse(stdout);
  const videoStream = info.streams?.find((stream) => stream.codec_type === "video");
  const durationSeconds = Number(info.format?.duration ?? videoStream?.duration);

  return {
    durationSeconds,
    duration: formatDuration(durationSeconds),
    resolution:
      videoStream?.width && videoStream?.height
        ? `${videoStream.width}x${videoStream.height}`
        : "未知",
  };
}

async function detectSilences(filePath) {
  try {
    await execFileAsync(FFMPEG_BIN, [
      "-hide_banner",
      "-i",
      filePath,
      "-af",
      "silencedetect=noise=-35dB:d=1.2",
      "-f",
      "null",
      "-",
    ]);
    return [];
  } catch (error) {
    return parseSilences(error.stderr ?? "");
  }
}

async function makeSourceVideoSegment(inputPath, outputPath, startSeconds, durationSeconds) {
  const args = [
    "-hide_banner",
    "-y",
  ];

  if (startSeconds > 0) {
    args.push("-ss", String(startSeconds));
  }

  args.push(
    "-i",
    inputPath,
    "-t",
    String(durationSeconds),
    "-map",
    "0:v:0",
    "-map",
    "0:a?",
    "-c",
    "copy",
    "-avoid_negative_ts",
    "make_zero",
    "-movflags",
    "+faststart",
    outputPath,
  );

  await execFileAsync(FFMPEG_BIN, args);
}

async function extractSegments(filePath, durationSeconds, projectPath) {
  const segmentDir = path.join(projectPath, "cache", "segments");
  await fs.rm(segmentDir, { recursive: true, force: true });
  await fs.mkdir(segmentDir, { recursive: true });

  const safeDuration = durationSeconds || 60;
  const segmentCount = Math.max(1, Math.ceil(safeDuration / SEGMENT_SECONDS));
  const segments = [];

  for (let index = 0; index < segmentCount; index += 1) {
    const startSeconds = index * SEGMENT_SECONDS;
    const segmentDuration = Math.min(SEGMENT_SECONDS, Math.max(0.1, safeDuration - startSeconds));
    const startMs = Math.round(startSeconds * 1000);
    const durationMs = Math.round(segmentDuration * 1000);
    const segmentPath = path.join(segmentDir, `segment-${String(index + 1).padStart(4, "0")}.mp4`);

    await makeSourceVideoSegment(filePath, segmentPath, startSeconds, segmentDuration);

    segments.push({
      id: `segment_${String(index + 1).padStart(4, "0")}`,
      startMs,
      durationMs,
      text: "待生成片段描述。",
      status: "draft",
      frameLabel: formatTimecode(startMs),
      segmentPath,
      segmentUrl: toMediaUrl(segmentPath),
      segmentRelativePath: toPosixRelative(projectPath, segmentPath),
    });
  }

  return segments;
}

async function readVideoDataUrl(videoPath) {
  const videoBuffer = await fs.readFile(videoPath);
  return `data:video/mp4;base64,${videoBuffer.toString("base64")}`;
}

async function createGlobalContext(filePath, durationSeconds, projectPath) {
  if (!process.env.MOONSHOT_API_KEY) {
    return "未配置 MOONSHOT_API_KEY，跳过全局理解。";
  }

  const contextDir = path.join(projectPath, "cache", "context");
  await fs.rm(contextDir, { recursive: true, force: true });
  await fs.mkdir(contextDir, { recursive: true });

  const contextVideoPath = path.join(contextDir, "global-context.mp4");
  await makeSourceVideoSegment(filePath, contextVideoPath, 0, durationSeconds);

  const videoUrl = await readVideoDataUrl(contextVideoPath);
  const response = await fetch(
    `${process.env.KIMI_BASE_URL || DEFAULT_KIMI_BASE_URL}/chat/completions`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${process.env.MOONSHOT_API_KEY}`,
      },
      body: JSON.stringify({
        model: process.env.KIMI_MODEL || DEFAULT_KIMI_MODEL,
        messages: [
          {
            role: "system",
            content:
              "你是专业口述影像脚本统筹。你会先理解整段视频，再为后续逐段描述提供上下文。",
          },
          {
            role: "user",
            content: [
              {
                type: "video_url",
                video_url: {
                  url: videoUrl,
                },
              },
              {
                type: "text",
                text:
                  "请理解这段完整视频，输出给口述影像脚本使用的简短上下文。包括：视频类型、主要人物/主体、场景、关键视觉线索、需要保持一致的称呼。不要写时间轴，不超过 200 字。",
              },
            ],
          },
        ],
        thinking: { type: "disabled" },
        max_tokens: 360,
      }),
    },
  );

  if (!response.ok) {
    const body = await response.text();
    return `全局理解失败：${response.status} ${body}`;
  }

  const data = await response.json();
  return data.choices?.[0]?.message?.content?.trim() || "模型未返回全局上下文。";
}

async function describeSegment(segment, index, total, globalContext) {
  const apiKey = process.env.MOONSHOT_API_KEY;
  if (!apiKey) {
    return {
      ...segment,
      text: "未配置 MOONSHOT_API_KEY，暂无法生成画面描述。",
      note: "请在 .env 中配置 Kimi API Key",
    };
  }

  const videoUrl = await readVideoDataUrl(segment.segmentPath);
  const response = await fetch(
    `${process.env.KIMI_BASE_URL || DEFAULT_KIMI_BASE_URL}/chat/completions`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: process.env.KIMI_MODEL || DEFAULT_KIMI_MODEL,
        messages: [
          {
            role: "system",
            content: SEGMENT_AD_PROMPT,
          },
          {
            role: "user",
            content: [
              {
                type: "video_url",
                video_url: {
                  url: videoUrl,
                },
              },
              {
                type: "text",
                text: `全局上下文：${globalContext}\n\n这是视频片段 ${index + 1}/${total}，起始时间码 ${segment.frameLabel}，片段时长 ${(segment.durationMs / 1000).toFixed(1)} 秒。请生成一句适合插入视频空隙的中文口述影像描述。要求：描述这段时间内发生的关键视觉变化；不要说“视频中/画面中”；不要主观猜测；不超过 45 个汉字。`,
              },
            ],
          },
        ],
        thinking: { type: "disabled" },
        max_tokens: 160,
      }),
    },
  );

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`Kimi API 请求失败：${response.status} ${body}`);
  }

  const data = await response.json();
  const text = data.choices?.[0]?.message?.content?.trim();
  return {
    ...segment,
    text: text || "模型未返回描述，请手动填写。",
  };
}

async function describeSegments(segments, globalContext) {
  const concurrency = 3;
  const described = new Array(segments.length);
  let cursor = 0;

  async function worker() {
    while (cursor < segments.length) {
      const index = cursor;
      cursor += 1;
      try {
        described[index] = await describeSegment(segments[index], index, segments.length, globalContext);
      } catch (error) {
        described[index] = {
          ...segments[index],
          text: "Kimi 生成失败，请手动填写或稍后重试。",
          status: "conflict",
          note: error instanceof Error ? error.message : "Kimi 生成失败",
        };
      }
    }
  }

  await Promise.all(
    Array.from({ length: Math.min(concurrency, segments.length) }, () => worker()),
  );
  return described;
}

function createWindow() {
  const win = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 1180,
    minHeight: 720,
    title: "语映",
    backgroundColor: "#151515",
    webPreferences: {
      preload: path.join(__dirname, "preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
      webSecurity: false,
    },
  });

  if (isDev) {
    win.loadURL("http://127.0.0.1:5173");
  } else {
    win.loadFile(path.join(__dirname, "../dist/index.html"));
  }
}

app.whenReady().then(async () => {
  await loadLocalEnv(app.getAppPath());

  protocol.handle("media", (request) => {
    const url = new URL(request.url);
    const filePath = decodeURIComponent(url.pathname);
    return net.fetch(pathToFileURL(filePath).toString());
  });

  createWindow();

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    app.quit();
  }
});

ipcMain.handle("project:listRecent", async () => {
  const db = openAppDb();
  try {
    return db.prepare(`
      SELECT
        id,
        name,
        project_path AS projectPath,
        project_file_path AS projectFilePath,
        last_opened_at AS lastOpenedAt,
        video_name AS videoName
      FROM recent_projects
      ORDER BY last_opened_at DESC
    `).all();
  } finally {
    db.close();
  }
});

ipcMain.handle("project:create", async (event) => {
  const parentWindow = BrowserWindow.fromWebContents(event.sender);
  const result = await dialog.showOpenDialog(parentWindow, {
    title: "选择或创建项目文件夹",
    properties: ["openDirectory", "createDirectory"],
  });

  if (result.canceled || result.filePaths.length === 0) {
    return null;
  }

  const projectPath = result.filePaths[0];
  await ensureProjectDirs(projectPath);
  const project = {
    name: path.basename(projectPath),
    projectPath,
    projectFilePath: path.join(projectPath, PROJECT_FILE),
    version: 1,
    createdAt: new Date().toISOString(),
  };
  await writeProjectFile(projectPath, project);

  const db = openProjectDb(projectPath);
  try {
    setProjectMeta(db, "name", project.name);
    setProjectMeta(db, "autoPlayNarration", "false");
    setTtsConfig(db, DEFAULT_TTS_CONFIG);
  } finally {
    db.close();
  }

  return loadProject(projectPath);
});

ipcMain.handle("project:open", async (event, payload) => {
  let projectPath = payload?.projectPath;

  if (!projectPath) {
    const parentWindow = BrowserWindow.fromWebContents(event.sender);
    const result = await dialog.showOpenDialog(parentWindow, {
      title: "打开项目文件夹",
      properties: ["openDirectory"],
    });

    if (result.canceled || result.filePaths.length === 0) {
      return null;
    }

    projectPath = result.filePaths[0];
  }

  await ensureProjectDirs(projectPath);
  if (!fsSync.existsSync(path.join(projectPath, PROJECT_FILE))) {
    await writeProjectFile(projectPath, {
      name: path.basename(projectPath),
      projectPath,
      projectFilePath: path.join(projectPath, PROJECT_FILE),
      version: 1,
      createdAt: new Date().toISOString(),
    });
  }

  return loadProject(projectPath);
});

ipcMain.handle("project:updateScript", async (_event, payload) => {
  if (!payload?.projectPath || !payload?.script) {
    throw new Error("缺少项目路径或脚本数据");
  }

  const db = openProjectDb(payload.projectPath);
  try {
    const current = getScriptById(db, payload.script.id);
    const shouldResetTts = current && current.text !== payload.script.text;
    db.prepare(`
      UPDATE scripts
      SET start_ms = @startMs,
          duration_ms = @durationMs,
          text = @text,
          status = @status,
          note = @note,
          tts_relative_path = CASE WHEN @shouldResetTts THEN NULL ELSE tts_relative_path END,
          tts_status = CASE WHEN @shouldResetTts THEN NULL ELSE tts_status END,
          tts_error = CASE WHEN @shouldResetTts THEN NULL ELSE tts_error END,
          tts_text_hash = CASE WHEN @shouldResetTts THEN NULL ELSE tts_text_hash END,
          tts_config_hash = CASE WHEN @shouldResetTts THEN NULL ELSE tts_config_hash END,
          updated_at = @updatedAt
      WHERE id = @id
    `).run({
      id: Number(payload.script.id),
      shouldResetTts: shouldResetTts ? 1 : 0,
      startMs: payload.script.startMs,
      durationMs: payload.script.durationMs,
      text: payload.script.text,
      status: payload.script.status,
      note: payload.script.note ?? null,
      updatedAt: new Date().toISOString(),
    });
    return loadProject(payload.projectPath);
  } finally {
    db.close();
  }
});

ipcMain.handle("project:updateSetting", async (_event, payload) => {
  if (!payload?.projectPath || !payload?.key) {
    throw new Error("缺少项目路径或设置项");
  }
  const db = openProjectDb(payload.projectPath);
  try {
    setProjectMeta(db, payload.key, payload.value);
    return loadProject(payload.projectPath);
  } finally {
    db.close();
  }
});

ipcMain.handle("project:save", async (_event, payload) => {
  if (!payload?.projectPath) {
    throw new Error("缺少项目路径");
  }

  const current = readProjectFile(payload.projectPath) ?? {};
  await writeProjectFile(payload.projectPath, {
    ...current,
    name: payload.name ?? current.name ?? path.basename(payload.projectPath),
    projectPath: payload.projectPath,
    projectFilePath: path.join(payload.projectPath, PROJECT_FILE),
    version: current.version ?? 1,
    updatedAt: new Date().toISOString(),
  });

  return loadProject(payload.projectPath);
});

ipcMain.handle("tts:updateConfig", async (_event, payload) => {
  if (!payload?.projectPath || !payload?.config) {
    throw new Error("缺少项目路径或 TTS 配置");
  }

  const db = openProjectDb(payload.projectPath);
  try {
    setTtsConfig(db, normalizeTtsConfig(payload.config));
    return loadProject(payload.projectPath);
  } finally {
    db.close();
  }
});

ipcMain.handle("tts:previewVoice", async (_event, payload) => {
  if (!payload?.projectPath || !payload?.config) {
    throw new Error("缺少项目路径或 TTS 配置");
  }

  await ensureProjectDirs(payload.projectPath);
  const normalized = normalizeTtsConfig({
    ...payload.config,
    speaker: payload.voiceType || payload.config.speaker,
  });
  const db = openProjectDb(payload.projectPath);
  const voice = getTtsVoiceByType(db, normalized.speaker);
  db.close();
  if (!voice) {
    throw new Error(`找不到音色：${normalized.speaker}`);
  }
  const hash = crypto
    .createHash("sha1")
    .update(JSON.stringify({
      text: payload.text || DEFAULT_TTS_PREVIEW_TEXT,
      provider: voice.provider,
      providerVoiceId: voice.providerVoiceId,
      ...normalized,
    }))
    .digest("hex")
    .slice(0, 16);
  const outputPath = path.join(payload.projectPath, "cache", "tts", `voice-preview-${hash}.mp3`);

  if (payload.force || !fsSync.existsSync(outputPath)) {
    await synthesizeSpeech({
      text: payload.text || DEFAULT_TTS_PREVIEW_TEXT,
      config: normalized,
      voice,
      outputPath,
    });
  }

  const relativePath = makeTtsRelativePath(payload.projectPath, path.basename(outputPath));
  const updateDb = openProjectDb(payload.projectPath);
  try {
    updateDb.prepare(`
      UPDATE tts_voices
      SET preview_relative_path = ?
      WHERE voice_type = ?
    `).run(relativePath, normalized.speaker);
  } finally {
    updateDb.close();
  }

  return {
    path: outputPath,
    url: toMediaUrl(outputPath),
  };
});

ipcMain.handle("tts:getPreviewCache", async (_event, payload) => {
  if (!payload?.projectPath || !payload?.config) {
    throw new Error("缺少项目路径或 TTS 配置");
  }

  const normalized = normalizeTtsConfig({
    ...payload.config,
    speaker: payload.voiceType || payload.config.speaker,
  });
  const db = openProjectDb(payload.projectPath);
  const voice = getTtsVoiceByType(db, normalized.speaker);
  db.close();
  if (!voice) {
    throw new Error(`找不到音色：${normalized.speaker}`);
  }

  const hash = crypto
    .createHash("sha1")
    .update(JSON.stringify({
      text: payload.text || DEFAULT_TTS_PREVIEW_TEXT,
      provider: voice.provider,
      providerVoiceId: voice.providerVoiceId,
      ...normalized,
    }))
    .digest("hex")
    .slice(0, 16);
  const outputPath = path.join(payload.projectPath, "cache", "tts", `voice-preview-${hash}.mp3`);

  if (!fsSync.existsSync(outputPath)) {
    return null;
  }

  return {
    path: outputPath,
    url: toMediaUrl(outputPath),
  };
});

ipcMain.handle("tts:generateScript", async (_event, payload) => {
  if (!payload?.projectPath || !payload?.scriptId || !payload?.config) {
    throw new Error("缺少项目路径、脚本 ID 或 TTS 配置");
  }

  await synthesizeScriptToProject(payload.projectPath, payload.scriptId, payload.config, {
    force: Boolean(payload.force),
  });
  return loadProject(payload.projectPath);
});

ipcMain.handle("tts:generateAll", async (_event, payload) => {
  if (!payload?.projectPath || !payload?.config) {
    throw new Error("缺少项目路径或 TTS 配置");
  }

  const db = openProjectDb(payload.projectPath);
  let scripts;
  try {
    scripts = db.prepare(`
      SELECT id
      FROM scripts
      WHERE status != 'disabled'
      ORDER BY start_ms ASC, id ASC
    `).all();
    setTtsConfig(db, normalizeTtsConfig(payload.config));
  } finally {
    db.close();
  }

  for (const script of scripts) {
    await synthesizeScriptToProject(payload.projectPath, script.id, payload.config);
  }

  return loadProject(payload.projectPath);
});

ipcMain.handle("video:importToProject", async (event, payload) => {
  if (!payload?.projectPath) {
    throw new Error("缺少项目路径");
  }

  const parentWindow = BrowserWindow.fromWebContents(event.sender);
  const result = await dialog.showOpenDialog(parentWindow, {
    title: "选择视频",
    properties: ["openFile"],
    filters: [
      { name: "Video", extensions: ["mp4", "mov", "m4v", "webm"] },
    ],
  });

  if (result.canceled || result.filePaths.length === 0) {
    return null;
  }

  const filePath = result.filePaths[0];
  await ensureProjectDirs(payload.projectPath);

  const targetName = path.basename(filePath);
  const targetPath = path.join(payload.projectPath, "source", targetName);
  await fs.copyFile(filePath, targetPath);

  const db = openProjectDb(payload.projectPath);
  try {
    const relativePath = toPosixRelative(payload.projectPath, targetPath);
    db.prepare("DELETE FROM videos").run();
    const resultInfo = db.prepare(`
      INSERT INTO videos (file_name, relative_path, duration, resolution, imported_at)
      VALUES (?, ?, ?, ?, ?)
    `).run(targetName, relativePath, "待分析", "待分析", new Date().toISOString());
    setProjectMeta(db, "videoId", String(resultInfo.lastInsertRowid));
  } finally {
    db.close();
  }

  return loadProject(payload.projectPath);
});

ipcMain.handle("video:analyze", async (_event, payload) => {
  if (!payload?.projectPath) {
    throw new Error("缺少项目路径");
  }

  const project = loadProject(payload.projectPath);
  if (!project.video?.path) {
    throw new Error("请先导入视频");
  }

  const filePath = project.video.path;
  const metadata = await getVideoMetadata(filePath);
  const db = openProjectDb(payload.projectPath);
  let analysisRunId;
  try {
    const run = db.prepare(`
      INSERT INTO analysis_runs (video_id, status, created_at)
      VALUES (?, ?, ?)
    `).run(project.video.id, "running", new Date().toISOString());
    analysisRunId = run.lastInsertRowid;
  } finally {
    db.close();
  }

  const [silences, segments, globalContext] = await Promise.all([
    detectSilences(filePath),
    extractSegments(filePath, metadata.durationSeconds, payload.projectPath),
    createGlobalContext(filePath, metadata.durationSeconds, payload.projectPath),
  ]);
  const scripts = await describeSegments(segments, globalContext);

  const writeDb = openProjectDb(payload.projectPath);
  try {
    const tx = writeDb.transaction(() => {
      writeDb.prepare(`
        UPDATE videos SET duration = ?, resolution = ? WHERE id = ?
      `).run(metadata.duration, metadata.resolution, project.video.id);
      writeDb.prepare(`
        UPDATE analysis_runs
        SET status = ?, global_context = ?, completed_at = ?
        WHERE id = ?
      `).run("completed", globalContext, new Date().toISOString(), analysisRunId);
      writeDb.prepare("DELETE FROM segments").run();
      writeDb.prepare("DELETE FROM scripts").run();

      const insertSegment = writeDb.prepare(`
        INSERT INTO segments (analysis_run_id, start_ms, duration_ms, relative_path, description, status, note)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `);
      const insertScript = writeDb.prepare(`
        INSERT INTO scripts (segment_id, start_ms, duration_ms, text, status, note, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `);

      for (const script of scripts) {
        const segmentResult = insertSegment.run(
          analysisRunId,
          script.startMs,
          script.durationMs,
          script.segmentRelativePath,
          script.text,
          script.status,
          script.note ?? null,
        );
        insertScript.run(
          segmentResult.lastInsertRowid,
          script.startMs,
          script.durationMs,
          script.text,
          script.status,
          script.note ?? null,
          new Date().toISOString(),
        );
      }
      setProjectMeta(writeDb, "globalContext", globalContext);
    });
    tx();
  } catch (error) {
    writeDb.prepare(`
      UPDATE analysis_runs
      SET status = ?, completed_at = ?, error_message = ?
      WHERE id = ?
    `).run("error", new Date().toISOString(), error instanceof Error ? error.message : "分析失败", analysisRunId);
    throw error;
  } finally {
    writeDb.close();
  }

  return {
    ...loadProject(payload.projectPath),
    analysis: {
      metadata,
      silences,
      globalContext,
    },
  };
});

ipcMain.handle("script:export", async (_event, payload) => {
  const result = await dialog.showSaveDialog({
    title: "导出口述脚本",
    defaultPath: "audio-description-script.json",
    filters: [{ name: "JSON", extensions: ["json"] }],
  });

  if (result.canceled || !result.filePath) {
    return null;
  }

  await fs.writeFile(result.filePath, JSON.stringify(payload, null, 2), "utf8");
  return { path: result.filePath };
});
