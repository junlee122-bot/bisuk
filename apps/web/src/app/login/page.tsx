"use client";

import { Suspense, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useQueryClient } from "@tanstack/react-query";
import { authApi } from "@/lib/api";
import { ROLE_LABEL, useSession } from "@/lib/session";

function LoginForm() {
  const router = useRouter();
  const params = useSearchParams();
  const qc = useQueryClient();
  const { status } = useSession();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const next = params.get("next") || "/";

  const login = async (e: string, p: string) => {
    setBusy(true);
    setError(null);
    try {
      await authApi.login(e, p);
      await qc.invalidateQueries();
      router.replace(next.startsWith("/") ? next : "/");
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <main className="mx-auto mt-16 max-w-sm px-4" data-testid="login-page">
      <h1 className="font-display text-2xl font-semibold">로그인</h1>
      <p className="mt-1 text-sm text-ink-2">연구실 계정으로 로그인하세요.</p>
      {status?.mode === "proxy-header" ? (
        <p className="panel mt-4 p-3 text-sm">
          이 서버는 학교 SSO(리버스 프록시) 인증을 씁니다. SSO 로그인 후 다시 접속하세요.
        </p>
      ) : (
        <form
          className="panel mt-4 space-y-3 p-4"
          onSubmit={(ev) => {
            ev.preventDefault();
            void login(email, password);
          }}
        >
          <label className="block text-sm">
            이메일
            <input
              type="email"
              autoComplete="username"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="mt-1 w-full rounded border border-[var(--panel-border)] bg-transparent px-2 py-1.5"
              data-testid="login-email"
              required
            />
          </label>
          <label className="block text-sm">
            비밀번호
            <input
              type="password"
              autoComplete="current-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="mt-1 w-full rounded border border-[var(--panel-border)] bg-transparent px-2 py-1.5"
              data-testid="login-password"
            />
          </label>
          {error && (
            <p className="text-sm text-[var(--state-danger)]" role="alert" data-testid="login-error">
              {error}
            </p>
          )}
          <button type="submit" disabled={busy} className="badge badge-demo w-full justify-center py-2" data-testid="login-submit">
            {busy ? "확인 중…" : "로그인"}
          </button>
          <p className="text-[11px] text-ink-3">
            비밀번호를 잊었으면 연구실 PI에게 임시 비밀번호 재발급을 요청하세요.
          </p>
        </form>
      )}
      {status?.mode === "dev" && status.devUsers.length > 0 && (
        <section className="panel mt-4 p-3 text-sm" data-testid="dev-users">
          <h2 className="font-semibold">개발 모드 계정 (로컬 전용)</h2>
          <ul className="mt-2 space-y-1">
            {status.devUsers.map((u) => (
              <li key={u.email}>
                <button className="badge badge-neutral" onClick={() => void login(u.email, "")} data-testid={`dev-login-${u.role}`}>
                  {u.displayName} · {ROLE_LABEL[u.role]}
                </button>
              </li>
            ))}
          </ul>
        </section>
      )}
    </main>
  );
}

export default function LoginPage() {
  return (
    <Suspense fallback={null}>
      <LoginForm />
    </Suspense>
  );
}
