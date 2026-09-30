"use client";

import { useState } from "react";
import { usePathname } from "next/navigation";
import Sidebar, { MobileSidebar } from "./Sidebar";
import Topbar from "./Topbar";

const AUTH_PATHS = ["/login", "/register"];

export default function AppShell({ children }: { children: React.ReactNode }) {
  const [navOpen, setNavOpen] = useState(false);
  const pathname = usePathname();

  if (AUTH_PATHS.includes(pathname)) {
    return <div className="min-h-screen">{children}</div>;
  }

  return (
    <div className="flex min-h-screen">
      <Sidebar />
      <MobileSidebar open={navOpen} onClose={() => setNavOpen(false)} />
      <div className="min-w-0 flex-1 lg:pl-64">
        <Topbar onMenuClick={() => setNavOpen(true)} />
        <main className="mx-auto w-full max-w-[1440px] px-4 pb-16 pt-6 sm:px-6 lg:px-8">
          {children}
        </main>
      </div>
    </div>
  );
}
