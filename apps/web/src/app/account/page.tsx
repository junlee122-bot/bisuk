"use client";

import { useState } from "react";
import { authApi } from "@/lib/api";
import { ROLE_LABEL, useSession } from "@/lib/session";

export default function AccountPage() {
  const { user, status } = useSession();
  const [cur, setCur] = useState("");
  const [next, setNext] = useState("");
  const [msg, setMsg] = useState<string | null>(null);
  if (!user) return <main className="p-8 text-sm text-ink-3">로그인이 필요합니다.</main>;
  return (
    <main className="mx-auto mt-10 max-w-md space-y-4 px-4" data-testid="account-page">
      <h1 className="font-display text-2xl font-semibold">내 계정</h1>
      <section className="panel p-4 text-sm">
        <p>
          <strong>{user.displayName}</strong> · {user.email}
        </p>
        <p className="mt-1 text-ink-2">역할: {ROLE_LABEL[user.role]}</p>
      </section>
      {status?.mode === "local" && (
        <form
          className="panel space-y-2 p-4 text-sm"
          onSubmit={(e) => {
            e.preventDefault();
            authApi
              .changePassword(cur, next)
              .then(() => {
                setMsg("비밀번호를 바꿨습니다. 다른 기기의 세션은 로그아웃됩니다.");
                setCur("");
                setNext("");
              })
              .catch((err: Error) => setMsg(err.message));
          }}
        >
          <h2 className="font-semibold">비밀번호 변경</h2>
          <input type="password" value={cur} onChange={(e) => setCur(e.target.value)} placeholder="현재 비밀번호" autoComplete="current-password" className="w-full rounded border border-[var(--panel-border)] bg-transparent px-2 py-1.5" />
          <input type="password" value={next} onChange={(e) => setNext(e.target.value)} placeholder="새 비밀번호" autoComplete="new-password" className="w-full rounded border border-[var(--panel-border)] bg-transparent px-2 py-1.5" />
          <button type="submit" className="badge badge-demo">변경</button>
          {msg && <p className="text-ink-2" role="status">{msg}</p>}
        </form>
      )}
    </main>
  );
}
