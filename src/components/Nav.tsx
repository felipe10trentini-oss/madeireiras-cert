"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const ABAS = [
  { href: "/", nome: "Certificado" },
  { href: "/madeireiras", nome: "Madeireiras" },
];

export function Nav() {
  const pathname = usePathname();
  return (
    <nav className="tabs" aria-label="Seções">
      {ABAS.map((aba) => (
        <Link key={aba.href} href={aba.href} className={pathname === aba.href ? "active" : ""}>
          {aba.nome}
        </Link>
      ))}
    </nav>
  );
}
