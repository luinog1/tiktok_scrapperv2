import { createServer } from 'node:http';

import { createApp } from './app.js';
import { CONFIG } from './config.js';

const app = createApp(CONFIG);
const server = createServer(app);

server.listen(CONFIG.port, () => {
  console.log(JSON.stringify({
    level: 'info',
    event: 'server_started',
    port: CONFIG.port,
    scrapeProvider: CONFIG.scrapeProvider,
    mediaProvider: CONFIG.mediaProvider,
  }));
});

function shutdown(signal: string) {
  console.log(JSON.stringify({ level: 'info', event: 'server_stopping', signal }));
  server.close((error) => {
    if (error) {
      console.error(error);
      process.exitCode = 1;
    }
  });
}

process.once('SIGTERM', () => shutdown('SIGTERM'));
process.once('SIGINT', () => shutdown('SIGINT'));
