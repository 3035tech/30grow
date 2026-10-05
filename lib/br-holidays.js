/**
 * Brazilian national holidays (pure, no DB): shared by the time clock calendar
 * and the pilot support response deadline.
 */

import { addDaysIso } from './people/time-day-summary.js';

/** Anonymous Gregorian algorithm. */
export function easterSunday(year) {
  const a = year % 19;
  const b = Math.floor(year / 100);
  const c = year % 100;
  const d = Math.floor(b / 4);
  const e = b % 4;
  const f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4);
  const k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451);
  const month = Math.floor((h + l - 7 * m + 114) / 31);
  const day = ((h + l - 7 * m + 114) % 31) + 1;
  return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

/** Brazilian national holidays of a year (Lei 662/1949, 6.802/1980, 14.759/2023) + Good Friday. */
export function nationalHolidays(year) {
  const y = Number(year);
  const list = [
    ['01-01', 'Confraternização Universal'],
    ['04-21', 'Tiradentes'],
    ['05-01', 'Dia do Trabalho'],
    ['09-07', 'Independência do Brasil'],
    ['10-12', 'Nossa Senhora Aparecida'],
    ['11-02', 'Finados'],
    ['11-15', 'Proclamação da República'],
    ['12-25', 'Natal'],
  ];
  if (y >= 2024) list.push(['11-20', 'Dia Nacional de Zumbi e da Consciência Negra']);
  const items = list.map(([md, name]) => ({ day: `${y}-${md}`, name }));
  items.push({ day: addDaysIso(easterSunday(y), -2), name: 'Sexta-feira Santa' });
  return items.sort((a, b) => a.day.localeCompare(b.day));
}

const dayCache = new Map();

/** @param {string} isoDay YYYY-MM-DD */
export function isNationalHoliday(isoDay) {
  const year = Number(String(isoDay).slice(0, 4));
  if (!Number.isFinite(year)) return false;
  let days = dayCache.get(year);
  if (!days) {
    days = new Set(nationalHolidays(year).map((h) => h.day));
    dayCache.set(year, days);
  }
  return days.has(isoDay);
}
