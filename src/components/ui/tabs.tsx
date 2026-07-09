"use client";

import * as React from "react";

import { cn } from "@/lib/utils";

interface TabsContextValue {
  value: string;
  onValueChange: (value: string) => void;
}

const TabsContext = React.createContext<TabsContextValue | null>(null);

function Tabs({ value, onValueChange, className, ...props }: React.HTMLAttributes<HTMLDivElement> & TabsContextValue) {
  return (
    <TabsContext.Provider value={{ value, onValueChange }}>
      <div className={cn("w-full", className)} {...props} />
    </TabsContext.Provider>
  );
}

function TabsList({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={cn("inline-flex h-10 items-center justify-center rounded-lg border border-white/[0.06] bg-white/[0.02] p-1 text-muted-foreground backdrop-blur-md", className)} {...props} />;
}

function TabsTrigger({ value, className, ...props }: React.ButtonHTMLAttributes<HTMLButtonElement> & { value: string }) {
  const context = React.useContext(TabsContext);
  if (!context) throw new Error("TabsTrigger must be used within Tabs");
  const active = context.value === value;
  return (
    <button
      type="button"
      className={cn(
        "inline-flex items-center justify-center whitespace-nowrap rounded-md border border-transparent px-3 py-1.5 text-sm font-semibold transition-all duration-300 ease-out hover:border-white/[0.15] hover:bg-white/[0.035] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring active:scale-[0.98] disabled:pointer-events-none disabled:opacity-50",
        active ? "border-white/[0.06] bg-white/[0.05] text-foreground shadow-[inset_0_1px_0_rgba(255,255,255,0.06)]" : "border-white/[0.06] hover:text-foreground",
        className
      )}
      aria-pressed={active}
      onClick={() => context.onValueChange(value)}
      {...props}
    />
  );
}

export { Tabs, TabsList, TabsTrigger };
