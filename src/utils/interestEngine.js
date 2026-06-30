// ─────────────────────────────────────────────────────────────────────────
// Loan Interest Calculation Engine
//
// Rules implemented (per spec):
//  1. Interest is calculated in whole CALENDAR MONTHS plus a daily-rate
//     remainder. A "month" completes on (start date + N calendar months
//     − 1 day): e.g. starting 29 June, month 1 completes 28 July. Each
//     completed month is charged the full flat monthly amount
//     (principal × rate%); leftover days beyond the last completed month
//     are charged at the daily rate (monthly amount ÷ 30).
//  2. INCLUSIVE day counting is applied natively at the segment level.
//     Each segment is defined as [startDate, endDate] inclusive. For
//     non-final segments (folds and payments), the next segment starts
//     on the day AFTER the previous segment ends. This creates clean,
//     non-overlapping periods like a bank statement.
//  3. Minimum 15 days interest is a WHOLE-LOAN-level floor: it only ever
//     matters when the entire loan's INCLUSIVE day count is under 15. If
//     so, the shortfall is added to the final segment so the loan's total
//     comes out to exactly 15 days. This also covers the degenerate case
//     of a same-day loan (start = end), which still receives the full
//     15-day minimum.
//  4. Compounding ("after 1 year"): every 12 calendar months (same
//     "+N months − 1 day" rule, from the loan start date or the most
//     recent compounding fold/payment), the interest accrued over that
//     12-month block — always exactly 12 × the monthly amount — is folded
//     into the principal. The new, larger principal is used for every
//     subsequent day's interest.
//  5. Partial payments (Mode 2 / EMI tracker) settle interest accrued up
//     to the payment date, reduce the principal by the payment amount,
//     and restart the 12-month compounding clock from that date.
//
// The engine produces a full chronological "timeline" of every accrual
// segment (fold / payment / final) so the UI can show a complete,
// auditable breakdown. Each segment uses inclusive day counting natively,
// with non-overlapping periods (bank statement style).
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
 * 28 August.
 */
export function monthMark(anchor, n) {
  if (n === 0) return new Date(anchor);
  return addDays(addCalendarMonths(anchor, n), -1);
}

/**
 * Calculate the inclusive days between two dates (including both start and end).
 */
export function inclusiveDaysBetween(d1, d2) {
  return daysBetween(d1, d2) + 1;
}

/**
 * Split an inclusive period [startDate, endDate] into whole calendar months
 * plus a remainder in days.
 * 
 * Examples:
 * - 1 Jun → 30 Jun     = { wholeMonths: 1, remainderDays: 0 }
 * - 29 Jun → 28 Jul    = { wholeMonths: 1, remainderDays: 0 }
 * - 1 Jun → 15 Jun     = { wholeMonths: 0, remainderDays: 15 }
 * - 3 Jul → 5 Jul      = { wholeMonths: 0, remainderDays: 3 }
 * - 1 Jun → 31 May     = { wholeMonths: 12, remainderDays: 0 }
 * - 1 Jun → 15 Jul     = { wholeMonths: 1, remainderDays: 15 }
 * 
 * This matches how banks and pawn brokers typically calculate calendar-month interest.
 */
export function monthsAndRemainderInclusive(startDate, endDate) {
  const start = toMidnight(startDate);
  const end = toMidnight(endDate);
  
  // If start and end are the same day, it's 0 months and 1 day (inclusive)
  if (start.getTime() === end.getTime()) {
    return { wholeMonths: 0, remainderDays: 1 };
  }
  
  // Find the maximum number of whole months we can fit
  let wholeMonths = 0;
  let monthEnd = monthMark(start, 1);
  
  // A month is complete if the month end date is <= the period end date
  while (monthEnd.getTime() <= end.getTime()) {
    wholeMonths++;
    monthEnd = monthMark(start, wholeMonths + 1);
  }
  
  // Calculate the remainder days
  // The remainder starts from the day after the last completed month
  const lastMonthEnd = monthMark(start, wholeMonths);
  const remainderStart = addDays(lastMonthEnd, 1);
  
  // If there are no days remaining, remainderDays is 0
  if (remainderStart.getTime() > end.getTime()) {
    return { wholeMonths, remainderDays: 0 };
  }
  
  // Calculate inclusive days from remainderStart to end
  const remainderDays = inclusiveDaysBetween(remainderStart, end);
  
  // Handle edge case: if remainderDays is 30 or more, it should be a whole month
  // But this shouldn't happen with our monthMark calculation
  if (remainderDays >= 30) {
    // This is a safety net - if we have 30+ days, it means our month calculation was off
    // Just convert it to months
    const extraMonths = Math.floor(remainderDays / 30);
    const extraDays = remainderDays % 30;
    return { 
      wholeMonths: wholeMonths + extraMonths, 
      remainderDays: extraDays 
    };
  }
  
  return { wholeMonths, remainderDays };
}

function buildEntry({ type, segmentStart, segmentEnd, wholeMonths, remainderDays, minApplied, openingPrincipal, ratePercent, paymentAmount }) {
  const monthlyAmount = monthlyInterestAmount(openingPrincipal, ratePercent);
  const dailyAmount = monthlyAmount / 30;
  const interest = monthlyAmount * wholeMonths + dailyAmount * remainderDays;
  const closing = openingPrincipal + interest;
  return {
    type,
    segmentStartDate: new Date(segmentStart),
    segmentEndDate: new Date(segmentEnd),
    rawDays: inclusiveDaysBetween(segmentStart, segmentEnd),
    wholeMonths,
    remainderDays,
    effectiveDays: wholeMonths * 30 + remainderDays,
    minApplied,
    openingPrincipal,
    ratePercent,
    dailyInterestAtStart: dailyAmount,
    monthlyInterestAtStart: monthlyAmount,
    interest,
    amountBeforeAdjustment: closing,
    paymentAmount,
    closingPrincipal: closing,
  };
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

  // Whole-loan-level INCLUSIVE day count (rule #2) and 15-day floor (rule #3).
  const totalChargeableDays = inclusiveDaysBetween(start, end);
  const needsFloor = totalChargeableDays < MIN_DAYS;
  const floorShortfall = needsFloor ? MIN_DAYS - totalChargeableDays : 0;

  // Degenerate same-day loan (start === end): the main loop below can
  // never execute (it requires segmentStart < end), but the floor still
  // applies in full ("even for 1 day, minimum 15 days").
  if (totalChargeableDays === 1) {
    const entry = buildEntry({
      type: "final",
      segmentStart: start,
      segmentEnd: end,
      wholeMonths: 0,
      remainderDays: MIN_DAYS, // 1 inclusive + 14 floor shortfall
      minApplied: true,
      openingPrincipal: origPrincipal,
      ratePercent,
      paymentAmount: 0,
    });
    return {
      timeline: [entry],
      finalPrincipal: entry.closingPrincipal,
      totalInterest: entry.interest,
      totalPaid: 0,
      originalPrincipal: origPrincipal,
      totalDaysRaw: totalChargeableDays,
      startDate: start,
      endDate: end,
    };
  }

  const sortedPayments = [...payments]
    .filter((p) => p && p.date && Number(p.amount) > 0)
    .map((p) => ({ date: toMidnight(p.date), amount: Number(p.amount) }))
    .sort((a, b) => a.date - b.date);

  let currentPrincipal = origPrincipal;
  let segmentStart = start;
  let yearAnchor = start; // resets on a compounding fold AND on a payment
  let paymentIdx = 0;

  const timeline = [];
  let totalInterest = 0;
  let totalPaid = 0;
  let safety = 0;

  while (segmentStart <= end && safety < 5000) {
    safety++;

    // Simple-interest mode (compounding = false) never produces a fold
    // boundary at all — interest just keeps accruing on whatever the
    // current principal is (which can still drop from payments), all the
    // way through, with no 12-month fold-into-principal step.
    const nextFold = compounding ? monthMark(yearAnchor, YEAR_MONTHS) : null;
    const nextPayment = paymentIdx < sortedPayments.length ? sortedPayments[paymentIdx].date : null;

    // Candidate boundary dates strictly after segmentStart, capped at `end`.
    const candidates = [end];
    if (nextFold && nextFold >= segmentStart && nextFold <= end) candidates.push(nextFold);
    if (nextPayment && nextPayment >= segmentStart && nextPayment <= end) candidates.push(nextPayment);

    const segmentEndMs = Math.min(...candidates.map((d) => d.getTime()));
    const segmentEnd = new Date(segmentEndMs);

    const isFold = !!nextFold && nextFold.getTime() === segmentEndMs;
    const isPayment = !isFold && nextPayment && nextPayment.getTime() === segmentEndMs;
    const isFinal = segmentEnd.getTime() === end.getTime();

    // Calculate whole months and remainder days using inclusive counting
    const { wholeMonths, remainderDays: rawRemainderDays } = monthsAndRemainderInclusive(segmentStart, segmentEnd);
    let remainderDays = rawRemainderDays;
    let minApplied = false;

    if (isFinal && needsFloor) {
      // For final segment, add the floor shortfall if needed
      remainderDays += floorShortfall;
      minApplied = true;
    }

    const entry = buildEntry({
      type: isFold ? "fold" : isPayment ? "payment" : "final",
      segmentStart,
      segmentEnd,
      wholeMonths,
      remainderDays,
      minApplied,
      openingPrincipal: currentPrincipal,
      ratePercent,
      paymentAmount: isPayment ? sortedPayments[paymentIdx].amount : 0,
    });

    totalInterest += entry.interest;

    if (isFold) {
      currentPrincipal = entry.closingPrincipal;
      yearAnchor = addDays(segmentEnd, 1);
      segmentStart = addDays(segmentEnd, 1);
    } else if (isPayment) {
      const pay = sortedPayments[paymentIdx];
      currentPrincipal = entry.closingPrincipal - pay.amount;
      entry.closingPrincipal = currentPrincipal;
      totalPaid += pay.amount;
      segmentStart = addDays(segmentEnd, 1);
      yearAnchor = addDays(segmentEnd, 1);
      paymentIdx++;
    } else {
      currentPrincipal = entry.closingPrincipal;
      segmentStart = addDays(segmentEnd, 1); // For final, this will exceed end and exit loop
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
    totalDaysRaw: totalChargeableDays,
    startDate: start,
    endDate: end,
  };
}
