import { clean, num } from "../engine/calc";
import type { UnitCode } from "../types";
import { SET_MARK } from "./xlsx";

export interface ImportedWindowRow {
  n: string;
  l: number | null;
  w: number | null;
  q: string;
}

export interface ParsedSheet {
  name: string;
  rows: (string | number)[][];
}

export interface ParsedWorkbook {
  rows: ImportedWindowRow[] | null;
  unit: UnitCode | null;
  settings: Record<string, unknown> | null;
  projectName: string;
  sheetName: string;
  hasNames: boolean;
}

// ---------- Pure-TypeScript RFC 1951 (DEFLATE-RAW) Fallback ----------
const FIXED_LIT_LEN = (() => {
  const l = new Uint8Array(288);
  for (let i = 0; i <= 143; i++) l[i] = 8;
  for (let i = 144; i <= 255; i++) l[i] = 9;
  for (let i = 256; i <= 279; i++) l[i] = 7;
  for (let i = 280; i <= 287; i++) l[i] = 8;
  return l;
})();

const FIXED_DIST_LEN = new Uint8Array(32).fill(5);
const CL_ORDER = [16, 17, 18, 0, 8, 7, 9, 6, 10, 5, 11, 4, 12, 3, 13, 2, 14, 1, 15];
const LEN_BASE = [
  3, 4, 5, 6, 7, 8, 9, 10, 11, 13, 15, 17, 19, 23, 27, 31, 35, 43, 51, 59, 67, 83, 99, 115, 131,
  163, 195, 227, 258,
];
const LEN_EXTRA = [0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 2, 2, 2, 2, 3, 3, 3, 3, 4, 4, 4, 4, 5, 5, 5, 5, 0];
const DIST_BASE = [
  1, 2, 3, 4, 5, 7, 9, 13, 17, 25, 33, 49, 65, 97, 129, 193, 257, 385, 513, 769, 1025, 1537, 2049,
  3073, 4097, 6145, 8193, 12289, 16385, 24577,
];
const DIST_EXTRA = [0, 0, 0, 0, 1, 1, 2, 2, 3, 3, 4, 4, 5, 5, 6, 6, 7, 7, 8, 8, 9, 9, 10, 10, 11, 11, 12, 12, 13, 13];

interface HuffTree {
  counts: Int32Array;
  symbols: Int32Array;
}

function buildHuffTree(lengths: Uint8Array): HuffTree {
  const maxBits = 15;
  const counts = new Int32Array(maxBits + 1);
  for (let i = 0; i < lengths.length; i++) {
    if (lengths[i] > 0) counts[lengths[i]]++;
  }
  const offsets = new Int32Array(maxBits + 1);
  let total = 0;
  for (let bits = 1; bits <= maxBits; bits++) {
    offsets[bits] = total;
    total += counts[bits];
  }
  const symbols = new Int32Array(total);
  for (let sym = 0; sym < lengths.length; sym++) {
    const len = lengths[sym];
    if (len > 0) {
      symbols[offsets[len]++] = sym;
    }
  }
  return { counts, symbols };
}

export function inflateRawFallback(src: Uint8Array, expectedSize = 0): Uint8Array {
  let bytePos = 0;
  let bitBuf = 0;
  let bitCount = 0;

  const needBits = (n: number) => {
    while (bitCount < n) {
      if (bytePos >= src.length) throw new Error("zip");
      bitBuf |= src[bytePos++] << bitCount;
      bitCount += 8;
    }
  };

  const readBits = (n: number): number => {
    if (n === 0) return 0;
    needBits(n);
    const val = bitBuf & ((1 << n) - 1);
    bitBuf >>>= n;
    bitCount -= n;
    return val;
  };

  const decodeSym = (tree: HuffTree): number => {
    let code = 0;
    let first = 0;
    let index = 0;
    for (let len = 1; len <= 15; len++) {
      needBits(1);
      code |= bitBuf & 1;
      bitBuf >>>= 1;
      bitCount--;
      const count = tree.counts[len];
      if (code - count < first) {
        return tree.symbols[index + (code - first)];
      }
      index += count;
      first += count;
      first <<= 1;
      code <<= 1;
    }
    throw new Error("zip");
  };

  const fixedLitTree = buildHuffTree(FIXED_LIT_LEN);
  const fixedDistTree = buildHuffTree(FIXED_DIST_LEN);

  let out = new Uint8Array(Math.max(expectedSize > 0 ? expectedSize : src.length * 3, 4096));
  let outLen = 0;
  const ensureCap = (extra: number) => {
    if (outLen + extra <= out.length) return;
    if (outLen + extra > 42e6) throw new Error("big");
    let newLen = out.length * 2;
    while (newLen < outLen + extra) newLen *= 2;
    const next = new Uint8Array(newLen);
    next.set(out.subarray(0, outLen));
    out = next;
  };

  let bfinal = 0;
  while (!bfinal) {
    bfinal = readBits(1);
    const btype = readBits(2);

    if (btype === 0) {
      bitBuf = 0;
      bitCount = 0;
      if (bytePos + 4 > src.length) throw new Error("zip");
      const len = src[bytePos] | (src[bytePos + 1] << 8);
      const nlen = src[bytePos + 2] | (src[bytePos + 3] << 8);
      bytePos += 4;
      if ((len ^ 0xffff) !== nlen || bytePos + len > src.length) throw new Error("zip");
      ensureCap(len);
      out.set(src.subarray(bytePos, bytePos + len), outLen);
      bytePos += len;
      outLen += len;
    } else if (btype === 1 || btype === 2) {
      let litTree = fixedLitTree;
      let distTree = fixedDistTree;

      if (btype === 2) {
        const hlit = readBits(5) + 257;
        const hdist = readBits(5) + 1;
        const hclen = readBits(4) + 4;
        const clLens = new Uint8Array(19);
        for (let i = 0; i < hclen; i++) {
          clLens[CL_ORDER[i]] = readBits(3);
        }
        const clTree = buildHuffTree(clLens);
        const allLens = new Uint8Array(hlit + hdist);
        let idx = 0;
        while (idx < hlit + hdist) {
          const sym = decodeSym(clTree);
          if (sym < 16) {
            allLens[idx++] = sym;
          } else if (sym === 16) {
            const rep = 3 + readBits(2);
            const prev = idx > 0 ? allLens[idx - 1] : 0;
            for (let k = 0; k < rep && idx < hlit + hdist; k++) allLens[idx++] = prev;
          } else if (sym === 17) {
            const rep = 3 + readBits(3);
            for (let k = 0; k < rep && idx < hlit + hdist; k++) allLens[idx++] = 0;
          } else if (sym === 18) {
            const rep = 11 + readBits(7);
            for (let k = 0; k < rep && idx < hlit + hdist; k++) allLens[idx++] = 0;
          }
        }
        litTree = buildHuffTree(allLens.subarray(0, hlit));
        distTree = buildHuffTree(allLens.subarray(hlit));
      }

      while (true) {
        const sym = decodeSym(litTree);
        if (sym < 256) {
          ensureCap(1);
          out[outLen++] = sym;
        } else if (sym === 256) {
          break;
        } else {
          const lIdx = sym - 257;
          if (lIdx >= LEN_BASE.length) throw new Error("zip");
          const length = LEN_BASE[lIdx] + readBits(LEN_EXTRA[lIdx]);
          const dIdx = decodeSym(distTree);
          if (dIdx >= DIST_BASE.length) throw new Error("zip");
          const dist = DIST_BASE[dIdx] + readBits(DIST_EXTRA[dIdx]);
          if (dist > outLen) throw new Error("zip");
          ensureCap(length);
          for (let i = 0; i < length; i++) {
            out[outLen] = out[outLen - dist];
            outLen++;
          }
        }
      }
    } else {
      throw new Error("zip");
    }
  }

  return out.subarray(0, outLen);
}

async function decompressRaw(comp: Uint8Array, expectedSize = 0): Promise<Uint8Array> {
  if (typeof DecompressionStream !== "undefined") {
    try {
      const ds = new DecompressionStream("deflate-raw");
      const copy = new Uint8Array(comp);
      const ab = await new Response(new Blob([copy]).stream().pipeThrough(ds)).arrayBuffer();
      return new Uint8Array(ab);
    } catch {
      // Fallback to pure TS decoder if runtime rejects deflate-raw stream
    }
  }
  return inflateRawFallback(comp, expectedSize);
}

export async function readZipXmlFiles(buf: ArrayBuffer): Promise<Record<string, string>> {
  const u = new Uint8Array(buf);
  const dv = new DataView(buf);
  const td = new TextDecoder();

  let eocd = -1;
  for (let i = u.length - 22; i >= Math.max(0, u.length - 65600); i--) {
    if (dv.getUint32(i, true) === 0x06054b50) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) throw new Error("zip");

  const entryCount = dv.getUint16(eocd + 10, true);
  let p = dv.getUint32(eocd + 16, true);
  const files: Record<string, string> = {};

  for (let k = 0; k < entryCount; k++) {
    if (p + 46 > u.length || dv.getUint32(p, true) !== 0x02014b50) throw new Error("zip");
    const meth = dv.getUint16(p + 10, true);
    const compSize = dv.getUint32(p + 20, true);
    const uncompSize = dv.getUint32(p + 24, true);
    const nl = dv.getUint16(p + 28, true);
    const xl = dv.getUint16(p + 30, true);
    const cl = dv.getUint16(p + 32, true);
    const lo = dv.getUint32(p + 42, true);
    const name = td.decode(u.subarray(p + 46, p + 46 + nl));
    p += 46 + nl + xl + cl;

    if (!/^xl\/(workbook\.xml|_rels\/workbook\.xml\.rels|sharedStrings\.xml|worksheets\/[^/]+\.xml)$/i.test(name)) {
      continue;
    }
    if (lo + 30 > u.length) throw new Error("zip");
    const lnl = dv.getUint16(lo + 26, true);
    const lxl = dv.getUint16(lo + 28, true);
    const ds = lo + 30 + lnl + lxl;
    if (compSize > 12e6 || uncompSize > 40e6) throw new Error("big");
    if (ds + compSize > u.length) throw new Error("zip");

    const rawSlice = u.subarray(ds, ds + compSize);
    let outBytes: Uint8Array;
    if (meth === 8) {
      outBytes = await decompressRaw(rawSlice, uncompSize);
    } else if (meth === 0) {
      outBytes = rawSlice;
    } else {
      throw new Error("meth");
    }
    if (outBytes.length > 40e6) throw new Error("big");
    files[name] = td.decode(outBytes);
  }

  return files;
}

function colIdx(ref: string): number {
  const m = /^([A-Z]+)/i.exec(ref);
  let c = 0;
  if (m) {
    for (const ch of m[1].toUpperCase()) {
      c = c * 26 + ch.charCodeAt(0) - 64;
    }
  }
  return c - 1;
}

export async function readXlsxSheets(buf: ArrayBuffer): Promise<ParsedSheet[]> {
  const files = await readZipXmlFiles(buf);
  const findFile = (target: string) => {
    if (files[target]) return files[target];
    const lower = target.toLowerCase();
    const hit = Object.keys(files).find((k) => k.toLowerCase() === lower);
    return hit ? files[hit] : undefined;
  };

  const wbXml = findFile("xl/workbook.xml");
  if (!wbXml) throw new Error("wb");
  const parser = new DOMParser();
  const doc = (xml: string) => parser.parseFromString(xml, "application/xml");

  const rels: Record<string, string> = {};
  const relsXml = findFile("xl/_rels/workbook.xml.rels");
  if (relsXml) {
    Array.from(doc(relsXml).getElementsByTagName("Relationship")).forEach((r) => {
      const id = r.getAttribute("Id");
      const target = r.getAttribute("Target");
      if (id && target) rels[id] = target;
    });
  }

  const ss: string[] = [];
  const ssXml = findFile("xl/sharedStrings.xml");
  if (ssXml) {
    Array.from(doc(ssXml).getElementsByTagName("si")).forEach((si) => {
      ss.push(
        Array.from(si.getElementsByTagName("t"))
          .map((t) => t.textContent || "")
          .join("")
      );
    });
  }

  const sheets: ParsedSheet[] = [];
  let idx = 0;
  for (const sh of Array.from(doc(wbXml).getElementsByTagName("sheet"))) {
    idx++;
    const rid =
      sh.getAttribute("r:id") ||
      sh.getAttributeNS("http://schemas.openxmlformats.org/officeDocument/2006/relationships", "id") ||
      "";
    let tg = rels[rid] || `worksheets/sheet${idx}.xml`;
    tg = tg.replace(/^\/?(xl\/)?/i, "");
    const sheetXml = findFile(`xl/${tg}`);
    if (!sheetXml) continue;

    const rows: (string | number)[][] = [];
    Array.from(doc(sheetXml).getElementsByTagName("row")).forEach((rw) => {
      const ri = (Number(rw.getAttribute("r")) || rows.length + 1) - 1;
      if (ri < 0 || ri > 20000) return;
      const arr = (rows[ri] = rows[ri] || []);
      Array.from(rw.getElementsByTagName("c")).forEach((c) => {
        const ci = colIdx(c.getAttribute("r") || "A1");
        if (ci < 0 || ci > 200) return;
        const t = c.getAttribute("t");
        const vEl = c.getElementsByTagName("v")[0];
        let val: string | number = "";
        if (t === "s") {
          val = vEl ? ss[Number(vEl.textContent)] ?? "" : "";
        } else if (t === "inlineStr") {
          val = Array.from(c.getElementsByTagName("t"))
            .map((q) => q.textContent || "")
            .join("");
        } else if (t === "str" || t === "e" || t === "b") {
          val = vEl?.textContent || "";
        } else if (vEl && vEl.textContent !== "") {
          const nn = Number(vEl.textContent);
          val = Number.isNaN(nn) ? vEl.textContent || "" : nn;
        }
        arr[ci] = val;
      });
    });

    sheets.push({
      name: sh.getAttribute("name") || `ورقة ${idx}`,
      rows,
    });
  }

  return sheets;
}

function detectUnitFromText(text: string): UnitCode | null {
  if (/ملي|mm|مم/i.test(text)) return "mm";
  if (/سانتي|سنتمتر|cm|سم/i.test(text)) return "cm";
  if (/متر|\bm\b|(\s|^)م(\s|$)/i.test(text)) return "m";
  return null;
}

export function parseImportedWorkbook(sheets: ParsedSheet[]): ParsedWorkbook {
  const out: ParsedWorkbook = {
    rows: null,
    unit: null,
    settings: null,
    projectName: "",
    sheetName: "",
    hasNames: false,
  };

  for (const sh of sheets) {
    const R = sh.rows;
    let markIdx = -1;
    for (let i = 0; i < Math.min(R.length, 400); i++) {
      if (R[i] && R[i][0] === SET_MARK) {
        markIdx = i;
        break;
      }
    }

    if (markIdx >= 0) {
      let js = "";
      for (let i = markIdx + 1; i < R.length && R[i] && typeof R[i][0] === "string" && R[i][0] !== ""; i++) {
        js += R[i][0];
      }
      try {
        const o = JSON.parse(js) as { project?: unknown; data?: unknown };
        if (o && o.data && typeof o.data === "object" && !Array.isArray(o.data)) {
          const dataObj = o.data as Record<string, unknown>;
          out.settings = dataObj;
          const u = String(dataObj.unit || "");
          if (u === "m" || u === "cm" || u === "mm") {
            out.unit = out.unit || (u as UnitCode);
          }
          if (typeof o.project === "string" && o.project.trim()) {
            out.projectName = clean(o.project).trim().slice(0, 60);
          }
        }
      } catch {
        // ignore invalid JSON block
      }
      // Also read human-readable "المشروع" row from settings sheet if not inside JSON
      if (!out.projectName) {
        for (let i = 0; i < Math.min(markIdx, 30); i++) {
          const r = R[i];
          if (r && String(r[0] || "").trim() === "المشروع" && typeof r[1] === "string" && r[1].trim()) {
            out.projectName = clean(r[1]).trim().slice(0, 60);
            break;
          }
        }
      }
      continue;
    }

    if (out.rows) continue;

    const txt = (c: unknown) => (typeof c === "string" ? c.trim() : "");
    const isL = (c: unknown) => {
      const t = txt(c);
      return t.length > 0 && t.length <= 25 && /(^|\s)(ال)?(طول|ارتفاع)|^(length|height)/i.test(t);
    };
    const isW = (c: unknown) => {
      const t = txt(c);
      return t.length > 0 && t.length <= 25 && /(^|\s)(ال)?عرض|^width/i.test(t);
    };
    const isQ = (c: unknown) => {
      const t = txt(c);
      return t.length > 0 && t.length <= 20 && /^(ال)?(عدد|كمية)|^(qty|quantity)/i.test(t);
    };
    const isN = (c: unknown) => {
      const t = txt(c);
      return (
        t.length > 0 &&
        t.length <= 30 &&
        /^(ال)?(اسم|تسمية|ملاحظة|بيان|غرفة|موقع)$|^اسم\s+الشباك|^(name|label|room|note)$/i.test(t)
      );
    };

    let hr = -1;
    let cl = -1;
    let cw = -1;
    let cq = -1;
    let cnCol = -1;

    for (let i = 0; i < Math.min(R.length, 15); i++) {
      const r = R[i] || [];
      let a = -1;
      let b = -1;
      let q = -1;
      let n = -1;
      for (let c = 0; c < r.length; c++) {
        if (a < 0 && isL(r[c])) a = c;
        else if (b < 0 && isW(r[c]) && c !== a) b = c;
        if (q < 0 && isQ(r[c])) q = c;
        if (n < 0 && isN(r[c])) n = c;
      }
      if (a >= 0 && b >= 0) {
        hr = i;
        cl = a;
        cw = b;
        cq = q;
        cnCol = n;
        break;
      }
    }

    let start = hr + 1;
    if (hr < 0) {
      // No header row: pick first two numeric columns (skipping sequential 1..N index col)
      const cnt: Record<number, number> = {};
      for (let i = 0; i < Math.min(R.length, 60); i++) {
        (R[i] || []).forEach((v, c) => {
          if (typeof v === "number") cnt[c] = (cnt[c] || 0) + 1;
        });
      }
      const cols = Object.keys(cnt)
        .map(Number)
        .filter((c) => cnt[c] >= 1)
        .sort((a, b) => a - b);
      if (cols.length >= 3) {
        const numRows = R.filter((r) => r && typeof r[cols[0]] === "number");
        const isSeq = numRows.length > 0 && numRows.every((r, i) => r[cols[0]] === i + 1);
        if (isSeq) cols.shift();
      }
      if (cols.length < 2) continue;
      cl = cols[0];
      cw = cols[1];
      cq = -1;
      cnCol = -1;
      start = 0;
      while (start < R.length && !(R[start] && typeof R[start][cl] === "number")) start++;
    }

    const pv = (c: unknown): number | null => {
      if (c === "" || c == null) return null;
      if (typeof c === "number") return Number.isFinite(c) ? c : null;
      const n = num(c);
      return n === null || Number.isNaN(n) ? null : n;
    };

    const maxInterestingCol = Math.max(cl, cw, cq, cnCol);
    const rows: ImportedWindowRow[] = [];
    let started = false;
    let blank = 0;

    for (let i = start; i < R.length && rows.length < 300; i++) {
      const r = R[i] || [];
      const firstCellText = typeof r[0] === "string" ? r[0].trim() : "";
      if (
        /ملخص إجمالي المساحات|ملخص الشبابيك المتشابهة|وباقي الشبابيك|يوسف القرعان/.test(firstCellText)
      ) {
        break;
      }

      const l = pv(r[cl]);
      const w = pv(r[cw]);
      const rawName = cnCol >= 0 && r[cnCol] != null ? clean(String(r[cnCol])).trim().slice(0, 60) : "";
      const hasVal = r.some((v, c) => c <= maxInterestingCol && v !== "" && v != null);

      if (!hasVal) {
        if (started) break;
        if (++blank > 3) break;
        continue;
      }
      if (!started && l === null && w === null && !rawName && hr < 0) continue;
      // If we have a header row, skip an empty merge sub-header row right under header (row 4)
      if (!started && hr >= 0 && i === start && l === null && w === null && !rawName) continue;

      started = true;
      let q = "";
      if (cq >= 0) {
        const qn = pv(r[cq]);
        if (qn !== null && Number.isInteger(qn) && qn >= 1 && qn <= 9999) {
          q = String(qn);
        }
      }
      if (rawName) out.hasNames = true;
      rows.push({ n: rawName, l, w, q });
    }

    if (rows.some((x) => x.l !== null || x.w !== null)) {
      out.rows = rows;
      out.sheetName = sh.name;
      for (let i = 0; i < Math.min(R.length, 4); i++) {
        (R[i] || []).forEach((v) => {
          if (typeof v !== "string") return;
          if (/الوحدة/.test(v)) {
            const m = /الوحدة:\s*([^|]+)/.exec(v);
            if (m) {
              const det = detectUnitFromText(m[1]);
              if (det) out.unit = det;
            }
          }
          if (!out.projectName && /المشروع:/.test(v)) {
            const pm = /المشروع:\s*([^|]+)/.exec(v);
            if (pm) out.projectName = clean(pm[1]).trim().slice(0, 60);
          }
        });
      }
    }
  }

  return out;
}
