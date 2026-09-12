import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "AI 电商运营助手",
  description: "电商经营日报与建议系统（P0 开发中）",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="zh-CN" className="h-full antialiased">
      <body className="min-h-full flex flex-col">{children}</body>
    </html>
  );
}
