"use client";

import type { ReadingStatus, RightsState, TabRole } from "@seokmun/types";
import { rightsLabel } from "@/lib/labels";

export const ROLE_ICON: Record<TabRole, string> = {
  PRIMARY: "P",
  BENCHMARK: "B",
  COMPARATIVE: "C",
  FRONTIER: "F",
  REFERENCE_ONLY: "R",
  FRAGMENT_SET: "FR",
  WATCHLIST: "W",
};

const READING_LABEL: Record<ReadingStatus, string> = {
  OBSERVED: "관측",
  PARTIALLY_OBSERVED: "부분 관측",
  VISUAL_RECONSTRUCTION: "시각 복원",
  TEXTUAL_SUPPLEMENT: "문헌 보충",
  CROSS_STELE_SUPPORTED: "교차 지지",
  MULTI_SOURCE_AUTOMATIC: "다중 근거 자동",
  CONFLICTING: "상충",
  UNKNOWN: "미상",
  ILLEGIBLE: "판독 불가",
};

export function ReadingBadge({ status }: { status: ReadingStatus }) {
  const cls =
    status === "MULTI_SOURCE_AUTOMATIC"
      ? "badge-ok"
      : status === "CONFLICTING"
        ? "badge-rights"
        : status === "UNKNOWN" || status === "ILLEGIBLE"
          ? "badge-warn"
          : "badge-neutral";
  return <span className={`badge ${cls}`}>{READING_LABEL[status]}</span>;
}

export function DemoBadge({ label = "가상 데이터" }: { label?: string }) {
  return (
    <span className="badge badge-demo" title="허구 데모 자료 — 실제 유물 데이터가 아님">
      ◈ {label}
    </span>
  );
}

const UNCLEARED: RightsState[] = [
  "UNKNOWN",
  "VERIFY_REQUIRED",
  "VERIFY_PER_ASSET",
  "NO_IMAGE_REDISTRIBUTION_UNTIL_CLEARED",
  "INTERNAL_RESTRICTED",
];

export function RightsBadge({ state }: { state: RightsState }) {
  const uncleared = UNCLEARED.includes(state);
  return (
    <span
      className={`badge ${uncleared ? "badge-rights" : "badge-ok"}`}
      title={`자산 권리 상태 — ${state}`}
    >
      {uncleared ? "⚠ " : "✓ "}
      {rightsLabel(state)}
      <span className="opacity-70">({state})</span>
    </span>
  );
}

export function RoleBadges({ roles }: { roles: TabRole[] }) {
  return (
    <span className="inline-flex gap-1">
      {roles.map((r) => (
        <span key={r} className="badge badge-neutral" title={r}>
          {ROLE_ICON[r]}
        </span>
      ))}
    </span>
  );
}
