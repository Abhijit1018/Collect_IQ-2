const cds = require('@sap/cds');
const axios = require('axios');
require('dotenv').config();

module.exports = cds.service.impl(async function() {
    const { Invoices, Payers, OutreachHistory, InvoicesS4 } = this.entities;
    const sapS4 = await cds.connect.to('ZUI_COLLECTIQ_04');

    // Action: Sync Data from S/4HANA
    this.on('syncAR', async (req) => {
        try {
            const remoteData = await sapS4.run(SELECT.from(InvoicesS4));
            if (!remoteData || remoteData.length === 0) return "No data found in SAP.";

            // Clean existing data for a fresh start
            await DELETE.from(Payers);
            await DELETE.from(Invoices);

            const payersMap = {};
            const invoiceEntries = [];

            remoteData.forEach(row => {
                // 1. Grouping logic for Payers
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

                // 2. Prepare Invoices for Bulk Insert (Efficient)
                invoiceEntries.push({
                    payerId: row.CustomerId,
                    invoiceNumber: row.InvoiceNum,
                    invoiceAmount: row.InvoiceAmount,
                    dueDate: row.DueDate,
                    daysPastDue: row.PastdueDays,
                    currency: row.Currency
                });
            });

            // Calculate Escalation Stages
            const finalPayers = Object.values(payersMap).map(p => {
                if (p.maxDaysPastDue <= 5) p.stage = 'STAGE_1';
                else if (p.maxDaysPastDue <= 15) p.stage = 'STAGE_2';
                else p.stage = 'STAGE_3';
                return p;
            });

            // Executing Bulk Operations
            await INSERT.into(Payers).entries(finalPayers);
            await INSERT.into(Invoices).entries(invoiceEntries);

            return `Sync complete: ${finalPayers.length} payers and ${invoiceEntries.length} invoices processed.`;
        } catch (err) {
            return req.error(500, `Sync failed: ${err.message}`);
        }
    });

    // Action: Generate Outreach using Gemini AI
    this.on('generateOutreach', 'Payers', async (req) => {
        const id = req.params[0].payerId;
        const payer = await SELECT.one.from(Payers).where({ payerId: id });
        if (!payer) return req.error(404, "Payer not found.");

        const strategy = payer.stage === 'STAGE_3' ? "Draft a firm phone call script." : "Draft a payment reminder email.";
        const tone = (payer.stage === 'STAGE_1') ? "Polite" : "Urgent/Serious";

        const prompt = `Act as an SAP Collections Agent. ${strategy} 
                        Customer: ${payer.payerName}. Balance: ${payer.totalPastDue}. 
                        Tone: ${tone}. Focus on the overdue amount.`;

        try {
            const response = await axios.post(
                `https://generativelanguage.googleapis.com/v1beta/models/gemini-pro:generateContent?key=${process.env.GEMINI_API_KEY}`,
                { contents: [{ parts: [{ text: prompt }] }] }
            );

            const aiDraft = response.data.candidates[0].content.parts[0].text;

            // Audit update and Payer status
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
            console.error("AI Error:", err.response?.data || err.message);
            return req.error(500, "AI Generation failed. Check API Key configuration.");
        }
    });
});