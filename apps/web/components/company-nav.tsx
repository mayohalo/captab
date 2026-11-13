"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

export function CompanyNavLinks({ id }: { id: string }) {
  const path = usePathname();
  const links: [string, string][] = [
    [`/company/${id}`, "Overview"], [`/company/${id}/ownership`, "Ownership"], [`/company/${id}/grants`, "Grants"],
    [`/company/${id}/approvals`, "Approvals"], [`/company/${id}/distributions`, "Distributions"], [`/company/${id}/deals`, "Deals"],
    [`/company/${id}/activity`, "Activity"], [`/me?company=${id}`, "My ownership"],
  ];
  const current = (href: string) => href === `/company/${id}` ? path === href : path === href || path.startsWith(`${href}/`);
  return <nav aria-label="Company">{links.map(([href, label]) =>
    <Link key={label} href={href} aria-current={current(href) ? "page" : undefined}>{label}</Link>)}</nav>;
}
