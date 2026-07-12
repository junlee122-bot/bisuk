"use client";

import { create } from "zustand";

/** 비교 트레이 — 선택한 문자 셀 모음 (세션 로컬 상태) */
interface CompareTrayState {
  cellIds: string[];
  add: (id: string) => void;
  remove: (id: string) => void;
  clear: () => void;
}

export const useCompareTray = create<CompareTrayState>((set) => ({
  cellIds: [],
  add: (id) =>
    set((s) => (s.cellIds.includes(id) ? s : { cellIds: [...s.cellIds, id].slice(-8) })),
  remove: (id) => set((s) => ({ cellIds: s.cellIds.filter((c) => c !== id) })),
  clear: () => set({ cellIds: [] }),
}));

/**
 * 상위 무대 모드 — EXHIBITION(전시 보기) / RESEARCH(연구 보기).
 * 두 모드는 동일한 Evidence 좌표계를 공유하며, 전환은 표시 계층만 바꾼다
 * (카메라 타깃·선택 글자·비석 탭·주석 상태를 초기화하지 않는다).
 * 연구 작업대(/sets/*)의 기본은 연구 보기, 쇼케이스(/showcase/*)는 전시 동선.
 */
export type StageMode = "EXHIBITION" | "RESEARCH";

interface StageModeState {
  mode: StageMode;
  setMode: (m: StageMode) => void;
}

export const useStageMode = create<StageModeState>((set) => ({
  mode: "RESEARCH",
  setMode: (mode) => set({ mode }),
}));

/** 모바일 레이아웃에서 표시 중인 패널 */
interface MobilePanelState {
  panel: "tree" | "workbench" | "evidence";
  setPanel: (p: MobilePanelState["panel"]) => void;
}

export const useMobilePanel = create<MobilePanelState>((set) => ({
  panel: "workbench",
  setPanel: (panel) => set({ panel }),
}));
