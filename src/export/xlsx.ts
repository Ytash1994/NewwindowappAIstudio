import { SIG_NAME, SIG_PHONE } from "../engine/calc";
import type { AreaTotalItem, ExportStructUnit } from "../types";

export interface XlsxSettingsField {
  label: string;
  rel: string;
  inc: string;
  dec: string;
  on: boolean;
}

export interface XlsxSettingsConfig {
  info: [string, string][];
  fields: XlsxSettingsField[];
  json: string;
}

export interface XlsxExportInfo {
  title: string;
  sub: string;
  struct: ExportStructUnit[];
  table: string[][];
  dup?: [string, string, string, string][];
  dupOther?: number;
  areaTotals?: AreaTotalItem[];
  areaUnitLabel?: string;
  settings?: XlsxSettingsConfig;
}

function hslHex(h: number, s: number, l: number): string {
  s /= 100;
  l /= 100;
  const a = s * Math.min(l, 1 - l);
  const f = (n: number) => {
    const k = (n + h / 30) % 12;
    const c = l - a * Math.max(-1, Math.min(k - 3, 9 - k, 1));
    return Math.round(255 * c)
      .toString(16)
      .padStart(2, "0");
  };
  return ("FF" + f(0) + f(8) + f(4)).toUpperCase();
}

function colName(i: number): string {
  let s = "";
  i++;
  while (i > 0) {
    const m = (i - 1) % 26;
    s = String.fromCharCode(65 + m) + s;
    i = Math.floor((i - 1) / 26);
  }
  return s;
}

const xesc = (s: unknown) =>
  String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");

function makeZip(files: { name: string; data: Uint8Array }[]): Blob {
  const enc = new TextEncoder();
  const chunks: Uint8Array[] = [];
  const cd: Uint8Array[] = [];
  let off = 0;

  const T: number[] = [];
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    T.push(c >>> 0);
  }
  const crc = (d: Uint8Array) => {
    let c = 0xffffffff;
    for (let i = 0; i < d.length; i++) c = T[(c ^ d[i]) & 255] ^ (c >>> 8);
    return (c ^ 0xffffffff) >>> 0;
  };

  files.forEach((f) => {
    const nm = enc.encode(f.name);
    const c = crc(f.data);
    const sz = f.data.length;
    const lh = new DataView(new ArrayBuffer(30));
    lh.setUint32(0, 0x04034b50, true);
    lh.setUint16(4, 20, true);
    lh.setUint16(6, 0x0800, true);
    lh.setUint16(12, 0x21, true);
    lh.setUint32(14, c, true);
    lh.setUint32(18, sz, true);
    lh.setUint32(22, sz, true);
    lh.setUint16(26, nm.length, true);
    chunks.push(new Uint8Array(lh.buffer), nm, f.data);

    const ch = new DataView(new ArrayBuffer(46));
    ch.setUint32(0, 0x02014b50, true);
    ch.setUint16(4, 20, true);
    ch.setUint16(6, 20, true);
    ch.setUint16(8, 0x0800, true);
    ch.setUint16(14, 0x21, true);
    ch.setUint32(16, c, true);
    ch.setUint32(20, sz, true);
    ch.setUint32(24, sz, true);
    ch.setUint16(28, nm.length, true);
    ch.setUint32(42, off, true);
    cd.push(new Uint8Array(ch.buffer), nm);
    off += 30 + nm.length + sz;
  });

  const cdSize = cd.reduce((a, x) => a + x.length, 0);
  const e = new DataView(new ArrayBuffer(22));
  e.setUint32(0, 0x06054b50, true);
  e.setUint16(8, files.length, true);
  e.setUint16(10, files.length, true);
  e.setUint32(12, cdSize, true);
  e.setUint32(16, off, true);

  const blobParts: BlobPart[] = [
    ...chunks.map((u) => new Uint8Array(u)),
    ...cd.map((u) => new Uint8Array(u)),
    new Uint8Array(e.buffer),
  ];
  return new Blob(blobParts, {
    type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  });
}

export const SET_MARK = "WINCALC-SETTINGS-V1";

type StyleBuilder = (o: {
  b?: number;
  sz?: number;
  fc?: string;
  f?: string;
  bw?: string;
  bc?: string;
  h?: string;
}) => number;

function settingsSheet(cfg: XlsxSettingsConfig, st: StyleBuilder): string {
  const t1 = st({ b: 1, sz: 15, fc: "FFFFFFFF", f: "FF1F2937", bw: "thin", bc: "FF1F2937" });
  const t2 = st({ sz: 10, fc: "FF374151", f: "FFF3F4F6", bw: "thin", bc: "FFD1D5DB" });
  const kS = st({ b: 1, f: "FFE5E7EB", bc: "FFB8C0C8" });
  const vS = st({ f: "FFFFFFFF", bc: "FFB8C0C8" });
  const hS = st({ b: 1, fc: "FFFFFFFF", f: "FF4B5563", bc: "FF374151" });
  const gS = st({ sz: 9, fc: "FF6B7280", f: "FFF9FAFB", bc: "FFE5E7EB" });

  const R: string[] = [];
  const merges: string[] = [];
  const NC = 5;

  const cl = (r: number, c: number, v: string | number | null | undefined, s: number) => {
    const ref = `${colName(c)}${r}`;
    if (v === "" || v === null || v === undefined) return `<c r="${ref}" s="${s}"/>`;
    if (typeof v === "number") return `<c r="${ref}" s="${s}"><v>${v}</v></c>`;
    return `<c r="${ref}" s="${s}" t="inlineStr"><is><t xml:space="preserve">${xesc(v)}</t></is></c>`;
  };

  const row = (cells: (string | number)[], s: number | number[], ht = 22) => {
    const r = R.length + 1;
    R.push(
      `<row r="${r}" ht="${ht}" customHeight="1">${cells
        .map((v, i) => cl(r, i, v, Array.isArray(s) ? s[i] : s))
        .join("")}</row>`
    );
    return r;
  };

  const mg = (r: number) => merges.push(`A${r}:${colName(NC - 1)}${r}`);

  mg(row(["إعدادات المشروع (ورقة للاستيراد: النوع والوحدة والعلاقات)", "", "", "", ""], t1, 30));
  mg(
    row(
      [
        "هذه الورقة منفصلة عن ورقة «النتائج». عند الاستيراد في التطبيق تختار هل تأخذ القياسات (من ورقة النتائج) أو الإعدادات (من هذه الورقة) أو الاثنين معاً.",
        "",
        "",
        "",
        "",
      ],
      t2,
      34
    )
  );
  row(["", "", "", "", ""], 0, 10);
  cfg.info.forEach(([k, v]) => row([k, v, "", "", ""], [kS, vS, vS, vS, vS]));
  row(["", "", "", "", ""], 0, 10);
  row(["الخانة", "العلاقة (كيف تُحسب)", "زيادة", "نقصان", "الحالة"], hS, 26);
  cfg.fields.forEach((f) => row([f.label, f.rel, f.inc, f.dec, f.on ? "ظاهرة" : "مخفية"], vS));
  row(["", "", "", "", ""], 0, 10);
  mg(row(["بيانات الاستيراد التقنية — لا تعدّلها ولا تحذفها (تحفظ العلاقات والتخصيص كاملة)", "", "", "", ""], t2, 24));
  row([SET_MARK, "", "", "", ""], gS, 18);
  const js = cfg.json;
  for (let i = 0; i < js.length; i += 20000) {
    row([js.slice(i, i + 20000), "", "", "", ""], gS, 18);
  }

  const cols = [28, 52, 12, 12, 12]
    .map((w, i) => `<col min="${i + 1}" max="${i + 1}" width="${w}" customWidth="1"/>`)
    .join("");
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><dimension ref="A1:E${R.length}"/><sheetViews><sheetView rightToLeft="1" workbookViewId="0"/></sheetViews><sheetFormatPr defaultRowHeight="18"/><cols>${cols}</cols><sheetData>${R.join("")}</sheetData><mergeCells count="${merges.length}">${merges.map((m) => `<mergeCell ref="${m}"/>`).join("")}</mergeCells><pageMargins left="0.4" right="0.4" top="0.5" bottom="0.5" header="0.3" footer="0.3"/></worksheet>`;
}

export function buildXlsx(info: XlsxExportInfo): Blob {
  const fonts = [
    '<font><sz val="11"/><color rgb="FF1D2733"/><name val="Tahoma"/><family val="2"/></font>',
  ];
  const fontIx: Record<string, number> = {};
  const fills = [
    '<fill><patternFill patternType="none"/></fill>',
    '<fill><patternFill patternType="gray125"/></fill>',
  ];
  const fillIx: Record<string, number> = {};
  const borders = ['<border><left/><right/><top/><bottom/><diagonal/></border>'];
  const borderIx: Record<string, number> = {};
  const xfs = ['<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>'];
  const xfIx: Record<string, number> = {};

  const font = (b: number | undefined, sz: number, col: string) => {
    const k = `${b ? 1 : 0}|${sz}|${col}`;
    if (!(k in fontIx)) {
      fontIx[k] = fonts.length;
      fonts.push(
        `<font>${b ? "<b/>" : ""}<sz val="${sz}"/><color rgb="${col}"/><name val="Tahoma"/><family val="2"/></font>`
      );
    }
    return fontIx[k];
  };

  const fill = (c: string | undefined) => {
    if (!c) return 0;
    if (!(c in fillIx)) {
      fillIx[c] = fills.length;
      fills.push(
        `<fill><patternFill patternType="solid"><fgColor rgb="${c}"/><bgColor indexed="64"/></patternFill></fill>`
      );
    }
    return fillIx[c];
  };

  const border = (w: string, c: string) => {
    const k = w + c;
    if (!(k in borderIx)) {
      borderIx[k] = borders.length;
      const e = (n: string) => `<${n} style="${w}"><color rgb="${c}"/></${n}>`;
      borders.push(
        `<border>${e("left")}${e("right")}${e("top")}${e("bottom")}<diagonal/></border>`
      );
    }
    return borderIx[k];
  };

  const st = (o: {
    b?: number;
    sz?: number;
    fc?: string;
    f?: string;
    bw?: string;
    bc?: string;
    h?: string;
  }) => {
    const k = JSON.stringify(o);
    if (!(k in xfIx)) {
      xfIx[k] = xfs.length;
      xfs.push(
        `<xf numFmtId="0" fontId="${font(o.b, o.sz || 11, o.fc || "FF1D2733")}" fillId="${fill(o.f)}" borderId="${border(o.bw || "thin", o.bc || "FFB8C0C8")}" xfId="0" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment horizontal="${o.h || "center"}" vertical="center" wrapText="1"/></xf>`
      );
    }
    return xfIx[k];
  };

  const S = info.struct;
  const ncols = 3 + S.reduce((a, u) => a + u.subs.length, 0);
  const HR = 4;
  const merges: string[] = [];
  const R: Record<number, string[]> = {};

  const cell = (r: number, c: number, v: string | number, s: number) => {
    const ref = colName(c) + r;
    if (v === "" || v === null || v === undefined) return `<c r="${ref}" s="${s}"/>`;
    if (typeof v === "number") return `<c r="${ref}" s="${s}"><v>${v}</v></c>`;
    return `<c r="${ref}" s="${s}" t="inlineStr"><is><t xml:space="preserve">${xesc(v)}</t></is></c>`;
  };
  const put = (r: number, c: number, v: string | number, s: number) => {
    (R[r] = R[r] || [])[c] = cell(r, c, v, s);
  };

  const GRAY = "FF6B7280";
  const t1 = st({ b: 1, sz: 15, fc: "FFFFFFFF", f: "FF1F2937", bw: "thin", bc: "FF1F2937" });
  const t2 = st({ sz: 10, fc: "FF374151", f: "FFF3F4F6", bw: "thin", bc: "FFD1D5DB" });
  for (let c = 0; c < ncols; c++) {
    put(1, c, c === 0 ? info.title : "", t1);
    put(2, c, c === 0 ? info.sub : "", t2);
  }
  merges.push(`A1:${colName(ncols - 1)}1`, `A2:${colName(ncols - 1)}2`);

  const fx = st({ b: 1, f: "FFE5E7EB", bw: "medium", bc: GRAY });
  ["رقم", "طول الشباك", "عرض الشباك"].forEach((t, c) => {
    put(3, c, t, fx);
    put(4, c, "", fx);
    merges.push(`${colName(c)}3:${colName(c)}4`);
  });

  let c = 3;
  const colMeta: { hue: number; single: boolean }[] = [];
  S.forEach((u) => {
    const hb = hslHex(u.hue, 70, 82);
    const bc = hslHex(u.hue, 50, 38);
    const n = u.subs.length;
    const hs = st({ b: 1, f: hb, bw: "medium", bc });
    if (u.group) {
      for (let i = 0; i < n; i++) {
        put(3, c + i, i === 0 ? u.name : "", hs);
        put(4, c + i, u.subs[i], hs);
      }
      if (n > 1) merges.push(`${colName(c)}3:${colName(c + n - 1)}3`);
    } else {
      put(3, c, u.label, hs);
      put(4, c, "", hs);
      merges.push(`${colName(c)}3:${colName(c)}4`);
    }
    for (let i = 0; i < n; i++) colMeta.push({ hue: u.hue, single: !u.group });
    c += n;
  });

  info.table.forEach((row, ri) => {
    const r = HR + 1 + ri;
    const even = ri % 2 === 1;
    row.forEach((v, ci) => {
      const nVal = v !== "" && !isNaN(Number(v)) ? Number(v) : v;
      if (ci < 3) {
        put(r, ci, nVal, st({ b: 1, f: even ? "FFF3F4F6" : "FFFFFFFF", bc: "FFB8C0C8" }));
      } else {
        const m = colMeta[ci - 3];
        put(
          r,
          ci,
          nVal,
          st({
            f: hslHex(m.hue, even ? 75 : 85, even ? 90 : 95),
            bc: hslHex(m.hue, 35, 68),
          })
        );
      }
    });
  });

  let nextRow = HR + info.table.length + 2;

  const areaN = info.areaTotals?.length || 0;
  if (areaN > 0 && info.areaTotals) {
    const at = st({ b: 1, sz: 12, fc: "FF0F5132", f: "FFD1E7DD", bw: "medium", bc: "FF198754" });
    const ah = st({ b: 1, f: "FFE5E7EB", bw: "medium", bc: GRAY });
    const ac = st({ b: 1, f: "FFFFFFFF", bc: "FFB8C0C8" });
    for (let col = 0; col < ncols; col++) {
      put(nextRow, col, col === 0 ? "ملخص إجمالي المساحات (لطلب المواد)" : "", at);
    }
    merges.push(`A${nextRow}:${colName(ncols - 1)}${nextRow}`);
    nextRow++;
    put(nextRow, 0, "البند", ah);
    put(nextRow, 1, `المساحة (${info.areaUnitLabel || ""})`, ah);
    if (ncols > 2) put(nextRow, 2, "المساحة (م²)", ah);
    nextRow++;
    info.areaTotals.forEach((item) => {
      put(nextRow, 0, item.label, ac);
      put(nextRow, 1, Number(item.totalInUnit.toFixed(3)), ac);
      if (ncols > 2) put(nextRow, 2, Number(item.totalSqM.toFixed(3)), ac);
      nextRow++;
    });
    nextRow++;
  }

  const dupN = (info.dup && info.dup.length) || 0;
  const DS = nextRow;
  if (dupN && info.dup) {
    const dt = st({ b: 1, sz: 13, fc: "FF7A5200", f: "FFFFF1C7", bw: "medium", bc: "FFB8860B" });
    const dh = st({ b: 1, f: "FFE5E7EB", bw: "medium", bc: GRAY });
    const ds = st({ b: 1, f: "FFFFFFFF", bc: "FFB8C0C8" });
    const dl = st({ f: "FFFFFFFF", bc: "FFB8C0C8" });
    const dn = st({ sz: 10, fc: "FF374151", f: "FFF3F4F6", bc: "FFD1D5DB" });

    for (let col = 0; col < ncols; col++) {
      put(DS, col, col === 0 ? "ملخص الشبابيك المتشابهة (قياسات مكررة وعددها)" : "", dt);
    }
    merges.push(`A${DS}:${colName(ncols - 1)}${DS}`);
    ["رقم", "طول الشباك", "عرض الشباك", "العدد"].forEach((t, col) => {
      if (col < ncols) put(DS + 1, col, t, dh);
    });
    if (ncols > 4) {
      put(DS + 1, 4, "أرقام الشبابيك", dh);
      for (let col = 5; col < ncols; col++) put(DS + 1, col, "", dh);
      if (ncols > 5) merges.push(`E${DS + 1}:${colName(ncols - 1)}${DS + 1}`);
    }
    info.dup.forEach((g, i) => {
      const r = DS + 2 + i;
      put(r, 0, i + 1, ds);
      put(r, 1, Number(g[0]), ds);
      put(r, 2, Number(g[1]), ds);
      if (ncols > 3) put(r, 3, Number(g[2]), ds);
      if (ncols > 4) {
        put(r, 4, g[3], dl);
        for (let col = 5; col < ncols; col++) put(r, col, "", dl);
        if (ncols > 5) merges.push(`E${r}:${colName(ncols - 1)}${r}`);
      }
    });
    if (info.dupOther && info.dupOther > 0) {
      const r = DS + 2 + dupN;
      for (let col = 0; col < ncols; col++) {
        put(
          r,
          col,
          col === 0 ? `وباقي الشبابيك (${info.dupOther}) قياساتها مختلفة وغير مكررة` : "",
          dn
        );
      }
      merges.push(`A${r}:${colName(ncols - 1)}${r}`);
      nextRow = r + 2;
    } else {
      nextRow = DS + 2 + dupN + 1;
    }
  }

  const FR = nextRow;
  {
    const fs1 = st({
      b: 1,
      sz: 12,
      fc: "FF7A5200",
      f: "FFFFF7E0",
      bw: "medium",
      bc: "FFB8860B",
      h: "right",
    });
    const fs2 = st({
      b: 1,
      sz: 12,
      fc: "FF7A5200",
      f: "FFFFF7E0",
      bw: "medium",
      bc: "FFB8860B",
      h: "left",
    });
    const a = Math.max(0, Math.ceil(ncols / 2) - 1);
    for (let col = 0; col < ncols; col++) {
      if (col === 0) put(FR, col, SIG_NAME, fs1);
      else if (col === a + 1) put(FR, col, `\u2066${SIG_PHONE}\u2069`, fs2);
      else put(FR, col, "", col <= a ? fs1 : fs2);
    }
    if (a >= 1) merges.push(`A${FR}:${colName(a)}${FR}`);
    if (ncols - 1 > a + 1) merges.push(`${colName(a + 1)}${FR}:${colName(ncols - 1)}${FR}`);
  }

  let sd = "";
  for (let r = 1; r <= FR; r++) {
    const ht = r === 1 ? 28 : r === 2 ? 20 : r <= 4 ? 26 : r === FR ? 26 : dupN && r >= DS && r < FR ? 24 : 20;
    sd += `<row r="${r}" ht="${ht}" customHeight="1">${(R[r] || []).join("")}</row>`;
  }

  const cols: string[] = [];
  for (let i = 0; i < ncols; i++) {
    const w = i === 0 ? 8 : i < 3 ? 12 : colMeta[i - 3].single ? 17 : 11;
    cols.push(`<col min="${i + 1}" max="${i + 1}" width="${w}" customWidth="1"/>`);
  }

  const s2 = info.settings ? settingsSheet(info.settings, st) : null;

  const sheet = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetPr><pageSetUpPr fitToPage="1"/></sheetPr><dimension ref="A1:${colName(ncols - 1)}${FR}"/><sheetViews><sheetView rightToLeft="1" workbookViewId="0"><pane xSplit="3" ySplit="${HR}" topLeftCell="D${HR + 1}" activePane="bottomRight" state="frozen"/></sheetView></sheetViews><sheetFormatPr defaultRowHeight="18"/><cols>${cols.join("")}</cols><sheetData>${sd}</sheetData><mergeCells count="${merges.length}">${merges.map((m) => `<mergeCell ref="${m}"/>`).join("")}</mergeCells><pageMargins left="0.4" right="0.4" top="0.5" bottom="0.5" header="0.3" footer="0.3"/><pageSetup orientation="landscape" fitToWidth="1" fitToHeight="0"/></worksheet>`;
  const styles = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><fonts count="${fonts.length}">${fonts.join("")}</fonts><fills count="${fills.length}">${fills.join("")}</fills><borders count="${borders.length}">${borders.join("")}</borders><cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs><cellXfs count="${xfs.length}">${xfs.join("")}</cellXfs><cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles></styleSheet>`;

  const E = new TextEncoder();
  const X = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>';
  const files = [
    {
      name: "[Content_Types].xml",
      data: E.encode(
        `${X}<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>${s2 ? '<Override PartName="/xl/worksheets/sheet2.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>' : ""}<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/></Types>`
      ),
    },
    {
      name: "_rels/.rels",
      data: E.encode(
        `${X}<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>`
      ),
    },
    {
      name: "xl/workbook.xml",
      data: E.encode(
        `${X}<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="النتائج" sheetId="1" r:id="rId1"/>${s2 ? '<sheet name="الإعدادات" sheetId="2" r:id="rId2"/>' : ""}</sheets></workbook>`
      ),
    },
    {
      name: "xl/_rels/workbook.xml.rels",
      data: E.encode(
        `${X}<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/>${s2 ? '<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet2.xml"/>' : ""}<Relationship Id="${s2 ? "rId3" : "rId2"}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>`
      ),
    },
    { name: "xl/styles.xml", data: E.encode(styles) },
    { name: "xl/worksheets/sheet1.xml", data: E.encode(sheet) },
  ];
  if (s2) {
    files.push({ name: "xl/worksheets/sheet2.xml", data: E.encode(s2) });
  }
  return makeZip(files);
}
