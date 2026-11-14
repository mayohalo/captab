import type { Metadata } from "next";
import type { ReactNode } from "react";
import { TopBar } from "../components/brand";
import "./globals.css";

const description = "Captab keeps a company's cap table in a NEAR smart contract governed by a DAO board: vesting grants, priced rounds, secondary sales, buybacks, exact payouts, and exit.";
const site = process.env.CAPTAB_AUTH_ORIGIN?.startsWith("https://") ? process.env.CAPTAB_AUTH_ORIGIN : undefined;

export const metadata: Metadata = {
  ...(site ? { metadataBase: new URL(site) } : {}),
  title: { default: "Captab: cap tables on NEAR", template: "%s · Captab" },
  description,
  openGraph: { title: "Captab: from day zero to unicorn", description, type: "website", siteName: "Captab" },
  twitter: { card: "summary_large_image", title: "Captab: from day zero to unicorn", description },
  alternates: { types: { "text/plain": "/llms.txt" } },
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return <html lang="en"><body><div className="backdrop" aria-hidden="true" /><TopBar />{children}</body></html>;
}
