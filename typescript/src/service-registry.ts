/**
 * Hardened service registry helpers for Omne SDK.
 */

import { ServiceRegistryEntry, ServiceRegistrySnapshot } from './types';
import { GuardrailError, NetworkError } from './errors';

/**
 * Canonical form for service identifiers (trimmed, lower-case).
 */
export function canonicalServiceId(serviceId: string): string {
  return (serviceId ?? '').trim().toLowerCase();
}

/**
 * Enforce service allow-lists while preserving canonical ordering.
 */
export function enforceAllowedServices(
  requested: string[],
  allowed: string[],
  allowUnknown: boolean = false
): string[] {
  const canonicalAllowed = new Map<string, string>();
  for (const service of allowed) {
    const canonical = canonicalServiceId(service);
    if (canonical.length > 0 && !canonicalAllowed.has(canonical)) {
      canonicalAllowed.set(canonical, service);
    }
  }

  const seen = new Set<string>();
  const output: string[] = [];

  for (const service of requested) {
    const canonical = canonicalServiceId(service);
    if (canonical.length === 0) {
      continue;
    }

    if (!allowUnknown && canonicalAllowed.size > 0 && !canonicalAllowed.has(canonical)) {
      throw GuardrailError.serviceNotAllowed(service, [...canonicalAllowed.values()]);
    }

    if (!seen.has(canonical)) {
      seen.add(canonical);
      const canonicalised = canonicalAllowed.get(canonical);
      output.push(canonicalised ?? service);
    }
  }

  return output;
}

export function normalizeServiceRegistryEntry(entry: any): ServiceRegistryEntry {
  if (!entry || typeof entry !== 'object') {
    return {
      serviceId: '',
      baseUrl: ''
    };
  }

  const metadataCandidate = (entry as any).metadata;
  const metadata = metadataCandidate && typeof metadataCandidate === 'object'
    ? metadataCandidate as Record<string, any>
    : undefined;

  const serviceIdRaw = (entry as any).serviceId ?? (entry as any).service_id ?? '';
  const baseUrlRaw = (entry as any).baseUrl ?? (entry as any).base_url ?? '';

  return {
    serviceId: String(serviceIdRaw).trim(),
    baseUrl: String(baseUrlRaw).trim(),
    planFingerprint: (entry as any).planFingerprint ?? (entry as any).plan_fingerprint ?? undefined,
    certificateFingerprint: (entry as any).certificateFingerprint ?? (entry as any).certificate_fingerprint ?? undefined,
    authScope: (entry as any).authScope ?? (entry as any).auth_scope ?? undefined,
    metadata,
    signature: (entry as any).signature ?? undefined
  };
}

export function normalizeServiceRegistrySnapshot(payload: any): ServiceRegistrySnapshot {
  const versionCandidate = payload?.version;
  const version = typeof versionCandidate === 'number'
    ? versionCandidate
    : Number(versionCandidate ?? 0);

  const root = typeof payload?.root === 'string' ? payload.root : '';
  const entriesRaw = Array.isArray(payload?.entries) ? payload.entries : [];
  const entries = entriesRaw
    .map(normalizeServiceRegistryEntry)
    .filter((entry: ServiceRegistryEntry) => entry.serviceId.length > 0 && entry.baseUrl.length > 0);

  return {
    version,
    root,
    entries
  };
}

export async function fetchServiceRegistrySnapshotFromUrl(
  endpoint: string,
  fetchImpl?: typeof fetch
): Promise<ServiceRegistrySnapshot> {
  const trimmed = endpoint.replace(/\/+$/g, '');
  const url = `${trimmed}/service-registry`;

  const fetchFn = fetchImpl ?? (typeof globalThis.fetch === 'function' ? globalThis.fetch.bind(globalThis) : undefined);
  if (typeof fetchFn !== 'function') {
    throw new NetworkError('Global fetch is not available. Provide a fetch implementation.', undefined, undefined, {
      url
    });
  }

  try {
    const response = await fetchFn(url, {
      method: 'GET',
      headers: {
        Accept: 'application/json'
      }
    });

    if (!response.ok) {
      const body = await response.text().catch(() => undefined);
      throw NetworkError.fromResponse(response, body);
    }

    const payload = await response.json();
    return normalizeServiceRegistrySnapshot(payload);
  } catch (error) {
    if (error instanceof NetworkError) {
      throw error;
    }
    throw NetworkError.connectionFailed(url, error as Error);
  }
}
