import type { AssetVariant, RenderPreset, ThreeDJob } from "@seokmun/types";
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
