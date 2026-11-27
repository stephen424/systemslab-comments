// Copies the SQL migrations next to the compiled code.
const fs = require('fs');
const path = require('path');
const from = path.join(__dirname, '..', 'src', 'database', 'migrations');
const to = path.join(__dirname, '..', 'dist', 'database', 'migrations');
fs.mkdirSync(to, { recursive: true });
for (const file of fs.readdirSync(from)) fs.copyFileSync(path.join(from, file), path.join(to, file));
