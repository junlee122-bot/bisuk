import type { Metadata } from "next";
import { Noto_Sans_KR, Noto_Serif_KR } from "next/font/google";
import "./globals.css";
import { Providers } from "@/components/Providers";
import { GlobalHeader } from "@/components/GlobalHeader";

/* next/font 자체 호스팅(빌드 시 서브셋 다운로드) — 런타임 CDN 요청 없음.
 * 두 서체 모두 SIL OFL 1.1 (docs/portfolio-polish/DEPENDENCY_AND_ASSET_LICENSES.md) */
const sansKr = Noto_Sans_KR({
  subsets: ["latin"],
  weight: ["400", "500", "700"],
  variable: "--font-sans-kr",
  display: "swap",
});
const serifKr = Noto_Serif_KR({
  subsets: ["latin"],
  weight: ["400", "600", "700"],
  variable: "--font-serif-kr",
  display: "swap",
});

export const metadata: Metadata = {
  title: "석문(石文) Studio — Comparative Autonomous Studio",
  description:
    "손상된 비문을, 근거와 함께 다시 읽다 — 여러 비석을 탭으로 동시에 열고 3D·이미지·문헌·발견 보고를 교차 검증하는 비문 연구 스튜디오",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="ko" className={`${sansKr.variable} ${serifKr.variable}`}>
      <body className="flex h-screen flex-col antialiased">
        <Providers>
          <GlobalHeader />
          <div className="min-h-0 flex-1 overflow-auto">{children}</div>
        </Providers>
      </body>
    </html>
  );
}
