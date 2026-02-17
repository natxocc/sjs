#!/usr/bin/env node
import fs from "fs";
import { compileSJS } from "@sjs/compiler";

const file = process.argv[2];

if (!file) {
  console.log("Usage: sjs <file.sjs>");
  process.exit(1);
}

const code = fs.readFileSync(file, "utf-8");

const { code: output } = compileSJS(code, file);

const outFile = file.replace(".sjs", ".js");

fs.writeFileSync(outFile, output);

console.log("? Compiled:", outFile);