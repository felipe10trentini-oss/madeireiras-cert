"use client";

import { Emissao } from "@/components/Emissao";
import { PortaoSenha } from "@/components/PortaoSenha";

export default function Home() {
  return (
    <PortaoSenha titulo="Certificados das madeireiras">
      {(senha, sair) => <Emissao senha={senha} sair={sair} />}
    </PortaoSenha>
  );
}
