const cds = require('@sap/cds');
const axios = require('axios');
const nodemailer = require('nodemailer');
require('dotenv').config();

module.exports = cds.service.impl(async function() {
    const { Invoices, Payers, OutreachHistory, InvoicesS4 } = this.entities;

    // 1. Setup Real Email Transporter (Outreach Orchestrator)
    const transporter = nodemailer.createTransport({
        host: process.env.EMAIL_HOST,
        port: process.env.EMAIL_PORT,
        secure: true, // true for port 465 (Gmail)
        auth: {
            user: process.env.EMAIL_USER,
            pass: process.env.EMAIL_PASS // 16-character App Password
        }
    });

    const sapS4 = await cds.connect.to('ZUI_COLLECTIQ_04');

    // Action: Sync Data from S/4HANA
    this.on('syncAR', async (req) => {
        try {
            console.log(">>> Starting Sync from S/4HANA...");
            const remoteData = await sapS4.run(SELECT.from(InvoicesS4));

            if (!remoteData || remoteData.length === 0) return "No data found in SAP.";

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
                        maxDaysPastDue: 0,
                        contactEmail: row.CustomerEmail || 'ar_test@example.com'
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
                // Determine Stage and UI Criticality
                if (p.maxDaysPastDue <= 5) { p.stage = 'STAGE_1'; p.criticality = 3; }
                else if (p.maxDaysPastDue <= 10) { p.stage = 'STAGE_2'; p.criticality = 2; }
                else { p.stage = 'STAGE_3'; p.criticality = 1; }
                return p;
            });

            await INSERT.into(Payers).entries(finalPayers);
            await INSERT.into(Invoices).entries(invoiceEntries);

            return `Sync complete: ${finalPayers.length} payers processed.`;
        } catch (err) {
            return req.error(500, `Sync failed: ${err.message}`);
        }
    });

    // Action: Generate Outreach using Gemini AI
    this.on('generateOutreach', 'Payers', async (req) => {
        const id = req.params[0].payerId;
        const payer = await SELECT.one.from(Payers).where({ payerId: id });
        if (!payer) return req.error(404, "Payer not found.");

        let tonePrompt = "";
        if (payer.stage === 'STAGE_1') {
            tonePrompt = `Draft a polite payment reminder email. Balance: ${payer.totalPastDue}. Keep tone courteous and professional.`;
        } else if (payer.stage === 'STAGE_2') {
            tonePrompt = `Draft a firm second-notice email. Balance: ${payer.totalPastDue}. Mention that this is a second notice and payment is required immediately.`;
        } else {
            tonePrompt = `Draft a short, serious CALL SCRIPT for an AI voice agent. Include greeting, balance of ${payer.totalPastDue}, and a direct ask for payment timing.`;
        }

        const prompt = `Act as an SAP Collections Agent. Customer: ${payer.payerName}. ${tonePrompt}`;

        try {
            const response = await axios.post(
                `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${process.env.GEMINI_API_KEY}`,
                { contents: [{ parts: [{ text: prompt }] }] }
            );

            const aiDraft = response.data.candidates[0].content.parts[0].text;

            await INSERT.into(OutreachHistory).entries({
                payerId: id,
                stageAtGeneration: payer.stage,
                outreachType: (payer.stage === 'STAGE_3') ? 'VOICE' : 'EMAIL',
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
            return req.error(500, `AI Generation failed: ${err.message}`);
        }
    });

    // Action: Send Real Outreach (Email or AI Voice)
    this.on('sendOutreach', 'Payers', async (req) => {
        const id = req.params[0].payerId;
        const payer = await SELECT.one.from(Payers).where({ payerId: id });

        if (!payer || !payer.latestOutreachDraft) {
            return req.error(400, "Please generate an AI draft first.");
        }

        // --- STAGE 3: AI Voice Call with Vapi.ai ---
        if (payer.stage === 'STAGE_3') {
            try {
                const vapiResponse = await axios.post('https://api.vapi.ai/call/phone', {
                    assistantId: process.env.VAPI_ASSISTANT_ID,
                    phoneNumberId: process.env.VAPI_PHONE_NUMBER_ID,
                    customer: { number: "+15122154525", name: payer.payerName },
                    assistantOverrides: { firstMessage: payer.latestOutreachDraft }
                }, { headers: { 'Authorization': `Bearer ${process.env.VAPI_API_KEY}` } });

                await UPDATE(Payers, id).with({
                    lastOutreachStatus: 'CALL_INITIATED',
                    lastOutreachAt: new Date().toISOString()
                });

                return `Vapi AI Voice Call initiated to +15122154525!`;
            } catch (err) { return req.error(500, `Voice Call Failed: ${err.message}`); }
        }

        // --- STAGE 1 & 2: HTML Email + Payment Redirect Link ---
        const redirectUrl = `https://port4004-workspaces-ws-31sjr.us10.trial.applicationstudio.cloud.sap/portal.html?payerId=${payer.payerId}&amount=${payer.totalPastDue}`;

        const htmlBody = `
            <div style="font-family: sans-serif; color: #333; line-height: 1.6; max-width: 600px;">
                <p>Dear <strong>${payer.payerName}</strong>,</p>
                <p>${payer.latestOutreachDraft.replace(/\n/g, '<br>')}</p>
                <div style="background-color: #f4f7f9; border: 1px solid #e0e4e7; padding: 25px; margin: 20px 0; border-radius: 8px; text-align: center;">
                    <h2 style="color: #004488; margin-top: 0;">Vegah CollectIQ Payment Portal</h2>
                    <p style="margin-bottom: 20px;">To process your payment securely, please click the button below:</p>
                    <a href="${redirectUrl}"
                       style="background-color: #004488; color: white; padding: 14px 28px; text-decoration: none; border-radius: 5px; font-weight: bold; display: inline-block;">
                       SECURE PAYMENT PORTAL
                    </a>
                    <p style="font-size: 11px; color: #777; margin-top: 15px;">Reference ID: ${payer.payerId} | Secure SAP BTP Transaction</p>
                </div>
                <p>Regards,<br><strong>Accounts Receivable Team</strong></p>
            </div>`;

        try {
            await transporter.sendMail({
                from: `"Vegah CollectIQ" <${process.env.EMAIL_USER}>`,
                to: payer.contactEmail,
                subject: `URGENT: Payment Reminder - ${payer.payerName}`,
                html: htmlBody
            });

            await UPDATE(Payers, id).with({
                lastOutreachStatus: 'SENT',
                lastOutreachAt: new Date().toISOString()
            });

            return `Email sent successfully to ${payer.contactEmail}!`;
        } catch (err) { return req.error(500, `Email failed: ${err.message}`); }
    });
});