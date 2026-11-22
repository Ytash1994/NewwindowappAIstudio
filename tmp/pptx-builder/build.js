const path = require("path");
const fs = require("fs");
const PptxGenJS = require("/tmp/pptx-builder/node_modules/pptxgenjs");

const ROOT = "/app/applet";
const IMG = {
  icon: path.join(ROOT, "public/app-icon.png"),
  step1: path.join(ROOT, "public/assets/aistudio/Screenshot_20261121_111849_Chrome_c8bf4557.jpg"),
  step2: path.join(ROOT, "public/assets/aistudio/Screenshot_20261122_124537___1833fdef.jpg"),
  pend: path.join(ROOT, "public/assets/aistudio/Screenshot_20261121_111203_Chrome_03c782c6.jpg"),
  clayO: path.join(ROOT, "src/assets/images/clay_hybrid_o_tinted_pebbles_1795341033192.jpg"),
  table1: path.join(ROOT, "public/assets/aistudio/Screenshot_20261121_083208___097a3384.jpg"),
  table2: path.join(ROOT, "public/assets/aistudio/Screenshot_20261121_083305___cd0b5334.jpg"),
  anatomy: path.join(ROOT, "src/assets/images/window_anatomy_diagram_1795342950624.jpg"),
  exportHub: path.join(ROOT, "src/assets/images/export_hub_showcase_1795342951134.jpg"),
};

for (const [k, p] of Object.entries(IMG)) {
  if (!fs.existsSync(p)) throw new Error("Missing image: " + k + " -> " + p);
}

const C = {
  bg: "0B111F",
  bgSoft: "101A2E",
  card: "162238",
  card2: "1C2A45",
  border: "2B3B5E",
  text: "F8FAFC",
  sub: "CBD5E1",
  muted: "94A3B8",
  sky: "38BDF8",
  blue: "3B82F6",
  green: "34D399",
  amber: "FBBF24",
  violet: "A78BFA",
  coral: "FB7185",
  teal: "2DD4BF",
  darkPanel: "0E1729",
};

const FONT = "Tahoma";

const pptx = new PptxGenJS();
pptx.layout = "LAYOUT_WIDE"; // 13.333 x 7.5 in
pptx.rtlMode = true;
pptx.author = "حاسبة القياسات";
pptx.company = "حاسبة القياسات للشبابيك والواجهات";
pptx.subject = "الدليل الشامل لجميع ميزات تطبيق حاسبة القياسات مع أمثلة عملية";
pptx.title = "حاسبة القياسات — شرح الميزات والأمثلة التطبيقية";

function baseSlide(title, subtitle, slideNum, accent = C.sky) {
  const s = pptx.addSlide();
  s.background = { color: C.bg };

  // Subtle top accent bar
  s.addShape(pptx.ShapeType.rect, {
    x: 0,
    y: 0,
    w: 13.333,
    h: 0.08,
    fill: { color: accent },
    line: { color: accent, width: 0 },
  });

  // Slide badge top-left
  s.addShape(pptx.ShapeType.roundRect, {
    x: 0.45,
    y: 0.28,
    w: 1.55,
    h: 0.42,
    rectRadius: 0.14,
    fill: { color: C.card2 },
    line: { color: accent, width: 1 },
  });
  s.addText(`شريحة ${slideNum} / 13`, {
    x: 0.45,
    y: 0.28,
    w: 1.55,
    h: 0.42,
    fontFace: FONT,
    fontSize: 10.5,
    bold: true,
    color: accent,
    align: "center",
    valign: "middle",
  });

  // Title & subtitle (top-right RTL)
  s.addText(title, {
    x: 2.15,
    y: 0.22,
    w: 10.68,
    h: 0.48,
    fontFace: FONT,
    fontSize: 22,
    bold: true,
    color: C.text,
    align: "right",
    rtlMode: true,
  });

  if (subtitle) {
    s.addText(subtitle, {
      x: 2.15,
      y: 0.72,
      w: 10.68,
      h: 0.34,
      fontFace: FONT,
      fontSize: 12.5,
      color: C.muted,
      align: "right",
      rtlMode: true,
    });
  }

  // Divider line
  s.addShape(pptx.ShapeType.line, {
    x: 0.45,
    y: 1.14,
    w: 12.43,
    h: 0,
    line: { color: C.border, width: 1 },
  });

  // Clean bottom footer
  s.addText("حاسبة القياسات — دليل الميزات والتطبيق العملي", {
    x: 0.45,
    y: 7.12,
    w: 12.43,
    h: 0.28,
    fontFace: FONT,
    fontSize: 9.5,
    color: C.muted,
    align: "right",
    rtlMode: true,
  });

  return s;
}

function clayCard(s, x, y, w, h, title, bodyLines, accent = C.sky, opts = {}) {
  const fill = opts.fill || C.card;
  s.addShape(pptx.ShapeType.roundRect, {
    x,
    y,
    w,
    h,
    rectRadius: 0.08,
    fill: { color: fill },
    line: { color: opts.border || C.border, width: 1.1 },
  });
  // Right vertical color strip
  s.addShape(pptx.ShapeType.roundRect, {
    x: x + w - 0.11,
    y: y + 0.12,
    w: 0.07,
    h: h - 0.24,
    rectRadius: 0.03,
    fill: { color: accent },
    line: { color: accent, width: 0 },
  });
  if (title) {
    s.addText(title, {
      x: x + 0.16,
      y: y + 0.12,
      w: w - 0.4,
      h: 0.36,
      fontFace: FONT,
      fontSize: opts.titleSize || 13.5,
      bold: true,
      color: accent,
      align: "right",
      valign: "top",
      rtlMode: true,
    });
  }
  if (bodyLines && bodyLines.length) {
    const runs = [];
    bodyLines.forEach((ln, idx) => {
      if (idx > 0) runs.push({ text: "\n", options: { breakLine: false } });
      runs.push({
        text: ln,
        options: { fontFace: FONT, fontSize: opts.bodySize || 11.2, color: C.sub },
      });
    });
    s.addText(runs, {
      x: x + 0.16,
      y: y + (title ? 0.5 : 0.14),
      w: w - 0.4,
      h: h - (title ? 0.6 : 0.24),
      align: "right",
      valign: "top",
      lineSpacingMultiple: 1.24,
      rtlMode: true,
    });
  }
}

function framedImage(s, imgPath, boxX, boxY, boxW, boxH, imgW, imgH, caption, accent = C.sky) {
  s.addShape(pptx.ShapeType.roundRect, {
    x: boxX,
    y: boxY,
    w: boxW,
    h: boxH,
    rectRadius: 0.1,
    fill: { color: C.darkPanel },
    line: { color: accent, width: 1.3 },
  });
  const pad = 0.12;
  const capH = caption ? 0.34 : 0;
  const availW = boxW - pad * 2;
  const availH = boxH - pad * 2 - capH;
  const ratio = imgW / imgH;
  let drawW = availW;
  let drawH = drawW / ratio;
  if (drawH > availH) {
    drawH = availH;
    drawW = drawH * ratio;
  }
  const ix = boxX + (boxW - drawW) / 2;
  const iy = boxY + pad + (availH - drawH) / 2;
  s.addImage({ path: imgPath, x: ix, y: iy, w: drawW, h: drawH });
  if (caption) {
    s.addText(caption, {
      x: boxX + 0.12,
      y: boxY + boxH - 0.38,
      w: boxW - 0.24,
      h: 0.3,
      fontFace: FONT,
      fontSize: 10,
      bold: true,
      color: C.muted,
      align: "center",
      valign: "middle",
      rtlMode: true,
    });
  }
}

function rtlCell(text, opts = {}) {
  return {
    text: String(text),
    options: {
      fontFace: FONT,
      fontSize: opts.fontSize || 10.5,
      bold: Boolean(opts.bold),
      color: opts.color || C.text,
      fill: { color: opts.fill || C.card },
      align: opts.align || "center",
      valign: "middle",
      border: { pt: 0.75, color: C.border },
      margin: [4, 6, 4, 6],
    },
  };
}

// ============================================================
// SLIDE 1: COVER
// ============================================================
{
  const s = pptx.addSlide();
  s.background = { color: C.bg };

  s.addShape(pptx.ShapeType.rect, {
    x: 0,
    y: 0,
    w: 13.333,
    h: 0.12,
    fill: { color: C.sky },
    line: { color: C.sky, width: 0 },
  });

  // Left visual panel: Architectural window diagram
  framedImage(
    s,
    IMG.anatomy,
    0.55,
    1.15,
    5.85,
    4.35,
    1376,
    768,
    "رسم توضيحي لأجزاء الشباك: الأباجور، الحلق، الظرفة، الزجاج، والمنخل",
    C.sky
  );

  // App Icon + Brand Title on right
  s.addImage({ path: IMG.icon, x: 11.45, y: 0.85, w: 1.25, h: 1.25 });

  s.addText("حاسبة القياسات", {
    x: 6.75,
    y: 0.9,
    w: 4.5,
    h: 0.7,
    fontFace: FONT,
    fontSize: 34,
    bold: true,
    color: C.text,
    align: "right",
    rtlMode: true,
  });
  s.addText("نظام متكامل لحساب مقاسات الشبابيك والواجهات بدقة فورية", {
    x: 6.75,
    y: 1.62,
    w: 5.95,
    h: 0.55,
    fontFace: FONT,
    fontSize: 15,
    color: C.sky,
    bold: true,
    align: "right",
    rtlMode: true,
  });

  clayCard(
    s,
    6.75,
    2.4,
    5.95,
    3.1,
    "ماذا يقدّم لك التطبيق؟",
    [
      "• تحويل الطول والعرض فوراً إلى كل مقاسات التقطيع والزجاج والمنخل والأباجور.",
      "• دعم كامل لوحدات القياس (متر / سانتي ميتر / ملي ميتر) والأرقام العربية.",
      "• حساب إجمالي المساحات (م²) وتجميع الشبابيك المتشابهة تلقائياً.",
      "• محرّر علاقات متقدم، خانات مخصصة، وتصميم Claymorphism ثلاثي الأبعاد.",
      "• تصدير احترافي PDF و Excel ذكي مع حفظ المشاريع والعمل دون إنترنت.",
    ],
    C.green,
    { titleSize: 15, bodySize: 12 }
  );

  // 4 Bottom Feature Pills
  const pills = [
    ["3 خطوات سريعة", C.sky],
    ["14 ثيم نهاري وليلي", C.violet],
    ["تصدير PDF و Excel", C.green],
    ["أمثلة ونتائج دقيقة", C.amber],
  ];
  pills.forEach(([lbl, col], i) => {
    const px = 0.55 + i * 3.12;
    s.addShape(pptx.ShapeType.roundRect, {
      x: px,
      y: 5.95,
      w: 2.9,
      h: 0.65,
      rectRadius: 0.16,
      fill: { color: C.card2 },
      line: { color: col, width: 1.4 },
    });
    s.addText(lbl, {
      x: px,
      y: 5.95,
      w: 2.9,
      h: 0.65,
      fontFace: FONT,
      fontSize: 13,
      bold: true,
      color: col,
      align: "center",
      valign: "middle",
      rtlMode: true,
    });
  });

  s.addText("إعداد: يوسف القرعان «أبو فارس» · الدليل التفصيلي للميزات", {
    x: 0.55,
    y: 6.92,
    w: 12.15,
    h: 0.32,
    fontFace: FONT,
    fontSize: 11,
    color: C.muted,
    align: "right",
    rtlMode: true,
  });
}

// ============================================================
// SLIDE 2: WORKFLOW + THEMES & TYPOGRAPHY
// ============================================================
{
  const s = baseSlide(
    "آلية العمل في التطبيق والهوية البصرية",
    "مسار عمل بسيط من 3 خطوات رئيسية مع شاشة تخصيص متقدمة و14 ثيماً لونياً",
    2,
    C.sky
  );

  // 4-Stage horizontal workflow (RTL right-to-left)
  const stages = [
    ["1", "النوع والمشاريع", "اختر من الأنواع الجاهزة أو أنشئ نوعاً خاصاً وافتح مشاريعك المحفوظة", C.green],
    ["2", "إدخال القياسات", "أدخل الطول والعرض والعدد والاسم بالوحدة المطلوبة مع أدوات النسخ السريع", C.sky],
    ["⚙", "تخصيص الخانات (اختياري)", "رتّب الخانات بالسحب والإفلات، فعّل المساحات، وعدّل العلاقات والتقريب", C.violet],
    ["3", "النتائج والتصدير", "بطاقات أو جدول تفاعلي، نسخ بلمسة، وتصدير PDF و Excel وواتساب", C.amber],
  ];
  stages.forEach(([badge, stTitle, stDesc, col], idx) => {
    const rx = 9.95 - idx * 3.16; // right to left
    s.addShape(pptx.ShapeType.roundRect, {
      x: rx,
      y: 1.38,
      w: 2.95,
      h: 2.1,
      rectRadius: 0.1,
      fill: { color: C.card },
      line: { color: col, width: 1.4 },
    });
    s.addShape(pptx.ShapeType.ellipse, {
      x: rx + 2.25,
      y: 1.54,
      w: 0.52,
      h: 0.52,
      fill: { color: col },
      line: { color: col, width: 0 },
    });
    s.addText(badge, {
      x: rx + 2.25,
      y: 1.54,
      w: 0.52,
      h: 0.52,
      fontFace: FONT,
      fontSize: 15,
      bold: true,
      color: "0B111F",
      align: "center",
      valign: "middle",
    });
    s.addText(stTitle, {
      x: rx + 0.14,
      y: 1.58,
      w: 2.02,
      h: 0.45,
      fontFace: FONT,
      fontSize: 13.5,
      bold: true,
      color: C.text,
      align: "right",
      valign: "middle",
      rtlMode: true,
    });
    s.addText(stDesc, {
      x: rx + 0.16,
      y: 2.18,
      w: 2.63,
      h: 1.15,
      fontFace: FONT,
      fontSize: 10.8,
      color: C.sub,
      align: "right",
      valign: "top",
      lineSpacingMultiple: 1.25,
      rtlMode: true,
    });
  });

  // Visual theme & UI section
  clayCard(
    s,
    6.75,
    3.78,
    6.15,
    3.1,
    "🎨 14 ثيم لوني + تحكّم بالخط والإضاءة",
    [
      "• تصميم Claymorphism ثلاثي الأبعاد: بطاقات ناعمة بظلال داخلية وخارجية مريحة للعين.",
      "• تبديل فوري بين الوضع الداكن والوضع الفاتح من زر (☀️ / 🌙) في الشريط العلوي.",
      "• ثيم «نهاري تحت الشمس» عالي التباين للعمل الميداني تحت ضوء الشمس المباشر.",
      "• ثيمات داكنة متخصصة: جرافيت، AMOLED أسود، سماوي نيون، بنفسجي نيون، برتقالي ناري.",
      "• 5 درجات لحجم الخط (أ±): صغير، عادي، كبير، كبير جداً، والأكبر — تُحفظ تلقائياً.",
    ],
    C.violet,
    { titleSize: 14.5, bodySize: 11.4 }
  );

  // Palette swatches card on left
  s.addShape(pptx.ShapeType.roundRect, {
    x: 0.48,
    y: 3.78,
    w: 5.95,
    h: 3.1,
    rectRadius: 0.1,
    fill: { color: C.darkPanel },
    line: { color: C.border, width: 1.2 },
  });
  s.addText("نماذج الثيمات اللونية وشريط الأدوات العلوي", {
    x: 0.65,
    y: 3.92,
    w: 5.6,
    h: 0.38,
    fontFace: FONT,
    fontSize: 13.5,
    bold: true,
    color: C.amber,
    align: "right",
    rtlMode: true,
  });

  const swatches = [
    ["جرافيت", "66708A"],
    ["AMOLED أسود", "111827"],
    ["نهاري", "0B4FA8"],
    ["تيتانيوم", "D97745"],
    ["عنّابي", "9F1239"],
    ["أزرق", "0F6FD6"],
    ["كحلي ملكي", "1E3A8A"],
    ["زمردي", "047857"],
    ["فحمي وذهبي", "B8860B"],
    ["نيلي", "5A49D8"],
    ["قهوة", "8A5A3B"],
    ["سماوي نيون", "22E5FF"],
    ["بنفسجي نيون", "B28DFF"],
    ["برتقالي ناري", "FF6B3D"],
  ];
  swatches.forEach(([nm, hex], idx) => {
    const colIdx = idx % 2;
    const rowIdx = Math.floor(idx / 2);
    const sx = colIdx === 0 ? 3.52 : 0.72;
    const sy = 4.4 + rowIdx * 0.34;
    s.addShape(pptx.ShapeType.roundRect, {
      x: sx,
      y: sy,
      w: 2.65,
      h: 0.28,
      rectRadius: 0.12,
      fill: { color: C.card2 },
      line: { color: C.border, width: 0.7 },
    });
    s.addShape(pptx.ShapeType.ellipse, {
      x: sx + 2.33,
      y: sy + 0.04,
      w: 0.2,
      h: 0.2,
      fill: { color: hex },
      line: { color: "FFFFFF", width: 0.5 },
    });
    s.addText(nm, {
      x: sx + 0.1,
      y: sy,
      w: 2.15,
      h: 0.28,
      fontFace: FONT,
      fontSize: 9.8,
      bold: true,
      color: C.text,
      align: "right",
      valign: "middle",
      rtlMode: true,
    });
  });
}

// ============================================================
// SLIDE 3: STEP 1 — TYPES & SAVED PROJECTS (WITH REAL SCREENSHOT)
// ============================================================
{
  const s = baseSlide(
    "الخطوة ١: اختيار نوع الشباك وإدارة المشاريع",
    "ثلاثة أنظمة جاهزة للعمل الفوري، إنشاء أنواع مخصصة، وحفظ كل مشروع باسمه",
    3,
    C.green
  );

  // Left: Real screenshot of Step 1
  framedImage(
    s,
    IMG.step1,
    0.5,
    1.32,
    3.15,
    5.6,
    1080,
    2106,
    "شاشة الخطوة ١ — اختيار النوع",
    C.green
  );

  // Right: 3 rich explanation cards
  clayCard(
    s,
    3.95,
    1.32,
    8.92,
    1.78,
    "🪟 3 أنواع أساسية جاهزة + رسوم توضيحية",
    [
      "• شبابيك دبل مجريين ونص: يحسب الحلق، الظرفة، العمود، السكين، الحصيرة، الصندوق، الزجاج، والمنخل.",
      "• واجهات سحاب بدون أباجور: مخصص للواجهات الصافية (حلق، ظرفة، زجاج، منخل، بدون صندوق أو حصيرة).",
      "• واجهات سحاب سنجل + أباجور: بخصم حلق -35 سم وصندوق طول ثابت 35 سم مع كامل تفاصيل الأباجور.",
    ],
    C.sky,
    { titleSize: 14, bodySize: 11 }
  );

  clayCard(
    s,
    3.95,
    3.24,
    8.92,
    1.78,
    "📁 المشاريع المحفوظة وإدارة الأعمال المتعددة",
    [
      "• احفظ مشروعك الحالي باسمه (مثال: فيلا أبو أحمد) لتتخزن كل شبابيكه، وحدته، علاقاته، وتاريخ التحديث.",
      "• افتح أي مشروع محفوظ لاحقاً بضغطة زر مع الحفاظ على أي أنواع جديدة أضفتها بعد حفظه.",
      "• أعد تسمية المشروع، ابدأ مشروعاً جديداً فارغاً، أو استورد مشروعاً مباشرة من ملف Excel.",
    ],
    C.amber,
    { titleSize: 14, bodySize: 11 }
  );

  clayCard(
    s,
    3.95,
    5.16,
    8.92,
    1.76,
    "⚙ تعديل الأنواع وإنشاء نوع مخصص + النسخة الاحتياطية",
    [
      "• زر «تعديل الأنواع والعلاقات» يسمح بتعديل صيغة أي خانة قبل البدء أو إنشاء نوع جديد تماماً باسمك.",
      "• داخل النوع المخصص يمكنك إضافة خانات غير محدودة وتغيير اسم النوع أو حذفه متى أردت.",
      "• قسم «النسخة الاحتياطية» يحفظ جميع أنواعك المخصصة وعلاقاتك ومشاريعك في ملف JSON أو نسخة HTML بلا إنترنت.",
    ],
    C.violet,
    { titleSize: 14, bodySize: 11 }
  );
}

// ============================================================
// SLIDE 4: WINDOW ANATOMY & 19 FIELDS REFERENCE
// ============================================================
{
  const s = baseSlide(
    "دليل الخانات المحسوبة (١٩ خانة قياسية + ٥ مساحات)",
    "كل مكوّن في الشباك يُحسب بعلاقة دقيقة من الطول والعرض بوحدة السنتيمتر القياسية",
    4,
    C.teal
  );

  framedImage(
    s,
    IMG.anatomy,
    0.48,
    1.32,
    5.55,
    3.45,
    1376,
    768,
    "توزّع مكوّنات الشباك والأباجور والمنخل",
    C.teal
  );

  clayCard(
    s,
    0.48,
    4.92,
    5.55,
    2.0,
    "📐 خمس خانات لحساب المساحات (م² / سم² / مم²)",
    [
      "• مساحة الشباك (AW): الطول × العرض",
      "• مساحة الحصيرة (AB): ارتفاع الحصيرة × عرض الحصيرة",
      "• مساحة الصندوق (AE): طول الصندوق × عرض الصندوق",
      "• مساحة الزجاج (AG) ومساحة المنخل (AI): الطول × العرض لكل منهما",
    ],
    C.green,
    { titleSize: 13, bodySize: 10.6 }
  );

  // Reference Table of built-in formulas
  const rows = [
    [
      rtlCell("العلاقة الافتراضية (سم)", { bold: true, fill: C.card2, color: C.sky }),
      rtlCell("البند / الخانة", { bold: true, fill: C.card2, color: C.sky }),
      rtlCell("المجموعة", { bold: true, fill: C.card2, color: C.sky }),
    ],
    [rtlCell("العرض − 1.6"), rtlCell("راسية حلق (أرضية حلق) N", { bold: true }), rtlCell("فردية")],
    [rtlCell("راسية الحلق ÷ 2"), rtlCell("راسية ظرفة (أرضية ظرفة) K", { bold: true }), rtlCell("فردية")],
    [rtlCell("الطول − 29.5 (أو −35 / 0)"), rtlCell("جنب الحلق M", { bold: true }), rtlCell("فردية")],
    [rtlCell("جنب الحلق − 4.8"), rtlCell("سكين أو زرفيل L", { bold: true }), rtlCell("فردية")],
    [rtlCell("عرض الصندوق − 9"), rtlCell("عمود A", { bold: true }), rtlCell("فردية")],
    [rtlCell("الطول − 30  |  العرض − 10"), rtlCell("ارتفاع B  |  عرض C", { bold: true }), rtlCell("الحصيرة")],
    [rtlCell("جنب+7 | ثابت 35 | راسية+0.6"), rtlCell("اباجور D | طول E | عرض F", { bold: true }), rtlCell("صندوق")],
    [rtlCell("سكين − 9.2  |  ظرفة − 5.7"), rtlCell("طول G  |  عرض H", { bold: true }), rtlCell("زجاج")],
    [rtlCell("سكين + 0.7  |  ظرفة + 2"), rtlCell("طول I  |  عرض J", { bold: true }), rtlCell("منخل")],
  ];

  s.addTable(rows, {
    x: 6.25,
    y: 1.32,
    w: 6.62,
    colW: [2.75, 2.55, 1.32],
    rowH: [0.46, 0.56, 0.56, 0.56, 0.56, 0.56, 0.56, 0.56, 0.56, 0.56],
  });
}

// ============================================================
// SLIDE 5: STEP 2 — SMART INPUT & UNITS (WITH REAL SCREENSHOT)
// ============================================================
{
  const s = baseSlide(
    "الخطوة ٢: إدخال القياسات الذكي والمرن",
    "إدخال سريع في الميدان مع تحويل تلقائي للوحدات ودعم الأرقام العربية وتنبيهات الأمان",
    5,
    C.sky
  );

  framedImage(
    s,
    IMG.step2,
    0.5,
    1.32,
    3.15,
    5.6,
    1080,
    2106,
    "شاشة الخطوة ٢ — بطاقات القياس",
    C.sky
  );

  clayCard(
    s,
    3.95,
    1.32,
    8.92,
    1.76,
    "📏 التحويل التلقائي بين الوحدات (م / سم / مم)",
    [
      "• عند تبديل الوحدة، تُحوَّل كل القياسات المدخلة وقيم الزيادة/النقصان والعلاقات فوراً دون إعادة كتابة.",
      "• ميزة المتر السريع: عند اختيار «متر»، كتابة 150 تتحول تلقائياً إلى 1.50 م؛ ولـ 10 م فأكثر تكتب الفاصلة يدوياً.",
      "• يتعرف المحرّك على الأرقام العربية (٠-٩) والإنجليزية والفواصل العشرية المختلفة ( .  ٫  ، ).",
    ],
    C.sky,
    { titleSize: 14, bodySize: 11 }
  );

  clayCard(
    s,
    3.95,
    3.22,
    8.92,
    1.76,
    "🏷️ تسمية الشباك، تغيير موضعه، وتحديد العدد",
    [
      "• اضغط على نص «تسمية الشباك» لكتابة اسم الغرفة (مطبخ، صالة...) ليظهر في الجداول والبحث وملفات PDF/Excel.",
      "• اضغط على شارة رقم الشباك الدائرية لنقله إلى رقم جديد (1–200) وتبديله تلقائياً مع الشباك الموجود في ذلك الرقم.",
      "• حقل «العدد»: أدخل الكمية المتكررة (حتى 9999) ليضربها التطبيق في المساحات الإجمالية وملخص التكرار.",
    ],
    C.amber,
    { titleSize: 14, bodySize: 11 }
  );

  clayCard(
    s,
    3.95,
    5.12,
    8.92,
    1.8,
    "🛡️ فحص الأخطاء وتنبيهات المقاسات الحية",
    [
      "• حماية حدود الإدخال: يرفض الأصفار والأرقام السالبة والقياسات الأكبر من 50 متراً مع تمييز البطاقة المتأثرة.",
      "• تحذير أصفر ناعم عند كتابة قياس أصغر من 10 سم أو أكبر من 6 أمتار للتنبيه من خطأ مطبعي محتمل.",
      "• تنبيه ذكي قبل النتائج إذا كانت أبعاد الشباك صغيرة جداً ستنتج قياسات تقطيع سالبة (مع تمييز الشباك فوراً).",
    ],
    C.coral,
    { titleSize: 14, bodySize: 11 }
  );
}

// ============================================================
// SLIDE 6: STEP 2 ACCELERATORS & PENDING MEASUREMENTS
// ============================================================
{
  const s = baseSlide(
    "أدوات التسريع في الإدخال وحالة «قياس غير جاهز»",
    "وفر الوقت عند تكرار المقاسات أو لصق القوائم، وتابع العمل حتى لو كان أحد المقاسات ناقصاً",
    6,
    C.amber
  );

  framedImage(
    s,
    IMG.pend,
    0.5,
    1.32,
    3.15,
    5.6,
    1080,
    2106,
    "نافذة التحقق من القياسات الناقصة",
    C.amber
  );

  clayCard(
    s,
    3.95,
    1.32,
    8.92,
    1.75,
    "⧉ أدوات النسخ واللصق السريع والتراجع",
    [
      "• «نسخ الشباك السابق»: يكرر آخر شباك مكتمل في الصف التالي فوراً مع التركيز على حقل العدد للتعديل السريع.",
      "• «نسخ شباك محدد»: اكتب رقم أي شباك وستظهر معاينته (اسمه وطوله وعرضه) قبل إضافته في آخر القائمة.",
      "• «لصق قياسات»: الصق عدة أسطر بصيغة (طول عرض اسم) لإضافتها دفعة واحدة، مع زر «↶ تراجع» عند حذف أي شباك.",
    ],
    C.sky,
    { titleSize: 14, bodySize: 11 }
  );

  clayCard(
    s,
    3.95,
    3.21,
    8.92,
    1.85,
    "⏳ ميزة «قياس غير جاهز» وحساب النصف الجاهز",
    [
      "• اضغط «⏳ قياس غير جاهز؟» في أي بطاقة واختر: الطول غير جاهز، العرض غير جاهز، أو كلاهما غير جاهز.",
      "• لا تتوقف الحسابات: الخانات المعتمدة على القياس الجاهز فقط تُحسب فوراً (مثل عرض الحلق والظرفة عند جاهزية العرض).",
      "• الخانات المعتمدة على القياس الناقص تظهر بعلامة (⏳) في الشاشة وبفراغ منظم في PDF و Excel لتعبئتها لاحقاً.",
    ],
    C.amber,
    { titleSize: 14, bodySize: 11 }
  );

  clayCard(
    s,
    3.95,
    5.2,
    8.92,
    1.72,
    "⚠️ نافذة التأكيد الذكية وتنظيف الصفوف الفارغة",
    [
      "• عند الانتقال للنتائج وبعض الصفوف ناقصة، تفتح نافذة «تأكد قبل المتابعة» لتكمّل القياس الناقص مباشرة داخلها.",
      "• أو تختار «اتركه فارغاً عمداً» لتعليمه غير جاهز، أو «حذف» الصف غير المطلوب بضغطة واحدة.",
      "• يظهر شريط «تنظيف الصفوف الفارغة» تلقائياً إذا وُجدت صفوف فارغة بين الشبابيك لحذفها بضغطة واحدة.",
    ],
    C.green,
    { titleSize: 14, bodySize: 11 }
  );
}

// ============================================================
// SLIDE 7: WORKED NUMERICAL EXAMPLE END-TO-END
// ============================================================
{
  const s = baseSlide(
    "مثال تطبيقي متكامل: مشروع واقعي بالأرقام",
    "تتبّع نفس المدخلات من شاشة القياس إلى النتائج النهائية لنوع «شبابيك دبل مجريين ونص» (الوحدة: سم)",
    7,
    C.green
  );

  // Input card top-right
  const inRows = [
    [
      rtlCell("الحالة", { bold: true, fill: C.card2, color: C.sky }),
      rtlCell("العدد", { bold: true, fill: C.card2, color: C.sky }),
      rtlCell("العرض (سم)", { bold: true, fill: C.card2, color: C.sky }),
      rtlCell("الطول (سم)", { bold: true, fill: C.card2, color: C.sky }),
      rtlCell("الاسم", { bold: true, fill: C.card2, color: C.sky }),
      rtlCell("#", { bold: true, fill: C.card2, color: C.sky }),
    ],
    [rtlCell("جاهز ✓", { color: C.green }), rtlCell("2", { bold: true }), rtlCell("263"), rtlCell("135"), rtlCell("صالة", { bold: true }), rtlCell("1")],
    [rtlCell("جاهز ✓", { color: C.green }), rtlCell("1", { bold: true }), rtlCell("263"), rtlCell("135"), rtlCell("مطبخ", { bold: true }), rtlCell("2")],
    [rtlCell("الطول ⏳", { color: C.amber }), rtlCell("1", { bold: true }), rtlCell("80"), rtlCell("⏳ غير جاهز", { color: C.amber }), rtlCell("حمام", { bold: true }), rtlCell("3")],
  ];

  s.addText("أولاً: المدخلات في الخطوة ٢ (ثلاثة شبابيك — إجمالي ٤ قطع)", {
    x: 0.5,
    y: 1.28,
    w: 12.35,
    h: 0.34,
    fontFace: FONT,
    fontSize: 13.5,
    bold: true,
    color: C.sky,
    align: "right",
    rtlMode: true,
  });

  s.addTable(inRows, {
    x: 0.5,
    y: 1.66,
    w: 12.35,
    colW: [2.0, 1.3, 2.2, 2.4, 3.25, 1.2],
    rowH: [0.38, 0.38, 0.38, 0.38],
  });

  s.addText("ثانياً: جدول النتائج المحسوبة آلياً في الخطوة ٤", {
    x: 0.5,
    y: 3.3,
    w: 12.35,
    h: 0.34,
    fontFace: FONT,
    fontSize: 13.5,
    bold: true,
    color: C.green,
    align: "right",
    rtlMode: true,
  });

  const outRows = [
    [
      rtlCell("منخل (ط×ع)", { bold: true, fill: C.card2, color: C.amber }),
      rtlCell("زجاج (ط×ع)", { bold: true, fill: C.card2, color: C.teal }),
      rtlCell("حصيرة (ر×ع)", { bold: true, fill: C.card2, color: C.sky }),
      rtlCell("عمود A", { bold: true, fill: C.card2, color: C.violet }),
      rtlCell("سكين L", { bold: true, fill: C.card2, color: C.coral }),
      rtlCell("جنب الحلق M", { bold: true, fill: C.card2, color: C.amber }),
      rtlCell("ظرفة K", { bold: true, fill: C.card2, color: C.violet }),
      rtlCell("حلق N", { bold: true, fill: C.card2, color: C.sky }),
      rtlCell("الشباك", { bold: true, fill: C.card2, color: C.text }),
    ],
    [
      rtlCell("101.4 × 132.7"),
      rtlCell("91.5 × 125"),
      rtlCell("105 × 253"),
      rtlCell("253"),
      rtlCell("100.7"),
      rtlCell("105.5"),
      rtlCell("130.7"),
      rtlCell("261.4"),
      rtlCell("1 · صالة (×2)", { bold: true }),
    ],
    [
      rtlCell("101.4 × 132.7"),
      rtlCell("91.5 × 125"),
      rtlCell("105 × 253"),
      rtlCell("253"),
      rtlCell("100.7"),
      rtlCell("105.5"),
      rtlCell("130.7"),
      rtlCell("261.4"),
      rtlCell("2 · مطبخ (×1)", { bold: true }),
    ],
    [
      rtlCell("⏳ × 41.2", { color: C.amber }),
      rtlCell("⏳ × 33.5", { color: C.amber }),
      rtlCell("⏳ × 70", { color: C.amber }),
      rtlCell("70"),
      rtlCell("⏳", { color: C.amber }),
      rtlCell("⏳", { color: C.amber }),
      rtlCell("39.2"),
      rtlCell("78.4"),
      rtlCell("3 · حمام (طول ⏳)", { bold: true }),
    ],
  ];

  s.addTable(outRows, {
    x: 0.5,
    y: 3.68,
    w: 12.35,
    colW: [1.8, 1.65, 1.55, 1.0, 1.0, 1.25, 1.0, 1.0, 2.1],
    rowH: [0.42, 0.44, 0.44, 0.44],
  });

  // Two summary callout cards at bottom
  clayCard(
    s,
    6.75,
    5.6,
    6.1,
    1.36,
    "🔁 ملخص الشبابيك المتشابهة التلقائي",
    [
      "• يكتشف التطبيق أن شباك 1 (عدد 2) وشباك 2 (عدد 1) لهما نفس القياس 135 × 263.",
      "• النتيجة: قياس مكرر واحد · 3 شبابيك متشابهة · الأرقام: 1، 2.",
    ],
    C.amber,
    { titleSize: 13, bodySize: 10.8 }
  );

  clayCard(
    s,
    0.5,
    5.6,
    6.0,
    1.36,
    "📐 ملخص إجمالي المساحات (عند تفعيل خانات المساحة)",
    [
      "• مساحة الشباك AW للقطعة = 1.35 × 2.63 = 3.55 م² × 3 قطع = 10.65 م².",
      "• مساحة الزجاج AG للقطعة = 0.915 × 1.25 = 1.144 م² × 3 قطع = 3.43 م².",
    ],
    C.green,
    { titleSize: 13, bodySize: 10.8 }
  );
}

// ============================================================
// SLIDE 8: STEP 3 — CLAY O DESIGN & DRAG-AND-DROP
// ============================================================
{
  const s = baseSlide(
    "شاشة تخصيص الخانات بتصميم Clay O والسحب الحر",
    "واجهة أنيقة بألوان باستيل واضحة لكل بند مع سحب وإفلات من أي مكان على البطاقة",
    8,
    C.violet
  );

  framedImage(
    s,
    IMG.clayO,
    0.48,
    1.32,
    4.0,
    5.6,
    896,
    1200,
    "تصميم Clay O — بطاقات باستيل مع رصيف القيم والأسهم",
    C.violet
  );

  clayCard(
    s,
    4.78,
    1.32,
    8.1,
    1.62,
    "🎨 تمييز بصري ناعم (Claymorphism Pastel)",
    [
      "• كل بطاقة خانة أو مجموعة لها لون باستيل هادئ مختلف (سماوي، وردي، أخضر، عنبري، بنفسجي).",
      "• رصيف داكن أنيق (Dock) يجمع شارة القيمة الحيّة لأول شباك مع أزرار السهمين (▲ / ▼) بوضوح تام.",
      "• أزرار تحديد ثلاثية الأبعاد (Checkbox) لإخفاء/إظهار أي خانة أو مجموعة كاملة بنقرة واحدة.",
    ],
    C.sky,
    { titleSize: 13.8, bodySize: 10.9 }
  );

  clayCard(
    s,
    4.78,
    3.08,
    8.1,
    1.85,
    "✋ السحب والإفلات من أي مكان (Drag & Drop) + المعاينة",
    [
      "• اسحب أي بطاقة مجموعة أو خانة فرعية مباشرة من أي مساحة فارغة فيها — وليس من أيقونة (⋮⋮) فقط!",
      "• بالماوس: سحب مباشر بعد تحريك 5px · باللمس: ضغطة مطوّلة قصيرة (175ms) مع اهتزاز خفيف وتمرير تلقائي.",
      "• مبدّل وضعين علوي: «↕ اختيار وترتيب» للترتيب النظيف السريع، أو «⚙ علاقات وتعديل» لإظهار أدوات الصيغ.",
    ],
    C.green,
    { titleSize: 13.8, bodySize: 10.9 }
  );

  clayCard(
    s,
    4.78,
    5.07,
    8.1,
    1.85,
    "🛡️ التراجع المتعدد وحفظ/إلغاء التغييرات بأمان",
    [
      "• زر «↶ تراجع» يحتفظ حتى 40 خطوة سابقة عند تغيير الترتيب أو العلاقات أو التحديد.",
      "• أزرار سريعة: طيّ/فتح الكل، تحديد الكل، إلغاء الكل، تصفير التعديلات، إرجاع العلاقات والترتيب الافتراضي.",
      "• زر «✓ تم» يحفظ التخصيص فوراً للنتائج، بينما تحمي شاشة «تغييرات غير محفوظة» تعديلاتك عند الإلغاء.",
    ],
    C.amber,
    { titleSize: 13.8, bodySize: 10.9 }
  );
}

// ============================================================
// SLIDE 9: ADVANCED RELATION EDITOR, CASCADE & ROUNDING + EXAMPLE
// ============================================================
{
  const s = baseSlide(
    "محرّر العلاقات المتقدم، التعديل المتسلسل، والتقريب",
    "عدّل المعادلات الحسابية بحرية تامة لكل نوع مع قوالب سريعة ومثال تطبيقي مباشر",
    9,
    C.coral
  );

  clayCard(
    s,
    6.75,
    1.32,
    6.12,
    2.65,
    "⚙ مكوّنات محرّر العلاقة لكل خانة",
    [
      "• قوالب سريعة بضغطة واحدة: (الطول − رقم، العرض ÷ 2، الطول × العرض...).",
      "• اختيار المصدر الأساسي (الطول، العرض، أو أي خانة سابقة) + خانة ثانية اختيارية.",
      "• 4 عمليات حسابية بين المصدرين: (＋ جمع، － طرح، × ضرب، ÷ قسمة) مع إمكانية تعديل كل مصدر قبل العملية.",
      "• معامل الضرب أو القسمة (× / ÷) ثم إضافة أو طرح ثابت نهائي بالوحدة المختارة.",
    ],
    C.sky,
    { titleSize: 14, bodySize: 11 }
  );

  clayCard(
    s,
    0.48,
    1.32,
    6.02,
    2.65,
    "🔗 التأثير المتسلسل (Cascade) والتقريب المرن (≈)",
    [
      "• زيادة (＋) ونقصان (－) مباشرة تحت كل خانة لتعديل فوري دون تغيير المعادلة الأصلية.",
      "• خيار «تطبيق التعديل على الخانات المرتبطة»: عند تفعيله ينتقل التعديل تلقائياً للخانات المشتقة؛ وعند إيقافه يؤثر على الخانة فقط.",
      "• التقريب الفردي أو العام لجميع النتائج: بدون، 0.1، 0.5، أو 1 باتجاه (لأقرب / لأعلى ↑ / لأسفل ↓).",
      "• زر «عرض الأرقام الأصلية» في النتائج للمقارنة السريعة مع القيم قبل التقريب.",
    ],
    C.violet,
    { titleSize: 14, bodySize: 11 }
  );

  // Worked math comparison panel at bottom
  s.addShape(pptx.ShapeType.roundRect, {
    x: 0.48,
    y: 4.18,
    w: 12.39,
    h: 2.75,
    rectRadius: 0.1,
    fill: { color: C.darkPanel },
    line: { color: C.amber, width: 1.4 },
  });
  s.addText("📐 مثال عملي: أثر إضافة (＋ 2 سم) على خانة «جنب الحلق M» لشباك 135 × 263 سم", {
    x: 0.72,
    y: 4.3,
    w: 11.9,
    h: 0.4,
    fontFace: FONT,
    fontSize: 14,
    bold: true,
    color: C.amber,
    align: "right",
    rtlMode: true,
  });

  const exRows = [
    [
      rtlCell("الأرقام مع تفعيل التقريب (0.5 لأعلى ↑)", { bold: true, fill: C.card2, color: C.violet }),
      rtlCell("بدون Cascade (على M فقط)", { bold: true, fill: C.card2, color: C.coral }),
      rtlCell("مع تفعيل Cascade (الوضع الافتراضي)", { bold: true, fill: C.card2, color: C.green }),
      rtlCell("النتيجة الأصلية", { bold: true, fill: C.card2, color: C.sky }),
      rtlCell("الخانة", { bold: true, fill: C.card2, color: C.text }),
    ],
    [
      rtlCell("107.5"),
      rtlCell("107.5 (+2)"),
      rtlCell("107.5 (+2)", { bold: true, color: C.green }),
      rtlCell("105.5"),
      rtlCell("جنب الحلق (M)", { bold: true }),
    ],
    [
      rtlCell("103.0  (أصلي 102.7)", { color: C.violet }),
      rtlCell("100.7  (ثابت)"),
      rtlCell("102.7 (+2)", { bold: true, color: C.green }),
      rtlCell("100.7"),
      rtlCell("سكين / زرفيل (L = M − 4.8)", { bold: true }),
    ],
    [
      rtlCell("93.5  (أصلي 93.5)"),
      rtlCell("91.5  (ثابت)"),
      rtlCell("93.5 (+2)", { bold: true, color: C.green }),
      rtlCell("91.5"),
      rtlCell("طول الزجاج (G = L − 9.2)", { bold: true }),
    ],
  ];

  s.addTable(exRows, {
    x: 0.72,
    y: 4.78,
    w: 11.9,
    colW: [2.75, 2.25, 2.55, 1.75, 2.6],
    rowH: [0.42, 0.48, 0.48, 0.48],
  });
}

// ============================================================
// SLIDE 10: CUSTOM FIELDS, GROUPS & AREA M2
// ============================================================
{
  const s = baseSlide(
    "الخانات المخصصة، المجموعات، وحساب المساحات (م²)",
    "ابنِ معادلات ورشتك الخاصة بمرونة كاملة واطلب كميات الزجاج والأباجور بدقة بالمتر المربع",
    10,
    C.teal
  );

  clayCard(
    s,
    6.8,
    1.35,
    6.05,
    2.7,
    "➕ إضافة خانات ومجموعات مخصصة",
    [
      "• أضف أي عدد من الخانات الجديدة (c1, c2...) لأي نوع جاهز أو نوع أنشأته أنت.",
      "• اربط الخانة الجديدة بمجموعة قائمة (مثل «زجاج» أو «الحصيرة») لتندمج داخل بطاقتها وعمودها، أو اكتب اسم مجموعة جديدة بلون مميز.",
      "• تمنع قائمة المصادر تلقائياً اختيار الخانات اللاحقة لتجنّب الدورات الحسابية غير الصالحة.",
      "• يحميك التطبيق من حذف أي خانة مخصصة إذا كانت هناك خانة أخرى مبنية على نتيجتها.",
    ],
    C.sky,
    { titleSize: 14, bodySize: 11 }
  );

  clayCard(
    s,
    0.48,
    1.35,
    6.05,
    2.7,
    "📐 تفعيل وحساب المساحات الخمس (م²)",
    [
      "• تأتي خانات المساحة (الشباك، الحصيرة، الصندوق، الزجاج، المنخل) مخفية افتراضياً لإبقاء الشاشة مركّزة.",
      "• فعّل أي خانة مساحة من خطوة «تخصيص الخانات» (عليها شارة 📐 مساحة).",
      "• يتعرف المحرّك آلياً على البُعد الثنائي (فdim = 2) فيضرب معامل التحويل مرّتين (م² / سم² / مم²).",
      "• يظهر في النتائج والملفات المصدّرة جدول «ملخص إجمالي المساحات» محسوباً بالمتر المربع (م²) ومضروباً في العدد!",
    ],
    C.green,
    { titleSize: 14, bodySize: 11 }
  );

  // Example card for Custom Area / Formula
  clayCard(
    s,
    0.48,
    4.25,
    12.37,
    2.65,
    "💡 مثال لبناء خانة مساحة زجاج مزدوجة من خانتين + طلب المادة بالمتر المربع",
    [
      "1. من شاشة «⚙ علاقات وتعديل» اضغط «＋ إضافة خانة جديدة»، وسمّها «مساحة الضرفتين»، وأضفها إلى مجموعة «زجاج».",
      "2. اختر «تُحسب من»: طول الزجاج (G)، و«الخانة الثانية»: عرض الزجاج (H)، و«العملية»: × ضرب (المساحة)، واضبط معامل الضرب على 2.",
      "3. النتيجة لشباك 135 × 263 (G=91.5، H=125) عدد 2 شباك: كل قطعة = 91.5 × 125 × 2 = 22,875 سم² = 2.288 م².",
      "4. في ملخص إجمالي المساحات بالنتائج سيظهر فوراً: «إجمالي مساحة الضرفتين: 4.575 م²» لتسعير أو طلب الزجاج من المصنع بدقة!",
    ],
    C.amber,
    { titleSize: 14, bodySize: 11.4 }
  );
}

// ============================================================
// SLIDE 11: STEP 4 — RESULTS CARDS, TABLE, SEARCH & COPY (REAL IMAGES)
// ============================================================
{
  const s = baseSlide(
    "الخطوة ٤: استعراض النتائج، الجدول الثابت، والبحث السريع",
    "طريقة عرض مرنة للبطاقات أو الجدول الواسع مع النسخ الفوري وملخصات المساحات والتكرار",
    11,
    C.sky
  );

  framedImage(
    s,
    IMG.table1,
    0.48,
    1.32,
    2.82,
    5.6,
    1080,
    2106,
    "وضع الجدول: أعمدة ثابتة ملوّنة",
    C.sky
  );

  framedImage(
    s,
    IMG.table2,
    3.48,
    1.32,
    2.82,
    5.6,
    1080,
    2106,
    "ملخص الشبابيك المتشابهة أسفل الجدول",
    C.amber
  );

  clayCard(
    s,
    6.55,
    1.32,
    6.32,
    1.76,
    "📱 وضع البطاقات vs وضع الجدول الواسع",
    [
      "• «بطاقات»: بطاقة مستقلة لكل شباك تضم المجموعات الملوّنة — مثالية للقراءة الميدانية على الهاتف.",
      "• «جدول»: جدول تقطيع متكامل بترويسة رأسية ثابتة وأول 3 أعمدة (رقم، طول، عرض + الاسم) مجمّدة أثناء التمرير.",
      "• يظهر الشريط العلوي ملخصاً فورياً لعدد الشبابيك والقطع، الخانات المفعّلة، وإجماليات الـ م².",
    ],
    C.sky,
    { titleSize: 13.8, bodySize: 10.9 }
  );

  clayCard(
    s,
    6.55,
    3.22,
    6.32,
    1.76,
    "🔍 البحث الفوري والنسخ بلمسة واحدة",
    [
      "• اضغط زر العدسة (🔍) وابحث برقم الشباك (مثل 3 أو ٣) أو باسمه (مثل صالة) لتصفية البطاقات والجدول فوراً.",
      "• اضغط على أي رقم في البطاقات أو خلايا الجدول لنسخه إلى الحافظة مباشرة مع رسالة تأكيد.",
      "• عند تفعيل التقريب، يظهر الرقم المقرّب بوضوح وتحته القيمة الأصلية للمراجعة السريعة.",
    ],
    C.green,
    { titleSize: 13.8, bodySize: 10.9 }
  );

  clayCard(
    s,
    6.55,
    5.12,
    6.32,
    1.8,
    "📊 بطاقات الملخص الذكي أسفل النتائج",
    [
      "• ملخص الشبابيك المتشابهة: يجمّع المقاسات المكررة بدقة (مع التفريق بين 150×100 و 100×150) ويعرض أرقامها.",
      "• ملخص إجمالي المساحات: يجمع مساحات كل بند مفعّل بالمتر المربع (م²) لطلب المواد فوراً.",
      "• إشعار خاص إذا وُجدت قياسات غير جاهزة (⏳) يبيّن أرقام الشبابيك المطلوب إكمالها لاحقاً.",
    ],
    C.amber,
    { titleSize: 13.8, bodySize: 10.9 }
  );
}

// ============================================================
// SLIDE 12: EXPORT, SHARE, EXCEL IMPORT & PORTABILITY
// ============================================================
{
  const s = baseSlide(
    "التصدير، المشاركة، إعادة الاستيراد، والعمل بدون إنترنت",
    "تقارير PDF عربية خفيفة، ملفات Excel ذكية ثنائية الأوراق، ونسخ احتياطي كامل",
    12,
    C.amber
  );

  framedImage(
    s,
    IMG.exportHub,
    0.48,
    1.32,
    5.75,
    3.32,
    1376,
    768,
    "منظومة التصدير والمشاركة والنسخ الاحتياطي",
    C.amber
  );

  clayCard(
    s,
    0.48,
    4.8,
    5.75,
    2.12,
    "📲 التشغيل المستقل (HTML بدون إنترنت + APK)",
    [
      "• يمكن تنزيل نسخة ملف HTML واحد ذاتية الاحتواء تعمل على أي هاتف أو كمبيوتر بلا اتصال بالإنترنت.",
      "• يدعم الحفظ والمشاركة الأصيلة على أندرويد (Capacitor APK) وحماية زر الرجوع للخروج الآمن.",
      "• طرق بديلة مدمجة إذا حظر المتصفح التنزيل: إعادة التنزيل، لصق الجدول، أو نص جاهز للواتساب.",
    ],
    C.violet,
    { titleSize: 13.2, bodySize: 10.6 }
  );

  clayCard(
    s,
    6.48,
    1.32,
    6.4,
    1.76,
    "📄 تصدير PDF عربي نصي خفيف (A4 أفقي)",
    [
      "• خطوط عربية مدمجة بترميز ثنائي الاتجاه نظيف وحجم خفيف جداً للمشاركة السريعة.",
      "• يضم ترويسة المشروع، النوع، الوحدة، التاريخ، الجداول الملوّنة، ملخص المساحات والتكرار، والتوقيع أسفل الصفحة.",
    ],
    C.coral,
    { titleSize: 13.6, bodySize: 10.8 }
  );

  clayCard(
    s,
    6.48,
    3.22,
    6.4,
    1.85,
    "📊 ملف Excel ذكي ثنائي الأوراق (تصدير + استيراد)",
    [
      "• ورقة «النتائج»: خلايا ملوّنة وترويسة مجمّدة (RTL) لسهولة التصفح والطباعة.",
      "• ورقة «الإعدادات»: تحفظ نوع الشباك والعلاقات والتخصيص؛ عند إعادة استيراد الملف تختار استيراد القياسات أو الإعدادات أو كليهما!",
    ],
    C.green,
    { titleSize: 13.6, bodySize: 10.8 }
  );

  clayCard(
    s,
    6.48,
    5.2,
    6.4,
    1.72,
    "💬 المشاركة السريعة والنسخ الاحتياطي JSON",
    [
      "• مشاركة مباشرة بالواتساب أو مشاركة النظام، نسخ جدول مفصول بـ Tab للإكسل، وتصدير ملف CSV بترميز UTF-8.",
      "• حفظ واستعادة نسخة احتياطية (.json) تشمل كل المشاريع والأنواع والعلاقات بضغطة زر.",
    ],
    C.sky,
    { titleSize: 13.6, bodySize: 10.8 }
  );
}

// ============================================================
// SLIDE 13: CLOSING SUMMARY
// ============================================================
{
  const s = pptx.addSlide();
  s.background = { color: C.bg };

  s.addShape(pptx.ShapeType.rect, {
    x: 0,
    y: 0,
    w: 13.333,
    h: 0.12,
    fill: { color: C.green },
    line: { color: C.green, width: 0 },
  });

  s.addImage({ path: IMG.icon, x: 5.95, y: 0.72, w: 1.43, h: 1.43 });

  s.addText("حاسبة القياسات — سرعة الميدان ودقة الورشة", {
    x: 0.8,
    y: 2.35,
    w: 11.73,
    h: 0.65,
    fontFace: FONT,
    fontSize: 28,
    bold: true,
    color: C.text,
    align: "center",
    rtlMode: true,
  });

  s.addText("من أخذ القياس في الموقع إلى ورقة التقطيع النهائية في ثوانٍ معدودة", {
    x: 1.2,
    y: 3.05,
    w: 10.93,
    h: 0.45,
    fontFace: FONT,
    fontSize: 15,
    color: C.sky,
    align: "center",
    rtlMode: true,
  });

  const pillars = [
    ["⚡ سرعة عالية", "إدخال مرن ونسخ ولصق قوائم وتبديل وحدات فوري", C.sky],
    ["🎯 دقة هندسية", "19 خانة معيارية + علاقات متقدمة + تقريب مخصص", C.green],
    ["🎨 راحة بصرية", "تصميم Claymorphism O واضح مع 14 ثيم وخط قابل للتكبير", C.violet],
    ["📦 توثيق متكامل", "PDF عربي و Excel ذكي ومشاريع محفوظة وعمل بلا إنترنت", C.amber],
  ];
  pillars.forEach(([pt, pd, col], i) => {
    const px = 9.95 - i * 3.12;
    clayCard(s, px, 3.88, 2.9, 1.9, pt, [pd], col, { titleSize: 14, bodySize: 11 });
  });

  s.addShape(pptx.ShapeType.roundRect, {
    x: 2.66,
    y: 6.18,
    w: 8.0,
    h: 0.78,
    rectRadius: 0.16,
    fill: { color: C.card2 },
    line: { color: C.amber, width: 1.2 },
  });
  s.addText("يوسف القرعان «أبو فارس»   ·   +962795467235", {
    x: 2.66,
    y: 6.18,
    w: 8.0,
    h: 0.78,
    fontFace: FONT,
    fontSize: 15,
    bold: true,
    color: C.amber,
    align: "center",
    valign: "middle",
    rtlMode: true,
  });
}

(async () => {
  const outPath = path.join(ROOT, "public/presentation.pptx");
  await pptx.writeFile({ fileName: outPath });
  const stats = fs.statSync(outPath);
  console.log("PPTX CREATED:", outPath, "Size bytes:", stats.size, "Slides:", pptx.slides.length);
})();
