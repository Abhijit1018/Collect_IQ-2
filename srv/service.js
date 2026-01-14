const cds = require('@sap/cds');
const axios = require('axios');
const nodemailer = require('nodemailer');
require('dotenv').config();

module.exports = cds.service.impl(async function() {
    const { Invoices, Payers, OutreachHistory } = this.entities;

    // 1. Setup Real Email Transporter (Enterprise configuration)
    // Logics: Using .env variables for security as per BTP standards
    const transporter = nodemailer.createTransport({
        host: process.env.EMAIL_HOST,
        port: process.env.EMAIL_PORT,
        secure: true,
        auth: {
            user: process.env.EMAIL_USER,
            pass: process.env.EMAIL_PASS
        }
    });

    // 2. Connect to the External OData v4 Service
    // Logics: Connection must use the destination defined in package.json
    const sapS4 = await cds.connect.to('ZUI_COLLECTIQ_V4');

    // --- Action: Sync Data from S/4HANA (Refactored for V4 Metadata) ---
    // Logics: Deep sync using Navigation Properties and CamelCase mapping
    this.on('syncAR', async (req) => {
        try {
            console.log(">>> Starting Sync from S/4HANA (v4 Deep Sync via Communication User)...");
            
            // FIX: Querying the remote EntitySet 'Payer' directly from the service 
            // instead of the local projection to avoid "Navigation property not found" errors.
            const remoteData = await sapS4.run(SELECT.from('Payer').columns(p => {
                p.PayerId, p.PayerName, p.TotalPastDue, p.MaxDaysPastDue, p.Stage, p.ContactEmail, p.Currency,
                p._Invoices(i => {
                    i.InvoiceId, i.InvoiceNumber, i.InvoiceAmount, i.DueDate, i.DaysPastDue, i.Currency
                })
            }));

            if (!remoteData || remoteData.length === 0) {
                return "No data found in SAP S/4HANA. Check Technical User permissions.";
            }

            // Clean local HANA Cloud storage before inserting fresh data (Logical Persistence)
            await DELETE.from(Payers);
            await DELETE.from(Invoices);

            const finalPayers = [];
            const invoiceEntries = [];

            remoteData.forEach(row => {
                // Logic: Determine Local Stage and UI Criticality based on Aging (MaxDaysPastDue)
                let stage = row.Stage; 
                let criticality = 0;
                if (row.MaxDaysPastDue <= 5) { 
                    stage = 'STAGE_1'; 
                    criticality = 3; 
                } else if (row.MaxDaysPastDue <= 10) { 
                    stage = 'STAGE_2'; 
                    criticality = 2; 
                } else { 
                    stage = 'STAGE_3'; 
                    criticality = 1; 
                }

                // Mapping remote CamelCase to local schema properties
                finalPayers.push({
                    PayerId: row.PayerId,
                    PayerName: row.PayerName,
                    TotalPastDue: Number(row.TotalPastDue),
                    MaxDaysPastDue: row.MaxDaysPastDue,
                    Stage: stage,
                    criticality: criticality,
                    ContactEmail: row.ContactEmail || 'ar_test@example.com',
                    Currency: row.Currency,
                    LastOutreachStatus: 'NOT_STARTED' // Updated to match CamelCase schema
                });

                // Logic: Mapping deep expanded invoices from S/4 to local HANA table
                if (row._Invoices) {
                    row._Invoices.forEach(inv => {
                        invoiceEntries.push({
                            InvoiceId: inv.InvoiceId,
                            PayerId: row.PayerId,
                            InvoiceNumber: inv.InvoiceNumber,
                            InvoiceAmount: inv.InvoiceAmount,
                            DueDate: inv.DueDate,
                            DaysPastDue: inv.DaysPastDue,
                            Currency: inv.Currency
                        });
                    });
                }
            });

            // Logical Insert: Bulk entries for better performance in BTP
            await INSERT.into(Payers).entries(finalPayers);
            await INSERT.into(Invoices).entries(invoiceEntries);

            console.log(`>>> Success: ${finalPayers.length} payers and ${invoiceEntries.length} invoices synced.`);
            return `Sync complete: ${finalPayers.length} payers processed via V4 Service.`;
        } catch (err) {
            console.error(">>> Sync Error:", err.message);
            return req.error(500, `V4 Sync failed: ${err.message}`);
        }
    });

    // --- Action: Generate Outreach using Gemini AI ---
    // Logics: Dynamic prompt engineering based on Aging Stage
    this.on('generateOutreach', 'Payers', async (req) => {
        const id = req.params[0].PayerId; 
        const payer = await SELECT.one.from(Payers).where({ PayerId: id });
        if (!payer) return req.error(404, "Payer not found in HANA Cloud.");

        let tonePrompt = "";
        if (payer.Stage === 'STAGE_1') {
            tonePrompt = `Draft a polite payment reminder email. Balance: ${payer.TotalPastDue}. Keep tone courteous and professional.`;
        } else if (payer.Stage === 'STAGE_2') {
            tonePrompt = `Draft a firm second-notice email. Balance: ${payer.TotalPastDue}. Mention that this is a second notice and payment is required immediately.`;
        } else {
            tonePrompt = `Draft a short, serious CALL SCRIPT for an AI voice agent. Include greeting, balance of ${payer.TotalPastDue}, and a direct ask for payment timing.`;
        }

        const prompt = `Act as an SAP Collections Agent. Customer: ${payer.PayerName}. ${tonePrompt}`;

        try {
            console.log(">>> Requesting Gemini AI for draft generation...");
            const response = await axios.post(
                `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${process.env.GEMINI_API_KEY}`,
                { contents: [{ parts: [{ text: prompt }] }] }
            );

            const aiDraft = response.data.candidates[0].content.parts[0].text;

            // Logic: Maintain history and update the Payer record with the latest preview
            await INSERT.into(OutreachHistory).entries({
                PayerId: id, // Fixed mapping
                stageAtGeneration: payer.Stage,
                outreachType: (payer.Stage === 'STAGE_3') ? 'VOICE' : 'EMAIL',
                bodyText: aiDraft,
                status: 'DRAFT_GENERATED'
            });

            await UPDATE(Payers, id).with({
                LastOutreachStatus: 'DRAFT_GENERATED',
                lastOutreachAt: new Date().toISOString(),
                latestOutreachDraft: aiDraft
            });

            return aiDraft;
        } catch (err) {
            return req.error(500, `AI Generation failed: ${err.message}`);
        }
    });

    // --- Action: Send Real Outreach (Email or AI Voice) ---
    // Logics: Integration with Nodemailer for Email and Vapi for Voice
    this.on('sendOutreach', 'Payers', async (req) => {
        const id = req.params[0].PayerId; 
        const payer = await SELECT.one.from(Payers).where({ PayerId: id });

        if (!payer || !payer.latestOutreachDraft) {
            return req.error(400, "Logic Error: Please generate an AI draft first.");
        }

        // Logic for STAGE_3: Automatic Voice Call Initiation
        if (payer.Stage === 'STAGE_3') {
            try {
                console.log(`>>> Initiating Vapi AI Call for ${payer.PayerName}...`);
                await axios.post('https://api.vapi.ai/call/phone', {
                    assistantId: process.env.VAPI_ASSISTANT_ID,
                    phoneNumberId: process.env.VAPI_PHONE_NUMBER_ID,
                    customer: { number: "+15122154525", name: payer.PayerName },
                    assistantOverrides: { firstMessage: payer.latestOutreachDraft }
                }, { headers: { 'Authorization': `Bearer ${process.env.VAPI_API_KEY}` } });

                await UPDATE(Payers, id).with({
                    LastOutreachStatus: 'CALL_INITIATED',
                    lastOutreachAt: new Date().toISOString()
                });

                return `Vapi AI Voice Call initiated successfully to +15122154525!`;
            } catch (err) { 
                return req.error(500, `Voice Call Integration Failed: ${err.message}`); 
            }
        }

        // Logic for STAGE_1 & 2: Professional Email Outreach with Payment Portal Link
        const redirectUrl = `https://port4004-workspaces-ws-31sjr.us10.trial.applicationstudio.cloud.sap/portal.html?payerId=${payer.PayerId}&amount=${payer.TotalPastDue}`;

        const htmlBody = `
            <div style="font-family: Arial, sans-serif; color: #333; line-height: 1.6; max-width: 600px; border: 1px solid #eee; padding: 20px;">
                <p>Dear <strong>${payer.PayerName}</strong>,</p>
                <p>${payer.latestOutreachDraft.replace(/\n/g, '<br>')}</p>
                <div style="background-color: #f4f7f9; border: 1px solid #e0e4e7; padding: 25px; margin: 20px 0; border-radius: 8px; text-align: center;">
                    <h2 style="color: #004488; margin-top: 0;">CollectIQ Payment Portal</h2>
                    <p style="margin-bottom: 20px;">To process your payment securely via SAP BTP, please click below:</p>
                    <a href="${redirectUrl}"
                       style="background-color: #004488; color: white; padding: 14px 28px; text-decoration: none; border-radius: 5px; font-weight: bold; display: inline-block;">
                       SECURE PAYMENT PORTAL
                    </a>
                    <p style="font-size: 11px; color: #777; margin-top: 15px;">Reference ID: ${payer.PayerId} | Authorized Transaction</p>
                </div>
                <p>Regards,<br><strong>Accounts Receivable Team</strong><br>Vegah CollectIQ Division</p>
            </div>`;

        try {
            console.log(`>>> Sending Email Outreach to ${payer.ContactEmail}...`);
            await transporter.sendMail({
                from: `"Vegah CollectIQ" <${process.env.EMAIL_USER}>`,
                to: payer.ContactEmail,
                subject: `URGENT: Payment Reminder - ${payer.PayerName}`,
                html: htmlBody
            });

            await UPDATE(Payers, id).with({
                LastOutreachStatus: 'SENT',
                lastOutreachAt: new Date().toISOString()
            });

            return `Email outreach sent successfully to ${payer.ContactEmail}!`;
        } catch (err) { 
            console.error(">>> Email Error:", err.message);
            return req.error(500, `Email delivery failed: ${err.message}`); 
        }
    });
});