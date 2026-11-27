import type { ConnectionOptions } from 'tls';

// Railway/.env values often hold a PEM certificate on one line with literal "\n" escapes.
export const parsePemCertificate = (value?: string): string | undefined => {
  const trimmed = value?.trim();
  return trimmed ? trimmed.replace(/\\n/g, '\n') : undefined;
};

/**
 * TLS settings for the Postgres pool. With DB_SSL_CA (Supabase's CA certificate) the
 * server's certificate is verified, so nobody between Railway and Supabase can pose as
 * the database. Without it the connection is encrypted but the server is not checked.
 */
export const databaseSslConfig = (options: {
  sslEnabled: boolean;
  caCertificate?: string;
}): false | ConnectionOptions => {
  const ca = parsePemCertificate(options.caCertificate);
  if (ca) {
    return { ca, rejectUnauthorized: true };
  }
  return options.sslEnabled ? { rejectUnauthorized: false } : false;
};

const URL_SSL_PARAMS = new Set(['sslmode', 'sslrootcert', 'sslcert', 'sslkey', 'uselibpqcompat']);

/**
 * pg lets ssl options in the connection string replace the ssl object we pass, so when we
 * verify the server ourselves those options are dropped from the URL.
 */
export const stripUrlSslParams = (connectionString: string): string => {
  const queryStart = connectionString.indexOf('?');
  if (queryStart === -1) return connectionString;

  const base = connectionString.slice(0, queryStart);
  const kept = connectionString
    .slice(queryStart + 1)
    .split('&')
    .filter(param => param && !URL_SSL_PARAMS.has(param.split('=')[0].toLowerCase()));

  return kept.length ? `${base}?${kept.join('&')}` : base;
};
