// Atalhos no menu do SEI do MAPA: um clique abre o peticionamento do certificado. Faz só o que o operador
// faria (Peticionamento > Processo Novo > tipo de processo), usando os links da própria sessão: os do SEI
// levam um infra_hash que muda, então não dá para guardar o endereço. Não lê os campos de login.
(() => {
  const ATALHOS = [
    ["AQF Cadastrada", "Tratamento Fitossanitário Quarentenário: Certificado TFQ – Térmico AQF – Cadastrada"],
    ["AQF Credenciada", "Tratamento Fitossanitário Quarentenário: Certificado TFQ – Térmico AQF – Credenciada"],
    ["Secagem Cadastrada", "Tratamento Fitossanitário Quarentenário: Certificado TFQ – Térmico Secagem Estufa – Cadastrada"],
    ["Secagem Credenciada", "Tratamento Fitossanitário Quarentenário: Certificado TFQ – Térmico Secagem Estufa – Credenciada"],
    ["Consolidado", "Tratamento Fitossanitário Quarentenário: Certificado TFQ Consolidado"],
    ["Desdobrado", "Tratamento Fitossanitário Quarentenário: Certificado TFQ Desdobrado"],
  ];
  const CHAVE = "atalhos-sei-pendente";

  // Sem acento, caixa ou diferença de traço ("–" e "-"): o nome no SEI pode mudar nesses detalhes.
  const norm = (s) =>
    (s || "")
      .normalize("NFD")
      .replace(/[̀-ͯ]/g, "")
      .replace(/[‐-―]/g, "-")
      .replace(/\s+/g, " ")
      .trim()
      .toLowerCase();

  const link = (texto) => {
    const alvo = norm(texto);
    return [...document.querySelectorAll("a")].find((a) => norm(a.textContent) === alvo) || null;
  };

  function aviso(msg) {
    const d = document.createElement("div");
    d.textContent = msg;
    d.style.cssText = "position:fixed;top:12px;left:50%;transform:translateX(-50%);z-index:99999;background:#b00020;color:#fff;padding:10px 16px;border-radius:6px;font:13px Arial,sans-serif;box-shadow:0 2px 8px rgba(0,0,0,.4)";
    document.body.appendChild(d);
    setTimeout(() => d.remove(), 8000);
  }

  function abrir(texto) {
    const tipo = link(texto);
    if (tipo) {
      sessionStorage.removeItem(CHAVE);
      tipo.click();
      return;
    }
    const menu = link("Processo Novo");
    if (!menu) return aviso("Atalhos SEI: não achei “Processo Novo” no menu.");
    sessionStorage.setItem(CHAVE, texto);
    menu.click();
  }

  // Chegou na lista depois do clique no menu: abre o tipo escolhido (a lista pode demorar a aparecer).
  function continuar() {
    const texto = sessionStorage.getItem(CHAVE);
    if (!texto) return;
    sessionStorage.removeItem(CHAVE);
    let tentativas = 0;
    const t = setInterval(() => {
      const tipo = link(texto);
      if (tipo) {
        clearInterval(t);
        tipo.click();
      } else if (++tentativas >= 20) {
        clearInterval(t);
        aviso(`Atalhos SEI: não achei “${texto}” na lista. Abra pela lista e me avise: o nome pode ter mudado.`);
      }
    }, 250);
  }

  // Só com a sessão aberta (na tela de login o menu não existe).
  if (!link("Processo Novo")) {
    sessionStorage.removeItem(CHAVE);
    return;
  }

  const painel = document.createElement("div");
  painel.id = "atalhos-sei";
  painel.style.cssText = "position:fixed;left:6px;bottom:6px;width:246px;z-index:9999;background:#0b2a33;border:1px solid #3a6b7a;border-radius:6px;padding:6px;font:11px Arial,sans-serif;display:grid;grid-template-columns:1fr 1fr;gap:4px";
  const titulo = document.createElement("div");
  titulo.textContent = "Certificado TFQ";
  titulo.style.cssText = "grid-column:1/3;color:#cfe6ee;font-weight:bold";
  painel.appendChild(titulo);
  for (const [rotulo, texto] of ATALHOS) {
    const b = document.createElement("button");
    b.type = "button";
    b.textContent = rotulo;
    b.title = texto;
    b.style.cssText = "background:#0691c8;color:#fff;border:0;border-radius:4px;padding:5px 2px;font:11px Arial,sans-serif;cursor:pointer";
    b.addEventListener("click", () => abrir(texto));
    painel.appendChild(b);
  }
  document.body.appendChild(painel);
  continuar();
})();
