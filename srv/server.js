const cds = require('@sap/cds');
const followUpExecutor = require('./jobs/followUpExecutor');

cds.on('served', () => {
    console.log('>>> [SERVER] Services started, initializing background jobs...');

    // Start background jobs
    followUpExecutor.start();
});

module.exports = cds.server;
