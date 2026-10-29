import assert from 'node:assert/strict';
import { test } from 'node:test';
import { isValidPhoneBr, isValidWebUrl, validateFormFields } from '../../lib/form-validation.js';

const validate = (type, value, options = {}) =>
  validateFormFields([{ key: 'field', type, ...options }], { field: value }, 'pt-BR');

test('structured fields reject partial or malformed values while remaining optional', () => {
  for (const type of ['phone', 'cpf', 'cep', 'url', 'time', 'email', 'number']) {
    assert.deepEqual(validate(type, ''), {}, `${type} may be empty when optional`);
  }
  assert.ok(validate('phone', '(11) 9999-999').field);
  assert.deepEqual(validate('phone', '(11) 99999-9999'), {});
  assert.ok(validate('cpf', '123.456.789').field);
  assert.ok(validate('cpf', 'abc12345678901').field);
  assert.deepEqual(validate('cpf', '123.456.789-01'), {});
  assert.ok(validate('cep', '01310-10').field);
  assert.ok(validate('cep', '013101000').field);
  assert.deepEqual(validate('cep', '01310-100'), {});
  assert.ok(validate('url', 'javascript:alert(1)').field);
  assert.ok(validate('url', 'linkedin.com/in/test').field);
  assert.deepEqual(validate('url', 'https://linkedin.com/in/test'), {});
  assert.ok(validate('time', '25:61').field);
  assert.deepEqual(validate('time', '09:30'), {});
  assert.ok(validate('email', 'name@').field);
  assert.ok(validate('number', '3.5', { min: 1, max: 50, step: 1 }).field);
  assert.deepEqual(validate('number', '3', { min: 1, max: 50, step: 1 }), {});
});

test('phone and web URL checks handle formatted input without accepting extra digits', () => {
  assert.equal(isValidPhoneBr('11999999999'), true);
  assert.equal(isValidPhoneBr('+55 (11) 99999-9999'), true);
  assert.equal(isValidPhoneBr('119999999999'), false);
  assert.equal(isValidPhoneBr('abc11999999999'), false);
  assert.equal(isValidWebUrl('https://example.com/path'), true);
  assert.equal(isValidWebUrl('ftp://example.com'), false);
});
