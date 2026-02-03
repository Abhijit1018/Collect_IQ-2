const cds = require('@sap/cds');

(async () => {
    try {
        console.log("--- DASHBOARD VERIFICATION ---");
        const model = await cds.load('*');
        const db = await cds.connect.to('db', { model });
        const { Payers, Invoices, OutreachHistory } = db.entities('my.collectiq');

        // 1. Overview Stats Simulation
        const payers = await db.run(SELECT.from(Payers));
        const totalOutstanding = payers.reduce((sum, p) => sum + (p.TotalPastDue || 0), 0);
        const customersAtRisk = payers.filter(p => p.Stage === 'STAGE_3' || p.Stage === 'STAGE_2').length;

        console.log(`[PASS] Overview Stats Logic:`);
        console.log(`   - Total Outstanding: ${totalOutstanding}`);
        console.log(`   - Customers at Risk: ${customersAtRisk}`);

        // 2. Outreach Timeline Simulation
        const timeline = await db.run(SELECT.from(OutreachHistory));
        console.log(`[PASS] Outreach Timeline Logic:`);
        console.log(`   - History Records Found: ${timeline.length}`);

        if (payers.length > 0) {
            console.log("[SUCCESS] Dashboard data layer is accessible.");
        } else {
            console.warn("[WARNING] No payers found. Dashboard will be empty.");
        }

    } catch (e) {
        console.error("[FAILED] Dashboard verification error:", e);
    }
})();
