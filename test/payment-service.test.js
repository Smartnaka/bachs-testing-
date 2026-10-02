import test from 'node:test';
import assert from 'node:assert/strict';
import { isValidPaidTransaction, normalizeStatus } from '../payment-service.js';

test('normalizes provider statuses', () => { assert.equal(normalizeStatus('SUCCESS'), 'paid'); assert.equal(normalizeStatus('CANCELLED'), 'cancelled'); assert.equal(normalizeStatus('PENDING'), 'pending'); });
test('only accepts exact NGN test amount as a paid transaction', () => { assert.equal(isValidPaidTransaction({ status: 'SUCCESS', amount: 5000, currency: 'NGN' }), true); assert.equal(isValidPaidTransaction({ status: 'SUCCESS', amount: 1, currency: 'NGN' }), false); });
