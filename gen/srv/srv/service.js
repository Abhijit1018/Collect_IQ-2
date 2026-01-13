const cds = require('@sap/cds');
const axios = require('axios');
require('dotenv').config();

module.exports = cds.service.impl(async function() {
    const { Invoices, Payers, OutreachHistory, InvoicesS4 } = this.entities;
    const sapS4 = await cds.connect.to('ZUI_COLLECTIQ_04'); 

    // Action: Sync Data from S/4HANA
    this.on('syncAR', async (req) => {
        try {
            console.log(">>> Starting Sync from S/4HANA...");
            const remoteData = await sapS4.run(SELECT.from(InvoicesS4));
            
            if (!remoteData || remoteData.length === 0) return "No data found in SAP.";

            // Wipe existing data for clean POC demo
            await DELETE.from(Payers);
            await DELETE.from(Invoices);

            const payersMap = {};
            const invoiceEntries = [];

            remoteData.forEach(row => {
                if (!payersMap[row.CustomerId]) {
                    payersMap[row.CustomerId] = {
                        payerId: row.CustomerId,
                        payerName: row.CustomerName,
                        totalPastDue: 0,
                        maxDaysPastDue: 0
                    };
                }
                payersMap[row.CustomerId].totalPastDue += Number(row.InvoiceAmount);
                payersMap[row.CustomerId].maxDaysPastDue = Math.max(payersMap[row.CustomerId].maxDaysPastDue, row.PastdueDays);

                invoiceEntries.push({
                    payerId: row.CustomerId,
                    invoiceNumber: row.InvoiceNum,
                    invoiceAmount: row.InvoiceAmount,
                    dueDate: row.DueDate,
                    daysPastDue: row.PastdueDays,
                    currency: row.Currency
                });
            });

            const finalPayers = Object.values(payersMap).map(p => {
                if (p.maxDaysPastDue <= 5) p.stage = 'STAGE_1';
                else if (p.maxDaysPastDue <= 10) p.stage = 'STAGE_2';
                else p.stage = 'STAGE_3';
                return p;
            });

            await INSERT.into(Payers).entries(finalPayers);
            await INSERT.into(Invoices).entries(invoiceEntries);

            return `Sync complete: ${finalPayers.length} payers processed.`;
        } catch (err) {
            return req.error(500, `Sync failed: ${err.message}`);
        }
    });

    // Action: Send Outreach (Bound to Payers)
    this.on('sendOutreach', 'Payers', async (req) => {
        const id = req.params[0].payerId; 
        const payer = await SELECT.one.from(Payers).where({ payerId: id });
        
        if (!payer || !payer.latestOutreachDraft) {
            return req.error(400, "Please generate an AI draft first.");
        }

        try {
            console.log(`>>> OUTBOUND COMMUNICATION LOGGED to ${payer.payerName}`);
            await UPDATE(Payers, id).with({
                lastOutreachStatus: 'SENT',
                lastOutreachAt: new Date().toISOString()
            });
            return "Outreach sent successfully.";
        } catch (err) {
            return req.error(500, `Failed: ${err.message}`);
        }
    });

    // Action: Generate Outreach using Gemini AI
    this.on('generateOutreach', 'Payers', async (req) => {
        const id = req.params[0].payerId;
        const payer = await SELECT.one.from(Payers).where({ payerId: id });
        if (!payer) return req.error(404, "Payer not found.");

        const prompt = `Act as an SAP Collections Agent. Customer: ${payer.payerName}. Balance: ${payer.totalPastDue}. Tone: Serious.`;

        try {
            const response = await axios.post(
                `https://generativelanguage.googleapis.com/v1beta/models/gemini-pro:generateContent?key=${process.env.GEMINI_API_KEY}`,
                { contents: [{ parts: [{ text: prompt }] }] }
            );

            const aiDraft = response.data.candidates[0].content.parts[0].text;

            await INSERT.into(OutreachHistory).entries({
                payerId: id,
                stageAtGeneration: payer.stage,
                outreachType: (payer.stage === 'STAGE_3') ? 'CALLSCRIPT' : 'EMAIL',
                bodyText: aiDraft,
                status: 'DRAFT_GENERATED'
            });

            await UPDATE(Payers, id).with({
                lastOutreachStatus: 'DRAFT_GENERATED',
                lastOutreachAt: new Date().toISOString(),
                latestOutreachDraft: aiDraft
            });

            return aiDraft;
        } catch (err) {
            return req.error(500, "AI Generation failed.");
        }
    });
});