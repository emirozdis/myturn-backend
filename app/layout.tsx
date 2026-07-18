import type { Metadata } from "next";
import type { ReactNode } from "react";

import "./legal.css";

export const metadata: Metadata = {
  title: {
    default: "MyTurn",
    template: "%s | MyTurn",
  },
  description: "Official MyTurn legal, privacy, account, and support resources.",
  metadataBase: new URL("https://myturn.emirozdis.tr"),
};

export default function RootLayout({ children }: Readonly<{ children: ReactNode }>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
