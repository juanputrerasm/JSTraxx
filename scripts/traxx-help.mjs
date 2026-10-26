/*
  Converts Traxx's WinHelp sources (Traxx/Help: the .RTF topic files named in Traxx.hpj, and
  the contents in Traxx.cnt) into static pages under public/help, for Help > Contents.

    node scripts/traxx-help.mjs [path/to/Traxx_OnGoing_Updates]

  WinHelp conventions handled: a topic per \page, its id in a # footnote and its title in a $
  footnote (K keywords are dropped); a hotspot is double-underlined text (\uldb) followed by
  hidden text (\v) naming the topic it jumps to; bold, italic, underline, tabs, bullets
  (\pntext). Embedded pictures (\pict, Windows metafiles) are left out.
*/
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";

const root = process.argv[2] ?? join(homedir(), "dev/Traxx_OnGoing_Updates");
const helpDir = join(root, "Traxx/Help");
const out = new URL("../public/help/", import.meta.url).pathname;
mkdirSync(out, { recursive: true });

const SKIP = new Set(["fonttbl", "colortbl", "stylesheet", "info", "pict", "listtable", "listoverridetable", "rsidtbl", "generator", "xmlnstbl", "themedata", "datastore", "latentstyles", "pgdsctbl", "object", "blipuid"]);
const esc = (s) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

/* One RTF file into topics: { id, title, html }. */
function convert(rtf) {
  const topics = [];
  let topic = { id: "", title: "", parts: [] };
  let para = [];
  const paras = [];
  let state = { b: false, i: false, ul: false, uldb: false, v: false, skip: false, footnote: false, pntext: false };
  const stack = [];
  let footnoteText = "", footnoteMark = "";
  let pendingLink = null; // { start index in para, text }
  let run = "";

  const flushRun = () => {
    if (!run) return;
    if (state.v) {
      // Hidden text after a hotspot: the topic id it jumps to.
      const target = run.trim().replace(/^%/, "").split(/[@>]/)[0];
      if (pendingLink && target) para.splice(pendingLink.at, pendingLink.count, `<a href="${target}.html">${pendingLink.text}</a>`);
      pendingLink = null;
      run = "";
      return;
    }
    let html = esc(run);
    if (state.uldb) {
      pendingLink = { at: para.length, count: 1, text: html };
      para.push(html);
      run = "";
      return;
    }
    if (state.b) html = `<b>${html}</b>`;
    if (state.i) html = `<i>${html}</i>`;
    if (state.ul) html = `<u>${html}</u>`;
    para.push(html);
    run = "";
  };
  const endPara = () => {
    flushRun();
    const text = para.join("").replace(/^(&emsp;)+/, "");
    paras.push(text);
    para = [];
  };
  const endTopic = () => {
    endPara();
    const body = paras.splice(0).map((p) => (p.trim() ? `<p>${p}</p>` : "")).join("\n");
    if (topic.id || body.trim()) topics.push({ id: topic.id, title: topic.title, html: body });
    topic = { id: "", title: "", parts: [] };
  };

  let i = 0;
  while (i < rtf.length) {
    const ch = rtf[i];
    if (ch === "{") {
      if (state.footnote || state.skip) { stack.push({ ...state }); i++; continue; }
      flushRun();
      stack.push({ ...state });
      i++;
      // A destination group: {\* ...} or a known one.
      const m = /^\\(\*\\)?([a-z]+)/.exec(rtf.slice(i, i + 40));
      if (m && (m[1] || SKIP.has(m[2]))) state = { ...state, skip: true };
      else if (m && m[2] === "footnote") {
        state = { ...state, footnote: true };
        footnoteText = "";
        // The mark is the last text character before this group.
        const last = para.length ? para[para.length - 1] : "";
        footnoteMark = last.slice(-1);
        if (["#", "$", "K", "+", "!", "*", ">", "@"].includes(footnoteMark)) para[para.length - 1] = last.slice(0, -1);
      } else if (m && m[2] === "pntext") state = { ...state, pntext: true };
      continue;
    }
    if (ch === "}") {
      const leaving = state;
      if (!leaving.footnote && !leaving.skip) flushRun();
      state = stack.pop() ?? state;
      if (leaving.footnote && !state.footnote) {
        const text = footnoteText.trim();
        if (footnoteMark === "#") topic.id = text;
        else if (footnoteMark === "$") topic.title = text;
      }
      i++;
      continue;
    }
    if (ch === "\\") {
      const sym = rtf[i + 1];
      if (sym === "'") {
        const c = String.fromCharCode(parseInt(rtf.slice(i + 2, i + 4), 16));
        if (state.footnote) footnoteText += c; else if (!state.skip) run += c;
        i += 4;
        continue;
      }
      if (sym === "\\" || sym === "{" || sym === "}") {
        if (state.footnote) footnoteText += sym; else if (!state.skip) run += sym;
        i += 2;
        continue;
      }
      if (sym === "~") { if (!state.skip && !state.footnote) run += " "; i += 2; continue; }
      if (sym === "\n" || sym === "\r") { if (!state.skip && !state.footnote) endPara(); i += 2; continue; }
      const m = /^\\([a-z]+)(-?\d+)? ?/.exec(rtf.slice(i, i + 40));
      if (!m) { i += 2; continue; }
      i += m[0].length;
      if (state.skip || state.footnote) continue;
      const word = m[1], arg = m[2] === undefined ? null : Number(m[2]);
      const on = arg === null || arg !== 0;
      switch (word) {
        case "par": endPara(); break;
        case "page": endTopic(); break;
        case "tab": flushRun(); para.push("&emsp;"); break;
        case "line": flushRun(); para.push("<br>"); break;
        case "plain": flushRun(); state = { ...state, b: false, i: false, ul: false, uldb: false, v: false }; break;
        case "b": flushRun(); state = { ...state, b: on }; break;
        case "i": flushRun(); state = { ...state, i: on }; break;
        case "ul": flushRun(); state = { ...state, ul: on }; break;
        case "ulnone": flushRun(); state = { ...state, ul: false, uldb: false }; break;
        case "uldb": flushRun(); state = { ...state, uldb: on }; break;
        case "v": flushRun(); state = { ...state, v: on }; break;
        case "bullet": run += "•"; break;
        case "endash": run += "–"; break;
        case "emdash": run += "-"; break;
        case "lquote": case "rquote": run += "'"; break;
        case "ldblquote": case "rdblquote": run += "\""; break;
        default: break;
      }
      continue;
    }
    if (ch === "\r" || ch === "\n") { i++; continue; }
    if (state.footnote) footnoteText += ch;
    else if (!state.skip) {
      if (state.pntext && ch !== "·" && ch !== "·") run += ch;
      else if (state.pntext) run += "• ";
      else run += ch;
    }
    i++;
  }
  endTopic();
  return topics;
}

const page = (title, body) => `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(title)} - Traxx Help</title><link rel="stylesheet" href="help.css"></head>
<body><nav><a href="index.html">Contents</a></nav><main><h1>${esc(title)}</h1>
${body}
</main></body></html>
`;

const hpj = readFileSync(join(helpDir, "Traxx.hpj"), "latin1");
const files = [...hpj.matchAll(/^\.\\(.+\.rtf)\s*$/gim)].map((m) => m[1]);
const titles = new Map();
let count = 0;
for (const file of files) {
  for (const t of convert(readFileSync(join(helpDir, file), "latin1"))) {
    if (!t.id) continue;
    titles.set(t.id, t.title || t.id);
    writeFileSync(join(out, `${t.id}.html`), page(t.title || t.id, t.html));
    count++;
  }
}

// Contents (Traxx.cnt): "1 Heading" or "2 Title=TOPIC_ID", by level.
const cnt = readFileSync(join(helpDir, "Traxx.cnt"), "latin1").split(/\r?\n/).filter((l) => /^\d /.test(l));
let html = "", level = 0;
for (const line of cnt) {
  const n = Number(line[0]);
  const rest = line.slice(2);
  while (level < n) { html += "<ul>"; level++; }
  while (level > n) { html += "</ul>"; level--; }
  const [label, id] = rest.split("=");
  html += id && titles.has(id.trim()) ? `<li><a href="${id.trim()}.html">${esc(label)}</a></li>` : `<li><strong>${esc(label)}</strong></li>`;
}
while (level > 0) { html += "</ul>"; level--; }
writeFileSync(join(out, "index.html"), page("Traxx Help Contents", `<p>Traxx's own help, as written for the Windows program. JSTraxx follows it; where the browser differs (files, the mouse), Help &gt; Keyboard Summary says so.</p>\n${html}`));
writeFileSync(join(out, "help.css"), `:root { color-scheme: light dark; --text: #1d1d1b; --bg: #fbfaf8; --link: #2f6fd0; --head: #1c2f7a; }
@media (prefers-color-scheme: dark) { :root { --text: #e6e5e2; --bg: #232427; --link: #6ea0f0; --head: #9fb4f0; } }
body { margin: 0; font: 15px/1.5 system-ui, -apple-system, "Segoe UI", sans-serif; color: var(--text); background: var(--bg); }
nav { padding: 8px 16px; border-bottom: 1px solid #8884; }
main { max-width: 760px; padding: 8px 16px 48px; margin: 0 auto; }
h1 { color: var(--head); font-size: 1.4em; }
a { color: var(--link); }
p { margin: 0.4em 0; }
ul { padding-left: 1.4em; }
`);
console.log(`wrote ${count} help topics to ${out}`);
