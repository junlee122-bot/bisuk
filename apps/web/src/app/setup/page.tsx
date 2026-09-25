"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useQueryClient } from "@tanstack/react-query";
import { authApi } from "@/lib/api";
import { useSession } from "@/lib/session";

export default function SetupPage() {
  const router = useRouter();
  const qc = useQueryClient();
  const { status } = useSession();
  const [form, setForm] = useState({ displayName: "", email: "", password: "", confirm: "" });
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  if (status && !status.needsSetup) {
    return (
      <main className="mx-auto mt-16 max-w-sm px-4 text-sm">
        이미 초기 설정이 끝났습니다. <a className="underline" href="/login">로그인</a>하세요.
      </main>
    );
  }

  const field = (key: keyof typeof form, label: string, type = "text", auto?: string) => (
    <label className="block text-sm">
      {label}
      <input
        type={type}
        autoComplete={auto}
        value={form[key]}
        onChange={(e) => setForm({ ...form, [key]: e.target.value })}
        className="mt-1 w-full rounded border border-[var(--panel-border)] bg-transparent px-2 py-1.5"
        data-testid={`setup-${key}`}
        required
      />
    </label>
  );

  return (
    <main className="mx-auto mt-16 max-w-md px-4" data-testid="setup-page">
      <h1 className="font-display text-2xl font-semibold">연구실 초기 설정</h1>
      <p className="mt-1 text-sm text-ink-2">
        첫 계정은 책임연구자(PI)가 됩니다. PI는 구성원 계정 발급, 권리 확정, 판독 승인, 백업을 맡습니다.
      </p>
      <form
        className="panel mt-4 space-y-3 p-4"
        onSubmit={(e) => {
          e.preventDefault();
          if (form.password !== form.confirm) {
            setError("비밀번호 확인이 일치하지 않습니다");
            return;
          }
          setBusy(true);
          setError(null);
          authApi
            .setup({ displayName: form.displayName, email: form.email, password: form.password })
            .then(async () => {
              await qc.invalidateQueries();
              router.replace("/admin");
            })
            .catch((err: Error) => setError(err.message))
            .finally(() => setBusy(false));
        }}
      >
        {field("displayName", "이름")}
        {field("email", "이메일", "email", "username")}
        {field("password", "비밀번호 (12자 이상 권장)", "password", "new-password")}
        {field("confirm", "비밀번호 확인", "password", "new-password")}
        {error && <p className="text-sm text-[var(--state-danger)]" role="alert">{error}</p>}
        <button type="submit" disabled={busy} className="badge badge-demo w-full justify-center py-2" data-testid="setup-submit">
          PI 계정 만들기
        </button>
      </form>
    </main>
  );
}
