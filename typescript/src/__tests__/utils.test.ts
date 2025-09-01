/**
 * Tests for utility functions
 */

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
  estimateGas 
} from '../utils';

describe('Utility Functions', () => {
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
    test('isValidAddress validates both Omne and hex addresses', () => {
      // Omne addresses  
      expect(isValidAddress('omne1hja1yjwwhdjrtjphtjty5d2smb7u5j3d')).toBe(true);
      // Hex addresses (legacy)
      expect(isValidAddress('0x742d35cc4bf688aee6f7c3c3a6b1c98aaee5e84e')).toBe(true);
      expect(isValidAddress('742d35cc4bf688aee6f7c3c3a6b1c98aaee5e84e')).toBe(true);
    });

    test('isValidOmneAddress validates Omne format specifically', () => {
      expect(isValidOmneAddress('omne1hja1yjwwhdjrtjphtjty5d2smb7u5j3d')).toBe(true);
      expect(isValidOmneAddress('0x742d35cc4bf688aee6f7c3c3a6b1c98aaee5e84e')).toBe(false);
      expect(isValidOmneAddress('invalid')).toBe(false);
    });

    test('isValidHexAddress validates hex format specifically', () => {
      expect(isValidHexAddress('0x742d35cc4bf688aee6f7c3c3a6b1c98aaee5e84e')).toBe(true);
      expect(isValidHexAddress('742d35cc4bf688aee6f7c3c3a6b1c98aaee5e84e')).toBe(true);
      expect(isValidHexAddress('0X742D35CC4BF688AEE6F7C3C3A6B1C98AAEE5E84E')).toBe(true);
      expect(isValidHexAddress('omne1hja1yjwwhdjrtjphtjty5d2smb7u5j3d')).toBe(false);
    });

    test('isValidAddress rejects invalid addresses', () => {
      expect(isValidAddress('0x742d35cc4bf688aee6f7c3c3a6b1c98aaee5e84')).toBe(false); // too short
      expect(isValidAddress('0x742d35cc4bf688aee6f7c3c3a6b1c98aaee5e84ex')).toBe(false); // invalid hex
      expect(isValidAddress('omne1invalid')).toBe(false); // invalid Omne
      expect(isValidAddress('not_an_address')).toBe(false);
      expect(isValidAddress('')).toBe(false);
    });

    test('Omne address encoding/decoding', () => {
      const testBytes = new Uint8Array([
        0x74, 0x2d, 0x35, 0xcc, 0x4b, 0xf6, 0x88, 0xae, 0xe6, 0xf7,
        0xc3, 0xc3, 0xa6, 0xb1, 0xc9, 0x8a, 0xae, 0xe5, 0xe8, 0x4e
      ]);
      
      const omneAddr = toOmneAddress(testBytes);
      expect(omneAddr).toMatch(/^omne1[123456789abcdefghjkmnpqrstuvwxyz]+$/);
      
      const decoded = fromOmneAddress(omneAddr);
      expect(decoded).toEqual(testBytes);
    });

    test('parseAddress handles both formats', () => {
      const hexResult = parseAddress('0x742d35cc4bf688aee6f7c3c3a6b1c98aaee5e84e');
      expect(hexResult.format).toBe('hex');
      expect(hexResult.bytes.length).toBe(20);
      
      const omneAddr = toOmneAddress(hexResult.bytes);
      const omneResult = parseAddress(omneAddr);
      expect(omneResult.format).toBe('omne');
      expect(omneResult.bytes).toEqual(hexResult.bytes);
    });

    test('normalizeAddress converts to Omne format', () => {
      const hexAddr = '0x742d35cc4bf688aee6f7c3c3a6b1c98aaee5e84e';
      const normalized = normalizeAddress(hexAddr);
      expect(normalized).toMatch(/^omne1[123456789abcdefghjkmnpqrstuvwxyz]+$/);
      
      // Omne addresses should remain unchanged
      const omneAddr = 'omne1hja1yjwwhdjrtjphtjty5d2smb7u5j3d';
      expect(normalizeAddress(omneAddr)).toBe(omneAddr);
      
      // Different hex cases should convert to same Omne format
      const normalized1 = normalizeAddress('742d35cc4bf688aee6f7c3c3a6b1c98aaee5e84e');
      const normalized2 = normalizeAddress('0X742D35CC4BF688AEE6F7C3C3A6B1C98AAEE5E84E');
      
      expect(normalized1).toMatch(/^omne1[123456789abcdefghjkmnpqrstuvwxyz]+$/);
      expect(normalized2).toMatch(/^omne1[123456789abcdefghjkmnpqrstuvwxyz]+$/);
      expect(normalized1).toBe(normalized2);
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
});
