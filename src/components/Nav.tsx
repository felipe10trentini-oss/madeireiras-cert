"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const ABAS = [
  { href: "/", nome: "Certificado" },
  { href: "/documentos", nome: "Desdobrado / Consolidado" },
  { href: "/madeireiras", nome: "Cadastros" },
  { href: "/controladoria", nome: "Controladoria" },
];

export function Nav() {
  const pathname = usePathname();
  return (
    <div className="nav-wrap">
      <nav className="tabs" aria-label="Seções">
        {ABAS.map((aba) => (
          <Link key={aba.href} href={aba.href} className={pathname === aba.href ? "active" : ""}>
            {aba.nome}
          </Link>
        ))}
      </nav>
    </div>
  );
}
