/**
 * اختبارات انحدار تلقائية لمحرك حاسبة الشبابيك (src/engine/calc.ts)
 * تضمن بقاء معادلات الأنواع الأربعة الأساسية وتحويل الوحدات والتقريب والتكرارات متطابقة 100%.
 */
import assert from "node:assert/strict";
import {
  BUILTIN_TYPE_NAMES,
  buildResults,
  compute,
  createDefaultState,
  createRuntimeCatalog,
  num,
  rndApply,
} from "../src/engine/calc";

let passed = 0;

function runTest(name: string, fn: () => void) {
  try {
    fn();
    passed++;
    console.log(`✓ ${name}`);
  } catch (err) {
    console.error(`✗ ${name}`);
    throw err;
  }
}

runTest("التحقق من وجود الأنواع الأربعة الأساسية دون تغيير", () => {
  assert.deepEqual(BUILTIN_TYPE_NAMES, [
    "شباك 3 مجاري نظامي",
    "شباك 2.5 نظامي",
    "واجهات 2.5 بدون صندوق",
    "شباك 3 مجاري بدون صندوق",
  ]);
});

runTest("النوع 1: شباك 3 مجاري نظامي (150×120 سم)", () => {
  const state = createDefaultState();
  state.type = "شباك 3 مجاري نظامي";
  state.unit = "cm";
  state.rows = [{ n: "صالة", L: "150", W: "120", q: "1" }];

  const cat = createRuntimeCatalog(state);
  const res = compute(cat, state.type, 150, 120);

  assert.equal(res.M, 120.5);
  assert.equal(res.N, 117.4);
  assert.equal(res.L, 112.7);
  assert.equal(res.K, 61.25); // جنب الحلق ÷ 2 + 1
  assert.equal(res.I, 112.7);
  assert.equal(res.J, 61.25);
  assert.equal(res.G, 103.4);
  assert.equal(res.H, 53.45);
  assert.equal(res.E, 29.5);
  assert.equal(res.F, 120);
  assert.equal(res.FF, 115);
  assert.equal(res.D, 127);
  assert.equal(res.A, 110.5);
  assert.equal(res.KL, 159.2);
  assert.equal(res.KW, 129.2);
  assert.equal(res.B, 130.5);
  assert.equal(res.C, 108.5);
  assert.equal(res.AG, 5526.73);
  assert.equal(res.AW, 20800);

  const built = buildResults(state);
  assert.equal(built.data.length, 1);
  assert.equal(built.data[0].neg, false);
  assert.equal(built.areaTotals.find((a) => a.key === "AW")?.totalSqM, 2.08);
});

runTest("النوع 2: شباك 2.5 نظامي (150×120 سم)", () => {
  const state = createDefaultState();
  state.type = "شباك 2.5 نظامي";
  state.unit = "cm";
  state.rows = [{ n: "غرفة", L: "150", W: "120", q: "1" }];

  const cat = createRuntimeCatalog(state);
  const res = compute(cat, state.type, 150, 120);

  assert.equal(res.M, 120.5);
  assert.equal(res.N, 117.4);
  assert.equal(res.L, 113);
  assert.equal(res.K, 58.6);
  assert.equal(res.I, 113);
  assert.equal(res.J, 58.6);
  assert.equal(res.G, 103.7);
  assert.equal(res.H, 52.8);
  assert.equal(res.E, 29.5);
  assert.equal(res.F, 120);
  assert.equal(res.AG, 5475.36);
  assert.equal(res.AW, 20800);
});

runTest("النوع 3: واجهات 2.5 بدون صندوق (150×120 سم)", () => {
  const state = createDefaultState();
  state.type = "واجهات 2.5 بدون صندوق";
  state.unit = "cm";
  state.rows = [{ n: "واجهة", L: "150", W: "120", q: "1" }];

  const cat = createRuntimeCatalog(state);
  const res = compute(cat, state.type, 150, 120);

  assert.equal(res.M, 150);
  assert.equal(res.N, 117.4);
  assert.equal(res.L, 142.2);
  assert.equal(res.K, 61);
  assert.equal(res.I, 142.2);
  assert.equal(res.J, 61);
  assert.equal(res.G, 132.9);
  assert.equal(res.H, 53.2);
  assert.equal(res.E, undefined);
  assert.equal(res.FF, 144.5);
  assert.equal(res.KL, 159.2);
  assert.equal(res.KW, 129.2);
  assert.equal(res.AG, 7070.28);
  assert.equal(res.AW, 20800);
});

runTest("النوع 4: شباك 3 مجاري بدون صندوق (150×120 سم)", () => {
  const state = createDefaultState();
  state.type = "شباك 3 مجاري بدون صندوق";
  state.unit = "cm";
  state.rows = [{ n: "مطبخ", L: "150", W: "120", q: "1" }];

  const cat = createRuntimeCatalog(state);
  const res = compute(cat, state.type, 150, 120);

  assert.equal(res.M, 150);
  assert.equal(res.N, 117.4);
  assert.equal(res.L, 142.2);
  assert.equal(res.K, 76); // جنب الحلق ÷ 2 + 1
  assert.equal(res.I, 142.2);
  assert.equal(res.J, 76);
  assert.equal(res.G, 132.9);
  assert.equal(res.H, 68.2);
  assert.equal(res.E, undefined);
  assert.equal(res.FF, 144.5);
  assert.equal(res.AG, 9063.78);
  assert.equal(res.AW, 20800);
});

runTest("تحويل الوحدات (متر / مم) يعطي نفس المساحات بالمتر المربع", () => {
  const sM = createDefaultState();
  sM.type = "شباك 3 مجاري نظامي";
  sM.unit = "m";
  sM.rows = [{ n: "", L: "1.5", W: "1.2", q: "2" }];
  const rM = buildResults(sM);

  const sMm = createDefaultState();
  sMm.type = "شباك 3 مجاري نظامي";
  sMm.unit = "mm";
  sMm.rows = [{ n: "", L: "1500", W: "1200", q: "2" }];
  const rMm = buildResults(sMm);

  assert.equal(rM.areaTotals.find((a) => a.key === "AW")?.totalSqM, 4.16);
  assert.equal(rMm.areaTotals.find((a) => a.key === "AW")?.totalSqM, 4.16);
  assert.equal(rM.data[0].res.K, 0.6125);
  assert.equal(rMm.data[0].res.K, 612.5);
});

runTest("تمييز التكرارات بدقة (150×120 منفصل عن 120×150) والأرقام العربية والتقريب", () => {
  assert.equal(num("١٥٠٫٥"), 150.5);
  assert.equal(Number.isNaN(num("1e3")), true);
  assert.equal(rndApply(61.25, { s: 0.5, d: "u" }), 61.5);
  assert.equal(rndApply(61.25, { s: 0.5, d: "d" }), 61);

  const state = createDefaultState();
  state.rows = [
    { n: "1", L: "150", W: "120", q: "1" },
    { n: "2", L: "150", W: "120", q: "2" },
    { n: "3", L: "120", W: "150", q: "1" },
  ];
  const res = buildResults(state);
  assert.equal(res.dups.length, 1);
  assert.equal(res.dups[0].cnt, 3);
  assert.equal(res.qtotal, 4);
});

console.log(`\nاكتملت جميع اختبارات خط الأساس للحاسبة بنجاح (${passed}/${passed}).`);
