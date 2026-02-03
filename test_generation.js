const cds = require('@sap/cds');

(async () => {
    try {
        const db = await cds.connect.to('db');
        const Invoices = db.entities('my.collectiq').Invoices;

        console.log('--- SIMULATING GENERATION FOR 1003 ---');

        const invoices = await db.run(SELECT.from(Invoices).where({ PayerId: '1003' }));
        console.log(`Found ${invoices.length} invoices for 1003`);

        let totalPastDue = 0;
        invoices.forEach(inv => {
            console.log(`Invoice ${inv.InvoiceNumber}: ${inv.InvoiceAmount}`);
            if (inv.InvoiceAmount) {
                totalPastDue += Number(inv.InvoiceAmount);
            }
        });

        console.log(`CALCULATED TOTAL: ${totalPastDue}`);

    } catch (e) {
        console.error(e);
    }
})();
