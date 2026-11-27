import { Pool, PoolConfig, QueryResult, QueryResultRow, types } from 'pg';
import { env } from './environment';
import { databaseSslConfig, stripUrlSslParams } from './databaseSsl';

// DATE columns come back as YYYY-MM-DD strings, not Date objects at local midnight.
types.setTypeParser(1082, (val: string) => val);

const databaseUrl = env.DATABASE_URL;
const urlRequiresSsl = databaseUrl ? /[?&]sslmode=require(?:&|$)/i.test(databaseUrl) : false;
const ssl = databaseSslConfig({ sslEnabled: env.DB_SSL || urlRequiresSsl, caCertificate: env.DB_SSL_CA });

const common: Pick<PoolConfig, 'max' | 'idleTimeoutMillis' | 'connectionTimeoutMillis' | 'ssl' | 'allowExitOnIdle'> = {
  ssl,
  max: 10,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 5000,
  allowExitOnIdle: env.NODE_ENV === 'test',
};

const poolConfig: PoolConfig = databaseUrl
  ? { connectionString: ssl && ssl.ca ? stripUrlSslParams(databaseUrl) : databaseUrl, ...common }
  : {
      host: process.env.DB_HOST || 'localhost',
      port: parseInt(process.env.DB_PORT || '5432', 10),
      database: process.env.DB_NAME || 'postgres',
      user: process.env.DB_USER || 'postgres',
      password: process.env.DB_PASSWORD || 'postgres',
      ...common,
    };

const pool = new Pool(poolConfig);

pool.on('error', (err: Error) => {
  console.error(`Unexpected error on idle DB client: ${err.message}`);
  process.exit(-1);
});

export const query = <T extends QueryResultRow = QueryResultRow>(
  text: string,
  params?: unknown[]
): Promise<QueryResult<T>> => pool.query<T>(text, params);

export const getClient = () => pool.connect();

export default pool;
