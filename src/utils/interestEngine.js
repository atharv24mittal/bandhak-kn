// ─────────────────────────────────────────────────────────────────────────
// Loan Interest Calculation Engine
//
// Rules implemented (per spec):
//  1. Interest is calculated in whole CALENDAR MONTHS plus a daily-rate
//     remainder — not by simply prorating a daily rate over every elapsed
//     day. A "month" completes on (start date + N calendar months − 1
//     day): e.g. starting 29 June, month 1 completes 28 July, month 2
//     completes 28 August. Each completed month is charged the full flat
//     monthly amount (principal × rate%); any leftover days beyond the
//     last completed month are charged at the daily rate
//     (monthly amount ÷ 30). E.g. 29 June → 29 August = "2 months + 1
//     day" = 2×(monthly amount) + 1×(daily rate).
//  2. Minimum 15 days interest is a WHOLE-LOAN-level floor: it only ever
//     matters when the entire loan (start date → final/as-of date) spans
//     under 15 days in total (in which case 0 whole months can ever have
//     completed anyway). If the loan runs 15 days or longer overall, this
//     floor never applies anywhere. When it does apply, it's applied once,
//     by padding the final segment's day count up to 15.
//  3. Compounding ("after 1 year"): every 12 calendar months (using the
//     same "+N months − 1 day" rule, from the loan start date or the most
//     recent compounding fold/payment), the interest accrued over that
//     12-month block — always exactly 12 × the monthly amount, with zero
//     remainder by construction — is folded into the principal. The new,
//     larger principal is used for every subsequent day's interest.
//  4. Partial payments (Mode 2 / EMI tracker) settle interest accrued up
//     to the payment date (using the same month+remainder rule), reduce
//     the principal by the payment amount, and restart the 12-month
//     compounding clock from that date.
//  5. "Total Days" (returned for display only) is INCLUSIVE of both the
//     start and end date (e.g. 3 Jul → 5 Jul = 3 days), since both
//     endpoints are considered part of the loan period. This is purely a
//     display figure — it is never used in any interest calculation.
//
// The engine produces a full chronological "timeline" of every accrual
// segment (fold / payment / final) so the UI can show a complete,
// auditable breakdown.
// ─────────────────────────────────────────────────────────────────────────

export const MIN_DAYS = 15;
export const YEAR_MONTHS = 12;
const DAY_MS = 24 * 60 * 60 * 1000;

/** Normalize any Date/string to a UTC-midnight Date (avoids DST/timezone drift). */
export function toMidnight(d) {
  const x = new Date(d);
  const norm = new Date(Date.UTC(x.getFullYear(), x.getMonth(), x.getDate()));
  return norm;
}

export function addDays(date, days) {
  const d = new Date(date);
  d.setUTCDate(d.getUTCDate() + days);
  return d;
}

export function daysBetween(d1, d2) {
  return Math.round((d2.getTime() - d1.getTime()) / DAY_MS);
}

/** Daily interest amount for a given principal & monthly rate (%). */
export function dailyInterestAmount(principal, ratePercent) {
  return (principal * ratePercent) / 100 / 30;
}

/** Flat monthly interest amount for a given principal & monthly rate (%). */
export function monthlyInterestAmount(principal, ratePercent) {
  return (principal * ratePercent) / 100;
}

function lastDayOfUTCMonth(year, monthIndex) {
  // Day 0 of "next month" is the last day of the target month.
  return new Date(Date.UTC(year, monthIndex + 1, 0)).getUTCDate();
}

/**
 * Add N calendar months to a date, clamping the day-of-month if the
 * target month is shorter (e.g. 31 Jan + 1 month → 28/29 Feb, not an
 * overflowed early-March date).
 */
export function addCalendarMonths(date, n) {
  const d = new Date(date);
  const day = d.getUTCDate();
  const totalMonthIndex = d.getUTCMonth() + n;
  const year = d.getUTCFullYear() + Math.floor(totalMonthIndex / 12);
  const monthIndex = ((totalMonthIndex % 12) + 12) % 12;
  const clampedDay = Math.min(day, lastDayOfUTCMonth(year, monthIndex));
  return new Date(Date.UTC(year, monthIndex, clampedDay));
}

/**
 * The date on which month N (counting from `anchor`) completes.
 * Month 0 is the anchor date itself (0 months elapsed yet).
 * Month N (N >= 1) completes on (anchor + N calendar months − 1 day) —
 * e.g. anchor = 29 June → month 1 completes 28 July, month 2 completes
 * 28 August, month 12 completes the following 28 June (or 27 June across
 * a leap day, exactly mirroring the original "after 2 July" example).
 */
export function monthMark(anchor, n) {
  if (n === 0) return new Date(anchor);
  return addDays(addCalendarMonths(anchor, n), -1);
}

/**
 * Split the span [A, B] into whole calendar months (per monthMark above)
 * plus a leftover remainder in days.
 * @returns {{wholeMonths: number, remainderDays: number}}
 */
export function monthsAndRemainder(A, B) {
  let n = 0;
  while (monthMark(A, n + 1).getTime() <= B.getTime()) {
    n++;
  }
  const mark = monthMark(A, n);
  const remainderDays = daysBetween(mark, B);
  return { wholeMonths: n, remainderDays };
}

/**
 * Run the full simulation.
 *
 * @param {Object} params
 * @param {Date|string} params.startDate
 * @param {Date|string} params.endDate     - "as of" / final date
 * @param {number} params.principal        - original principal
 * @param {number} params.ratePercent       - monthly rate, e.g. 2.25
 * @param {Array<{date:Date|string, amount:number}>} [params.payments] - Mode 2 only
 * @param {boolean} [params.compounding=true] - false = simple interest only,
 *   never folds accrued interest into principal after 12 months.
 *
 * @returns {{
 *   timeline: Array<Object>,
 *   finalPrincipal: number,
 *   totalInterest: number,
 *   totalPaid: number,
 *   originalPrincipal: number,
 *   totalDaysRaw: number,
 *   startDate: Date,
 *   endDate: Date,
 * }}
 */
export function calculateLoan({ startDate, endDate, principal, ratePercent, payments = [], compounding = true }) {
  const start = toMidnight(startDate);
  const end = toMidnight(endDate);
  const origPrincipal = Number(principal);

  if (end < start) {
    throw new Error("END_BEFORE_START");
  }

  const sortedPayments = [...payments]
    .filter((p) => p && p.date && Number(p.amount) > 0)
    .map((p) => ({ date: toMidnight(p.date), amount: Number(p.amount) }))
    .sort((a, b) => a.date - b.date);

  // Whole-loan-level 15-day floor check. Uses the plain exclusive day
  // difference internally (never the inclusive display figure below) so
  // every interest calculation stays exact and self-consistent.
  const totalDaysExclusive = daysBetween(start, end);
  const needsFloor = totalDaysExclusive > 0 && totalDaysExclusive < MIN_DAYS;
  const floorShortfall = needsFloor ? MIN_DAYS - totalDaysExclusive : 0;

  let currentPrincipal = origPrincipal;
  let segmentStart = start;
  let yearAnchor = start; // resets on a compounding fold AND on a payment
  let paymentIdx = 0;

  const timeline = [];
  let totalInterest = 0;
  let totalPaid = 0;
  let safety = 0;

  while (segmentStart < end && safety < 5000) {
    safety++;

    // Simple-interest mode (compounding = false) never produces a fold
    // boundary at all — interest just keeps accruing on whatever the
    // current principal is (which can still drop from payments), all the
    // way through, with no 12-month fold-into-principal step.
    const nextFold = compounding ? monthMark(yearAnchor, YEAR_MONTHS) : null;
    const nextPayment = paymentIdx < sortedPayments.length ? sortedPayments[paymentIdx].date : null;

    // Candidate boundary dates strictly after segmentStart, capped at `end`.
    const candidates = [end];
    if (nextFold && nextFold > segmentStart && nextFold < end) candidates.push(nextFold);
    if (nextPayment && nextPayment > segmentStart && nextPayment <= end) candidates.push(nextPayment);

    const nextDateMs = Math.min(...candidates.map((d) => d.getTime()));
    const nextDate = new Date(nextDateMs);

    const isFold = !!nextFold && nextFold.getTime() === nextDateMs;
    const isPayment = !isFold && nextPayment && nextPayment.getTime() === nextDateMs;
    const isFinal = nextDate.getTime() === end.getTime();

    const rawDays = daysBetween(segmentStart, nextDate);

    // Calculation basis: whole calendar months (at the flat monthly
    // amount) plus a daily-rate remainder. A fold segment always comes
    // out to exactly { wholeMonths: 12, remainderDays: 0 } by
    // construction, since nextFold IS monthMark(yearAnchor, 12).
    const { wholeMonths, remainderDays: rawRemainderDays } = monthsAndRemainder(segmentStart, nextDate);
    let remainderDays = rawRemainderDays;
    let minApplied = false;

    // The 15-day floor, if it applies at all (whole loan < 15 days), is
    // added entirely to the FINAL segment's remainder so the loan's total
    // comes out to exactly 15 days. (wholeMonths is guaranteed 0 here,
    // since under-15-days can never contain a completed month.)
    if (needsFloor && isFinal) {
      remainderDays = rawRemainderDays + floorShortfall;
      minApplied = true;
    }

    const monthlyAmount = monthlyInterestAmount(currentPrincipal, ratePercent);
    const dailyAmount = monthlyAmount / 30;
    const interest = monthlyAmount * wholeMonths + dailyAmount * remainderDays;
    const effectiveDays = wholeMonths * 30 + remainderDays; // days-equivalent actually charged

    const openingPrincipal = currentPrincipal;
    const closingBeforeAdjustment = openingPrincipal + interest;

    let type = "final";
    if (isFold) type = "fold";
    else if (isPayment) type = "payment";

    const entry = {
      type, // 'fold' | 'payment' | 'final'
      segmentStartDate: new Date(segmentStart),
      segmentEndDate: new Date(nextDate),
      rawDays, // true calendar days elapsed in this segment
      wholeMonths,
      remainderDays,
      effectiveDays, // wholeMonths*30 + remainderDays (the calculation basis, as a days-equivalent)
      minApplied,
      openingPrincipal,
      ratePercent,
      dailyInterestAtStart: dailyAmount,
      monthlyInterestAtStart: monthlyAmount,
      interest,
      amountBeforeAdjustment: closingBeforeAdjustment,
      paymentAmount: isPayment ? sortedPayments[paymentIdx].amount : 0,
      closingPrincipal: closingBeforeAdjustment,
    };

    totalInterest += interest;

    if (isFold) {
      currentPrincipal = closingBeforeAdjustment;
      entry.closingPrincipal = currentPrincipal;
      yearAnchor = nextDate;
      segmentStart = nextDate;
    } else if (isPayment) {
      const pay = sortedPayments[paymentIdx];
      currentPrincipal = closingBeforeAdjustment - pay.amount;
      entry.closingPrincipal = currentPrincipal;
      totalPaid += pay.amount;
      segmentStart = nextDate;
      yearAnchor = nextDate; // compounding clock restarts from this payment date
      paymentIdx++;
    } else {
      // final boundary
      currentPrincipal = closingBeforeAdjustment;
      entry.closingPrincipal = currentPrincipal;
      segmentStart = nextDate;
    }

    timeline.push(entry);

    if (isFinal) break;
  }

  return {
    timeline,
    finalPrincipal: currentPrincipal,
    totalInterest,
    totalPaid,
    originalPrincipal: origPrincipal,
    // Inclusive of both the start and end date, for display only — never
    // used internally for any interest calculation (see rule #5 above).
    totalDaysRaw: totalDaysExclusive + 1,
    startDate: start,
    endDate: end,
  };
}
