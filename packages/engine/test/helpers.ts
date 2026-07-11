import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import type { GlyphCell } from "@seokmun/types";
import {
  buildGlyphCellEntity,
  inferScriptFamily,
  toPipelineCell,
  type SeedGlyphCellJson,
  type SeedPriors,
} from "../src/demoSeed";
import type {
  PipelineDocument,
  PipelineGlyphCell,
  PipelineInput,
  PipelineTab,
} from "../src/pipeline";

const here = path.dirname(fileURLToPath(import.meta.url));
const seedDir = path.resolve(here, "../../../data/seed");

export function loadJson<T>(name: string): T {
  return JSON.parse(readFileSync(path.join(seedDir, name), "utf8")) as T;
}

export interface DemoSeedData {
  priors: SeedPriors;
  cells: GlyphCell[];
  pipelineCells: PipelineGlyphCell[];
  cellsByTab: Map<string, PipelineGlyphCell[]>;
  tabs: PipelineTab[];
  documents: PipelineDocument[];
}

export function loadDemoSeed(): DemoSeedData {
  const glyphSeed = loadJson<{
    priors: SeedPriors;
    glyphCells: SeedGlyphCellJson[];
  }>("demo-glyphs.json");
  const workspace = loadJson<{
    tabs: Array<{ id: string; title: string; periodEstimate: string }>;
  }>("workspace.json");
  const corpus = loadJson<{ documents: Array<Record<string, unknown>> }>("corpus.json");

  const maxByTab = new Map<string, { lines: number; seq: number }>();
  for (const c of glyphSeed.glyphCells) {
    const m = maxByTab.get(c.steleTabId) ?? { lines: 1, seq: 1 };
    m.lines = Math.max(m.lines, c.lineIndex);
    m.seq = Math.max(m.seq, c.sequenceIndex);
    maxByTab.set(c.steleTabId, m);
  }
  const cells = glyphSeed.glyphCells.map((c) => {
    const m = maxByTab.get(c.steleTabId)!;
    return buildGlyphCellEntity(c, glyphSeed.priors, m.lines, m.seq);
  });
  const jitterById = new Map(
    glyphSeed.glyphCells.map((c) => [c.id, c.styleJitter])
  );
  const pipelineCells = cells.map((c) => toPipelineCell(c, jitterById.get(c.id)));
  const cellsByTab = new Map<string, PipelineGlyphCell[]>();
  for (const c of pipelineCells) {
    const list = cellsByTab.get(c.steleTabId) ?? [];
    list.push(c);
    cellsByTab.set(c.steleTabId, list);
  }
  const tabs: PipelineTab[] = workspace.tabs.map((t) => ({
    id: t.id,
    title: t.title,
    periodEstimate: t.periodEstimate,
    scriptFamily: inferScriptFamily(t.periodEstimate),
  }));
  const documents = corpus.documents.map((d) => ({
    id: d.id as string,
    title: d.title as string,
    content: d.content as string,
    reliabilityTier: d.reliabilityTier as number,
    independenceGroup: d.independenceGroup as string,
    derivedFromDocumentId: (d.derivedFromDocumentId as string | null) ?? null,
    benchmarkLeak: Boolean(d.benchmarkLeak),
    claims: (d.claims ?? []) as PipelineDocument["claims"],
  }));
  return { priors: glyphSeed.priors, cells, pipelineCells, cellsByTab, tabs, documents };
}

export function pipelineInputFor(cellId: string): PipelineInput {
  const seed = loadDemoSeed();
  const cell = seed.pipelineCells.find((c) => c.id === cellId);
  if (!cell) throw new Error(`seed cell not found: ${cellId}`);
  const tab = seed.tabs.find((t) => t.id === cell.steleTabId);
  if (!tab) throw new Error(`seed tab not found: ${cell.steleTabId}`);
  return {
    cell,
    tab,
    allTabs: seed.tabs,
    cellsByTab: seed.cellsByTab,
    priors: seed.priors,
    documents: seed.documents,
    modelVersion: "test-model",
    corpusVersion: "test-corpus",
  };
}
