"use client";

import { Declaracoes } from "@/components/Declaracoes";
import { PortaoSenha } from "@/components/PortaoSenha";

export default function Page() {
  return (
    <PortaoSenha titulo="Declarações de tratamento">
      {(senha, sair) => <Declaracoes senha={senha} sair={sair} />}
    </PortaoSenha>
  );
}
