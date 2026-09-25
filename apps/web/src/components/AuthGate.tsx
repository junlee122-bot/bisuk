"use client";

import { useEffect } from "react";
import { usePathname, useRouter } from "next/navigation";
import { useQueryClient } from "@tanstack/react-query";
import { UNAUTHORIZED_EVENT } from "@/lib/api";
import { useSession } from "@/lib/session";

/** 로그인 없이 열리는 경로 — 공개 쇼케이스·로그인·초기 설정 */
const PUBLIC_PATHS = [/^\/login/, /^\/setup/, /^\/showcase\//];

/**
 * 인증 흐름 — 계정이 하나도 없으면 초기 설정(/setup), 세션이 없으면 로그인(/login).
 * API가 401을 돌려주면(세션 만료) 로그인 화면으로 보낸다.
 */
export function AuthGate() {
  const router = useRouter();
  const pathname = usePathname();
  const qc = useQueryClient();
  const { status } = useSession();
  const isPublic = PUBLIC_PATHS.some((re) => re.test(pathname));

  useEffect(() => {
    if (!status) return;
    if (status.needsSetup && !pathname.startsWith("/setup")) {
      router.replace("/setup");
      return;
    }
    if (!status.needsSetup && !status.user && status.mode !== "dev" && !isPublic) {
      router.replace(`/login?next=${encodeURIComponent(pathname)}`);
    }
  }, [status, pathname, isPublic, router]);

  useEffect(() => {
    const onUnauthorized = () => {
      void qc.invalidateQueries({ queryKey: ["auth", "status"] });
      if (!PUBLIC_PATHS.some((re) => re.test(window.location.pathname))) {
        router.replace(`/login?next=${encodeURIComponent(window.location.pathname + window.location.search)}`);
      }
    };
    window.addEventListener(UNAUTHORIZED_EVENT, onUnauthorized);
    return () => window.removeEventListener(UNAUTHORIZED_EVENT, onUnauthorized);
  }, [qc, router]);

  return null;
}
