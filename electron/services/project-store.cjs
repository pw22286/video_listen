const path = require("node:path");
const fsSync = require("node:fs");
const Database = require("better-sqlite3");
const {
  DEFAULT_TTS_CONFIG,
  DEFAULT_TTS_RESOURCE_ID,
  PROJECT_DB,
  VOLCENGINE_CAPABILITIES,
  VOLCENGINE_PROVIDER,
} = require("./constants.cjs");

function openAppDb(userDataPath) {
  const db = new Database(path.join(userDataPath, "app.db"));
  db.pragma("journal_mode = WAL");
  db.exec(`
    CREATE TABLE IF NOT EXISTS recent_projects (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      project_path TEXT NOT NULL UNIQUE,
      project_file_path TEXT NOT NULL,
      last_opened_at TEXT NOT NULL,
      video_name TEXT
    )
  `);
  return db;
}

function openProjectDb(projectPath, appPath) {
  const db = new Database(path.join(projectPath, PROJECT_DB));
  db.pragma("journal_mode = WAL");
  db.exec(`
    CREATE TABLE IF NOT EXISTS project_meta (
      key TEXT PRIMARY KEY,
      value TEXT
    );

    CREATE TABLE IF NOT EXISTS videos (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      file_name TEXT NOT NULL,
      relative_path TEXT NOT NULL,
      duration TEXT,
      resolution TEXT,
      imported_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS analysis_runs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      video_id INTEGER,
      status TEXT NOT NULL,
      global_context TEXT,
      created_at TEXT NOT NULL,
      completed_at TEXT,
      error_message TEXT
    );

    CREATE TABLE IF NOT EXISTS segments (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      analysis_run_id INTEGER,
      start_ms INTEGER NOT NULL,
      duration_ms INTEGER NOT NULL,
      relative_path TEXT NOT NULL,
      description TEXT,
      status TEXT NOT NULL,
      note TEXT
    );

    CREATE TABLE IF NOT EXISTS scripts (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      segment_id INTEGER,
      start_ms INTEGER NOT NULL,
      duration_ms INTEGER NOT NULL,
      text TEXT NOT NULL,
      status TEXT NOT NULL,
      note TEXT,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS tts_voices (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      model TEXT NOT NULL,
      scene TEXT,
      name TEXT NOT NULL,
      voice_type TEXT NOT NULL UNIQUE,
      language TEXT,
      capability TEXT,
      tags TEXT
    )
  `);
  migrateProjectDb(db);
  seedTtsVoices(db, appPath);
  return db;
}

function migrateProjectDb(db) {
  const scriptColumns = db.prepare("PRAGMA table_info(scripts)").all().map((column) => column.name);
  const migrations = [
    ["tts_relative_path", "TEXT"],
    ["tts_status", "TEXT"],
    ["tts_error", "TEXT"],
    ["tts_voice_type", "TEXT"],
    ["tts_speech_rate", "INTEGER"],
    ["tts_loudness_rate", "INTEGER"],
    ["tts_pitch", "INTEGER"],
    ["tts_text_hash", "TEXT"],
    ["tts_config_hash", "TEXT"],
    ["tts_updated_at", "TEXT"],
  ];

  for (const [column, type] of migrations) {
    if (!scriptColumns.includes(column)) {
      db.prepare(`ALTER TABLE scripts ADD COLUMN ${column} ${type}`).run();
    }
  }

  const voiceColumns = db.prepare("PRAGMA table_info(tts_voices)").all().map((column) => column.name);
  const voiceMigrations = [
    ["provider", `TEXT DEFAULT '${VOLCENGINE_PROVIDER}'`],
    ["provider_voice_id", "TEXT"],
    ["display_name", "TEXT"],
    ["capabilities_json", "TEXT"],
    ["preview_relative_path", "TEXT"],
  ];

  for (const [column, type] of voiceMigrations) {
    if (!voiceColumns.includes(column)) {
      db.prepare(`ALTER TABLE tts_voices ADD COLUMN ${column} ${type}`).run();
    }
  }

  db.prepare(`
    UPDATE tts_voices
    SET provider = COALESCE(NULLIF(provider, ''), ?),
        provider_voice_id = COALESCE(NULLIF(provider_voice_id, ''), voice_type),
        display_name = COALESCE(NULLIF(display_name, ''), name),
        capabilities_json = COALESCE(NULLIF(capabilities_json, ''), ?)
  `).run(VOLCENGINE_PROVIDER, JSON.stringify(VOLCENGINE_CAPABILITIES));
}

function parseTtsVoicesFromDocs(appPath) {
  const docsPath = path.join(appPath, "docs", "音色.md");
  if (!fsSync.existsSync(docsPath)) return [];

  const content = fsSync.readFileSync(docsPath, "utf8");
  const voices = [];
  for (const rawLine of content.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line.startsWith("|")) continue;
    if (line.includes("---") || line.includes("**场景**")) continue;

    const cells = line
      .split("|")
      .map((cell) => cell.replace(/\\$/g, "").trim())
      .filter(Boolean);

    if (cells.length < 5) continue;
    const [scene, name, voiceType, language, capability, tags = ""] = cells;
    if (!voiceType || voiceType === "voice_type" || voiceType.includes(" ")) continue;
    if (!/^[a-zA-Z0-9_]+$/.test(voiceType)) continue;

    voices.push({
      provider: VOLCENGINE_PROVIDER,
      providerVoiceId: voiceType,
      displayName: name,
      model: DEFAULT_TTS_RESOURCE_ID,
      scene,
      name,
      voiceType,
      language,
      capability,
      capabilitiesJson: JSON.stringify(VOLCENGINE_CAPABILITIES),
      tags,
    });
  }

  return voices;
}

function seedTtsVoices(db, appPath) {
  const count = db.prepare("SELECT COUNT(*) AS count FROM tts_voices").get().count;
  if (count > 0) return;

  const voices = parseTtsVoicesFromDocs(appPath);
  const insert = db.prepare(`
    INSERT OR IGNORE INTO tts_voices (
      provider,
      provider_voice_id,
      display_name,
      model,
      scene,
      name,
      voice_type,
      language,
      capability,
      capabilities_json,
      tags
    )
    VALUES (
      @provider,
      @providerVoiceId,
      @displayName,
      @model,
      @scene,
      @name,
      @voiceType,
      @language,
      @capability,
      @capabilitiesJson,
      @tags
    )
  `);
  const tx = db.transaction(() => {
    for (const voice of voices) insert.run(voice);
  });
  tx();
}

function setProjectMeta(db, key, value) {
  db.prepare(`
    INSERT INTO project_meta (key, value)
    VALUES (?, ?)
    ON CONFLICT(key) DO UPDATE SET value = excluded.value
  `).run(key, value == null ? "" : String(value));
}

function getProjectMeta(db, key) {
  return db.prepare("SELECT value FROM project_meta WHERE key = ?").get(key)?.value ?? "";
}

function getTtsConfig(db) {
  return {
    speaker: getProjectMeta(db, "tts.speaker") || DEFAULT_TTS_CONFIG.speaker,
    speechRate: Number(getProjectMeta(db, "tts.speechRate") || DEFAULT_TTS_CONFIG.speechRate),
    loudnessRate: Number(getProjectMeta(db, "tts.loudnessRate") || DEFAULT_TTS_CONFIG.loudnessRate),
    pitch: Number(getProjectMeta(db, "tts.pitch") || DEFAULT_TTS_CONFIG.pitch),
  };
}

function setTtsConfig(db, config) {
  if (config.speaker !== undefined) setProjectMeta(db, "tts.speaker", config.speaker);
  if (config.speechRate !== undefined) setProjectMeta(db, "tts.speechRate", Number(config.speechRate));
  if (config.loudnessRate !== undefined) setProjectMeta(db, "tts.loudnessRate", Number(config.loudnessRate));
  if (config.pitch !== undefined) setProjectMeta(db, "tts.pitch", Number(config.pitch));
}

function parseCapabilities(value) {
  if (!value) return VOLCENGINE_CAPABILITIES;
  try {
    return JSON.parse(value);
  } catch {
    return VOLCENGINE_CAPABILITIES;
  }
}

function getTtsVoiceByType(db, voiceType) {
  const row = db.prepare(`
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
    WHERE voice_type = ?
  `).get(voiceType);

  if (!row) return null;
  return {
    ...row,
    provider: row.provider || VOLCENGINE_PROVIDER,
    providerVoiceId: row.providerVoiceId || row.voiceType,
    displayName: row.displayName || row.name,
    capabilities: parseCapabilities(row.capabilitiesJson),
  };
}

module.exports = {
  getProjectMeta,
  getTtsConfig,
  getTtsVoiceByType,
  openAppDb,
  openProjectDb,
  parseCapabilities,
  setProjectMeta,
  setTtsConfig,
};
