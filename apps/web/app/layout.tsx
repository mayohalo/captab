import type { Metadata } from "next";
import type { ReactNode } from "react";
import { TopBar } from "../components/brand";
import "./globals.css";

export const metadata: Metadata = {
  title: "Captab",
  description: "DAO-governed company ownership on NEAR, from day zero to exit.",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return <html lang="en"><body><div className="backdrop" aria-hidden="true" /><TopBar />{children}</body></html>;
}
