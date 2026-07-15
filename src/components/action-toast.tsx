"use client";

import { useEffect, useRef, useState } from "react";
import { AlertTriangle, CheckCircle2, Info, X } from "lucide-react";

import { cn } from "@/lib/utils";

export type ActionToastTone = "success" | "error" | "info";

type ActionToastDetail = {
  message: string;
  title?: string;
  tone?: ActionToastTone;
  durationMs?: number;
};

const ACTION_TOAST_EVENT = "ray-growth-os:action-toast";

export function showToast(detail: string | ActionToastDetail, tone: ActionToastTone = "info") {
  if (typeof window === "undefined") return;
  const payload = typeof detail === "string" ? { message: detail, tone } : detail;
  window.dispatchEvent(new CustomEvent<ActionToastDetail>(ACTION_TOAST_EVENT, { detail: payload }));
}

function toastToneMeta(tone: ActionToastTone) {
  if (tone === "error") {
    return {
      icon: <AlertTriangle className="h-4 w-4" />,
      title: "操作失败",
      className: "border-rose-300/30 bg-rose-500/15 text-rose-50 shadow-rose-950/30",
      iconClassName: "bg-rose-400/20 text-rose-100",
    };
  }

  if (tone === "info") {
    return {
      icon: <Info className="h-4 w-4" />,
      title: "提示",
      className: "border-blue-300/30 bg-blue-500/15 text-blue-50 shadow-blue-950/30",
      iconClassName: "bg-blue-400/20 text-blue-100",
    };
  }

  return {
    icon: <CheckCircle2 className="h-4 w-4" />,
    title: "操作成功",
    className: "border-emerald-300/30 bg-emerald-500/15 text-emerald-50 shadow-emerald-950/30",
    iconClassName: "bg-emerald-400/20 text-emerald-100",
  };
}

export function ActionToastHost() {
  const [toast, setToast] = useState<ActionToastDetail | null>(null);
  const timerRef = useRef<number | null>(null);

  useEffect(() => {
    function handleToast(event: Event) {
      const detail = (event as CustomEvent<ActionToastDetail>).detail;
      if (!detail?.message) return;

      if (timerRef.current) {
        window.clearTimeout(timerRef.current);
      }

      const nextToast = { tone: "info" as ActionToastTone, ...detail };
      setToast(nextToast);
      timerRef.current = window.setTimeout(() => setToast(null), nextToast.durationMs ?? 2600);
    }

    window.addEventListener(ACTION_TOAST_EVENT, handleToast);
    return () => {
      window.removeEventListener(ACTION_TOAST_EVENT, handleToast);
      if (timerRef.current) {
        window.clearTimeout(timerRef.current);
      }
    };
  }, []);

  if (!toast) return null;

  const tone = toast.tone ?? "success";
  const meta = toastToneMeta(tone);

  return (
    <div className="pointer-events-none fixed left-1/2 top-1/2 z-[100] w-[min(calc(100vw-2rem),430px)] -translate-x-1/2 -translate-y-1/2">
      <div
        role={tone === "error" ? "alert" : "status"}
        aria-live={tone === "error" ? "assertive" : "polite"}
        className={cn(
          "pointer-events-auto flex items-start gap-3 rounded-lg border px-4 py-3 shadow-2xl backdrop-blur-xl animate-fade-in-up",
          meta.className
        )}
      >
        <span className={cn("mt-0.5 grid h-7 w-7 shrink-0 place-items-center rounded-md", meta.iconClassName)}>{meta.icon}</span>
        <div className="min-w-0 flex-1">
          <p className="text-sm font-bold">{toast.title || meta.title}</p>
          <p className="mt-1 text-xs leading-5 text-white/75">{toast.message}</p>
        </div>
        <button
          type="button"
          className="-mr-1 grid h-7 w-7 shrink-0 place-items-center rounded-md text-white/55 transition-colors hover:bg-white/10 hover:text-white"
          onClick={() => setToast(null)}
          aria-label="关闭提示"
        >
          <X className="h-4 w-4" />
        </button>
      </div>
    </div>
  );
}
