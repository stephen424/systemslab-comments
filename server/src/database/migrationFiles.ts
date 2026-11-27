import fs from 'fs';
import path from 'path';

const candidateMigrationDirs = (): string[] => [
  path.join(process.cwd(), 'src', 'database', 'migrations'),
  path.join(__dirname, 'migrations'),
];

export const resolveMigrationsDir = (): string => {
  const dir = candidateMigrationDirs().find(candidate => fs.existsSync(candidate));
  if (!dir) {
    throw new Error(`Migrations directory not found. Checked:\n${candidateMigrationDirs().map(d => `  - ${d}`).join('\n')}`);
  }
  return dir;
};

export const getMigrationFiles = (): string[] =>
  fs
    .readdirSync(resolveMigrationsDir())
    .filter(file => file.endsWith('.sql'))
    .sort();
