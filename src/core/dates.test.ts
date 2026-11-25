import { describe, expect, it } from 'vitest';
import { addDays, addMonths, daysBetween, lastDayOfMonth, monthName, monthOf, shiftMonths, toSaoPauloDate } from './dates';

describe('dates', () => {
  it('extracts the month of a date', () => {
    expect(monthOf('2026-10-14')).toBe('2026-10');
  });

  it('adds months across year boundaries', () => {
    expect(addMonths('2026-11', 3)).toBe('2027-02');
    expect(addMonths('2026-01', -1)).toBe('2025-12');
    expect(addMonths('2026-10', 0)).toBe('2026-10');
    expect(addMonths('2026-10', -12)).toBe('2025-10');
  });

  it('shifts a date by whole months, keeping the day when it exists', () => {
    expect(shiftMonths('2025-11-29', 10)).toBe('2026-09-29');
    expect(shiftMonths('2026-01-31', 1)).toBe('2026-02-28');
    expect(shiftMonths('2026-10-15', 0)).toBe('2026-10-15');
  });

  it('adds days across month boundaries', () => {
    expect(addDays('2026-10-30', 3)).toBe('2026-11-02');
    expect(addDays('2026-03-01', -1)).toBe('2026-02-28');
  });

  it('counts days between two dates', () => {
    expect(daysBetween('2026-10-01', '2026-10-04')).toBe(3);
    expect(daysBetween('2026-10-04', '2026-10-01')).toBe(-3);
  });

  it('finds the last day of a month', () => {
    expect(lastDayOfMonth('2026-02')).toBe('2026-02-28');
    expect(lastDayOfMonth('2028-02')).toBe('2028-02-29');
    expect(lastDayOfMonth('2026-12')).toBe('2026-12-31');
  });

  it('converts an instant to the São Paulo calendar date', () => {
    expect(toSaoPauloDate(new Date('2026-10-15T02:30:00Z'))).toBe('2026-10-14');
    expect(toSaoPauloDate(new Date('2026-10-15T03:00:00Z'))).toBe('2026-10-15');
  });

  it('names a month in Portuguese', () => {
    expect(monthName('2026-10')).toBe('outubro de 2026');
    expect(monthName('2027-03')).toBe('março de 2027');
  });
});
