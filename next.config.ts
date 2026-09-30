import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // pdf-parse (via pdfjs-dist) precisa rodar sem bundling para resolver
  // corretamente o build Node em vez do worker de navegador, e o
  // @napi-rs/canvas precisa ficar de fora do bundle por ser um módulo nativo.
  serverExternalPackages: ["pdf-parse", "@napi-rs/canvas", "tesseract.js"],
  // O OCR (tesseract.js) carrega o worker e o núcleo WebAssembly por caminho em
  // tempo de execução: garante que esses arquivos vão junto na função da Vercel.
  outputFileTracingIncludes: {
    "/api/extrair": [
      "./node_modules/tesseract.js/**/*",
      "./node_modules/tesseract.js-core/**/*",
      // O worker do tesseract roda em outra thread e o rastreio da Vercel não vê os require
      // dele: sem estes pacotes o OCR travava na produção ("Cannot find module 'bmp-js'").
      "./node_modules/bmp-js/**/*",
      "./node_modules/idb-keyval/**/*",
      "./node_modules/is-url/**/*",
      "./node_modules/node-fetch/**/*",
      "./node_modules/whatwg-url/**/*",
      "./node_modules/tr46/**/*",
      "./node_modules/webidl-conversions/**/*",
      "./node_modules/regenerator-runtime/**/*",
      "./node_modules/wasm-feature-detect/**/*",
      "./node_modules/zlibjs/**/*",
      "./ocr/por.traineddata.gz",
    ],
  },
};

export default nextConfig;
