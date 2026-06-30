export const en = {
  appName: "Hisaab Khata",
  appTagline: "Loan Interest Ledger",

  modeTab1: "Date Range",
  modeTab2: "EMI / Partial Payments",

  // ── Shared form fields ──
  principalLabel: "Principal Amount",
  principalPlaceholder: "e.g. 10000",
  rateLabel: "Interest Rate (per month)",
  rateDefault: "2.25% (default)",
  rateAlt: "1.75%",
  rateManual: "Other",
  rateManualPlaceholder: "Enter rate %",
  rateSimple: "Simple Interest (1.75%)",
  rateSimpleHint: "Simple interest only — does not compound after 1 year",
  perMonth: "month",
  startDateLabel: "Start Date",
  endDateLabel: "End Date",
  asOfDateLabel: "Calculate As Of",
  selected: "Selected",
  calculateBtn: "Calculate",
  recalculate: "Recalculate",

  // ── Mode 2 specific ──
  paymentsHeading: "Partial Payments Received",
  paymentDateLabel: "Payment Date",
  paymentAmountLabel: "Amount Paid",
  addPayment: "+ Add Payment",
  removePayment: "Remove",
  noPayments: "No partial payments added yet. Add one below, or leave empty to just track running interest.",

  // ── Results ──
  resultsHeading: "Result",
  totalAmountPayable: "Total Amount Payable",
  outstandingAmount: "Outstanding Amount (as of selected date)",
  totalInterest: "Total Interest",
  totalDays: "Total Days",
  totalPaidSoFar: "Total Paid So Far",
  originalPrincipal: "Original Principal",
  minDaysNote: "Minimum 15-day interest rule applied",
  simpleInterestNote: "Simple interest mode — no yearly compounding applied",
  daysShort: "days",
  monthsShort: "months",

  breakdownHeading: "Full Breakdown (review every segment)",
  colPeriod: "Period",
  colDays: "Days",
  colOpeningPrincipal: "Opening Principal",
  colDailyInterest: "Daily Interest",
  colInterest: "Interest",
  colEvent: "Event",
  colClosing: "Closing Balance",
  eventFold: "1-Year Compounding",
  eventPayment: "Payment Received",
  eventFinal: "Final / As-of Date",
  yearEndLabel: "End of Year",
  foldExplain: "Interest of this period added to principal (compounding)",
  paymentExplain: "paid — deducted from balance",

  // ── Info / help ──
  howItWorksTitle: "How this is calculated",
  howItWorksBody:
    "Interest is calculated in whole calendar months, plus a daily rate for any leftover days. A \"month\" runs from the start (or last payment/compounding) date up to one day before the same date next month — e.g. starting 29 June, month 1 completes 28 July. Each completed month is charged the full flat monthly amount (Principal × Rate); leftover days beyond that are charged at the monthly amount ÷ 30 per day. The minimum-15-day rule only matters if the whole loan period is under 15 days in total — in that case the entire loan is charged for 15 days. By default, every 12 such calendar months, the interest earned in that block is added to the principal (compounding) — choosing the \"Simple Interest\" rate option turns this off, so interest is always calculated on the same principal (minus any payments) with no compounding, no matter how long the loan runs. In the EMI tracker, each payment first settles interest accrued so far, then reduces the principal — and (when compounding is on) restarts the 12-month compounding clock from that payment date. The \"Total Days\" figure shown in the results counts both the start and end date as part of the loan period.",

  errEndBeforeStart: "End date must be on or after the start date.",
  errInvalidPrincipal: "Please enter a valid principal amount greater than 0.",
  errInvalidRate: "Please enter a valid interest rate greater than 0.",
  errInvalidDates: "Please select both a start and an end date.",
  errPaymentDateRange: "Payment dates must fall between the start date and the as-of date.",

  footerNote: "All calculations happen in your browser — nothing is uploaded anywhere.",
  languageToggle: "हिंदी",
};
