"use client";

// Data do peticionamento (recibo do SEI) da programação ou do comunicado, achada na pasta
// "Madeireiras 2" do OneDrive sem upload e sem digitar. Ver src/lib/pastaRecibos.ts.
import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import type { Madeireira } from "@/lib/madeireiras";
import {
  buscarRecibo,
  escolherPasta,
  lembrarPastaDaEmpresa,
  nomesDasPastas,
  pastaDaEmpresa,
  pastaGuardada,
  permissao,
  suportaPastas,
  type ReciboAchado,
} from "@/lib/pastaRecibos";

type Estado =
  | { k: "inicio" }
  | { k: "sem-suporte" }
  | { k: "sem-pasta" }
  | { k: "sem-permissao" }
  | { k: "sem-empresa"; pastas: string[] }
  | { k: "buscando"; msg: string }
  | { k: "achou"; r: ReciboAchado }
  | { k: "nao-achou"; pasta: string; pastas: string[] };

interface Props {
  senha: string;
  empresa: Pick<Madeireira, "apelido" | "razaoSocial" | "cnpj">;
  tipo: "comunicado" | "programacao";
  /** Início do tratamento (dd/mm/aaaa): define o mês da programação. */
  data: string | null;
  numeroComunicado: string | null;
  trimestral: boolean;
  onData: (data: string) => void;
}

export function ReciboPeticionamento({ senha, empresa, tipo, data, numeroComunicado, trimestral, onData }: Props) {
  const [estado, setEstado] = useState<Estado>({ k: "inicio" });
  const onDataRef = useRef(onData);
  useEffect(() => {
    onDataRef.current = onData;
  }, [onData]);
  const { apelido, razaoSocial, cnpj } = empresa;

  const buscar = useCallback(
    async (pedirPermissao: boolean) => {
      if (!suportaPastas()) return setEstado({ k: "sem-suporte" });
      if (!data || (tipo === "comunicado" && !numeroComunicado)) return;
      try {
        let raiz = await pastaGuardada();
        if (!raiz) {
          if (!pedirPermissao) return setEstado({ k: "sem-pasta" });
          raiz = await escolherPasta();
        }
        if ((await permissao(raiz, pedirPermissao)) !== "granted") return setEstado({ k: "sem-permissao" });
        setEstado({ k: "buscando", msg: "Procurando a pasta da empresa…" });
        const pasta = await pastaDaEmpresa(raiz, { apelido, razaoSocial, cnpj });
        if (!pasta) return setEstado({ k: "sem-empresa", pastas: await nomesDasPastas(raiz) });
        const r = await buscarRecibo({
          senha,
          pasta,
          tipo,
          data,
          numeroComunicado,
          trimestral,
          onProgresso: (msg) => setEstado({ k: "buscando", msg }),
        });
        if (r) {
          setEstado({ k: "achou", r });
          onDataRef.current(r.recibo.data);
        } else setEstado({ k: "nao-achou", pasta: pasta.name, pastas: await nomesDasPastas(raiz) });
      } catch (e) {
        // Seletor fechado sem escolher, ou pasta movida/apagada.
        if ((e as Error)?.name === "AbortError") return setEstado({ k: "sem-pasta" });
        setEstado({ k: "sem-pasta" });
      }
    },
    [senha, apelido, razaoSocial, cnpj, tipo, data, numeroComunicado, trimestral]
  );

  // Ao abrir: busca sozinho se a pasta já foi autorizada neste navegador.
  useEffect(() => {
    const t = setTimeout(() => void buscar(false), 0);
    return () => clearTimeout(t);
  }, [buscar]);

  const doc = tipo === "comunicado" ? `do comunicado ${numeroComunicado ?? ""}` : "da programação do mês";
  const escolherOutra = (pastas: string[]) => (
    <select
      aria-label="Pasta da empresa"
      defaultValue=""
      onChange={(e) => {
        if (!e.target.value) return;
        lembrarPastaDaEmpresa(empresa.cnpj, e.target.value);
        void buscar(false);
      }}
      style={{ maxWidth: 260 }}
    >
      <option value="">Escolher a pasta da empresa…</option>
      {pastas.map((p) => (
        <option key={p}>{p}</option>
      ))}
    </select>
  );

  let conteudo: ReactNode = null;
  switch (estado.k) {
    case "inicio":
      conteudo = <span className="hint">Procurando o recibo {doc}…</span>;
      break;
    case "sem-suporte":
      conteudo = <span className="hint">Abra o site no Chrome ou no Edge para buscar o recibo na pasta do OneDrive.</span>;
      break;
    case "sem-pasta":
    case "sem-permissao":
      conteudo = (
        <>
          <button type="button" className="btn btn-sm" onClick={() => void buscar(true)}>
            {estado.k === "sem-pasta" ? "Conectar a pasta “Madeireiras 2” do OneDrive" : "Permitir acesso à pasta do OneDrive"}
          </button>
          <span className="hint">
            {estado.k === "sem-pasta"
              ? "Uma vez só: escolha a pasta Madeireiras 2. O site acha o recibo do SEI e preenche a data do peticionamento."
              : "O navegador pede para confirmar o acesso à pasta (só leitura)."}
          </span>
        </>
      );
      break;
    case "sem-empresa":
      conteudo = (
        <>
          <span className="hint">Não achei a pasta de {empresa.apelido} no OneDrive.</span> {escolherOutra(estado.pastas)}
        </>
      );
      break;
    case "buscando":
      conteudo = <span className="hint">{estado.msg}</span>;
      break;
    case "achou":
      conteudo = (
        <span className="hint" title={estado.r.caminho}>
          ✓ Data do peticionamento {doc}: <b>{estado.r.recibo.data}</b> às {estado.r.recibo.hora} (recibo do SEI em{" "}
          {estado.r.caminho.split("/").slice(0, -1).join("/") || estado.r.caminho})
        </span>
      );
      break;
    case "nao-achou":
      conteudo = (
        <>
          <span className="hint">
            Não achei o recibo {doc} na pasta “{estado.pasta}”: confira a data à mão.
          </span>{" "}
          <button type="button" className="link" onClick={() => void buscar(false)}>
            procurar de novo
          </button>{" "}
          {escolherOutra(estado.pastas)}
        </>
      );
      break;
  }
  return <div className="recibo-peticionamento">{conteudo}</div>;
}
