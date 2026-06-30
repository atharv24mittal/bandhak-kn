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
//  2. INCLUSIVE day counting: both the start date and the end date of the
//     loan are counted as chargeable days (e.g. 3 Jul → 5 Jul = 3 days,
//     2 Jun → 30 Jun = 29 days). To apply this without double-counting at
//     internal boundaries (a payment or compounding fold splitting the
//     loan into multiple segments), the extra "+1 inclusive day" is added
//     ONCE, specifically to the FINAL segment of the whole loan — and
//     only when that final segment hasn't completed any whole month
//     (wholeMonths === 0), since a completed month already accounts for
//     its own boundary via the "−1 day" in its definition. Every other
//     (non-final) segment uses the plain day-difference between its own
//     boundaries, since the boundary date itself is correctly "owned" by
//     whichever side needs it, with no day double-billed.
//  3. Minimum 15 days interest is a WHOLE-LOAN-level floor: it only ever
//     matters when the entire loan's INCLUSIVE day count is under 15. If
//     so, the shortfall is added to the final segment (on top of rule #2's
//     adjustment) so the loan's total comes out to exactly 15 days. This
//     also covers the degenerate case of a same-day loan (start = end),
//     which still receives the full 15-day minimum.
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
// auditable breakdown. Note: each entry's `segmentStartDate` is the exact
// internal boundary date used for calculation (shared with the previous
// entry's `segmentEndDate`); the UI displays this shifted by +1 day for
// any non-first entry, purely so consecutive rows don't show the same
// calendar date twice — this is a display-only adjustment and does not
// affect the math (see BreakdownTable.jsx).
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

function buildEntry({ type, segmentStart, nextDate, wholeMonths, remainderDays, minApplied, openingPrincipal, ratePercent, paymentAmount }) {
  const monthlyAmount = monthlyInterestAmount(openingPrincipal, ratePercent);
  const dailyAmount = monthlyAmount / 30;
  const interest = monthlyAmount * wholeMonths + dailyAmount * remainderDays;
  const closing = openingPrincipal + interest;
  return {
    type,
    segmentStartDate: new Date(segmentStart),
    segmentEndDate: new Date(nextDate),
    rawDays: daysBetween(segmentStart, nextDate),
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
  const totalDaysExclusive = daysBetween(start, end);
  const totalChargeableDays = totalDaysExclusive + 1;
  const needsFloor = totalChargeableDays < MIN_DAYS;
  const floorShortfall = needsFloor ? MIN_DAYS - totalChargeableDays : 0;

  // Degenerate same-day loan (start === end): the main loop below can
  // never execute (it requires segmentStart < end), but the floor still
  // applies in full ("even for 1 day, minimum 15 days").
  if (totalDaysExclusive === 0) {
    const entry = buildEntry({
      type: "final",
      segmentStart: start,
      nextDate: end,
      wholeMonths: 0,
      remainderDays: MIN_DAYS, // 0 raw + 1 inclusive + 14 floor shortfall
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

    // Calculation basis: whole calendar months (at the flat monthly
    // amount) plus a daily-rate remainder. A fold segment always comes
    // out to exactly { wholeMonths: 12, remainderDays: 0 } by
    // construction, since nextFold IS monthMark(yearAnchor, 12).
    const { wholeMonths, remainderDays: rawRemainderDays } = monthsAndRemainder(segmentStart, nextDate);
    let remainderDays = rawRemainderDays;
    let minApplied = false;

    if (isFinal) {
      // Rule #2: the loan's actual final day is fully chargeable, but only
      // add it here if no whole month has already absorbed that boundary.
      if (wholeMonths === 0) {
        remainderDays += 1;
      }
      // Rule #3: the whole-loan 15-day floor, applied on top of rule #2.
      if (needsFloor) {
        remainderDays += floorShortfall;
        minApplied = true;
      }
    }

    const entry = buildEntry({
      type: isFold ? "fold" : isPayment ? "payment" : "final",
      segmentStart,
      nextDate,
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
      yearAnchor = nextDate;
      segmentStart = nextDate;
    } else if (isPayment) {
      const pay = sortedPayments[paymentIdx];
      currentPrincipal = entry.closingPrincipal - pay.amount;
      entry.closingPrincipal = currentPrincipal;
      totalPaid += pay.amount;
      segmentStart = nextDate;
      yearAnchor = nextDate; // compounding clock restarts from this payment date
      paymentIdx++;
    } else {
      currentPrincipal = entry.closingPrincipal;
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
    totalDaysRaw: totalChargeableDays,
    startDate: start,
    endDate: end,
  };
}
