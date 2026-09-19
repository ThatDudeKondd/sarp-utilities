// .cjs extension: package.json sets "type": "module", and PM2 loads this
// config via require(), which can't parse ESM.
module.exports = {
  apps: [
    {
      name: 'sarp-utilities',
      script: 'dist/index.js',
      instances: 1,
      exec_mode: 'fork', // single instance only -- one process must own the Discord gateway connection
      autorestart: true,
      max_restarts: 10,
      restart_delay: 5000,
      max_memory_restart: '1.5G',
    },
  ],
};
