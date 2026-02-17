import { parse } from "node-html-parser";

export function compileSJS(code, id = "") {
  const root = parse(code);

  const scopeId = `data-s-${Math.random().toString(36).slice(2, 8)}`;

  const styleNode = root.querySelector("style");
  let scopedCss = "";

  if (styleNode) {
    const rawCss = styleNode.textContent;
    scopedCss = rawCss.replace(
      /([^{]+)({[^}]+})/g,
      (match, selector, content) => {
        const s = selector.trim();
        if (!s || s.startsWith("@") || s.startsWith(":root")) {
          return match;
        }

        const scopedSelector = selector
          .split(",")
          .map((part) => {
            const p = part.trim();
            if (!p) return part;
            return `${p}[${scopeId}]`;
          })
          .join(", ");

        return `${scopedSelector} ${content}`;
      }
    );
  }

  const rawScript = root.querySelector("script")?.textContent || "";

  const importLines = [];
  const remainingLines = [];

  rawScript.split("\n").forEach((line) => {
    if (line.trim().startsWith("import ")) {
      importLines.push(line.trim());
    } else {
      remainingLines.push(line);
    }
  });

  const script = remainingLines.join("\n");

  const template = root.childNodes.find(
    (n) =>
      n.nodeType === 1 &&
      n.tagName !== "SCRIPT" &&
      n.tagName !== "STYLE"
  );

  let elCount = 0;
  let globalDecls = "";

  const hasSlots =
    template &&
    template.querySelectorAll &&
    template.querySelectorAll("slot").length > 0;

  const gen = (node, pName, insideFor = false) => {
    if (!node) return "";

    if (node.nodeType === 3) {
      const t = node.textContent;
      if (!t || !t.trim()) return "";

      if (t.includes("{{")) {
        const n = `t${elCount++}`;
        const expr = t.replace(/\{\{([^}]+)\}\}/g, (_m, g1) => {
          return `\${(typeof ${g1.trim()} === 'function' ? ${g1.trim()}() : ${g1.trim()})}`;
        });

        return `
const ${n} = document.createTextNode("");
${pName}.appendChild(${n});
$watch(() => { ${n}.textContent = \`${expr}\`; });
`;
      }

      const n = `t${elCount++}`;
      return `
const ${n} = document.createTextNode(\`${t.replace(/[`$\\]/g, "\\$&")}\`);
${pName}.appendChild(${n});
`;
    }

    const name = `el${elCount++}`;
    const tag = node.tagName.toLowerCase();
    const attrs = node.attributes || {};

    let code = `
const ${name} = document.createElement("${tag}");
${name}.setAttribute("${scopeId}", "");
`;

    for (let [k, v] of Object.entries(attrs)) {
      if (k.startsWith("@")) {
        code += `${name}.addEventListener("${k.slice(1)}", ($event) => { ${v} });\n`;
      } else if (k === "s-model") {
        code += `
$watch(() => { ${name}.value = ${v}(); });
${name}.addEventListener("input", e => ${v}(e.target.value));
`;
      } else {
        code += `${name}.setAttribute("${k}", \`${v}\`);\n`;
      }
    }

    if (pName) {
      code += `${pName}.appendChild(${name});\n`;
    }

    node.childNodes.forEach((ch) => {
      code += gen(ch, name);
    });

    return code;
  };

  const body = template ? gen(template, "target") : "";

  const styleInjected = scopedCss
    ? `
const _s = document.createElement("style");
_s.textContent = \`${scopedCss}\`;
document.head.appendChild(_s);
`
    : "";

  const componentParams = hasSlots
    ? "(target, _slots = {}, $props = {})"
    : "(target)";

  const userImports =
    importLines.length > 0 ? importLines.join("\n") + "\n" : "";

  const output = `
import {$signal, $watch, $onMount, $reconcile, $computed, $signals, $component} from "@sjs/core";
${userImports}
${styleInjected}
export default function ${componentParams} {
${script}
${globalDecls}
${body}
if(typeof el0 !== 'undefined') target.replaceChildren(el0);
}
`;

  return { code: output, map: null };
}