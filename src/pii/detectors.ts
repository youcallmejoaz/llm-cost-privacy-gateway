import type { PiiType } from '../types.js';

export interface Detector {
  type: PiiType;
  pattern: RegExp;
  /** Extra check on the matched text (checksums, digit counts). */
  validate?: (match: string) => boolean;
}

export function luhnValid(digits: string): boolean {
  let sum = 0;
  let double = false;
  for (let i = digits.length - 1; i >= 0; i--) {
    let d = digits.charCodeAt(i) - 48;
    if (d < 0 || d > 9) return false;
    if (double) {
      d *= 2;
      if (d > 9) d -= 9;
    }
    sum += d;
    double = !double;
  }
  return digits.length > 0 && sum % 10 === 0;
}

export function ibanValid(raw: string): boolean {
  const iban = raw.replace(/\s+/g, '').toUpperCase();
  if (!/^[A-Z]{2}\d{2}[A-Z0-9]{11,30}$/.test(iban)) return false;
  const rearranged = iban.slice(4) + iban.slice(0, 4);
  let remainder = 0;
  for (const ch of rearranged) {
    const code = ch.charCodeAt(0);
    const value = code >= 65 ? String(code - 55) : ch;
    for (const digit of value) remainder = (remainder * 10 + Number(digit)) % 97;
  }
  return remainder === 1;
}

const NI_BANNED_PREFIXES = new Set(['BG', 'GB', 'KN', 'NK', 'NT', 'TN', 'ZZ']);

export function niNumberValid(raw: string): boolean {
  const ni = raw.replace(/\s+/g, '').toUpperCase();
  if (!/^[A-CEGHJ-PR-TW-Z][A-CEGHJ-NPR-TW-Z]\d{6}[A-D]$/.test(ni)) return false;
  return !NI_BANNED_PREFIXES.has(ni.slice(0, 2));
}

function ukPhoneValid(raw: string): boolean {
  const digits = raw.replace(/\D/g, '');
  const national = digits.startsWith('44') && raw.trim().startsWith('+') ? digits.slice(2).replace(/^0/, '') : digits.replace(/^0/, '');
  return national.length >= 9 && national.length <= 10;
}

function intlPhoneValid(raw: string): boolean {
  const digits = raw.replace(/\D/g, '');
  return digits.length >= 8 && digits.length <= 15;
}

/**
 * Order matters: earlier detectors win when matches overlap
 * (an IBAN contains digit runs that could look like a phone number).
 */
export const DETECTORS: Detector[] = [
  { type: 'email', pattern: /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,}\b/g },
  { type: 'iban', pattern: /\b[A-Z]{2}\d{2}(?: ?[A-Z0-9]){11,30}\b/g, validate: ibanValid },
  {
    type: 'card',
    pattern: /(?<!\d)\d(?:[ -]?\d){12,18}(?!\d)/g,
    validate: (m) => {
      const digits = m.replace(/\D/g, '');
      return digits.length >= 13 && digits.length <= 19 && luhnValid(digits);
    },
  },
  {
    type: 'ni_number',
    pattern: /\b[A-Za-z]{2} ?\d{2} ?\d{2} ?\d{2} ?[A-Da-d]\b/g,
    validate: niNumberValid,
  },
  {
    type: 'phone',
    pattern: /(?<![\w+])(?:\+44[ -]?(?:\(0\)[ -]?)?|\(?0)\d{2,4}\)?[ -]?\d{3,4}[ -]?\d{3,4}(?!\d)/g,
    validate: ukPhoneValid,
  },
  {
    type: 'phone',
    pattern: /(?<![\w+])\+(?!44)[1-9]\d{0,2}[ -]?(?:\(?\d{1,4}\)?[ -]?){2,5}\d{2,4}(?!\d)/g,
    validate: intlPhoneValid,
  },
  {
    type: 'postcode',
    pattern: /\b(?:GIR ?0AA|[A-PR-UWYZ][A-HK-Y]?\d[A-Z\d]? ?\d[ABD-HJLNP-UW-Z]{2})\b/gi,
  },
];
