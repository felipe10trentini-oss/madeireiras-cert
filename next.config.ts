import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // pdf-parse (via pdfjs-dist) precisa rodar sem bundling para resolver
  // corretamente o build Node em vez do worker de navegador, e o
  // @napi-rs/canvas precisa ficar de fora do bundle por ser um módulo nativo.
  serverExternalPackages: ["pdf-parse", "@napi-rs/canvas", "tesseract.js"],
  // O OCR (tesseract.js) carrega o worker e o núcleo WebAssembly por caminho em
  // tempo de execução: garante que esses arquivos vão junto na função da Vercel.
  outputFileTracingIncludes: {
    "/api/extrair": ["./node_modules/tesseract.js/**/*", "./node_modules/tesseract.js-core/**/*"],
  },
};

export default nextConfig;
