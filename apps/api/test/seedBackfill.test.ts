import Database from "better-sqlite3";
import { describe, expect, it } from "vitest";
import { migrate } from "../src/db";
import { steleAssets } from "../src/repo";
import { backfillSeedPresentationMetadata, seedAll } from "../src/seed";

describe("seed presentation metadata backfill", () => {
  it("adds Blender metadata to an existing demo asset without replacing its other parameters", () => {
    const db = new Database(":memory:");
    try {
      migrate(db);
      seedAll(db);
      const current = steleAssets.get(db, "asset-demo-a");
      expect(current).not.toBeNull();
      if (!current) return;

      steleAssets.put(db, {
        ...current,
        meshParams: {
          width: current.meshParams?.width,
          height: current.meshParams?.height,
          customLegacyValue: "preserve-me",
        },
      });

      backfillSeedPresentationMetadata(db);

      const updated = steleAssets.get(db, "asset-demo-a");
      expect(updated?.meshParams).toMatchObject({
        width: 0.55,
        height: 2,
        customLegacyValue: "preserve-me",
        presentationAssetUrl: "/models/demo-a-museum-stele.glb",
        blenderAsset: {
          generatorVersion: "1.1.0",
          sourceState: "GENERATED_VISUAL_ONLY",
          measurementAllowed: false,
        },
      });
    } finally {
      db.close();
    }
  });
});
