// The installed-model registry: typed CRUD over the `models` SQLite table.
// This table is the single source of truth for which models exist and which one
// is active, replacing the old bare `model_path` config key.

import * as FileSystem from "expo-file-system/legacy";
import { v4 as uuid } from "uuid";
import { getDatabase, getConfig, setConfig } from "../storage/database";
import type { DownloadStatus, InstalledModel, ModelRole } from "./types";

interface ModelRow {
  id: string;
  display_name: string;
  hf_repo: string | null;
  hf_file: string | null;
  file_path: string;
  quant: string | null;
  size_bytes: number;
  min_ram_mb: number | null;
  chat_template: string | null;
  context_size: number;
  role: ModelRole;
  state: DownloadStatus;
  resume_token: string | null;
  sha256: string | null;
  is_active: number;
  created_at: number;
}

function mapRow(r: ModelRow): InstalledModel {
  return {
    id: r.id,
    displayName: r.display_name,
    hfRepo: r.hf_repo,
    hfFile: r.hf_file,
    filePath: r.file_path,
    quant: r.quant,
    sizeBytes: r.size_bytes,
    minRamMb: r.min_ram_mb,
    chatTemplate: r.chat_template,
    contextSize: r.context_size,
    role: r.role,
    state: r.state,
    resumeToken: r.resume_token,
    sha256: r.sha256,
    isActive: r.is_active === 1,
    createdAt: r.created_at,
  };
}

const SELECT =
  `SELECT id, display_name, hf_repo, hf_file, file_path, quant, size_bytes,
          min_ram_mb, chat_template, context_size, role, state, resume_token,
          sha256, is_active, created_at FROM models`;

export interface NewModel {
  id?: string;
  displayName: string;
  hfRepo?: string | null;
  hfFile?: string | null;
  filePath: string;
  quant?: string | null;
  sizeBytes?: number;
  minRamMb?: number | null;
  chatTemplate?: string | null;
  contextSize?: number;
  role?: ModelRole;
  state?: DownloadStatus;
  resumeToken?: string | null;
  sha256?: string | null;
}

export async function insertModel(m: NewModel): Promise<InstalledModel> {
  const d = await getDatabase();
  const id = m.id ?? uuid();
  const now = Date.now();
  await d.runAsync(
    `INSERT INTO models
       (id, display_name, hf_repo, hf_file, file_path, quant, size_bytes,
        min_ram_mb, chat_template, context_size, role, state, resume_token,
        sha256, is_active, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?)`,
    id,
    m.displayName,
    m.hfRepo ?? null,
    m.hfFile ?? null,
    m.filePath,
    m.quant ?? null,
    m.sizeBytes ?? 0,
    m.minRamMb ?? null,
    m.chatTemplate ?? null,
    m.contextSize ?? 4096,
    m.role ?? "primary",
    m.state ?? "downloading",
    m.resumeToken ?? null,
    m.sha256 ?? null,
    now,
  );
  const row = await d.getFirstAsync<ModelRow>(`${SELECT} WHERE id = ?`, id);
  return mapRow(row!);
}

export async function listInstalled(): Promise<InstalledModel[]> {
  const d = await getDatabase();
  const rows = await d.getAllAsync<ModelRow>(
    `${SELECT} ORDER BY is_active DESC, created_at DESC`,
  );
  return rows.map(mapRow);
}

export async function getModelById(id: string): Promise<InstalledModel | null> {
  const d = await getDatabase();
  const row = await d.getFirstAsync<ModelRow>(`${SELECT} WHERE id = ?`, id);
  return row ? mapRow(row) : null;
}

export async function getActiveModel(): Promise<InstalledModel | null> {
  const d = await getDatabase();
  const row = await d.getFirstAsync<ModelRow>(
    `${SELECT} WHERE is_active = 1 AND state = 'ready' LIMIT 1`,
  );
  return row ? mapRow(row) : null;
}

export async function setModelState(
  id: string,
  state: DownloadStatus,
): Promise<void> {
  const d = await getDatabase();
  await d.runAsync("UPDATE models SET state = ? WHERE id = ?", state, id);
}

export async function setResumeToken(
  id: string,
  token: string | null,
): Promise<void> {
  const d = await getDatabase();
  await d.runAsync("UPDATE models SET resume_token = ? WHERE id = ?", token, id);
}

// Called when a download verifies & commits: record final size/hash/path and
// mark it ready.
export async function finalizeModel(
  id: string,
  fields: {
    filePath?: string;
    sizeBytes?: number;
    sha256?: string | null;
    chatTemplate?: string | null;
  },
): Promise<void> {
  const d = await getDatabase();
  await d.runAsync(
    `UPDATE models
       SET state = 'ready', resume_token = NULL,
           file_path = COALESCE(?, file_path),
           size_bytes = COALESCE(?, size_bytes),
           sha256 = COALESCE(?, sha256),
           chat_template = COALESCE(?, chat_template)
     WHERE id = ?`,
    fields.filePath ?? null,
    fields.sizeBytes ?? null,
    fields.sha256 ?? null,
    fields.chatTemplate ?? null,
    id,
  );
}

export async function setActiveModel(id: string): Promise<void> {
  const d = await getDatabase();
  await d.withTransactionAsync(async () => {
    await d.runAsync("UPDATE models SET is_active = 0 WHERE is_active = 1");
    await d.runAsync("UPDATE models SET is_active = 1 WHERE id = ?", id);
  });
  await setConfig("active_model_id", id);
}

export async function removeModel(id: string): Promise<void> {
  const d = await getDatabase();
  await d.runAsync("DELETE FROM models WHERE id = ?", id);
}

// One-time backfill: if there are no model rows but a legacy `model_path` config
// points at an existing file, register it as a ready+active model so existing
// installs keep their model after the upgrade.
export async function ensureLegacyMigration(): Promise<void> {
  const existing = await listInstalled();
  if (existing.length > 0) return;

  const legacyPath = await getConfig("model_path");
  if (!legacyPath) return;

  const info = await FileSystem.getInfoAsync(legacyPath);
  if (!info.exists) return;

  const fileName = legacyPath.split("/").pop() || "model.gguf";
  const model = await insertModel({
    displayName: fileName.replace(/\.gguf$/i, ""),
    filePath: legacyPath,
    hfFile: fileName,
    sizeBytes: info.size ?? 0,
    contextSize: 4096,
    role: "primary",
    state: "ready",
  });
  await setActiveModel(model.id);
}
