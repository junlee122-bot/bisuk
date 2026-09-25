/**
 * 서지 — BibTeX / RIS / CSL-JSON 가져오기·내보내기와 한국 인문학 각주·참고문헌 형식.
 * 가져오기는 알 수 없는 필드·형식을 버리지 않고 경고로 알린다.
 * 형식화 규칙(한국어 문헌):
 *   논문  저자, 「논문명」, 『학술지명』 권-호, 발행처, 연도, 쪽.
 *   단행본 저자, 『서명』, 출판지: 출판사, 연도, 쪽.
 *   학위논문 저자, 「논문명」, 대학 박사학위논문, 연도.
 * 서양어 문헌은 Chicago 형식에 가깝게 쓴다.
 */
import type { BibliographyEntry, BibliographyType, CslName } from "@seokmun/types";

export type BibliographyDraft = Omit<BibliographyEntry, "id" | "createdAt" | "updatedAt" | "createdBy">;

export interface BibliographyParseResult {
  entries: BibliographyDraft[];
  warnings: string[];
}

export function emptyDraft(type: BibliographyType, title: string): BibliographyDraft {
  return {
    citationKey: "",
    type,
    title,
    author: [],
    editor: [],
    issued: null,
    containerTitle: "",
    volume: "",
    issue: "",
    page: "",
    publisher: "",
    publisherPlace: "",
    genre: "",
    DOI: "",
    URL: "",
    ISBN: "",
    language: "ko",
    note: "",
  };
}

const CJK_RE = /[\p{Script=Hangul}\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}]/u;
const HANGUL_RE = /\p{Script=Hangul}/u;

function guessLanguage(text: string): string {
  if (HANGUL_RE.test(text)) return "ko";
  if (/[\p{Script=Hiragana}\p{Script=Katakana}]/u.test(text)) return "ja";
  if (/\p{Script=Han}/u.test(text)) return "zh";
  return "en";
}

/** "홍길동", "Kim, Minsu", "Minsu Kim", "{국립문화재연구원}" → CSL 이름 */
export function parseName(raw: string): CslName {
  const s = raw.trim();
  if (/^\{.*\}$/.test(s)) return { literal: s.slice(1, -1).trim() };
  if (CJK_RE.test(s) && !s.includes(",")) return { literal: s.replace(/\s+/g, " ") };
  if (s.includes(",")) {
    const [family, ...rest] = s.split(",");
    const given = rest.join(",").trim();
    return given ? { family: family!.trim(), given } : { family: family!.trim() };
  }
  const parts = s.split(/\s+/);
  if (parts.length === 1) return { literal: s };
  return { family: parts[parts.length - 1]!, given: parts.slice(0, -1).join(" ") };
}

export function nameToString(n: CslName, order: "family-first" | "given-first" = "family-first"): string {
  if (n.literal) return n.literal;
  if (!n.given) return n.family ?? "";
  if (!n.family) return n.given;
  if (CJK_RE.test(n.family)) return `${n.family}${n.given}`;
  return order === "family-first" ? `${n.family}, ${n.given}` : `${n.given} ${n.family}`;
}

// ── BibTeX ──

const BIBTEX_TYPE: Record<string, BibliographyType> = {
  article: "article-journal",
  book: "book",
  inbook: "chapter",
  incollection: "chapter",
  phdthesis: "thesis",
  mastersthesis: "thesis",
  thesis: "thesis",
  techreport: "report",
  report: "report",
  inproceedings: "paper-conference",
  conference: "paper-conference",
  online: "webpage",
  electronic: "webpage",
  dataset: "dataset",
  unpublished: "manuscript",
  misc: "manuscript",
  manual: "report",
  booklet: "book",
};

const TYPE_TO_BIBTEX: Record<BibliographyType, string> = {
  "article-journal": "article",
  book: "book",
  chapter: "incollection",
  thesis: "phdthesis",
  report: "techreport",
  "paper-conference": "inproceedings",
  webpage: "online",
  dataset: "dataset",
  manuscript: "unpublished",
};

const MONTHS: Record<string, number> = {
  jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12,
};

function unLatex(s: string): string {
  return s
    .replace(/\\&/g, "&")
    .replace(/\\%/g, "%")
    .replace(/\\_/g, "_")
    .replace(/\\\$/g, "$")
    .replace(/\\textendash\s*/g, "–")
    .replace(/---/g, "—")
    .replace(/--/g, "–")
    .replace(/[{}]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

/** 필드 값 읽기 — {중첩 {괄호}}, "따옴표", 숫자, @string 매크로, # 연결 */
function readValue(src: string, i: number, macros: Map<string, string>): [string, number] {
  const parts: string[] = [];
  for (;;) {
    while (/\s/.test(src[i] ?? "")) i++;
    const ch = src[i];
    if (ch === "{") {
      let depth = 0;
      const start = i;
      for (; i < src.length; i++) {
        if (src[i] === "\\") {
          i++;
          continue;
        }
        if (src[i] === "{") depth++;
        else if (src[i] === "}") {
          depth--;
          if (depth === 0) break;
        }
      }
      parts.push(src.slice(start + 1, i));
      i++;
    } else if (ch === '"') {
      const start = ++i;
      let depth = 0;
      for (; i < src.length; i++) {
        if (src[i] === "\\") {
          i++;
          continue;
        }
        if (src[i] === "{") depth++;
        else if (src[i] === "}") depth--;
        else if (src[i] === '"' && depth === 0) break;
      }
      parts.push(src.slice(start, i));
      i++;
    } else {
      const m = /^[^,}\s#]+/.exec(src.slice(i));
      const tok = m?.[0] ?? "";
      i += tok.length;
      parts.push(macros.get(tok.toLowerCase()) ?? tok);
    }
    while (/\s/.test(src[i] ?? "")) i++;
    if (src[i] === "#") {
      i++;
      continue;
    }
    return [parts.join(""), i];
  }
}

export function parseBibtex(text: string): BibliographyParseResult {
  const entries: BibliographyDraft[] = [];
  const warnings: string[] = [];
  const macros = new Map<string, string>();
  let i = 0;
  while (i < text.length) {
    const at = text.indexOf("@", i);
    if (at < 0) break;
    const m = /^@\s*([A-Za-z]+)\s*([{(])/.exec(text.slice(at));
    if (!m) {
      i = at + 1;
      continue;
    }
    const kind = m[1]!.toLowerCase();
    const close = m[2] === "{" ? "}" : ")";
    i = at + m[0].length;
    if (kind === "comment" || kind === "preamble") {
      let depth = 1;
      for (; i < text.length && depth > 0; i++) {
        if (text[i] === "{" || text[i] === "(") depth++;
        else if (text[i] === "}" || text[i] === ")") depth--;
      }
      continue;
    }
    if (kind === "string") {
      const nm = /^\s*([^=\s]+)\s*=/.exec(text.slice(i));
      if (nm) {
        i += nm[0].length;
        const [v, ni] = readValue(text, i, macros);
        macros.set(nm[1]!.toLowerCase(), v);
        i = ni;
      }
      while (i < text.length && text[i] !== close) i++;
      i++;
      continue;
    }
    const keyM = /^\s*([^,\s]*)\s*,/.exec(text.slice(i));
    const key = keyM?.[1] ?? "";
    if (keyM) i += keyM[0].length;
    const fields = new Map<string, string>();
    for (;;) {
      while (/[\s,]/.test(text[i] ?? "")) i++;
      if (i >= text.length || text[i] === close) {
        i++;
        break;
      }
      const fm = /^([A-Za-z][\w:-]*)\s*=/.exec(text.slice(i));
      if (!fm) {
        warnings.push(`@${kind}{${key}}: 필드 구문을 읽을 수 없어 나머지를 건너뜀`);
        while (i < text.length && text[i] !== close) i++;
        i++;
        break;
      }
      i += fm[0].length;
      const [v, ni] = readValue(text, i, macros);
      fields.set(fm[1]!.toLowerCase(), v);
      i = ni;
    }
    const type = BIBTEX_TYPE[kind];
    if (!type) warnings.push(`@${kind}{${key}}: 알 수 없는 유형 — manuscript로 가져옴`);
    const title = unLatex(fields.get("title") ?? "");
    if (!title) {
      warnings.push(`@${kind}{${key}}: 제목(title) 없음 — 건너뜀`);
      continue;
    }
    const d = emptyDraft(type ?? "manuscript", title);
    d.citationKey = key;
    const names = (f: string) =>
      (fields.get(f) ?? "")
        .split(/\s+and\s+/i)
        .map((x) => x.trim())
        .filter(Boolean)
        .map((x) => parseName(/^\{.*\}$/.test(x) ? x : unLatex(x)));
    d.author = names("author");
    d.editor = names("editor");
    const year = parseInt(fields.get("year") ?? fields.get("date") ?? "", 10);
    if (Number.isFinite(year)) {
      const monRaw = (fields.get("month") ?? "").toLowerCase().slice(0, 3);
      const month = MONTHS[monRaw] ?? (parseInt(monRaw, 10) || undefined);
      d.issued = month && month >= 1 && month <= 12 ? { year, month } : { year };
    }
    d.containerTitle = unLatex(fields.get("journal") ?? fields.get("journaltitle") ?? fields.get("booktitle") ?? "");
    d.volume = unLatex(fields.get("volume") ?? "");
    d.issue = unLatex(fields.get("number") ?? fields.get("issue") ?? "");
    d.page = unLatex(fields.get("pages") ?? "").replace(/–/g, "-");
    d.publisher = unLatex(fields.get("publisher") ?? fields.get("school") ?? fields.get("institution") ?? fields.get("organization") ?? "");
    d.publisherPlace = unLatex(fields.get("address") ?? fields.get("location") ?? "");
    d.DOI = unLatex(fields.get("doi") ?? "");
    d.URL = (fields.get("url") ?? "").trim();
    d.ISBN = unLatex(fields.get("isbn") ?? "");
    d.note = unLatex(fields.get("note") ?? "");
    if (kind === "phdthesis") d.genre = unLatex(fields.get("type") ?? "박사학위논문");
    else if (kind === "mastersthesis") d.genre = unLatex(fields.get("type") ?? "석사학위논문");
    else d.genre = unLatex(fields.get("type") ?? "");
    const lang = (fields.get("langid") ?? fields.get("language") ?? "").toLowerCase();
    d.language = lang.startsWith("kor") || lang === "ko" ? "ko" : lang.startsWith("chi") || lang === "zh" ? "zh" : lang.startsWith("jap") || lang === "ja" ? "ja" : lang ? "en" : guessLanguage(title + d.containerTitle);
    entries.push(d);
  }
  return { entries, warnings };
}

function bibtexEscape(s: string): string {
  return s.replace(/([&%_$#])/g, "\\$1");
}

function bibtexName(n: CslName): string {
  if (n.literal) return `{${n.literal}}`;
  if (n.family && n.given) return `${n.family}, ${n.given}`;
  return n.family ?? n.given ?? "";
}

export function makeCitationKey(e: Pick<BibliographyEntry, "author" | "issued" | "title">): string {
  const first = e.author[0];
  const base = first ? (first.family ?? first.literal ?? first.given ?? "anon") : "anon";
  const ascii = base.normalize("NFKD").replace(/[^\w]/g, "");
  return `${ascii || "ref"}${e.issued?.year ?? "nd"}`;
}

export function serializeBibtex(entries: Array<BibliographyDraft | BibliographyEntry>): string {
  const used = new Set<string>();
  return entries
    .map((e) => {
      let key = e.citationKey || makeCitationKey(e);
      let n = 1;
      while (used.has(key)) key = `${e.citationKey || makeCitationKey(e)}${String.fromCharCode(96 + ++n)}`;
      used.add(key);
      const f: Array<[string, string]> = [];
      const push = (k: string, v: string | undefined) => {
        if (v) f.push([k, v]);
      };
      push("title", `{${bibtexEscape(e.title)}}`);
      push("author", e.author.map(bibtexName).join(" and "));
      push("editor", e.editor.map(bibtexName).join(" and "));
      push("year", e.issued ? String(e.issued.year) : "");
      push("month", e.issued?.month ? String(e.issued.month) : "");
      const container = bibtexEscape(e.containerTitle);
      if (e.type === "article-journal") push("journal", container);
      else push("booktitle", container);
      push("volume", e.volume);
      push("number", e.issue);
      push("pages", e.page.replace(/-/g, "--"));
      if (e.type === "thesis") push("school", bibtexEscape(e.publisher));
      else if (e.type === "report") push("institution", bibtexEscape(e.publisher));
      else push("publisher", bibtexEscape(e.publisher));
      push("address", e.publisherPlace);
      push("type", e.genre);
      push("doi", e.DOI);
      push("url", e.URL);
      push("isbn", e.ISBN);
      push("langid", e.language);
      push("note", bibtexEscape(e.note));
      const body = f.map(([k, v]) => `  ${k} = {${v}}`).join(",\n");
      return `@${TYPE_TO_BIBTEX[e.type]}{${key},\n${body}\n}`;
    })
    .join("\n\n")
    .concat("\n");
}

// ── RIS ──

const RIS_TYPE: Record<string, BibliographyType> = {
  JOUR: "article-journal",
  JFULL: "article-journal",
  MGZN: "article-journal",
  NEWS: "article-journal",
  BOOK: "book",
  EBOOK: "book",
  EDBOOK: "book",
  CHAP: "chapter",
  ECHAP: "chapter",
  THES: "thesis",
  RPRT: "report",
  GOVDOC: "report",
  CONF: "paper-conference",
  CPAPER: "paper-conference",
  ELEC: "webpage",
  WEB: "webpage",
  DATA: "dataset",
  UNPB: "manuscript",
  MANSCPT: "manuscript",
  GEN: "manuscript",
};

const TYPE_TO_RIS: Record<BibliographyType, string> = {
  "article-journal": "JOUR",
  book: "BOOK",
  chapter: "CHAP",
  thesis: "THES",
  report: "RPRT",
  "paper-conference": "CPAPER",
  webpage: "ELEC",
  dataset: "DATA",
  manuscript: "UNPB",
};

export function parseRis(text: string): BibliographyParseResult {
  const entries: BibliographyDraft[] = [];
  const warnings: string[] = [];
  let cur: Map<string, string[]> | null = null;
  let lastTag = "";
  const flush = () => {
    if (!cur) return;
    const get = (...tags: string[]) => tags.map((t) => cur!.get(t)?.[0]).find((v) => v) ?? "";
    const all = (...tags: string[]) => tags.flatMap((t) => cur!.get(t) ?? []);
    const ty = get("TY");
    const type = RIS_TYPE[ty];
    if (!type) warnings.push(`TY  - ${ty}: 알 수 없는 유형 — manuscript로 가져옴`);
    const title = get("TI", "T1", "CT", "BT");
    if (!title) {
      warnings.push(`TY  - ${ty}: 제목 없음 — 건너뜀`);
      cur = null;
      return;
    }
    const d = emptyDraft(type ?? "manuscript", title);
    d.author = all("AU", "A1").map(parseName);
    d.editor = all("ED", "A2", "A3").map(parseName);
    const yearStr = get("PY", "Y1", "DA");
    const ym = /(\d{4})(?:[/-](\d{1,2}))?/.exec(yearStr);
    if (ym) {
      const month = ym[2] ? parseInt(ym[2], 10) : undefined;
      d.issued = month && month >= 1 && month <= 12 ? { year: parseInt(ym[1]!, 10), month } : { year: parseInt(ym[1]!, 10) };
    }
    d.containerTitle = get("T2", "JO", "JF", "JA", "SE");
    if (type === "book" && get("BT") && get("TI", "T1")) d.containerTitle = "";
    d.volume = get("VL");
    d.issue = get("IS");
    const sp = get("SP");
    const ep = get("EP");
    d.page = sp && ep ? `${sp}-${ep}` : sp;
    d.publisher = get("PB");
    d.publisherPlace = get("CY", "PP");
    d.DOI = get("DO");
    d.URL = get("UR", "L2");
    d.ISBN = get("SN");
    d.genre = get("M3");
    d.note = all("N1").join(" ");
    d.citationKey = get("ID");
    const la = get("LA").toLowerCase();
    d.language = la.startsWith("ko") || la.includes("korean") || la === "kor" ? "ko" : la ? (la.startsWith("zh") || la.includes("chinese") ? "zh" : la.startsWith("ja") || la.includes("japanese") ? "ja" : "en") : guessLanguage(title + d.containerTitle);
    entries.push(d);
    cur = null;
  };
  for (const raw of text.split(/\r?\n/)) {
    const m = /^([A-Z][A-Z0-9])  -\s?(.*)$/.exec(raw);
    if (!m) {
      if (cur && lastTag && raw.trim()) {
        const list = cur.get(lastTag)!;
        list[list.length - 1] += ` ${raw.trim()}`;
      }
      continue;
    }
    const [, tag, value] = m as unknown as [string, string, string];
    if (tag === "TY") {
      flush();
      cur = new Map();
    }
    if (tag === "ER") {
      flush();
      lastTag = "";
      continue;
    }
    if (!cur) continue;
    const list = cur.get(tag) ?? [];
    list.push(value.trim());
    cur.set(tag, list);
    lastTag = tag;
  }
  if (cur) {
    warnings.push("마지막 레코드에 ER 태그가 없음 — 가져옴");
    flush();
  }
  return { entries, warnings };
}

export function serializeRis(entries: Array<BibliographyDraft | BibliographyEntry>): string {
  const lines: string[] = [];
  for (const e of entries) {
    const push = (tag: string, v: string | undefined) => {
      if (v) lines.push(`${tag}  - ${v}`);
    };
    push("TY", TYPE_TO_RIS[e.type]);
    push("ID", e.citationKey);
    push("TI", e.title);
    for (const a of e.author) push("AU", nameToString(a));
    for (const a of e.editor) push("ED", nameToString(a));
    push("PY", e.issued ? `${e.issued.year}${e.issued.month ? `/${String(e.issued.month).padStart(2, "0")}` : ""}` : "");
    push("T2", e.containerTitle);
    push("VL", e.volume);
    push("IS", e.issue);
    const [sp, ep] = e.page.split("-");
    push("SP", sp);
    push("EP", ep);
    push("PB", e.publisher);
    push("CY", e.publisherPlace);
    push("M3", e.genre);
    push("DO", e.DOI);
    push("UR", e.URL);
    push("SN", e.ISBN);
    push("LA", e.language);
    push("N1", e.note);
    lines.push("ER  - ");
    lines.push("");
  }
  return lines.join("\r\n");
}

// ── CSL-JSON ──

export function toCslJson(entries: BibliographyEntry[]): Array<Record<string, unknown>> {
  return entries.map((e) => {
    const o: Record<string, unknown> = { id: e.citationKey || e.id, type: e.type, title: e.title };
    if (e.author.length) o.author = e.author;
    if (e.editor.length) o.editor = e.editor;
    if (e.issued) o.issued = { "date-parts": [e.issued.month ? [e.issued.year, e.issued.month] : [e.issued.year]] };
    const opt: Array<[string, string]> = [
      ["container-title", e.containerTitle],
      ["volume", e.volume],
      ["issue", e.issue],
      ["page", e.page],
      ["publisher", e.publisher],
      ["publisher-place", e.publisherPlace],
      ["genre", e.genre],
      ["DOI", e.DOI],
      ["URL", e.URL],
      ["ISBN", e.ISBN],
      ["language", e.language],
      ["note", e.note],
    ];
    for (const [k, v] of opt) if (v) o[k] = v;
    return o;
  });
}

export function parseCslJson(text: string): BibliographyParseResult {
  const warnings: string[] = [];
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    return { entries: [], warnings: ["CSL-JSON 구문 오류"] };
  }
  const list = Array.isArray(data) ? data : [data];
  const entries: BibliographyDraft[] = [];
  const types = new Set<string>(Object.keys(TYPE_TO_RIS));
  for (const item of list as Array<Record<string, unknown>>) {
    const title = typeof item.title === "string" ? item.title : "";
    if (!title) {
      warnings.push(`항목 ${String(item.id ?? "?")}: 제목 없음 — 건너뜀`);
      continue;
    }
    const rawType = String(item.type ?? "");
    if (!types.has(rawType)) warnings.push(`항목 ${String(item.id ?? "?")}: 유형 ${rawType} — manuscript로 가져옴`);
    const d = emptyDraft((types.has(rawType) ? rawType : "manuscript") as BibliographyType, title);
    d.citationKey = String(item.id ?? "");
    const names = (v: unknown): CslName[] =>
      Array.isArray(v)
        ? v.map((n: Record<string, unknown>) => {
            const out: CslName = {};
            if (typeof n.family === "string") out.family = n.family;
            if (typeof n.given === "string") out.given = n.given;
            if (typeof n.literal === "string") out.literal = n.literal;
            return out;
          })
        : [];
    d.author = names(item.author);
    d.editor = names(item.editor);
    const dp = (item.issued as { "date-parts"?: number[][] } | undefined)?.["date-parts"]?.[0];
    if (dp?.[0]) d.issued = dp[1] ? { year: Number(dp[0]), month: Number(dp[1]) } : { year: Number(dp[0]) };
    const str = (k: string) => (typeof item[k] === "string" ? (item[k] as string) : "");
    d.containerTitle = str("container-title");
    d.volume = str("volume") || (typeof item.volume === "number" ? String(item.volume) : "");
    d.issue = str("issue") || (typeof item.issue === "number" ? String(item.issue) : "");
    d.page = str("page");
    d.publisher = str("publisher");
    d.publisherPlace = str("publisher-place");
    d.genre = str("genre");
    d.DOI = str("DOI");
    d.URL = str("URL");
    d.ISBN = str("ISBN");
    d.language = str("language") || guessLanguage(title);
    d.note = str("note");
    entries.push(d);
  }
  return { entries, warnings };
}

export type BibliographyFormat = "bibtex" | "ris" | "csl-json";

export function detectBibliographyFormat(text: string): BibliographyFormat | null {
  const t = text.trimStart();
  if (t.startsWith("[") || t.startsWith("{")) return "csl-json";
  if (/^TY  - /m.test(t)) return "ris";
  if (/@\s*[A-Za-z]+\s*[{(]/.test(t)) return "bibtex";
  return null;
}

export function parseBibliography(text: string, format?: BibliographyFormat): BibliographyParseResult & { format: BibliographyFormat | null } {
  const f = format ?? detectBibliographyFormat(text);
  if (f === "bibtex") return { ...parseBibtex(text), format: f };
  if (f === "ris") return { ...parseRis(text), format: f };
  if (f === "csl-json") return { ...parseCslJson(text), format: f };
  return { entries: [], warnings: ["형식을 알 수 없음 (BibTeX·RIS·CSL-JSON 지원)"], format: null };
}

// ── 형식화 ──

function isEastAsian(e: Pick<BibliographyEntry, "language" | "title">): boolean {
  return ["ko", "zh", "ja"].includes(e.language) || CJK_RE.test(e.title);
}

function joinNames(names: CslName[], eastAsian: boolean): string {
  if (names.length === 0) return "";
  if (eastAsian) {
    const list = names.map((n) => nameToString(n));
    return list.length > 3 ? `${list[0]} 외` : list.join("·");
  }
  const list = names.map((n, i) => nameToString(n, i === 0 ? "family-first" : "given-first"));
  if (list.length === 1) return list[0]!;
  if (list.length > 3) return `${list[0]} et al.`;
  return `${list.slice(0, -1).join(", ")}, and ${list[list.length - 1]}`;
}

/** 각주·참고문헌 형식 문자열. locator(쪽 등)가 있으면 끝에 붙인다. */
export function formatCitation(e: BibliographyDraft | BibliographyEntry, locator = ""): string {
  const ea = isEastAsian(e);
  const year = e.issued ? String(e.issued.year) : ea ? "연도 미상" : "n.d.";
  const loc = locator || e.page;
  if (ea) {
    const who = joinNames(e.author.length ? e.author : e.editor, true) + (e.author.length === 0 && e.editor.length ? " 편" : "");
    const volIssue = [e.volume, e.issue].filter(Boolean).join("-");
    const parts: string[] = [];
    if (who) parts.push(who);
    switch (e.type) {
      case "article-journal":
      case "paper-conference":
        parts.push(`「${e.title}」`);
        if (e.containerTitle) parts.push(`『${e.containerTitle}』${volIssue ? ` ${volIssue}` : ""}`);
        if (e.publisher) parts.push(e.publisher);
        parts.push(year);
        break;
      case "chapter":
        parts.push(`「${e.title}」`);
        if (e.containerTitle) parts.push(`『${e.containerTitle}』`);
        if (e.publisher) parts.push(e.publisher);
        parts.push(year);
        break;
      case "thesis":
        parts.push(`「${e.title}」`);
        parts.push(`${e.publisher}${e.genre ? ` ${e.genre}` : " 학위논문"}`);
        parts.push(year);
        break;
      default:
        parts.push(`『${e.title}』`);
        if (e.publisherPlace && e.publisher) parts.push(`${e.publisherPlace}: ${e.publisher}`);
        else if (e.publisher) parts.push(e.publisher);
        parts.push(year);
    }
    if (loc) parts.push(/^[pP]\.|쪽$/.test(loc) ? loc : `${loc}쪽`);
    return `${parts.join(", ")}.`;
  }
  const who = joinNames(e.author.length ? e.author : e.editor, false);
  const pages = loc ? `: ${loc}` : "";
  switch (e.type) {
    case "article-journal":
    case "paper-conference":
      return `${who ? `${who}. ` : ""}"${e.title}." ${e.containerTitle ? `${e.containerTitle} ` : ""}${e.volume}${e.issue ? `, no. ${e.issue}` : ""} (${year})${pages}.${e.DOI ? ` https://doi.org/${e.DOI}.` : ""}`.replace(/\s+/g, " ");
    case "chapter":
      return `${who ? `${who}. ` : ""}"${e.title}." In ${e.containerTitle}${e.editor.length ? `, edited by ${joinNames(e.editor, false)}` : ""}${pages ? `, ${loc}` : ""}. ${e.publisherPlace ? `${e.publisherPlace}: ` : ""}${e.publisher}${e.publisher ? ", " : ""}${year}.`;
    case "thesis":
      return `${who ? `${who}. ` : ""}"${e.title}." ${e.genre || "PhD diss."}, ${e.publisher}, ${year}.`;
    default:
      return `${who ? `${who}. ` : ""}${e.title}. ${e.publisherPlace ? `${e.publisherPlace}: ` : ""}${e.publisher}${e.publisher ? ", " : ""}${year}${pages ? `, ${loc}` : ""}.`;
  }
}

/** 참고문헌 목록 — 동아시아 문헌(가나다순) 먼저, 서양어 문헌(알파벳순) 다음 */
export function formatBibliographyList(entries: Array<BibliographyDraft | BibliographyEntry>): string[] {
  const sortKey = (e: BibliographyDraft) => {
    const n = e.author[0] ?? e.editor[0];
    return `${n ? nameToString(n) : e.title} ${e.issued?.year ?? ""}`;
  };
  const ea = entries.filter((e) => isEastAsian(e)).sort((a, b) => sortKey(a).localeCompare(sortKey(b), "ko"));
  const west = entries.filter((e) => !isEastAsian(e)).sort((a, b) => sortKey(a).localeCompare(sortKey(b), "en"));
  return [...ea, ...west].map((e) => formatCitation(e));
}

/** 중복 판정 키 — DOI가 있으면 DOI, 없으면 정규화한 제목+연도 */
export function bibliographyDedupeKey(e: Pick<BibliographyEntry, "DOI" | "title" | "issued">): string {
  if (e.DOI) return `doi:${e.DOI.toLowerCase().replace(/^https?:\/\/(dx\.)?doi\.org\//, "")}`;
  return `t:${e.title.normalize("NFKC").toLowerCase().replace(/[\s\p{P}]/gu, "")}|${e.issued?.year ?? ""}`;
}
