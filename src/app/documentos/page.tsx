"use client";

import { Documentos } from "@/components/Documentos";
import { PortaoSenha } from "@/components/PortaoSenha";

export default function Page() {
  return (
    <PortaoSenha titulo="Certificados desdobrados e consolidados">
      {(senha, sair) => <Documentos senha={senha} sair={sair} />}
    </PortaoSenha>
  );
}
