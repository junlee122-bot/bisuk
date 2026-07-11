import type { Metadata } from "next";
import "./globals.css";
import { Providers } from "@/components/Providers";

export const metadata: Metadata = {
  title: "석문(石文) Comparative Autonomous Studio",
  description:
    "여러 비석을 탭으로 동시에 열고 3D·이미지·문헌·발견 보고를 교차 검증하는 자율 비문 연구 플랫폼",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="ko">
      <body className="min-h-screen antialiased">
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
