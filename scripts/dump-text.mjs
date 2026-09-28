import fs from "node:fs";
import { PDFParse } from "pdf-parse";

const path = process.argv[2];
const buf = fs.readFileSync(path);
const parser = new PDFParse({ data: buf });
const result = await parser.getText();
console.log(result.text);
await parser.destroy();
