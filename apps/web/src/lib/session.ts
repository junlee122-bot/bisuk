"use client";

import { useQuery } from "@tanstack/react-query";
import type { UserRole } from "@seokmun/types";
import { authApi } from "./api";

const RANK: Record<UserRole, number> = { GUEST: 1, RESEARCHER: 2, PI: 3 };

export const ROLE_LABEL: Record<UserRole, string> = {
  PI: "책임연구자(PI)",
  RESEARCHER: "연구원",
  GUEST: "열람자",
};

export function useSession() {
  const q = useQuery({ queryKey: ["auth", "status"], queryFn: authApi.status, staleTime: 60_000, retry: 0 });
  return {
    status: q.data ?? null,
    user: q.data?.user ?? null,
    loading: q.isLoading,
  };
}

/** 현재 사용자가 최소 역할 이상인가 (세트별 역할은 서버가 최종 판단) */
export function useCan(min: UserRole): boolean {
  const { user } = useSession();
  return Boolean(user && RANK[user.role] >= RANK[min]);
}
