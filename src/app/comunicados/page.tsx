"use client";

import { Comunicados } from "@/components/Comunicados";
import { PortaoSenha } from "@/components/PortaoSenha";

export default function Page() {
  return (
    <PortaoSenha titulo="Comunicados de tratamento">
      {(senha, sair) => <Comunicados senha={senha} sair={sair} />}
    </PortaoSenha>
  );
}
