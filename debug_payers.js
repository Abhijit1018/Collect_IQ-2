const cds = require('@sap/cds');

(async () => {
    try {
        const db = await cds.connect.to('db');
        const payers = await db.run(SELECT.from('my.collectiq.Payers').where({ PayerId: { in: ['1003', '1004'] } }));
        console.log('--- PAYER DATA DEBUG ---');
        console.table(payers.map(p => ({
            PayerId: p.PayerId,
            PayerName: p.PayerName,
            TotalPastDue: p.TotalPastDue,
            Currency: p.Currency,
            Stage: p.Stage
        })));
    } catch (e) {
        console.error(e);
    }
})();
