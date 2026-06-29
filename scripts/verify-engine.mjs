// Quick standalone verification against the user's exact worked examples.
// Run with: node --experimental-vm-modules verify.mjs   (or just node verify.mjs since it's plain JS)
import { calculateLoan } from "../src/utils/interestEngine.js";

function approxEqual(a, b, eps = 0.0001) {
  return Math.abs(a - b) < eps;
}

function check(label, actual, expected) {
  const ok = approxEqual(actual, expected);
  console.log(`${ok ? "PASS" : "FAIL"}  ${label}: got ${actual}, expected ${expected}`);
  if (!ok) process.exitCode = 1;
}

console.log("=== Example A: 10,000 @ 2.25%, 20 days (no min-15 trigger) ===");
{
  const r = calculateLoan({
    startDate: "2026-01-01",
    endDate: "2026-01-21", // 20 days later
    principal: 10000,
    ratePercent: 2.25,
  });
  check("totalInterest", round(r.totalInterest), 150);
  check("finalPrincipal", round(r.finalPrincipal), 10150);
}

console.log("\n=== Example B: min-15-day rule, 3rd Jul 2026 -> 5th Jul 2026 ===");
{
  const r = calculateLoan({
    startDate: "2026-07-03",
    endDate: "2026-07-05", // raw diff = 2 days, should bump to 15
    principal: 10000,
    ratePercent: 2.25,
  });
  console.log("rawDays in timeline:", r.timeline[0].rawDays, "effectiveDays:", r.timeline[0].effectiveDays);
  check("effectiveDays", r.timeline[0].effectiveDays, 15);
  check("interest (15 days @ 7.5/day)", round(r.totalInterest), 112.5);
}

console.log("\n=== Example C: Compound interest, 3rd Jul 2023 -> 5th Jul 2026 ===");
{
  const r = calculateLoan({
    startDate: "2023-07-03",
    endDate: "2026-07-05",
    principal: 10000,
    ratePercent: 2.25,
  });
  const folds = r.timeline.filter((t) => t.type === "fold");
  console.log(
    "Fold dates & resulting principal:",
    folds.map((f) => `${f.segmentEndDate.toISOString().slice(0, 10)} -> ${round(f.closingPrincipal)}`)
  );
  check("Fold #1 date is 2024-07-02", folds[0].segmentEndDate.toISOString().slice(0, 10) === "2024-07-02" ? 1 : 0, 1);
  check("Principal after fold #1", round(folds[0].closingPrincipal), 12737.5);
  check("Daily interest right after fold #1", round6(dailyAfterFold(folds[0].closingPrincipal)), 9.553125);
}

console.log("\n=== Example D: EMI tracker, 10,000 @ 2.25%, pay 5000 after 31 days, then +35 days ===");
{
  const r = calculateLoan({
    startDate: "2026-01-01",
    endDate: "2026-01-01" /* placeholder, replaced below */,
    principal: 10000,
    ratePercent: 2.25,
    payments: [{ date: "2026-02-01", amount: 5000 }], // 31 days after 2026-01-01
  });
}
{
  const start = "2026-01-01";
  const payDate = addDaysStr(start, 31); // 2026-02-01
  const endDate = addDaysStr(payDate, 35); // 35 days after the payment
  const r = calculateLoan({
    startDate: start,
    endDate,
    principal: 10000,
    ratePercent: 2.25,
    payments: [{ date: payDate, amount: 5000 }],
  });
  const seg1 = r.timeline[0];
  const seg2 = r.timeline[1];
  console.log("Segment 1 (31 days):", { days: seg1.rawDays, interest: round(seg1.interest), amountBefore: round(seg1.amountBeforeAdjustment), closing: round(seg1.closingPrincipal) });
  console.log("Segment 2 (35 days):", { days: seg2.rawDays, dailyAtStart: round6(seg2.dailyInterestAtStart), interest: round6(seg2.interest), closing: round6(seg2.closingPrincipal) });

  check("Seg1 days", seg1.rawDays, 31);
  check("Seg1 interest", round(seg1.interest), 232.5);
  check("Seg1 amountBeforeAdjustment (before payment)", round(seg1.amountBeforeAdjustment), 10232.5);
  check("Seg1 closing principal (after -5000)", round(seg1.closingPrincipal), 5232.5);
  check("Seg2 daily interest at start", round6(seg2.dailyInterestAtStart), 3.926625);
  check("Seg2 interest (35 days)", round6(seg2.interest), 137.431875);
  check("Seg2 closing principal (no further payment)", round6(seg2.closingPrincipal), 5369.931875);
}

console.log("\n=== Example E: same as D, but next payment after 378 days -> compounding kicks in mid-segment ===");
{
  const start = "2026-01-01";
  const payDate1 = addDaysStr(start, 31);
  const payDate2 = addDaysStr(payDate1, 378);
  const r = calculateLoan({
    startDate: start,
    endDate: payDate2,
    principal: 10000,
    ratePercent: 2.25,
    payments: [
      { date: payDate1, amount: 5000 },
      { date: payDate2, amount: 1 }, // tiny payment just to force a boundary at payDate2 for inspection
    ],
  });
  console.log(
    "Timeline types/dates:",
    r.timeline.map((t) => `${t.type}@${t.segmentEndDate.toISOString().slice(0, 10)} (days=${t.rawDays})`)
  );
  const foldEntry = r.timeline.find((t) => t.type === "fold");
  check("A fold occurs within the 378-day second segment", foldEntry ? 1 : 0, 1);
}

function round(n) {
  return Math.round(n * 100) / 100;
}
function round6(n) {
  return Math.round(n * 1e6) / 1e6;
}
function dailyAfterFold(principal) {
  return (principal * 2.25) / 100 / 30;
}
function addDaysStr(dateStr, days) {
  const d = new Date(dateStr + "T00:00:00Z");
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

console.log("\n=== Example F: regression test for the 'fold then quick payment' bug ===");
{
  // Matches the user's reported screenshot: start 21 Jul 2020, pay 1000
  // after 335 days (21 Jun 2021), then a fold lands at 21 Jun 2022 (365
  // days later), then a payment of 2000 just 1 day after that fold.
  // The 1-day post-fold sliver must NOT be padded to 15 days, because the
  // real gap since the last actual payment (21 Jun 2021) is 366 days.
  const start = "2020-07-21";
  const pay1 = addDaysStr(start, 335); // 2021-06-21
  const pay2 = addDaysStr(pay1, 366); // 2022-06-22 (365-day fold + 1 real day)
  const r = calculateLoan({
    startDate: start,
    endDate: pay2,
    principal: 10000,
    ratePercent: 2.25,
    payments: [
      { date: pay1, amount: 1000 },
      { date: pay2, amount: 2000 },
    ],
  });
  console.log(
    "Timeline:",
    r.timeline.map((t) => `${t.type} ${t.segmentEndDate.toISOString().slice(0, 10)} rawDays=${t.rawDays} effDays=${t.effectiveDays} minApplied=${t.minApplied}`)
  );
  const lastPiece = r.timeline[r.timeline.length - 1];
  check("Final piece (post-fold sliver) rawDays", lastPiece.rawDays, 1);
  check("Final piece effectiveDays should be actual 1 day, NOT padded to 15", lastPiece.effectiveDays, 1);
  check("Final piece minApplied should be false", lastPiece.minApplied ? 1 : 0, 0);
}

console.log("\n=== Example G: a short gap right after a payment is NOT padded when the OVERALL loan is long ===");
{
  // Corrected understanding: the 15-day floor is a whole-loan-level check.
  // Here the overall loan (start -> end) is 105 days, well over 15, so the
  // final 5-day gap after the payment must NOT be padded — it's charged
  // for its actual 5 days, even though that particular gap is short.
  const start = "2026-01-01";
  const pay1 = addDaysStr(start, 100);
  const end = addDaysStr(pay1, 5); // overall loan = 105 days total
  const r = calculateLoan({
    startDate: start,
    endDate: end,
    principal: 10000,
    ratePercent: 2.25,
    payments: [{ date: pay1, amount: 3000 }],
  });
  const lastPiece = r.timeline[r.timeline.length - 1];
  check("Final gap (5 raw days) NOT padded since overall loan is 105 days", lastPiece.effectiveDays, 5);
  check("minApplied false since overall loan >= 15 days", lastPiece.minApplied ? 1 : 0, 0);
}

console.log("\n=== Example I: user's exact 3-payment screenshot scenario ===");
{
  // start 21 Jul 2020; pay 1000 on 28 Jul 2020 (7 raw days in);
  // fold lands 28 Jul 2021; pay 1000 on 30 Jul 2021 (2 days after fold);
  // pay 1000 on 31 Jul 2021 (1 day after that). Overall loan is 2,168
  // days (>>15), so NEITHER the 7-day nor the 1-day gap should be padded.
  const start = "2020-07-21";
  const pay1 = "2020-07-28";
  const pay2 = "2021-07-30";
  const pay3 = "2021-07-31";
  const end = addDaysStr(start, 2168);
  const r = calculateLoan({
    startDate: start,
    endDate: end,
    principal: 10000,
    ratePercent: 2.25,
    payments: [
      { date: pay1, amount: 1000 },
      { date: pay2, amount: 1000 },
      { date: pay3, amount: 1000 },
    ],
  });
  console.log(
    "Timeline:",
    r.timeline.map((t) => `${t.type} ${t.segmentEndDate.toISOString().slice(0, 10)} rawDays=${t.rawDays} effDays=${t.effectiveDays} minApplied=${t.minApplied}`)
  );
  const seg1 = r.timeline[0]; // start -> pay1, raw 7 days
  const seg4 = r.timeline[3]; // post-fold -> pay3, raw 1 day
  check("Segment 1 (7 raw days) NOT padded", seg1.effectiveDays, 7);
  check("Segment 1 minApplied false", seg1.minApplied ? 1 : 0, 0);
  check("Segment 4 (1 raw day, right after a fold) NOT padded", seg4.effectiveDays, 1);
  check("Segment 4 minApplied false", seg4.minApplied ? 1 : 0, 0);
}

console.log("\n=== Example H: Mode 1 (no payments), trailing remainder after folds is NOT padded ===");
{
  // Same as Example C (3yr+3days) but now checking the final 3-day stub:
  // the real gap since loan start is 1098 days overall (>>15), so the
  // trailing 3-day remainder after the 3rd fold should charge actual 3
  // days, not be padded to 15.
  const r = calculateLoan({
    startDate: "2023-07-03",
    endDate: "2026-07-05",
    principal: 10000,
    ratePercent: 2.25,
  });
  const lastPiece = r.timeline[r.timeline.length - 1];
  console.log("Mode 1 final piece:", { rawDays: lastPiece.rawDays, effectiveDays: lastPiece.effectiveDays, minApplied: lastPiece.minApplied, interest: round(lastPiece.interest) });
  check("Mode 1 trailing remainder rawDays", lastPiece.rawDays, 3);
  check("Mode 1 trailing remainder effectiveDays now actual (not padded)", lastPiece.effectiveDays, 3);
}

console.log("\n=== Example J: Simple Interest mode (compounding=false) ===");
{
  // Same 3-year span as Example C/H, but with compounding disabled. There
  // should be ZERO 'fold' entries, and the interest should be flat simple
  // interest on the ORIGINAL principal for the entire span: 10000 * 1.75%
  // * totalDays / 30.
  const r = calculateLoan({
    startDate: "2023-07-03",
    endDate: "2026-07-05",
    principal: 10000,
    ratePercent: 1.75,
    compounding: false,
  });
  const folds = r.timeline.filter((t) => t.type === "fold");
  check("No fold entries when compounding is disabled", folds.length, 0);
  check("Single timeline entry (no payments, no folds)", r.timeline.length, 1);
  const expectedInterest = 10000 * (1.75 / 100) * (r.totalDaysRaw / 30);
  check("Simple interest matches flat formula on original principal", round6(r.totalInterest), round6(expectedInterest));
  check("Final principal = original + simple interest (no compounding growth)", round(r.finalPrincipal), round(10000 + expectedInterest));

  // With a partial payment thrown in, principal still drops normally, and
  // interest after the payment is simple (on the reduced principal), but
  // still never folds even past the 365-day mark.
  const r2 = calculateLoan({
    startDate: "2023-07-03",
    endDate: "2026-07-05",
    principal: 10000,
    ratePercent: 1.75,
    compounding: false,
    payments: [{ date: "2024-01-01", amount: 3000 }],
  });
  const folds2 = r2.timeline.filter((t) => t.type === "fold");
  check("No folds even with a payment crossing the 365-day mark", folds2.length, 0);
  check("Exactly one payment entry + one final entry", r2.timeline.length, 2);
}
