"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useSenhaEquipe } from "@/lib/senhaEquipe";

const ABAS = [
  { href: "/", nome: "Certificado" },
  { href: "/madeireiras", nome: "Madeireiras" },
  { href: "/controladoria", nome: "Controladoria" },
];

export function Nav() {
  const pathname = usePathname();
  const { sessao, definir } = useSenhaEquipe();
  return (
    <div className="nav-wrap">
      <nav className="tabs" aria-label="Seções">
        {ABAS.map((aba) => (
          <Link key={aba.href} href={aba.href} className={pathname === aba.href ? "active" : ""}>
            {aba.nome}
          </Link>
        ))}
      </nav>
      {sessao && (
        <div className="usuario">
          <span title={sessao.login}>{sessao.nome}</span>
          <button
            type="button"
            className="link"
            onClick={() => {
              definir(null);
              window.location.reload();
            }}
          >
            Sair
          </button>
        </div>
      )}
    </div>
  );
}
