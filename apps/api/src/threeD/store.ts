import type { AssetVariant, CameraBookmark, RenderPreset, SceneLook, ThreeDJob } from "@seokmun/types";
import type { Db } from "../db";

function get<T>(db: Db, table: string, id: string): T | null {
  const row = db.prepare(`SELECT data FROM ${table} WHERE id = ?`).get(id) as
    | { data: string }
    | undefined;
  return row ? (JSON.parse(row.data) as T) : null;
}

export const assetVariants = {
  get: (db: Db, id: string) => get<AssetVariant>(db, "asset_variants", id),
  listByAsset: (db: Db, assetId: string): AssetVariant[] => {
    const rows = db
      .prepare("SELECT data FROM asset_variants WHERE stele_asset_id = ?")
      .all(assetId) as Array<{ data: string }>;
    return rows.map((r) => JSON.parse(r.data) as AssetVariant);
  },
  put: (db: Db, v: AssetVariant) => {
    db.prepare(
      "INSERT OR REPLACE INTO asset_variants (id, stele_asset_id, data) VALUES (?, ?, ?)"
    ).run(v.id, v.steleAssetId, JSON.stringify(v));
  },
  delete: (db: Db, id: string) => {
    db.prepare("DELETE FROM asset_variants WHERE id = ?").run(id);
  },
};

export const threeDJobs = {
  get: (db: Db, id: string) => get<ThreeDJob>(db, "three_d_jobs", id),
  listByAsset: (db: Db, assetId: string): ThreeDJob[] => {
    const rows = db
      .prepare("SELECT data FROM three_d_jobs WHERE stele_asset_id = ?")
      .all(assetId) as Array<{ data: string }>;
    return rows.map((r) => JSON.parse(r.data) as ThreeDJob);
  },
  put: (db: Db, j: ThreeDJob) => {
    db.prepare(
      "INSERT OR REPLACE INTO three_d_jobs (id, stele_asset_id, data) VALUES (?, ?, ?)"
    ).run(j.id, j.steleAssetId, JSON.stringify(j));
  },
};

export const renderPresets = {
  list: (db: Db): RenderPreset[] => {
    const rows = db.prepare("SELECT data FROM render_presets").all() as Array<{
      data: string;
    }>;
    return rows.map((r) => JSON.parse(r.data) as RenderPreset);
  },
  put: (db: Db, p: RenderPreset) => {
    db.prepare("INSERT OR REPLACE INTO render_presets (id, data) VALUES (?, ?)").run(
      p.id,
      JSON.stringify(p)
    );
  },
};

export const sceneLooks = {
  get: (db: Db, id: string) => get<SceneLook>(db, "scene_looks", id),
  list: (db: Db): SceneLook[] => {
    const rows = db.prepare("SELECT data FROM scene_looks").all() as Array<{ data: string }>;
    return rows
      .map((r) => JSON.parse(r.data) as SceneLook)
      .sort((a, b) => Number(b.builtIn) - Number(a.builtIn) || a.name.localeCompare(b.name));
  },
  put: (db: Db, look: SceneLook) => {
    db.prepare("INSERT OR REPLACE INTO scene_looks (id, data) VALUES (?, ?)").run(
      look.id,
      JSON.stringify(look)
    );
  },
  delete: (db: Db, id: string) => {
    db.prepare("DELETE FROM scene_looks WHERE id = ?").run(id);
  },
};

export const cameraBookmarks = {
  get: (db: Db, id: string) => get<CameraBookmark>(db, "camera_bookmarks", id),
  list: (db: Db): CameraBookmark[] => {
    const rows = db.prepare("SELECT data FROM camera_bookmarks").all() as Array<{ data: string }>;
    return rows.map((r) => JSON.parse(r.data) as CameraBookmark);
  },
  put: (db: Db, bm: CameraBookmark) => {
    db.prepare("INSERT OR REPLACE INTO camera_bookmarks (id, data) VALUES (?, ?)").run(
      bm.id,
      JSON.stringify(bm)
    );
  },
  delete: (db: Db, id: string) => {
    db.prepare("DELETE FROM camera_bookmarks WHERE id = ?").run(id);
  },
};

/** 내장 SceneLook 6종 (portfolio-polish §12) — 시드/리셋 시 보장 */
export function seedSceneLooks(db: Db): void {
  const now = new Date().toISOString();
  const base = {
    builtIn: true,
    version: 1,
    createdBy: "system",
    createdAt: now,
    updatedAt: now,
    exposure: 1,
    aoStrength: 0.6,
    lightAzimuthDeg: 105,
    lightElevationDeg: 12,
    representation: "PBR_PRESENTATION" as const,
    stage: { floor: true, plinth: true },
    toneMapping: "ACES" as const,
  };
  const looks: SceneLook[] = [
    {
      ...base,
      id: "look-museum-warm",
      name: "MUSEUM_WARM",
      description: "따뜻한 박물관 무대 — 전시 기본",
      lightingPreset: "MUSEUM_NEUTRAL",
    },
    {
      ...base,
      id: "look-lab-neutral",
      name: "LAB_NEUTRAL",
      description: "실험실 균일광 — 판독·비교 기본",
      lightingPreset: "LABORATORY_NEUTRAL",
      representation: "RESEARCH_EVIDENCE",
      stage: { floor: false, plinth: false },
    },
    {
      ...base,
      id: "look-raking-east",
      name: "RAKING_EAST",
      description: "동쪽 사광 105° — 획 음영 관찰",
      lightingPreset: "RAKING",
      lightAzimuthDeg: 105,
      stage: { floor: false, plinth: false },
    },
    {
      ...base,
      id: "look-raking-west",
      name: "RAKING_WEST",
      description: "서쪽 사광 255° — 반대측 음영",
      lightingPreset: "RAKING",
      lightAzimuthDeg: 255,
      stage: { floor: false, plinth: false },
    },
    {
      ...base,
      id: "look-source-color-review",
      name: "SOURCE_COLOR_REVIEW",
      description: "원본색 검토 — 무조명·Neutral 톤매핑(톤 개입 최소)",
      lightingPreset: "UNLIT_ALBEDO",
      toneMapping: "NEUTRAL",
      representation: "UNLIT_ORIGINAL",
      stage: { floor: false, plinth: false },
    },
    {
      ...base,
      id: "look-portfolio-hero",
      name: "PORTFOLIO_HERO",
      description: "포트폴리오 히어로 — 웜 무대 + 림 라이트",
      lightingPreset: "MUSEUM_NEUTRAL",
      exposure: 1.05,
    },
  ];
  for (const look of looks) sceneLooks.put(db, look);
}
