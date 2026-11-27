export const normalizeOrigin = (origin: string): string => {
  const trimmed = origin.trim();

  if (!trimmed) {
    return '';
  }

  try {
    return new URL(trimmed).origin;
  } catch {
    return trimmed.replace(/\/+$/, '');
  }
};

export const parseOriginList = (value?: string): string[] =>
  (value || '')
    .split(',')
    .map(normalizeOrigin)
    .filter(Boolean);

export const getAllowedCorsOrigins = (frontendUrl: string, corsOriginsValue?: string): string[] => {
  const origins = [normalizeOrigin(frontendUrl), ...parseOriginList(corsOriginsValue)];
  return Array.from(new Set(origins.filter(Boolean)));
};

export const isOriginAllowed = (origin: string | undefined, allowedOrigins: readonly string[]): boolean => {
  if (!origin) {
    return true;
  }

  return allowedOrigins.includes(normalizeOrigin(origin));
};
