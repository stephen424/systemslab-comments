import app from './app';
import { env } from './config/environment';

app.listen(env.PORT, () => console.log(`Comments API listening on port ${env.PORT}`));
