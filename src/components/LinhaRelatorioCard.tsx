"use client";

import { useState } from "react";
import { regraDe, type TipoTratamento } from "@/lib/certificado";
import type { Comunicado } from "@/lib/comunicado";
import type { MadeireiraSalva } from "@/lib/madeireirasDb";
import type { ValoresCertificado } from "@/lib/modelos";
import {
  colunasRelatorio,
  linhaParaTsv,
  montarLinhaRelatorio,
  type PadraoRelatorio,
} from "@/lib/relatorio";
import {
  cidadeDoEndereco,
  ehMannMovel,
  linhaMannMovel,
  placaDaUnidade,
  PROCESSO_COMUNICADO_MANN,
  VOLUME_CAMARA_MANN,
} from "@/lib/relatorioMannMovel";
import { rtCompleto } from "@/lib/responsaveis";
import { cabecalhoSenha } from "@/lib/senhaEquipe";
import { ReciboPeticionamento } from "./ReciboPeticionamento";

interface Props {
  senha: string;
  empresa: MadeireiraSalva;
  valores: ValoresCertificado;
  tipo: TipoTratamento;
  camara: string | null;
  comunicado: Comunicado | null;
  dataComunicado: string | null;
  onToast: (msg: string) => void;
  onPadraoSalvo: (padrao: PadraoRelatorio) => void;
}

/**
 * Linha da aba TÉRMICO do relatório do MAPA. Processo, data da programação,
 * RT e volume da câmara não estão na curva: são digitados uma vez e ficam
 * salvos na empresa (gravados ao copiar a linha).
 */
export function LinhaRelatorioCard({ senha, empresa, valores, tipo, camara, comunicado, dataComunicado, onToast, onPadraoSalvo }: Props) {
  const salvo = empresa.relatorio ?? {};
  // Padrão das linhas já lançadas na planilha de relatório da empresa (objetivo, formatos, processo, RT...).
  const estilo = empresa.estilo ?? null;
  // MANN MÓVEL: planilha própria (placa, local, total de peças em "Número de volumes"). Ver relatorioMannMovel.ts.
  const mann = ehMannMovel(empresa);
  const [placa, setPlaca] = useState(placaDaUnidade(comunicado?.unidadeVolante));
  const [local, setLocal] = useState(cidadeDoEndereco(valores.enderecoTrat));
  const [processo, setProcesso] = useState(
    mann ? salvo.processo || PROCESSO_COMUNICADO_MANN : salvo.processo || estilo?.processo || ""
  );
  // Com comunicado enviado, a data é a de criação do PDF; na programação, a data salva do mês.
  // Achando o recibo do SEI na pasta do OneDrive, vale a data do peticionamento (ReciboPeticionamento).
  const usaComunicado = dataComunicado != null || empresa.documento === "comunicado";
  const [dataDocumento, setDataDocumento] = useState(
    usaComunicado ? (dataComunicado ?? "") : (salvo.dataDocumento || estilo?.dataDocumento || "")
  );
  // Nome completo do RT (o da assinatura no SEI), não o apelido da Planilha Geral.
  const [rt, setRt] = useState(rtCompleto(empresa.rt) || salvo.rt || estilo?.rt || "");
  const [volumeCamara, setVolumeCamara] = useState(
    mann
      ? VOLUME_CAMARA_MANN
      : (camara && (salvo.volumesCamara?.[camara] || estilo?.volumesCamara?.[String(parseInt(camara, 10))])) || ""
  );
  const [ajustes, setAjustes] = useState<Record<string, string>>({});

  const colunas = colunasRelatorio(empresa);
  const padrao: PadraoRelatorio = {
    processo,
    dataDocumento,
    rt,
    volumesCamara: camara ? { [camara]: volumeCamara } : {},
  };
  const base = montarLinhaRelatorio({ empresa, valores, tipo, camara, padrao, estilo });
  const linha = {
    ...(mann
      ? linhaMannMovel(base, { valores, comunicado, processo, dataDocumento, placa, local, volumeCamara })
      : base),
    ...ajustes,
  };

  async function copiar() {
    try {
      await navigator.clipboard.writeText(linhaParaTsv(colunas, linha));
    } catch {
      onToast("Não foi possível copiar. Permita o acesso à área de transferência e tente de novo.");
      return;
    }
    // Guarda os dados repetitivos para a próxima emissão desta empresa.
    const guardar: PadraoRelatorio = mann ? { processo, rt } : { processo, rt, volumesCamara: padrao.volumesCamara };
    if (!usaComunicado) guardar.dataDocumento = dataDocumento;
    try {
      const res = await fetch("/api/madeireiras/padrao", {
        method: "POST",
        headers: { "Content-Type": "application/json", ...cabecalhoSenha(senha) },
        body: JSON.stringify({ cnpj: empresa.cnpj, padrao: guardar }),
      });
      if (res.ok) onPadraoSalvo((await res.json()).padrao);
    } catch {
      // salvar o padrão é conveniência; a linha já foi copiada
    }
    onToast(
      `Linha copiada! Cole na coluna A da próxima linha vazia da aba TÉRMICO (${empresa.modalidade === "Credenciada" ? "A–Z" : "A–X"}).`
    );
  }

  return (
    <section>
      <div className="section-title">
        <h2>Linha do relatório do MAPA</h2>
        <p>
          Aba TÉRMICO · planilha de {empresa.modalidade === "Credenciada" ? "credenciada (A–Z)" : "cadastrada (A–X)"}
        </p>
      </div>

      <div className="card" style={{ marginBottom: 14 }}>
        <div className="form-grid tres">
          <div className="field">
            <label htmlFor="rel-processo">Nº do processo da {empresa.documento === "comunicado" ? "comunicação" : "programação"}</label>
            <input id="rel-processo" type="text" value={processo} onChange={(e) => setProcesso(e.target.value)} placeholder="21034.001153/2021-90" />
          </div>
          <div className="field">
            <label htmlFor="rel-data">Data do {empresa.documento === "comunicado" ? "comunicado" : "documento (programação)"}</label>
            <input id="rel-data" type="text" value={dataDocumento} onChange={(e) => setDataDocumento(e.target.value)} placeholder="dd/mm/aaaa" />
          </div>
          {!mann && (
            <div className="field full">
              {/* Data do peticionamento: lida do recibo do SEI na pasta do OneDrive. */}
              <ReciboPeticionamento
                senha={senha}
                empresa={empresa}
                tipo={usaComunicado ? "comunicado" : "programacao"}
                data={valores.dataInicio ?? null}
                numeroComunicado={usaComunicado ? (comunicado?.numero ?? valores.comunicado ?? null) : null}
                trimestral={!!regraDe(empresa).programacaoTrimestral}
                onData={setDataDocumento}
              />
            </div>
          )}
          <div className="field">
            <label htmlFor="rel-rt">Responsável técnico</label>
            <input id="rel-rt" type="text" value={rt} onChange={(e) => setRt(e.target.value)} />
          </div>
          <div className="field">
            <label htmlFor="rel-vol">Volume da câmara {mann ? "" : (camara ?? "")} (m³)</label>
            <input id="rel-vol" type="text" value={volumeCamara} onChange={(e) => setVolumeCamara(e.target.value)} />
          </div>
          {mann && (
            <>
              <div className="field">
                <label htmlFor="rel-placa">Placa (unidade de tratamento)</label>
                <input id="rel-placa" type="text" value={placa} onChange={(e) => setPlaca(e.target.value)} placeholder="ex.: JCV8C11" />
                {!placa && <span className="hint">Unidade volante do comunicado não reconhecida: digite a placa.</span>}
              </div>
              <div className="field">
                <label htmlFor="rel-local">Local do tratamento (cidade)</label>
                <input id="rel-local" type="text" value={local} onChange={(e) => setLocal(e.target.value)} />
              </div>
            </>
          )}
          <div className="field">
            <label htmlFor="rel-vols">Número de volumes</label>
            <input id="rel-vols" type="text" value={linha.volumes} onChange={(e) => setAjustes((a) => ({ ...a, volumes: e.target.value }))} />
          </div>
          <div className="field">
            <label htmlFor="rel-pc">Nº do processo do certificado</label>
            <input
              id="rel-pc"
              type="text"
              value={linha.processoCertificado}
              onChange={(e) => setAjustes((a) => ({ ...a, processoCertificado: e.target.value }))}
              placeholder="deixe em branco e preencha depois"
            />
          </div>
        </div>
        <p className="hint">
          Processo, data, RT e volume da câmara ficam salvos para esta empresa quando você copia a linha.
        </p>
      </div>

      <div className="table-wrap" style={{ marginBottom: 14 }}>
        <table className="dados">
          <thead>
            <tr>
              {colunas.map((c, i) => (
                <th key={c.key}>
                  {String.fromCharCode(65 + i)} · {c.titulo}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            <tr>
              {colunas.map((c) => (
                <td key={c.key}>{linha[c.key] || "—"}</td>
              ))}
            </tr>
          </tbody>
        </table>
      </div>

      <div className="actions">
        <button type="button" className="btn primary lg" onClick={copiar}>
          Copiar linha do relatório
        </button>
        <span className="hint">Cole na coluna A da próxima linha vazia da aba TÉRMICO.</span>
      </div>
    </section>
  );
}
