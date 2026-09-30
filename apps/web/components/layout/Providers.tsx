"use client";

import { SessionProvider } from "next-auth/react";
import { ThemeProvider } from "../providers/ThemeProvider";
import { LanguageProvider } from "../../lib/i18n/LanguageProvider";

export default function Providers({ children }: { children: React.ReactNode }) {
  return (
    <SessionProvider>
      <ThemeProvider>
        <LanguageProvider>{children}</LanguageProvider>
      </ThemeProvider>
    </SessionProvider>
  );
}
