/**
 * Cria (ou troca a senha de) um operador direto no banco — usado para o primeiro login master,
 * antes de existir alguém na controladoria. A senha é digitada no terminal e não aparece na tela.
 *
 *   npx tsx --env-file=.env.local scripts/criarOperador.ts <login> "<Nome>" [master]
 */
import readline from "node:readline";
import { senhaFraca } from "../src/lib/auth";
import { alterarOperador, criarOperador, listarOperadores } from "../src/lib/operadores";

function perguntarOculto(pergunta: string): Promise<string> {
  return new Promise((resolve) => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout, terminal: true });
    const saida = rl as unknown as { _writeToOutput: (s: string) => void; output: NodeJS.WriteStream };
    let mostrarPergunta = true;
    saida._writeToOutput = (s: string) => {
      if (mostrarPergunta) saida.output.write(s);
      else if (s.includes("\n")) saida.output.write("\n");
    };
    rl.question(pergunta, (resposta) => {
      rl.close();
      resolve(resposta);
    });
    mostrarPergunta = false;
  });
}

async function main() {
  const [login, nome, perfilArg] = process.argv.slice(2);
  if (!login || !nome) {
    console.error('Uso: npx tsx --env-file=.env.local scripts/criarOperador.ts <login> "<Nome>" [master]');
    process.exit(1);
  }
  const perfil = perfilArg === "master" ? "master" : "operador";
  const senha = await perguntarOculto(`Senha para ${login}: `);
  const repetida = await perguntarOculto("Repita a senha: ");
  if (senha !== repetida) throw new Error("As senhas não conferem.");
  const fraca = senhaFraca(senha);
  if (fraca) throw new Error(fraca);

  const existente = (await listarOperadores()).find((o) => o.login === login.trim().toLowerCase());
  if (existente) {
    await alterarOperador(existente.id, { senha, nome, perfil, ativo: true });
    console.log(`Senha de ${login} atualizada (${perfil}).`);
  } else {
    await criarOperador({ login, nome, senha, perfil });
    console.log(`Operador ${login} criado (${perfil}).`);
  }
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
