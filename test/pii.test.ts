import { describe, expect, it } from 'vitest';
import { ibanValid, luhnValid, niNumberValid } from '../src/pii/detectors.js';
import { findPii, Redactor } from '../src/pii/redactor.js';
import fake from '../fixtures/fake-pii.json' with { type: 'json' };

const types = ['email', 'phone', 'ni_number', 'card', 'iban', 'postcode'] as const;

describe('PII detectors', () => {
  for (const type of types) {
    for (const value of (fake as unknown as Record<string, string[]>)[type]) {
      it(`detects ${type}: ${value}`, () => {
        const found = findPii(`Customer note: ${value}, thanks.`);
        expect(found).toHaveLength(1);
        expect(found[0].type).toBe(type);
        expect(found[0].value).toBe(value);
      });
    }
  }

  it('checks card numbers with Luhn', () => {
    expect(luhnValid('4111111111111111')).toBe(true);
    expect(luhnValid('4111111111111112')).toBe(false);
    expect(findPii('order total 4111 1111 1111 1112')).toHaveLength(0);
  });

  it('checks IBANs with mod 97', () => {
    expect(ibanValid('GB82 WEST 1234 5698 7654 32')).toBe(true);
    expect(ibanValid('GB82 WEST 1234 5698 7654 33')).toBe(false);
  });

  it('applies National Insurance prefix rules', () => {
    expect(niNumberValid('AB123456C')).toBe(true);
    expect(niNumberValid('QQ123456C')).toBe(false); // Q is never a first letter
    expect(niNumberValid('GB123456A')).toBe(false); // banned prefix
    expect(niNumberValid('AB123456E')).toBe(false); // suffix must be A to D
  });

  it('leaves ordinary business text alone', () => {
    const text = 'Order ORD-48213 on 2026-10-25 for £1,234.56, ref ABC123, version 1.2.3, call at 3pm, 40 seats, SKU 12345678.';
    expect(findPii(text)).toEqual([]);
  });
});

describe('Redactor', () => {
  it('uses stable tokens and restores originals', () => {
    const r = new Redactor();
    const a = r.redact('Email jane.doe@example.com or JANE.DOE@example.com, card 4111 1111 1111 1111, call 07700 900123');
    expect(a.text).toBe('Email [EMAIL_1] or [EMAIL_1], card [CARD_1], call [PHONE_1]');
    expect(r.counts).toEqual({ email: 2, card: 1, phone: 1 });
    expect(r.restore('Reply sent to [EMAIL_1] about [CARD_1]')).toBe('Reply sent to jane.doe@example.com about 4111 1111 1111 1111');
  });

  it('numbers different values separately and ignores unknown tokens', () => {
    const r = new Redactor();
    expect(r.redact('a@example.com then b@example.com').text).toBe('[EMAIL_1] then [EMAIL_2]');
    expect(r.restore('[EMAIL_2] [EMAIL_9]')).toBe('b@example.com [EMAIL_9]');
  });
});
