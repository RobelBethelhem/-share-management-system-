/**
 * Gregorian to Ethiopian Calendar Converter
 *
 * The Ethiopian calendar has 13 months: 12 months of 30 days each
 * and Pagume (13th month) with 5 days (6 in a leap year).
 *
 * Ethiopian New Year (Meskerem 1) falls on:
 *   - September 11 (most years)
 *   - September 12 (when the previous Ethiopian year was a leap year)
 *
 * Ethiopian leap year: ethYear % 4 === 3
 */

const ETH_MONTHS = [
  'Meskerem',  // 1  (መስከረም)
  'Tikimt',    // 2  (ጥቅምት)
  'Hidar',     // 3  (ኅዳር)
  'Tahsas',    // 4  (ታኅሣሥ)
  'Tir',       // 5  (ጥር)
  'Yekatit',   // 6  (የካቲት)
  'Megabit',   // 7  (መጋቢት)
  'Miyazya',   // 8  (ሚያዝያ)
  'Ginbot',    // 9  (ግንቦት)
  'Sene',      // 10 (ሰኔ)
  'Hamle',     // 11 (ሐምሌ)
  'Nehase',    // 12 (ነሐሴ)
  'Pagume',    // 13 (ጳጉሜ)
];

const ETH_MONTHS_AMHARIC = [
  'መስከረም', 'ጥቅምት', 'ኅዳር', 'ታኅሣሥ', 'ጥር', 'የካቲት',
  'መጋቢት', 'ሚያዝያ', 'ግንቦት', 'ሰኔ', 'ሐምሌ', 'ነሐሴ', 'ጳጉሜ',
];

/**
 * Determine the Gregorian date of Ethiopian New Year (Meskerem 1)
 * for a given Ethiopian year.
 *
 * Meskerem 1 of Ethiopian year Y falls on September 12
 * if the previous Ethiopian year (Y-1) was a leap year,
 * i.e., (Y-1) % 4 === 3, equivalently Y % 4 === 0.
 */
function getNewYearSeptDay(ethYear) {
  return ethYear % 4 === 0 ? 12 : 11;
}

/**
 * Convert a Gregorian date to Ethiopian date.
 * @param {number} gYear  - Gregorian year
 * @param {number} gMonth - Gregorian month (1-12)
 * @param {number} gDay   - Gregorian day (1-31)
 * @returns {{ year: number, month: number, day: number, monthName: string, monthAmharic: string }}
 */
export function gregorianToEthiopian(gYear, gMonth, gDay) {
  const gDate = new Date(gYear, gMonth - 1, gDay);

  // Ethiopian year that could start in this Gregorian year
  let ethYear = gYear - 7;
  const septDay = getNewYearSeptDay(ethYear);
  const newYear = new Date(gYear, 8, septDay); // September

  let startDate;
  if (gDate >= newYear) {
    startDate = newYear;
  } else {
    ethYear = gYear - 8;
    startDate = new Date(gYear - 1, 8, getNewYearSeptDay(ethYear));
  }

  const diffDays = Math.round((gDate - startDate) / (1000 * 60 * 60 * 24));

  const ethMonth = Math.floor(diffDays / 30) + 1;
  const ethDay = (diffDays % 30) + 1;

  return {
    year: ethYear,
    month: ethMonth,
    day: ethDay,
    monthName: ETH_MONTHS[ethMonth - 1] || 'Pagume',
    monthAmharic: ETH_MONTHS_AMHARIC[ethMonth - 1] || 'ጳጉሜ',
  };
}

/**
 * Format Ethiopian date as "YYYY/MM/DD"
 */
export function formatEthiopianDate(gYear, gMonth, gDay) {
  const eth = gregorianToEthiopian(gYear, gMonth, gDay);
  const mm = String(eth.month).padStart(2, '0');
  const dd = String(eth.day).padStart(2, '0');
  return `${eth.year}/${mm}/${dd}`;
}

/**
 * Format Ethiopian date with month name: "Tahsas 22, 2016"
 */
export function formatEthiopianDateLong(gYear, gMonth, gDay) {
  const eth = gregorianToEthiopian(gYear, gMonth, gDay);
  return `${eth.monthName} ${eth.day}, ${eth.year}`;
}

/**
 * Format Ethiopian date with Amharic month name: "ታኅሣሥ 22, 2016"
 */
export function formatEthiopianDateAmharic(gYear, gMonth, gDay) {
  const eth = gregorianToEthiopian(gYear, gMonth, gDay);
  return `${eth.monthAmharic} ${eth.day}/${eth.year}`;
}

export { ETH_MONTHS, ETH_MONTHS_AMHARIC };
