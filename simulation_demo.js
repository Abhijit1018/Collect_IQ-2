const axios = require('axios');
const cds = require('@sap/cds');

const BASE_URL = 'http://localhost:4004/odata/v4/collect-iq';

(async () => {
    try {
        console.log("=== STARTING END-TO-END DEMO SIMULATION ===");

        // 1. Connect to DB for independent verification
        const model = await cds.load('*');
        const db = await cds.connect.to('db', { model });
        const { Payers, OutreachHistory, ScheduledFollowups } = db.entities('my.collectiq');

        // Helper: Reset Payer
        const resetPayer = async (id, stageData) => {
            await db.run(UPDATE(Payers).set(stageData).where({ PayerId: id }));
            // Also update invoices to match if needed, but for now we trust the forcing
        };

        // Helper: Run Scenario
        const runScenario = async (stageName, payerId, expectedStage) => {
            console.log(`\n--- SCENARIO: ${stageName} (Payer ${payerId}) ---`);

            // 1. Generate Outreach
            console.log(`[ACTION] POST /generateOutreach for ${payerId}...`);
            await axios.post(`${BASE_URL}/Payers('${payerId}')/CollectIQService.generateOutreach`, {});

            // Verify DB State
            const payer = await db.run(SELECT.one.from(Payers).where({ PayerId: payerId }));
            console.log(`[VERIFY] Current Stage in DB: ${payer.Stage}`);
            console.log(`[VERIFY] Draft: "${payer.latestOutreachDraft ? payer.latestOutreachDraft.substring(0, 60) + '...' : 'NONE'}"`);

            if (payer.Stage !== expectedStage) console.warn(`[WARN] Start mismatched! Expected ${expectedStage}, got ${payer.Stage}. (Might need invoice data adj)`);
            if (!payer.latestOutreachDraft) throw new Error("Draft not generated!");

            // 2. Send Outreach
            console.log(`[ACTION] POST /sendOutreach for ${payerId}...`);
            try {
                await axios.post(`${BASE_URL}/Payers('${payerId}')/CollectIQService.sendOutreach`, {});
                console.log(`[result] Send success.`);
            } catch (e) {
                console.log(`[result] Send failed (network/creds): ${e.response?.data?.error?.message || e.message} (Expected in simulation)`);
            }

            // Verify History
            const history = await db.run(SELECT.from(OutreachHistory)
                .where({ payer_PayerId: payerId })
                .orderBy('outreachDate', 'desc')
                .limit(1));

            if (history.length > 0) {
                console.log(`[VERIFY] History Logged: Type=${history[0].outreachType}, Status=${history[0].status}`);
            } else {
                console.error(`[FAIL] No history logged for ${stageName}!`);
            }
        };

        // --- EXECUTE SCENARIOS ---

        // Scenario 1: Stage 1 (Assume implicit or force data - using Payer 1001 for low overdue)
        // Correcting: We might need to manipulate invoices to force stages if logic calculates dynamically.
        // But for simulation, we'll test with Payer 1003 (Adani - Stage 3) specifically as requested.

        await runScenario('STAGE 3 DEMO', '1003', 'STAGE_3');

        // --- FOLLOW-UP SCHEDULING ---
        console.log(`\n--- SCENARIO: Schedule Follow-up ---`);
        const today = new Date();
        const diff = (7 - today.getDay() + 1) % 7 || 7;
        const nextMonday = new Date(today);
        nextMonday.setDate(today.getDate() + diff);
        const dateStr = nextMonday.toISOString().split('T')[0];

        console.log(`[ACTION] Scheduling for ${dateStr} (Next Monday)...`);
        try {
            await axios.post(`${BASE_URL}/scheduleFollowUp`, {
                payerId: '1003',
                originalCallId: 'SIM_CALL_001',
                scheduledDate: dateStr,
                reason: 'Demo Follow-up: Discuss payment plan'
            });
            console.log(`[result] Schedule success.`);
        } catch (e) {
            console.error(`[FAIL] Schedule failed: ${e.response?.data?.error?.message || e.message}`);
        }

        // Verify Follow-up
        const followup = await db.run(SELECT.one.from(ScheduledFollowups)
            .where({ payer_PayerId: '1003', scheduledDate: dateStr }));

        if (followup) {
            console.log(`[VERIFY] Follow-up found: ID=${followup.ID}, Status=${followup.status}`);
        } else {
            console.error(`[FAIL] Follow-up verification failed.`);
        }

        console.log("\n=== SIMULATION COMPLETE ===");

    } catch (e) {
        console.error("CRITICAL ERROR:", e.message);
        if (e.code === 'ECONNREFUSED') console.error("Is the server running on port 4004?");
    }
})();
