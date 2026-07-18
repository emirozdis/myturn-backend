import type { ReactNode } from "react";

import { LegalShell } from "./_components/legal-shell";

export default function LegalLayout({ children }: Readonly<{ children: ReactNode }>) {
  return <LegalShell>{children}</LegalShell>;
}
