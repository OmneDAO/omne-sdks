/**
 * Tests for utility functions
 */

import { describe, expect, test } from '@jest/globals';

import {
  toQuar,
  fromQuar,
  toOMC,
  formatBalance,
  isValidAddress,
  isValidOmneAddress,
  isValidHexAddress,
  normalizeAddress,
  toOmneAddress,
  fromOmneAddress,
  parseAddress,
  calculateGasCost,
  estimateGas,
  verifyMlDsa44Signature,
  verifyMessageSignature
} from '../utils';
import { WalletAccount } from '../wallet';
import { hexToBuffer, bufferToHex } from '../utils';

// ML-DSA-44 (FIPS 204) byte lengths.
const ML_DSA_44_SIG_BYTES = 2420;

describe('Utility Functions', () => {
  // 32-byte address (64 hex chars) — the post-quantum address width.
  const sampleHex = '742d35cc4bf688aee6f7c3c3a6b1c98aaee5e84e0011223344556677889900aa';
  // Canonical om1z bech32m encoding of the same 32-byte address
  const sampleOmne = toOmneAddress(hexToBuffer(sampleHex));

  describe('Quar conversion', () => {
    test('toQuar converts OMC to quar correctly', () => {
      expect(toQuar('1')).toBe('1000000000000000000');
      expect(toQuar('0.5')).toBe('500000000000000000');
      expect(toQuar('0.001')).toBe('1000000000000000');
      expect(toQuar(1)).toBe('1000000000000000000');
    });

    test('fromQuar converts quar to OMC correctly', () => {
      const result1 = fromQuar('1000000000000000000');
      expect(result1.toString()).toBe('1');
      
      const result2 = fromQuar('500000000000000000');
      expect(result2.toString()).toBe('0.5');
      
      const result3 = fromQuar('1000000000000000');
      expect(result3.toString()).toBe('0.001');
    });

    test('toOMC is alias for fromQuar', () => {
      expect(toOMC('1000000000000000000')).toEqual(fromQuar('1000000000000000000'));
    });

    test('formatBalance creates human-readable string', () => {
      expect(formatBalance('1000000000000000000')).toBe('1.000000 OMC');
      expect(formatBalance('1500000000000000000', 2)).toBe('1.50 OMC');
    });
  });

  describe('Address validation', () => {
    test('isValidAddress validates Omne and raw hex addresses', () => {
      expect(isValidAddress(sampleOmne)).toBe(true);
      expect(isValidAddress(sampleHex)).toBe(true);
    });

    test('isValidOmneAddress validates om1z format specifically', () => {
      expect(isValidOmneAddress(sampleOmne)).toBe(true);
      expect(isValidOmneAddress(sampleHex)).toBe(false);
      expect(isValidOmneAddress('invalid')).toBe(false);
    });

    test('isValidHexAddress validates raw hex format (no prefix)', () => {
      expect(isValidHexAddress(sampleHex)).toBe(true);
      expect(isValidHexAddress(sampleHex.toUpperCase())).toBe(false);
      expect(isValidHexAddress(sampleOmne)).toBe(false);
      expect(isValidHexAddress('zzzz35cc4bf688aee6f7c3c3a6b1c98aaee5e84e')).toBe(false);
      expect(isValidHexAddress('742d35cc4bf688aee6f7c3c3a6b1c98aaee5e84')).toBe(false); // 39 chars
    });

    test('isValidAddress rejects invalid addresses', () => {
      expect(isValidAddress('742d35cc4bf688aee6f7c3c3a6b1c98aaee5e84')).toBe(false); // 39 chars
      expect(isValidAddress('not_an_address')).toBe(false);
      expect(isValidAddress('')).toBe(false);
      expect(isValidAddress(sampleHex.toUpperCase())).toBe(false);
    });

    test('legacy omne1 addresses are rejected (Ignis is om1z-only)', () => {
      const legacy = 'omne1' + sampleHex;
      expect(isValidAddress(legacy)).toBe(false);
      expect(isValidOmneAddress(legacy)).toBe(false);
      expect(() => fromOmneAddress(legacy)).toThrow();
      expect(() => normalizeAddress(legacy)).toThrow();
    });

    test('om1z bech32m address encoding/decoding', () => {
      const testBytes = new Uint8Array([
        0x74, 0x2d, 0x35, 0xcc, 0x4b, 0xf6, 0x88, 0xae, 0xe6, 0xf7,
        0xc3, 0xc3, 0xa6, 0xb1, 0xc9, 0x8a, 0xae, 0xe5, 0xe8, 0x4e,
        0x00, 0x11, 0x22, 0x33, 0x44, 0x55, 0x66, 0x77, 0x88, 0x99,
        0x00, 0xaa
      ]);

      const omneAddr = toOmneAddress(testBytes);
      expect(omneAddr).toMatch(/^om1z/);

      const decoded = fromOmneAddress(omneAddr);
      expect(decoded).toEqual(testBytes);
    });

    test('fromOmneAddress rejects non-om1z input', () => {
      expect(() => fromOmneAddress('omne1' + sampleHex)).toThrow();
      expect(() => fromOmneAddress('invalid')).toThrow();
      expect(() => fromOmneAddress(sampleHex)).toThrow();
    });

    test('parseAddress handles om1z bech32m and raw hex formats', () => {
      const hexResult = parseAddress(sampleHex);
      expect(hexResult.format).toBe('hex');
      expect(hexResult.bytes.length).toBe(32);

      const omneAddr = toOmneAddress(hexResult.bytes);
      const omneResult = parseAddress(omneAddr);
      expect(omneResult.format).toBe('bech32m');
      expect(omneResult.bytes).toEqual(hexResult.bytes);
    });

    test('normalizeAddress converts any format to om1z bech32m', () => {
      const normalized = normalizeAddress(sampleHex);
      expect(normalized).toMatch(/^om1z/);

      // om1z addresses should remain unchanged
      expect(normalizeAddress(sampleOmne)).toBe(sampleOmne);

      // Uppercase hex inputs should be rejected
      expect(() => normalizeAddress(sampleHex.toUpperCase())).toThrow();
    });
  });

  describe('Gas calculations', () => {
    test('calculateGasCost computes cost correctly', () => {
      expect(calculateGasCost(21000, '1000')).toBe('21000000');
      expect(calculateGasCost(50000, '500')).toBe('25000000');
    });

    test('estimateGas provides reasonable estimates', () => {
      expect(estimateGas('transfer')).toBe(21000);
      expect(estimateGas('tokenTransfer')).toBe(50000);
      expect(estimateGas('orc20Deploy')).toBe(150000);
      expect(estimateGas('transfer', true)).toBe(41000); // with data
    });
  });

  describe('Message signatures', () => {
    test('verifies ML-DSA-44 signed message against signer address', () => {
      const account = WalletAccount.fromPrivateKey('1'.repeat(64));
      const message = 'hello-omne';
      const signature = account.signMessage(message);

      // Extract the signature and public key components (2420-byte sig
      // followed by the 1312-byte public key).
      const combined = hexToBuffer(signature);
      const sigHex = bufferToHex(combined.slice(0, ML_DSA_44_SIG_BYTES));
      const pubHex = bufferToHex(combined.slice(ML_DSA_44_SIG_BYTES));

      // Explicit verification with separate sig and pubkey.
      expect(verifyMlDsa44Signature(message, sigHex, pubHex, account.address)).toBe(true);

      // Wrapper accepts the combined sig||pubkey envelope.
      expect(verifyMessageSignature(message, signature, account.address)).toBe(true);
      expect(verifyMessageSignature(message, signature, sampleOmne)).toBe(false);
    });

    test('verifies ML-DSA-44 signed message with different key', () => {
      const account = WalletAccount.fromPrivateKey('2'.repeat(64));
      const message = 'deadbeef';
      const signature = account.signMessage(message);

      const combined = hexToBuffer(signature);
      const sigHex = bufferToHex(combined.slice(0, ML_DSA_44_SIG_BYTES));
      const pubHex = bufferToHex(combined.slice(ML_DSA_44_SIG_BYTES));

      expect(verifyMlDsa44Signature(message, sigHex, pubHex, account.address)).toBe(true);
    });
  });
});
