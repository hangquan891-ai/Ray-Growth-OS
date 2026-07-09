import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Ray Growth OS｜AI 增长工作台",
  description: "面向独立开发者的 AI 主动获客与内容增长工作台。",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="zh-CN">
      <body>{children}</body>
    </html>
  );
}