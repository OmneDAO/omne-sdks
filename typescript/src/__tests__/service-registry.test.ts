import { GuardrailError } from '../errors';
import {
  canonicalServiceId,
  enforceAllowedServices,
  normalizeServiceRegistryEntry
} from '../service-registry';

describe('service registry guardrails', () => {
  describe('canonicalServiceId', () => {
    it('normalizes whitespace and casing', () => {
      expect(canonicalServiceId('  FastVM ')).toBe('fastvm');
    });

    it('handles empty values safely', () => {
      expect(canonicalServiceId('')).toBe('');
      expect(canonicalServiceId(undefined as unknown as string)).toBe('');
    });
  });

  describe('enforceAllowedServices', () => {
    it('rejects unknown services when override disabled', () => {
      expect(() =>
        enforceAllowedServices(['FastVM', 'Unknown'], ['FastVM', 'VDP'], false)
      ).toThrow(GuardrailError);
    });

    it('deduplicates while preserving canonical forms', () => {
      const result = enforceAllowedServices(
        ['fastvm', 'FASTVM', 'VDP'],
        ['FastVM', 'VDP'],
        false
      );
      expect(result).toEqual(['FastVM', 'VDP']);
    });

    it('allows unknown services when override enabled', () => {
      const result = enforceAllowedServices(
        ['FastVM', 'Experimental'],
        ['FastVM'],
        true
      );
      expect(result).toEqual(['FastVM', 'Experimental']);
    });
  });

  describe('normalizeServiceRegistryEntry', () => {
    it('trims service identifiers and base URLs', () => {
      const normalized = normalizeServiceRegistryEntry({
        serviceId: '  FastVM  ',
        baseUrl: ' https://fastvm.example '
      });
      expect(normalized.serviceId).toBe('FastVM');
      expect(normalized.baseUrl).toBe('https://fastvm.example');
    });
  });
});
