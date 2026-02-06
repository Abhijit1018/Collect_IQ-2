const cds = require('@sap/cds');
const path = require('path');
const axios = require('axios');
const nodemailer = require('nodemailer');
const twilio = require('twilio');
const { CronJob } = require('cron');
const expressWs = require('express-ws');
const WebSocket = require('ws');
const stage1Template = require('./templates/stage1');
const stage2Template = require('./templates/stage2');

// Inline voice script generator (no external template dependency)
const generateVoiceScript = (payerName, amount, currency) => {
  return `Hello, this is Vegah CollectIQ calling for ${payerName}. You have an outstanding balance of ${amount} ${currency || 'USD'}. Is this a good time to discuss your payment options?`;
};
const { GoogleGenerativeAI } = require("@google/generative-ai");

// Load .env from project root (fixes path issues when running from srv/)
require('dotenv').config({ path: path.resolve(__dirname, '../.env') });
console.log(`>>> [ENV] DEEPGRAM_API_KEY loaded: ${process.env.DEEPGRAM_API_KEY ? 'YES' : 'NO'}`);
console.log(`>>> [ENV] GEMINI_API_KEY loaded: ${process.env.GEMINI_API_KEY ? 'YES' : 'NO'}`);

module.exports = cds.service.impl(async function () {
  const { Invoices, Payers, OutreachHistory, CallTranscripts, ScheduledFollowups, PaymentStatusLog } = this.entities;
  const self = this;

  // 1. Setup Real Email Transporter (SECURE PORTAL EMAILS INTACT)
  const transporter = nodemailer.createTransport({
    host: process.env.EMAIL_HOST,
    port: process.env.EMAIL_PORT || 587,
    secure: false, // true for 465, false for 587
    auth: {
      user: process.env.EMAIL_USER,
      pass: process.env.EMAIL_PASS,
    },
  });

  // 2. Setup Twilio Client
  const twilioClient = new twilio(
    process.env.TWILIO_ACCOUNT_SID,
    process.env.TWILIO_AUTH_TOKEN
  );

  // 3. Connect to S/4HANA Service
  const sapS4 = await cds.connect.to('ZUI_COLLECTIQ_V4');

  // --- HELPER FUNCTIONS ---
  const { SELECT, UPDATE, UPSERT, INSERT } = cds.ql;

  async function _generateOutreach(payerId) {
    console.log(`>>> [generateOutreach] Processing PayerId: ${payerId}`);
    const payer = await SELECT.one.from(Payers).where({ PayerId: payerId });
    console.log(`>>> [generateOutreach] Found payer: ${payer ? payer.PayerName : 'NOT FOUND'}`);

    if (!payer) throw new Error('Payer not found.');

    let finalDraft = '';
    let subjectLine = '';

    // --- DYNAMIC STAGE & AMOUNT CALCULATION START ---
    // Fetch invoices to recalculate stage and total amount dynamically
    const invoices = await SELECT.from(Invoices).where({ PayerId: payerId });
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    let maxDays = 0;
    let totalPastDue = 0;

    invoices.forEach(inv => {
      // Sum up total past due amount
      if (inv.InvoiceAmount) {
        totalPastDue += Number(inv.InvoiceAmount);
      }

      if (inv.DueDate) {
        const dueDate = new Date(inv.DueDate);
        dueDate.setHours(0, 0, 0, 0);
        const diffTime = today - dueDate;
        const diffDays = Math.floor(diffTime / (1000 * 60 * 60 * 24));
        if (diffDays > maxDays) maxDays = diffDays;
      }
    });

    let calculatedStage = 'STAGE_1';
    if (maxDays <= 5) {
      calculatedStage = 'STAGE_1';
    } else if (maxDays <= 10) {
      calculatedStage = 'STAGE_2';
    } else {
      calculatedStage = 'STAGE_3';
    }

    console.log(`>>> [generateOutreach] Calculated Stage: ${calculatedStage}, TotalPastDue: ${totalPastDue}`);

    // Update payer data in memory
    payer.Stage = calculatedStage;
    payer.TotalPastDue = totalPastDue;

    // Persist to DB
    await UPDATE(Payers).set({
      Stage: calculatedStage,
      MaxDaysPastDue: maxDays,
      TotalPastDue: totalPastDue
    }).where({ PayerId: payerId });
    // --- DYNAMIC STAGE & AMOUNT CALCULATION END ---

    if (payer.Stage === 'STAGE_1') {
      const t = stage1Template(payer.PayerName, payer.TotalPastDue, payer.Currency);
      finalDraft = t.body;
      subjectLine = t.subject;
    } else if (payer.Stage === 'STAGE_2') {
      const t = stage2Template(payer.PayerName, payer.TotalPastDue, payer.Currency);
      finalDraft = t.body;
      subjectLine = t.subject;
    } else {
      // Stage 3: Urgent collection call script
      subjectLine = 'Urgent: Payment Reminder - Action Required';
      finalDraft = generateVoiceScript(payer.PayerName, payer.TotalPastDue, payer.Currency);
    }

    await UPDATE(Payers)
      .set({
        LastOutreachStatus: 'DRAFT_GENERATED',
        lastOutreachAt: new Date().toISOString(),
        latestOutreachDraft: finalDraft,
        latestSubjectLine: subjectLine,
      })
      .where({ PayerId: payerId });

    console.log(`>>> [generateOutreach] Draft updated in DB for ${payerId}`);
    return finalDraft;
  }

  async function _sendOutreach(payerId) {
    console.log(`>>> [sendOutreach] Processing PayerId: ${payerId}`);
    const payer = await SELECT.one.from(Payers).where({ PayerId: payerId });
    console.log(`>>> [sendOutreach] Found payer: ${payer ? payer.PayerName : 'NOT FOUND'}`);
    console.log(`>>> [sendOutreach] Payer Stage: ${payer ? payer.Stage : 'N/A'}`);

    // --- STAGE 3: TWILIO CALL ---
    if (payer.Stage === 'STAGE_3') {
      const ngrokUrl = process.env.NGROK_URL;
      console.log(`>>> [sendOutreach] NGROK_URL: ${ngrokUrl}`);
      console.log(`>>> [sendOutreach] Phone: ${payer.ContactPhone}`);
      console.log(`>>> [sendOutreach] Twilio Phone: ${process.env.TWILIO_PHONE_NUMBER}`);

      try {
        console.log(`>>> [TWILIO] Attempting call to ${payer.ContactPhone}...`);
        const call = await twilioClient.calls.create({
          from: process.env.TWILIO_PHONE_NUMBER,
          to: payer.ContactPhone,
          url: `${ngrokUrl}/collect-iq/voice?payerId=${payerId}`,
        });
        console.log(`>>> [TWILIO] SUCCESS! Call SID: ${call.sid} - Status: ${call.status}`);

        await UPDATE(Payers)
          .set({ LastOutreachStatus: 'CALL_INITIATED' })
          .where({ PayerId: payerId });

        await INSERT.into(OutreachHistory).entries({
          payer_PayerId: payerId,
          outreachType: 'call',
          outreachDate: new Date().toISOString(),
          status: 'sent',
          notes: `Twilio Call SID: ${call.sid}`
        });

      } catch (err) {
        console.error('>>> [TWILIO ERROR]: Call failed to trigger!');
        console.error(`>>> Reason: ${err.message}`);

        await INSERT.into(OutreachHistory).entries({
          payer_PayerId: payerId,
          outreachType: 'call',
          outreachDate: new Date().toISOString(),
          status: 'failed',
          notes: `Check logs. Error: ${err.message}`
        });

        throw err;
      }
    }
    // --- STAGES 1 & 2: SECURE PORTAL EMAIL ROUTING ---
    else if (payer.Stage === 'STAGE_1' || payer.Stage === 'STAGE_2') {
      console.log(`>>> [sendOutreach] Sending email for ${payer.Stage}...`);

      let appUrl = process.env.appUrl || 'http://localhost:4004';
      if (!process.env.appUrl && process.env.VCAP_APPLICATION) {
        const vcap = JSON.parse(process.env.VCAP_APPLICATION);
        appUrl = `https://${vcap.application_uris[0]}`;
      }

      let cleanBaseUrl = appUrl.endsWith('/') ? appUrl.slice(0, -1) : appUrl;
      let redirectUrl = `${cleanBaseUrl}/collectiq_ui/webapp/portal.html?payerId=${payer.PayerId}&amount=${payer.TotalPastDue}`;

      try {
        const htmlBody = `
          <div style="font-family: Arial, sans-serif; color: #333; line-height: 1.6; max-width: 600px; border: 1px solid #eee; padding: 20px;">
            <p>${payer.latestOutreachDraft.replace(/\n/g, '<br>')}</p>
            <div style="background-color: #f4f7f9; border: 1px solid #e0e4e7; padding: 25px; margin: 20px 0; border-radius: 8px; text-align: center;">
              <h2 style="color: #004488; margin-top: 0;">CollectIQ Payment Portal</h2>
              <p>To process your payment securely via SAP BTP, please click below:</p>
              <a href="${redirectUrl}" style="background-color: #004488; color: white; padding: 14px 28px; text-decoration: none; border-radius: 5px; font-weight: bold; display: inline-block;">SECURE PAYMENT PORTAL</a>
            </div>
            <p>Regards,<br><strong>Accounts Receivable Team</strong></p>
          </div>`;

        await transporter.sendMail({
          from: `"Vegah CollectIQ" <${process.env.EMAIL_USER}>`,
          to: payer.ContactEmail,
          subject: payer.latestSubjectLine || 'Payment Reminder',
          html: htmlBody,
        });

        await UPDATE(Payers)
          .set({ LastOutreachStatus: 'SENT', lastOutreachAt: new Date().toISOString() })
          .where({ PayerId: payerId });

        await INSERT.into(OutreachHistory).entries({
          payer_PayerId: payerId,
          outreachType: 'email',
          outreachDate: new Date().toISOString(),
          status: 'sent',
          bodyText: htmlBody, // Check length limit in schema
          notes: `Sent via Nodemailer to ${payer.ContactEmail}`
        });

        console.log(`>>> [EMAIL] Sent to ${payer.ContactEmail}`);
      } catch (err) {
        console.error('>>> [EMAIL ERROR]:', err.message);

        await INSERT.into(OutreachHistory).entries({
          payer_PayerId: payerId,
          outreachType: 'email',
          outreachDate: new Date().toISOString(),
          status: 'failed',
          notes: `Email failed: ${err.message}`
        });

        throw err;
      }
    } else {
      console.log(`>>> [sendOutreach] Unknown stage: ${payer.Stage}`);
    }
  }

  // --- A. CRON SCHEDULER WITH VERBOSE DIAGNOSTICS ---
  const job = new CronJob(
    '*/1000000 * * * *', // Every 2 minutes for testing; change to '0 0 11 * * *' for 11:00 AM IST
    async () => {
      try {
        console.log('>>> [SCHEDULER] ====== STARTING SCHEDULER CYCLE ======');
        const db = await cds.connect.to('db');

        console.log('>>> [SCHEDULER] Fetching all payers from DB...');
        const all = await db.run(
          SELECT.from('my.collectiq.Payers').columns(
            'PayerId',
            'PayerName',
            'Stage',
            'LastOutreachStatus',
            'ContactPhone',
            'ContactEmail',
            'TotalPastDue',
            'latestOutreachDraft'
          )
        );

        console.log('>>> [SCHEDULER] All Payers in DB:');
        console.table(
          all.map((p) => ({
            PayerId: p.PayerId,
            PayerName: p.PayerName,
            Stage: p.Stage,
            LastOutreachStatus: p.LastOutreachStatus,
            Phone: p.ContactPhone,
          }))
        );

        // Filter for STAGE_1, STAGE_2, and STAGE_3 (all stages)
        const norm = (v) => (v || '').trim().toUpperCase();
        const pending = all.filter((p) => {
          const stage = norm(p.Stage);
          return stage === 'STAGE_1' || stage === 'STAGE_2' || stage === 'STAGE_3';
        });

        console.log(`>>> [SCHEDULER] Found ${pending.length} pending payers (Stage 1, 2, or 3).`);

        for (const payer of pending) {
          console.log(`\n>>> [SCHEDULER] ====== PROCESSING PAYER: ${payer.PayerName} (${payer.PayerId}) ======`);
          console.log(`>>> [SCHEDULER] Phone: ${payer.ContactPhone}`);
          console.log(`>>> [SCHEDULER] Email: ${payer.ContactEmail}`);
          console.log(`>>> [SCHEDULER] Stage: ${payer.Stage}`);
          console.log(`>>> [SCHEDULER] Status: ${payer.LastOutreachStatus}`);

          try {
            console.log(`>>> [SCHEDULER] Step 1: Calling _generateOutreach...`);
            await _generateOutreach(payer.PayerId);
            console.log(`>>> [SCHEDULER] Step 1: _generateOutreach completed.`);

            console.log(`>>> [SCHEDULER] Step 2: Calling _sendOutreach...`);
            await _sendOutreach(payer.PayerId);
            console.log(`>>> [SCHEDULER] Step 2: _sendOutreach completed.`);
          } catch (err) {
            console.error(`>>> [SCHEDULER] ERROR for ${payer.PayerId}:`);
            console.error(`>>> [SCHEDULER] Message: ${err.message}`);
            console.error('>>> [SCHEDULER] Stack:', err.stack);
          }
        }

        console.log('>>> [SCHEDULER] ====== CYCLE COMPLETE ======\n');
      } catch (err) {
        console.error('>>> [SCHEDULER ERROR] Main scheduler error:');
        console.error(`>>> Message: ${err.message}`);
        console.error('>>> Stack:', err.stack);
      }
    },
    null,
    true, // ENABLED: Auto-start
    'Asia/Kolkata'
  );

  console.log('[SCHEDULER] Cron job ENABLED - running every 2 minutes');
  console.log('[SCHEDULER] Sends: STAGE_1 & STAGE_2 = Email, STAGE_3 = Twilio Call');
  console.log('[SCHEDULER] Env check - TWILIO_PHONE_NUMBER:', process.env.TWILIO_PHONE_NUMBER ? 'SET' : 'MISSING');
  console.log('[SCHEDULER] Env check - NGROK_URL:', process.env.NGROK_URL ? 'SET' : 'MISSING');

  // --- B. Action: Sync Data from S/4HANA (REAL MODE) ---
  this.on('syncAR', async (req) => {
    try {
      console.log('>>> [SYNC] Connecting to ABAP System...');
      const sapS4 = await cds.connect.to('ZUI_COLLECTIQ_V4');

      // 1. Fetch data from ABAP service (Entity name must match your CSN exactly)
      console.log('>>> [SYNC] Fetching external AR data...');
      const externalData = await sapS4.run(
        SELECT.from('ZUI_COLLECTIQ_V4.ZUI_COLLECTIQ_V4_EntityType') // Update entity name if different
      );

      console.log(`>>> [SYNC] Received ${externalData.length} records from ABAP.`);

      // 2. Map external data to local Payer structure
      const mappedData = externalData.map((item) => ({
        PayerId: item.PayerId,
        PayerName: item.PayerName,
        TotalPastDue: item.TotalPastDue,
        Currency: item.CurrencyCode || 'USD',
        Stage: item.Stage || 'STAGE_1',
        LastOutreachStatus: 'NOT_STARTED', // Reset status on sync
        ContactEmail: item.EmailAddress,
        ContactPhone: item.PhoneNumber,
      }));

      // 3. Upsert into Local HANA DB
      const db = await cds.connect.to('db');
      await db.run(UPSERT.into(Payers).entries(mappedData));

      console.log('>>> [SYNC] Success! Local HANA DB updated.');
      return 'Sync completed successfully!';
    } catch (err) {
      console.error('>>> [SYNC ERROR]:', err.message);
      return req.error(500, `Sync failed: ${err.message}`);
    }
  });

  // --- C. Action: Generate Outreach (UI Button - Entity action) ---
  this.on('generateOutreach', 'Payers', async (req) => {
    const id = req.data.PayerId || req.params[0].PayerId;
    await _generateOutreach(id);
    return 'Draft generated.';
  });

  // --- D. Action: Send Real Outreach (UI Button - Entity action) ---
  this.on('sendOutreach', 'Payers', async (req) => {
    const id = req.data.PayerId || req.params[0].PayerId;
    await _sendOutreach(id);
    return 'Outreach sent.';
  });

  // --- E. After READ: Calculate DaysPastDue dynamically for Invoices ---
  this.after('READ', 'Invoices', (invoices) => {
    console.log('>>> [AFTER READ Invoices] Triggered');
    const today = new Date();
    today.setHours(0, 0, 0, 0); // Reset to start of day
    console.log('>>> [AFTER READ Invoices] Today:', today.toISOString());

    const invoiceArray = Array.isArray(invoices) ? invoices : (invoices ? [invoices] : []);
    console.log('>>> [AFTER READ Invoices] Processing', invoiceArray.length, 'invoices');

    invoiceArray.forEach(invoice => {
      if (invoice && invoice.DueDate) {
        const dueDate = new Date(invoice.DueDate);
        dueDate.setHours(0, 0, 0, 0);
        const diffTime = today - dueDate;
        const diffDays = Math.floor(diffTime / (1000 * 60 * 60 * 24));
        invoice.DaysPastDue = diffDays > 0 ? diffDays : 0;
        console.log(`>>> [AFTER READ Invoices] Invoice ${invoice.InvoiceNumber}: DueDate=${invoice.DueDate}, DaysPastDue=${invoice.DaysPastDue}`);
      } else {
        console.log('>>> [AFTER READ Invoices] Invoice missing or no DueDate:', JSON.stringify(invoice));
      }
    });
  });

  // --- F. After READ: Calculate MaxDaysPastDue and Stage dynamically for Payers ---
  // Also updates DaysPastDue for expanded Invoices
  this.after('READ', 'Payers', async (payers) => {
    const db = await cds.connect.to('db');
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const payerArray = Array.isArray(payers) ? payers : (payers ? [payers] : []);

    for (const payer of payerArray) {
      if (payer && payer.PayerId) {
        // Check if Invoices were expanded with the Payer
        let invoices = payer.Invoices;

        // If not expanded, fetch from DB
        if (!invoices || invoices.length === 0) {
          invoices = await db.run(
            SELECT.from('my.collectiq.Invoices').where({ PayerId: payer.PayerId })
          );
        }

        let maxDays = 0;
        invoices.forEach(inv => {
          if (inv.DueDate) {
            const dueDate = new Date(inv.DueDate);
            dueDate.setHours(0, 0, 0, 0);
            const diffTime = today - dueDate;
            const diffDays = Math.floor(diffTime / (1000 * 60 * 60 * 24));
            const daysPastDue = diffDays > 0 ? diffDays : 0;

            // Update the invoice DaysPastDue if it's expanded
            inv.DaysPastDue = daysPastDue;

            if (daysPastDue > maxDays) {
              maxDays = daysPastDue;
            }
          }
        });

        payer.MaxDaysPastDue = maxDays > 0 ? maxDays : 0;

        // Calculate Stage dynamically based on MaxDaysPastDue
        // <= 5 days: STAGE_1
        // 5-10 days: STAGE_2
        // > 10 days: STAGE_3
        if (payer.MaxDaysPastDue <= 5) {
          payer.Stage = 'STAGE_1';
        } else if (payer.MaxDaysPastDue <= 10) {
          payer.Stage = 'STAGE_2';
        } else {
          payer.Stage = 'STAGE_3';
        }

        // Also update criticality based on stage
        if (payer.Stage === 'STAGE_3') {
          payer.criticality = 1; // High priority
        } else if (payer.Stage === 'STAGE_2') {
          payer.criticality = 2; // Medium priority
        } else {
          payer.criticality = 3; // Low priority
        }
      }
    }
  });

  // --- G. WEBHOOK HANDLERS (INSIDE SERVICE FUNCTION) ---
  const app = cds.app;
  const bodyParser = require('body-parser');
  app.use(bodyParser.json());
  app.use(bodyParser.urlencoded({ extended: false }));

  // Initialize express-ws for WebSocket support
  expressWs(app);

  console.log('>>> [ROUTES] Registering webhook routes...');

  // INITIAL VOICE PROMPT (Watermark)
  app.all('/collect-iq/voice', async (req, res) => {
    console.log(`\n>>> [VOICE] ========== VOICE CALL START ==========`);
    console.log(`>>> [VOICE] Query:`, req.query);

    try {
      const { payerId } = req.query;

      if (!payerId) {
        console.error(`>>> [VOICE ERROR] No payerId in query!`);
        const twiml = new (require('twilio').twiml.VoiceResponse)();
        twiml.say('Error: No account ID provided.');
        twiml.hangup();
        return res.type('text/xml').send(twiml.toString());
      }

      const db = await cds.connect.to('db');
      const payer = await db.run(SELECT.one.from('my.collectiq.Payers').where({ PayerId: payerId }));

      console.log(`>>> [VOICE] PayerId: ${payerId}, Found: ${payer ? 'YES' : 'NO'}`);

      if (!payer) {
        const twiml = new (require('twilio').twiml.VoiceResponse)();
        twiml.say('Sorry, we could not find your account.');
        twiml.hangup();
        console.log(`>>> [VOICE] Sending error response (payer not found)`);
        return res.type('text/xml').send(twiml.toString());
      }

      const ngrokUrl = process.env.NGROK_URL;
      console.log(`>>> [VOICE] Payer: ${payer.PayerName}, NGROK_URL: ${ngrokUrl}`);

      const twiml = new (require('twilio').twiml.VoiceResponse)();

      // Connect to WebSocket media stream for real-time audio handling
      // Use customParameters to reliably pass payerId (Twilio strips URL query params)
      const connect = twiml.connect();
      const stream = connect.stream({
        url: `wss://${ngrokUrl.replace('https://', '')}/collect-iq/media-stream`,
      });
      // Pass payerId via customParameters - Twilio includes these in the 'start' event
      stream.parameter({ name: 'payerId', value: payerId });

      const response = twiml.toString();
      console.log(`>>> [VOICE] Sending TwiML response with media stream`);
      console.log(`>>> [VOICE] Response length: ${response.length} bytes`);

      res.type('text/xml');
      res.send(response);
    } catch (err) {
      console.error(`>>> [VOICE EXCEPTION]:`, err.message);
      console.error(err.stack);

      const twiml = new (require('twilio').twiml.VoiceResponse)();
      twiml.say('An error occurred. Please try again later.');
      twiml.hangup();

      res.type('text/xml');
      res.send(twiml.toString());
    }
  });

  // HANDLE USER INPUT & PLAY STAGE SCRIPT
  app.post('/collect-iq/handle-reminder', async (req, res) => {
    console.log(`\n>>> [HANDLE-REMINDER] ========== HANDLING INPUT ==========`);
    console.log(`>>> [HANDLE-REMINDER] Query:`, req.query);
    console.log(`>>> [HANDLE-REMINDER] Body:`, req.body);

    try {
      const { payerId } = req.query;
      const digit = req.body.Digits;

      const db = await cds.connect.to('db');
      const ngrokUrl = process.env.NGROK_URL;

      const payer = await db.run(SELECT.one.from('my.collectiq.Payers').where({ PayerId: payerId }));

      console.log(`>>> [HANDLE-REMINDER] PayerId: ${payerId}, Digit: ${digit}, Payer: ${payer ? payer.PayerName : 'NOT FOUND'}`);

      if (!payer) {
        const twiml = new (require('twilio').twiml.VoiceResponse)();
        twiml.say('Account not found.');
        twiml.hangup();
        return res.type('text/xml').send(twiml.toString());
      }

      const twiml = new (require('twilio').twiml.VoiceResponse)();

      if (digit === '1') {
        console.log(`>>> [HANDLE-REMINDER] User confirmed. Updating status and playing script...`);

        await db.run(
          UPDATE(Payers)
            .set({
              LastOutreachStatus: 'CALL_ANSWERED',
              lastOutreachAt: new Date().toISOString(),
            })
            .where({ PayerId: payerId })
        );

        const script = payer.latestOutreachDraft || 'Your payment is overdue. Please contact us.';
        console.log(`>>> [HANDLE-REMINDER] Script: ${script.substring(0, 80)}...`);

        twiml.say({ voice: 'alice' }, script);

        const gather = twiml.gather({
          numDigits: 1,
          action: `${ngrokUrl}/collect-iq/confirm-payment?payerId=${payerId}`,
          method: 'POST',
          timeout: 10,
        });

        gather.say({ voice: 'alice' }, 'Press 1 to confirm payment will be initiated. Press any other key to disconnect.');
      } else {
        console.log(`>>> [HANDLE-REMINDER] Invalid or no input. Disconnecting...`);
        twiml.say({ voice: 'alice' }, 'Invalid input. Goodbye.');
        await db.run(
          UPDATE(Payers).set({ LastOutreachStatus: 'CALL_DECLINED' }).where({ PayerId: payerId })
        );
        twiml.hangup();
      }

      const response = twiml.toString();
      console.log(`>>> [HANDLE-REMINDER] Sending response (${response.length} bytes)`);

      res.type('text/xml');
      res.send(response);
    } catch (err) {
      console.error(`>>> [HANDLE-REMINDER EXCEPTION]:`, err.message);
      console.error(err.stack);

      const twiml = new (require('twilio').twiml.VoiceResponse)();
      twiml.say('An error occurred.');
      twiml.hangup();

      res.type('text/xml');
      res.send(twiml.toString());
    }
  });

  // FINAL CONFIRMATION
  app.post('/collect-iq/confirm-payment', async (req, res) => {
    console.log(`\n>>> [CONFIRM-PAYMENT] ========== FINAL CONFIRMATION ==========`);
    console.log(`>>> [CONFIRM-PAYMENT] Query:`, req.query);
    console.log(`>>> [CONFIRM-PAYMENT] Body:`, req.body);

    try {
      const { payerId } = req.query;
      const digit = req.body.Digits;

      const db = await cds.connect.to('db');

      const twiml = new (require('twilio').twiml.VoiceResponse)();

      if (digit === '1') {
        console.log(`>>> [CONFIRM-PAYMENT] Confirmed for ${payerId}`);

        await db.run(
          UPDATE(Payers)
            .set({
              LastOutreachStatus: 'CALL_CONFIRMED',
              lastOutreachAt: new Date().toISOString(),
            })
            .where({ PayerId: payerId })
        );

        // Log to OutreachHistory (assuming the entities are available in this scope or can be accessed)
        try {
          await db.run(INSERT.into('my.collectiq.OutreachHistory').entries({
            payer_PayerId: payerId,
            outreachType: 'call',
            outreachDate: new Date().toISOString(),
            status: 'responded',
            responseReceived: true,
            responseDate: new Date().toISOString(),
            notes: 'User confirmed payment via IVR/AI.'
          }));
        } catch (e) { console.error("History Log Error", e); }

        twiml.say({ voice: 'alice' }, 'Thank you for confirming. Your record has been updated. Goodbye.');
      } else {
        console.log(`>>> [CONFIRM-PAYMENT] Declined for ${payerId}`);

        await db.run(
          UPDATE(Payers)
            .set({
              LastOutreachStatus: 'CALL_DECLINED',
              lastOutreachAt: new Date().toISOString(),
            })
            .where({ PayerId: payerId })
        );

        // Log to OutreachHistory
        try {
          await db.run(INSERT.into('my.collectiq.OutreachHistory').entries({
            payer_PayerId: payerId,
            outreachType: 'call',
            outreachDate: new Date().toISOString(),
            status: 'responded',
            responseReceived: true,
            responseDate: new Date().toISOString(),
            notes: 'User declined or invalid input.'
          }));
        } catch (e) { console.error("History Log Error", e); }

        twiml.say({ voice: 'alice' }, 'Our team will contact you shortly. Goodbye.');
      }

      twiml.hangup();
      res.type('text/xml');
      res.send(twiml.toString());
    } catch (err) {
      console.error(`>>> [CONFIRM-PAYMENT EXCEPTION]:`, err.message);
      console.error(err.stack);

      const twiml = new (require('twilio').twiml.VoiceResponse)();
      twiml.say('Error occurred. Goodbye.');
      twiml.hangup();

      res.type('text/xml');
      res.send(twiml.toString());
    }
  });

  // TEST ROUTE
  app.get('/test-route', (req, res) => {
    console.log('>>> TEST ROUTE HIT');
    res.send('Test route works! Routes are registering correctly.');
  });

  // SHADOW MODE (Gemini Simulation)
  app.post('/collect-iq/chat-simulation', async (req, res) => {
    console.log(`\n>>> [SHADOW-MODE] ========== CHAT SIMULATION ==========`);
    try {
      const { text, payerId } = req.body;
      const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
      // Define Tools for Gemini
      const tools = [
        {
          function_declarations: [
            {
              name: "schedule_followup",
              description: "Schedules a follow-up call or reminder for the customer.",
              parameters: {
                type: "OBJECT",
                properties: {
                  date: {
                    type: "STRING",
                    description: "The date for the follow-up in YYYY-MM-DD format. If the user says 'Monday', calculate the date of the next Monday."
                  },
                  reason: {
                    type: "STRING",
                    description: "The reason for the follow-up (e.g., 'Payment promise', 'Call back requested')."
                  }
                },
                required: ["date"]
              }
            }
          ]
        }
      ];

      // Using 'gemini-2.0-flash' as it is the available model
      const model = genAI.getGenerativeModel({
        model: "gemini-2.0-flash",
        tools: tools,
        toolConfig: { functionCallingConfig: { mode: "AUTO" } }
      });

      const db = await cds.connect.to('db');
      const payer = await db.run(SELECT.one.from('my.collectiq.Payers').where({ PayerId: payerId }));
      const payerName = payer?.PayerName || 'the customer';

      let amountContext = '';
      if (payer?.TotalPastDue) {
        amountContext = `The specific overdue amount is ${payer.TotalPastDue} ${payer.Currency || ''}.`;
      } else {
        amountContext = `The exact amount is not available, so refer to it generally as "your outstanding balance".`;
      }

      // Calculate today's date for the AI's reference
      const today = new Date().toISOString().split('T')[0];

      const systemInstruction = `You are a professional collections agent for Vegah CollectIQ.
              
Your Goal: professionally remind the customer about their payment.
Current Date: ${today}

1. Start by greeting ${payerName} and clearly stating the purpose of the call (if this is the first message).
2. ${amountContext}
3. Keep responses concise (under 2 sentences) unless answering a question.
4. Be empathetic but professional.
5. IF the user asks for a human, say "I am transferring you to a specialist now."
6. IF the customer agrees to pay later or asks for a callback, USE the 'schedule_followup' tool.
7. NEGOTIATION RULE: Do NOT accept payment promises or follow-ups more than 30 days in the future. If they ask for "next year" or "6 months", firmly refuse and ask for a date within this month.
8. Context: Status: ${payer?.LastOutreachStatus || 'unknown'}`;

      const chat = model.startChat({
        history: [
          {
            role: "user",
            parts: [{ text: `System Instruction: ${systemInstruction}` }],
          },
          {
            role: "model",
            parts: [{ text: "Understood. I am ready to simulate the agent." }],
          }
        ],
      });

      const result = await chat.sendMessage(text);
      const response = await result.response;

      // Handle Function Calls
      const functionCalls = response.functionCalls();
      let responseText = response.text() || "";

      if (functionCalls && functionCalls.length > 0) {
        for (const call of functionCalls) {
          if (call.name === 'schedule_followup') {
            const { date, reason } = call.args;
            console.log(`>>> [SHADOW-MODE] Tool Call: schedule_followup`, call.args);

            // Execute DB Insert
            try {
              const followUpID = cds.utils.uuid();
              await db.run(INSERT.into('my.collectiq.ScheduledFollowups').entries({
                ID: followUpID,
                payer_PayerId: payerId,
                scheduledDate: date,
                scheduledTime: new Date().toTimeString().split(' ')[0], // Local system time
                reason: reason || "Scheduled via Shadow Mode",
                status: 'pending'
              }));
              console.log(`>>> [SHADOW-MODE] Follow-up scheduled in DB for ${date}`); // Log 1

              // 2. Log to Outreach History (so it appears in Payer Details & Dashboard)
              await db.run(INSERT.into('my.collectiq.OutreachHistory').entries({
                ID: cds.utils.uuid(),
                payer_PayerId: payerId,
                outreachType: 'call', // Simulated call
                outreachDate: new Date().toISOString(),
                status: 'responded',
                responseReceived: true,
                responseDate: new Date().toISOString(),
                notes: `[Shadow Mode] Follow-up scheduled: ${reason}`,
                bodyText: `Customer agreed to pay later. Follow-up scheduled for ${date}. Reason: ${reason}`, // Visible in "Message" column
                stageAtGeneration: payer?.Stage || 'STAGE_1' // Added stage tracking
              }));

              // 3. Update Payer Status (so Dashboard updates)
              await db.run(UPDATE('my.collectiq.Payers').set({
                LastOutreachStatus: 'Follow-up Scheduled',
                lastOutreachAt: new Date().toISOString()
              }).where({ PayerId: payerId }));

              // 4. Create Transcript Analysis (so it appears in "Transcript Analysis History" tab)
              await db.run(INSERT.into('my.collectiq.CallTranscripts').entries({
                ID: cds.utils.uuid(),
                payer_PayerId: payerId,
                callId: `SIM-${Date.now()}`,
                callDate: new Date().toISOString(),
                duration: 120, // Mock duration (2 mins)
                transcriptAgent: "Agent: (Shadow Mode Simulation)",
                transcriptPayer: `Customer: (Shadow Mode logic applied - ${reason})`,
                fullTranscript: `[Shadow Mode Simulation]\nOutcome: Follow-up scheduled for ${date}.\nReason: ${reason}`,
                callConclusion: `Follow-up scheduled: ${reason}`, // Visible in "Conclusion" column
                paymentPromiseDate: date,
                paymentPromiseConfirmed: true,
                sentimentScore: 0.85, // Mock positive sentiment
                recommendedAction: "Verify payment on scheduled date"
              }));

              // Append system confirmation to response if empty
              if (!responseText) {
                responseText = `(System: Follow-up scheduled for ${date})`;
              }
            } catch (dbErr) {
              console.error(">>> [SHADOW-MODE] DB Error:", dbErr.message);
              responseText += " [Error scheduling follow-up in database]";
            }
          }
        }
      }

      // If the model called a function but didn't generate text (common in some modes), ensure we send something back
      if (!responseText && functionCalls.length > 0) {
        responseText = "I have scheduled the follow-up as requested.";
      }

      res.json({ response: responseText });

    } catch (err) {
      console.error(">>> [SHADOW-MODE ERROR]", err);
      res.status(500).json({ error: err.message });
    }
  });

  // ========== TWILIO MEDIA STREAM + DEEPGRAM STT/TTS + GEMINI ==========
  // Real-time voice conversation: Deepgram for STT/TTS, Gemini for conversation logic
  app.ws('/collect-iq/media-stream', (ws, req) => {
    console.log(`\n>>> [MEDIA-STREAM] ========== TWILIO WEBSOCKET CONNECTED ==========`);
    console.log(`>>> [MEDIA-STREAM] Query:`, req.query);

    let streamSid = null;
    let callSid = null;
    let payerId = req.query.payerId || null;

    // Robust Fallback: Parse URL if query params are missing (common in some WS proxies)
    if (!payerId && req.url && req.url.includes('payerId=')) {
      const match = req.url.match(/[?&]payerId=([^&]+)/);
      if (match) {
        payerId = match[1];
      }
    }
    console.log(`>>> [MEDIA-STREAM] Final PayerID: ${payerId}`);

    let deepgramWs = null;
    let deepgramConnecting = null;
    let payer = null;
    let conversationHistory = [];
    let isProcessingResponse = false;
    let transcriptBuffer = '';
    let silenceTimer = null;
    let hasGreeted = false;
    let callStartTime = Date.now(); // Track call start time for duration calculation

    // Fetch payer details once and cache
    const loadPayer = async () => {
      console.log(`>>> [LOAD-PAYER] Called. Current payer cache: ${payer ? 'EXISTS' : 'NULL'}, payerId: ${payerId}`);
      if (payer) {
        console.log(`>>> [LOAD-PAYER] Returning cached payer: ${payer.PayerName}`);
        return payer;
      }
      if (!payerId) {
        console.log(`>>> [LOAD-PAYER] ERROR: payerId is NULL/undefined!`);
        return null;
      }
      try {
        const db = await cds.connect.to('db');
        payer = await db.run(SELECT.one.from('my.collectiq.Payers').where({ PayerId: payerId }));
        console.log(`>>> [LOAD-PAYER] DB Query Result:`, JSON.stringify(payer, null, 2));
        console.log(`>>> [MEDIA-STREAM] Loaded payer for AI prompt: ${payer?.PayerName || 'N/A'}, Amount: ${payer?.TotalPastDue || 'N/A'}`);
      } catch (err) {
        console.error(`>>> [MEDIA-STREAM] Failed loading payer:`, err.message);
      }
      return payer;
    };

    // Helper to safely send to Twilio WS
    const safeSendToTwilio = (payload) => {
      if (!ws || ws.readyState !== WebSocket.OPEN) {
        console.warn('>>> [TWILIO] Skip send: WS not OPEN');
        return false;
      }
      try {
        ws.send(JSON.stringify(payload));
        return true;
      } catch (err) {
        console.warn('>>> [TWILIO] Send failed:', err.message);
        return false;
      }
    };

    // ===== DEEPGRAM TTS - Convert text to speech =====
    const speakText = async (text) => {
      if (!text || !streamSid) {
        console.warn('>>> [DEEPGRAM-TTS] Cannot speak: missing text or streamSid');
        return;
      }
      
      console.log(`>>> [DEEPGRAM-TTS] Speaking: "${text}"`);
      
      try {
        const response = await axios({
          method: 'POST',
          url: 'https://api.deepgram.com/v1/speak?model=aura-asteria-en&encoding=mulaw&sample_rate=8000&container=none',
          headers: {
            'Authorization': `Token ${process.env.DEEPGRAM_API_KEY}`,
            'Content-Type': 'application/json'
          },
          data: { text },
          responseType: 'arraybuffer'
        });

        // Convert audio buffer to base64 and send to Twilio in chunks
        const audioBuffer = Buffer.from(response.data);
        const chunkSize = 640; // ~40ms of audio at 8kHz mulaw
        
        for (let i = 0; i < audioBuffer.length; i += chunkSize) {
          const chunk = audioBuffer.slice(i, i + chunkSize);
          const base64Chunk = chunk.toString('base64');
          
          safeSendToTwilio({
            event: 'media',
            streamSid: streamSid,
            media: { payload: base64Chunk }
          });
          
          // Small delay to prevent buffer overflow
          await new Promise(resolve => setTimeout(resolve, 20));
        }
        
        console.log(`>>> [DEEPGRAM-TTS] Finished speaking (${audioBuffer.length} bytes)`);
      } catch (err) {
        console.error(`>>> [DEEPGRAM-TTS] Error:`, err.message);
      }
    };

    // ===== HELPER: Format amount for natural speech =====
    const formatAmountForSpeech = (amount, currencyCode) => {
      // Convert number to words
      const ones = ['', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine',
                    'ten', 'eleven', 'twelve', 'thirteen', 'fourteen', 'fifteen', 'sixteen', 
                    'seventeen', 'eighteen', 'nineteen'];
      const tens = ['', '', 'twenty', 'thirty', 'forty', 'fifty', 'sixty', 'seventy', 'eighty', 'ninety'];
      
      const numToWords = (num) => {
        if (num === 0) return 'zero';
        if (num < 0) return 'negative ' + numToWords(-num);
        
        let words = '';
        
        if (Math.floor(num / 1000000) > 0) {
          words += numToWords(Math.floor(num / 1000000)) + ' million ';
          num %= 1000000;
        }
        
        if (Math.floor(num / 1000) > 0) {
          words += numToWords(Math.floor(num / 1000)) + ' thousand ';
          num %= 1000;
        }
        
        if (Math.floor(num / 100) > 0) {
          words += ones[Math.floor(num / 100)] + ' hundred ';
          num %= 100;
        }
        
        if (num > 0) {
          if (num < 20) {
            words += ones[num];
          } else {
            words += tens[Math.floor(num / 10)];
            if (num % 10 > 0) {
              words += ' ' + ones[num % 10];
            }
          }
        }
        
        return words.trim();
      };
      
      // Currency names for speech
      const currencyNames = {
        'USD': 'dollars',
        'INR': 'rupees',
        'EUR': 'euros',
        'GBP': 'pounds',
        'AUD': 'Australian dollars',
        'CAD': 'Canadian dollars',
        'JPY': 'yen',
        'CNY': 'yuan'
      };
      
      const currencyName = currencyNames[currencyCode] || currencyCode;
      const amountWords = numToWords(Math.floor(amount));
      
      return `${amountWords} ${currencyName}`;
    };

    // ===== RULE-BASED CONVERSATION AGENT (No external AI API) =====
    // Uses pattern matching and conversation state to generate responses
    let conversationState = 'greeting_response'; // States: greeting_response, awaiting_confirmation, awaiting_date, closing
    
    const generateResponse = async (userMessage) => {
      if (isProcessingResponse) {
        console.log('>>> [AGENT] Already processing, skipping...');
        return null;
      }
      
      isProcessingResponse = true;
      
      const payerName = payer?.PayerName || 'Customer';
      const amountDue = payer?.TotalPastDue || 0;
      const currency = payer?.Currency || 'USD';
      // Format amount for natural speech (e.g., "eighty five thousand dollars")
      const fullAmount = formatAmountForSpeech(amountDue, currency);
      
      // Normalize user message for matching
      const msg = userMessage.toLowerCase().trim();
      
      console.log(`>>> [AGENT] Processing: "${userMessage}" | State: ${conversationState}`);
      
      // Add user message to history
      conversationHistory.push({ role: 'user', content: userMessage });
      
      let response = '';
      let action = null;
      
      // Pattern matching for common responses
      const patterns = {
        // Positive responses (yes, okay, sure, etc.) - STRICT matching
        positive: /^(yes|yeah|yep|yup|sure|okay|ok|fine|alright|correct|right|uh-huh|mhm|go ahead|proceed)\.?$/i,
        // Soft positive (contains positive words but might have more context)
        softPositive: /\b(yes|yeah|yep|sure|okay|ok|fine|alright)\b/i,
        // Negative responses (no, not now, can't, etc.) - Check these FIRST
        negative: /\b(no|nope|not now|not right now|busy|can't|cannot|can not|don't|do not|won't|will not|later|not interested|stop|not today|right now)\b/i,
        // Request for human
        human: /\b(human|person|agent|representative|someone|real person|speak to|talk to|transfer|manager|supervisor)\b/i,
        // Payment confirmation (must be clearly positive about paying)
        paymentPositive: /\b(i will pay|i'll pay|yes.*(pay|payment)|ready to pay|want to pay|let's pay|make.*(payment|pay)|paying now|pay now|pay today)\b/i,
        // Schedule/callback related
        callback: /\b(call back|callback|call me|tomorrow|next week|monday|tuesday|wednesday|thursday|friday|few days|couple days|another time|different time)\b/i,
        // Questions
        question: /\b(what|why|how much|when|where|who|which|can you|could you|tell me|explain|what is)\b/i,
        // Dispute/problem
        dispute: /\b(wrong|incorrect|mistake|error|dispute|not mine|didn't order|never ordered|already paid|paid already|problem|issue)\b/i,
        // Greeting responses
        greeting: /\b(hello|hi|hey|good morning|good afternoon|doing well|i'm good|i am good)\b/i,
        // Confirmation of identity
        identity: /\b(this is|speaking|that's me|that is me|i am|yes this is)\b/i
      };
      
      // Helper function to check patterns with priority
      const matchesPattern = (pattern) => pattern.test(msg);
      
      // State machine logic
      switch (conversationState) {
        case 'greeting_response':
          // Check in priority order: human > dispute > negative > positive
          if (matchesPattern(patterns.human)) {
            response = `Of course ${payerName}, I'll transfer you to a specialist right away. Please hold.`;
            action = { type: 'transfer' };
          } else if (matchesPattern(patterns.dispute)) {
            response = `I understand there may be a concern ${payerName}. Let me transfer you to a specialist who can help resolve this for the amount of ${fullAmount}.`;
            action = { type: 'transfer' };
          } else if (matchesPattern(patterns.negative)) {
            response = `I understand ${payerName}. When would be a better time to discuss your account with the balance of ${fullAmount}?`;
            conversationState = 'awaiting_date';
          } else if (matchesPattern(patterns.positive) || matchesPattern(patterns.softPositive) || matchesPattern(patterns.greeting) || matchesPattern(patterns.identity)) {
            response = `Thank you ${payerName}. I'm calling about your outstanding balance of ${fullAmount}. Would you like to make a payment arrangement today?`;
            conversationState = 'awaiting_confirmation';
          } else {
            // Default: assume they're listening
            response = `${payerName}, I'm reaching out regarding your balance of ${fullAmount}. Can we discuss payment options today?`;
            conversationState = 'awaiting_confirmation';
          }
          break;
          
        case 'awaiting_confirmation':
          // Check in priority order: human > dispute > negative/callback > positive payment
          if (matchesPattern(patterns.human)) {
            response = `Absolutely ${payerName}, transferring you now. Please hold.`;
            action = { type: 'transfer' };
          } else if (matchesPattern(patterns.dispute)) {
            response = `I understand ${payerName}. Let me connect you with a specialist who can review your account and the ${fullAmount} balance with you.`;
            action = { type: 'transfer' };
          } else if (matchesPattern(patterns.negative) || matchesPattern(patterns.callback)) {
            // User said no, can't, later, etc. - offer callback
            response = `No problem ${payerName}. When would be a good time for us to call you back about the ${fullAmount}?`;
            conversationState = 'awaiting_date';
          } else if (matchesPattern(patterns.paymentPositive)) {
            // User explicitly agreed to pay
            response = `Excellent ${payerName}! To process your payment of ${fullAmount}, I'll transfer you to our payment specialist who can assist you securely.`;
            action = { type: 'transfer' };
          } else if (matchesPattern(patterns.question)) {
            response = `${payerName}, the balance of ${fullAmount} is currently due on your account. Would you like to speak with a specialist for more details?`;
            conversationState = 'awaiting_confirmation';
          } else if (matchesPattern(patterns.positive) || matchesPattern(patterns.softPositive)) {
            // Generic positive - offer payment assistance
            response = `Great ${payerName}! Would you like to make a payment today, or should I schedule a callback for a more convenient time?`;
            conversationState = 'awaiting_confirmation';
          } else {
            // Unclear response - ask for clarification
            response = `${payerName}, shall I arrange a callback for a more convenient time to discuss the ${fullAmount}?`;
            conversationState = 'awaiting_date';
          }
          break;
          
        case 'awaiting_date':
          if (matchesPattern(patterns.human)) {
            response = `Of course, transferring you now ${payerName}.`;
            action = { type: 'transfer' };
          } else if (matchesPattern(patterns.negative) && !matchesPattern(patterns.callback)) {
            // User said no without specifying a time
            response = `I understand ${payerName}. We'll reach out again soon about your balance of ${fullAmount}. Have a good day.`;
            action = { type: 'end_call' };
          } else {
            // Try to extract a date or just schedule for tomorrow
            let followupDate = new Date();
            let reason = 'Customer requested callback';
            
            if (/tomorrow/i.test(msg)) {
              followupDate.setDate(followupDate.getDate() + 1);
              reason = 'Customer requested callback tomorrow';
            } else if (/monday/i.test(msg)) {
              const daysUntilMonday = (8 - followupDate.getDay()) % 7 || 7;
              followupDate.setDate(followupDate.getDate() + daysUntilMonday);
              reason = 'Customer requested callback on Monday';
            } else if (/tuesday/i.test(msg)) {
              const daysUntil = (9 - followupDate.getDay()) % 7 || 7;
              followupDate.setDate(followupDate.getDate() + daysUntil);
              reason = 'Customer requested callback on Tuesday';
            } else if (/wednesday/i.test(msg)) {
              const daysUntil = (10 - followupDate.getDay()) % 7 || 7;
              followupDate.setDate(followupDate.getDate() + daysUntil);
              reason = 'Customer requested callback on Wednesday';
            } else if (/thursday/i.test(msg)) {
              const daysUntil = (11 - followupDate.getDay()) % 7 || 7;
              followupDate.setDate(followupDate.getDate() + daysUntil);
              reason = 'Customer requested callback on Thursday';
            } else if (/friday/i.test(msg)) {
              const daysUntil = (12 - followupDate.getDay()) % 7 || 7;
              followupDate.setDate(followupDate.getDate() + daysUntil);
              reason = 'Customer requested callback on Friday';
            } else if (/next week/i.test(msg)) {
              followupDate.setDate(followupDate.getDate() + 7);
              reason = 'Customer requested callback next week';
            } else if (/few days|couple days|couple of days/i.test(msg)) {
              followupDate.setDate(followupDate.getDate() + 3);
              reason = 'Customer requested callback in a few days';
            } else {
              // Default to tomorrow
              followupDate.setDate(followupDate.getDate() + 1);
              reason = 'Customer requested callback';
            }
            
            const dateStr = followupDate.toISOString().split('T')[0];
            response = `Perfect ${payerName}, I've scheduled a callback for ${followupDate.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' })} regarding your ${fullAmount} balance. Have a great day!`;
            action = { type: 'followup', date: dateStr, reason: reason };
            conversationState = 'closing';
          }
          break;
        case 'closing':
          response = `Thank you for your time ${payerName}. Goodbye!`;
          action = { type: 'end_call' };
          break;
          
        default:
          response = `${payerName}, would you like to speak with a specialist about your account?`;
          conversationState = 'awaiting_confirmation';
      }
      
      console.log(`>>> [AGENT] Response: "${response}" | Action: ${action?.type || 'none'} | New State: ${conversationState}`);
      
      // Add response to history
      conversationHistory.push({ role: 'assistant', content: response });
      
      isProcessingResponse = false;
      return { text: response, action: action };
    };

    // ===== Handle tool actions with full backend reporting =====
    const handleToolAction = async (action) => {
      if (!action) return;
      
      console.log(`>>> [TOOL] Executing action:`, action);
      const db = await cds.connect.to('db');
      const callDuration = Math.floor((Date.now() - callStartTime) / 1000) || 60;
      const fullTranscript = conversationHistory.map(m => `${m.role === 'user' ? 'Customer' : 'Agent'}: ${m.content}`).join('\n');
      
      switch (action.type) {
        case 'transfer':
          console.log(`>>> [TOOL] Transferring call to ${process.env.TRANSFER_PHONE_NUMBER}...`);
          
          // Log transfer to backend
          try {
            // 1. Log to OutreachHistory
            await db.run(INSERT.into('my.collectiq.OutreachHistory').entries({
              ID: cds.utils.uuid(),
              payer_PayerId: payerId,
              outreachType: 'call',
              outreachDate: new Date().toISOString(),
              status: 'transferred',
              responseReceived: true,
              responseDate: new Date().toISOString(),
              notes: `[Voice Agent] Call transferred to human agent`,
              bodyText: `Customer requested transfer to specialist.`,
              stageAtGeneration: payer?.Stage || 'STAGE_1'
            }));
            
            // 2. Update Payer status
            await db.run(UPDATE('my.collectiq.Payers').set({
              LastOutreachStatus: 'Transferred to Agent',
              lastOutreachAt: new Date().toISOString()
            }).where({ PayerId: payerId }));
            
            // 3. Log CallTranscript
            await db.run(INSERT.into('my.collectiq.CallTranscripts').entries({
              ID: cds.utils.uuid(),
              payer_PayerId: payerId,
              callId: callSid || `VOICE-${Date.now()}`,
              callDate: new Date().toISOString(),
              duration: callDuration,
              transcriptAgent: "Agent: (Deepgram Voice Call)",
              transcriptPayer: "Customer: Requested transfer",
              fullTranscript: fullTranscript || "[Call transferred to human]",
              callConclusion: "Transferred to human agent",
              sentimentScore: 0.5,
              recommendedAction: "Follow up after human agent call"
            }));
            
            console.log(`>>> [TOOL] Transfer logged to backend`);
          } catch (err) {
            console.error(`>>> [TOOL] DB Error logging transfer:`, err.message);
          }
          
          // Execute Twilio transfer
          if (callSid) {
            const transferTwiml = `<Response>
              <Say voice="alice">Please hold while I connect you to a specialist.</Say>
              <Dial>${process.env.TRANSFER_PHONE_NUMBER}</Dial>
            </Response>`;
            
            try {
              await twilioClient.calls(callSid).update({ twiml: transferTwiml });
              console.log(`>>> [TOOL] Call transferred successfully`);
            } catch (err) {
              console.error(`>>> [TOOL] Transfer error:`, err.message);
            }
          }
          if (ws.readyState === WebSocket.OPEN) ws.close();
          break;
          
        case 'end_call':
          console.log(`>>> [TOOL] Ending call...`);
          
          // Log call completion to backend
          try {
            // 1. Log to OutreachHistory
            await db.run(INSERT.into('my.collectiq.OutreachHistory').entries({
              ID: cds.utils.uuid(),
              payer_PayerId: payerId,
              outreachType: 'call',
              outreachDate: new Date().toISOString(),
              status: 'completed',
              responseReceived: true,
              responseDate: new Date().toISOString(),
              notes: `[Voice Agent] Call completed successfully`,
              bodyText: `AI voice call completed. Customer engaged with agent.`,
              stageAtGeneration: payer?.Stage || 'STAGE_1'
            }));
            
            // 2. Update Payer status
            await db.run(UPDATE('my.collectiq.Payers').set({
              LastOutreachStatus: 'Call Completed',
              lastOutreachAt: new Date().toISOString()
            }).where({ PayerId: payerId }));
            
            // 3. Log CallTranscript
            await db.run(INSERT.into('my.collectiq.CallTranscripts').entries({
              ID: cds.utils.uuid(),
              payer_PayerId: payerId,
              callId: callSid || `VOICE-${Date.now()}`,
              callDate: new Date().toISOString(),
              duration: callDuration,
              transcriptAgent: "Agent: (Deepgram Voice Call)",
              transcriptPayer: "Customer: (Voice Call)",
              fullTranscript: fullTranscript || "[Call ended normally]",
              callConclusion: "Call completed successfully",
              sentimentScore: 0.7,
              recommendedAction: "Schedule follow-up if needed"
            }));
            
            console.log(`>>> [TOOL] Call end logged to backend`);
          } catch (err) {
            console.error(`>>> [TOOL] DB Error logging call end:`, err.message);
          }
          
          if (ws.readyState === WebSocket.OPEN) ws.close();
          break;
          
        case 'followup':
          console.log(`>>> [TOOL] Scheduling followup for ${action.date}: ${action.reason}`);
          try {
            // 1. Insert scheduled followup
            const followupId = cds.utils.uuid();
            await db.run(INSERT.into('my.collectiq.ScheduledFollowups').entries({
              ID: followupId,
              payer_PayerId: payerId,
              scheduledDate: action.date,
              scheduledTime: new Date().toTimeString().split(' ')[0],
              reason: action.reason || "Scheduled via Voice Agent",
              status: 'pending'
            }));
            console.log(`>>> [TOOL] ScheduledFollowup created: ${followupId}`);
            
            // 2. Log to OutreachHistory
            await db.run(INSERT.into('my.collectiq.OutreachHistory').entries({
              ID: cds.utils.uuid(),
              payer_PayerId: payerId,
              outreachType: 'call',
              outreachDate: new Date().toISOString(),
              status: 'responded',
              responseReceived: true,
              responseDate: new Date().toISOString(),
              notes: `[Voice Agent] Follow-up scheduled for ${action.date}: ${action.reason}`,
              bodyText: `Customer agreed to follow-up on ${action.date}. Reason: ${action.reason}`,
              stageAtGeneration: payer?.Stage || 'STAGE_1'
            }));
            console.log(`>>> [TOOL] OutreachHistory logged`);
            
            // 3. Update Payer status
            await db.run(UPDATE('my.collectiq.Payers').set({
              LastOutreachStatus: 'Follow-up Scheduled',
              lastOutreachAt: new Date().toISOString()
            }).where({ PayerId: payerId }));
            console.log(`>>> [TOOL] Payer status updated`);
            
            // 4. Create CallTranscript
            await db.run(INSERT.into('my.collectiq.CallTranscripts').entries({
              ID: cds.utils.uuid(),
              payer_PayerId: payerId,
              callId: callSid || `VOICE-${Date.now()}`,
              callDate: new Date().toISOString(),
              duration: callDuration,
              transcriptAgent: "Agent: (Deepgram Voice Call)",
              transcriptPayer: `Customer: ${action.reason}`,
              fullTranscript: fullTranscript,
              callConclusion: `Follow-up scheduled: ${action.reason}`,
              paymentPromiseDate: action.date,
              paymentPromiseConfirmed: true,
              sentimentScore: 0.85,
              recommendedAction: "Verify payment on scheduled date"
            }));
            console.log(`>>> [TOOL] CallTranscript created`);
            
            console.log(`>>> [TOOL] Follow-up scheduled successfully - ALL BACKEND RECORDS CREATED`);
          } catch (err) {
            console.error(`>>> [TOOL] DB Error:`, err.message);
          }
          break;
      }
    };

    // ===== Process transcript and generate response =====
    const processTranscript = async (transcript) => {
      if (!transcript || transcript.trim().length < 2) return;
      
      console.log(`>>> [TRANSCRIPT] Processing: "${transcript}"`);
      
      const response = await generateResponse(transcript);
      if (response && response.text) {
        await speakText(response.text);
        
        if (response.action) {
          // Small delay before executing action
          setTimeout(() => handleToolAction(response.action), 1000);
        }
      }
    };

    // ===== DEEPGRAM STT CONNECTION =====
    const connectToDeepgram = async () => {
      if (deepgramWs && deepgramWs.readyState === WebSocket.OPEN) {
        console.log(`>>> [DEEPGRAM-STT] Already connected`);
        return;
      }
      if (deepgramConnecting) {
        console.log(`>>> [DEEPGRAM-STT] Connection in progress...`);
        return deepgramConnecting;
      }

      deepgramConnecting = new Promise((resolve, reject) => {
        const apiKey = process.env.DEEPGRAM_API_KEY;
        
        console.log(`>>> [DEEPGRAM-STT] API Key available: ${apiKey ? 'YES' : 'NO - MISSING!'}`);
        
        if (!apiKey) {
          console.error(`>>> [DEEPGRAM-STT] CRITICAL: No DEEPGRAM_API_KEY!`);
          reject(new Error('DEEPGRAM_API_KEY not configured'));
          return;
        }

        // Deepgram live transcription WebSocket URL
        // Using mulaw encoding to match Twilio's audio format
        const deepgramUrl = `wss://api.deepgram.com/v1/listen?encoding=mulaw&sample_rate=8000&channels=1&model=nova-2&smart_format=true&interim_results=true&endpointing=300&utterance_end_ms=1000`;
        
        console.log(`>>> [DEEPGRAM-STT] Connecting...`);

        deepgramWs = new WebSocket(deepgramUrl, {
          headers: {
            'Authorization': `Token ${apiKey}`
          }
        });

        deepgramWs.on('open', async () => {
          console.log(`>>> [DEEPGRAM-STT] Connected!`);
          resolve();
          
          // Send initial greeting after connection
          if (!hasGreeted) {
            hasGreeted = true;
            await loadPayer();
            
            // Debug: Log what payer data we have
            console.log(`>>> [GREETING] Payer object:`, JSON.stringify(payer, null, 2));
            
            const payerName = payer?.PayerName || 'Customer';
            const amountDue = payer?.TotalPastDue || 0;
            const currency = payer?.Currency || 'USD';
            
            // Format amount for natural speech
            const fullAmount = formatAmountForSpeech(amountDue, currency);
            
            console.log(`>>> [GREETING] Using: Name="${payerName}", Amount="${fullAmount}"`);
            
            const greeting = `Hello ${payerName}, this is Vegah Collect I Q. You have an outstanding balance of ${fullAmount}. Is this a good time to discuss your account?`;
            
            // Add greeting to conversation history
            conversationHistory.push({ role: 'assistant', content: greeting });
            
            console.log(`>>> [DEEPGRAM-STT] Sending greeting: "${greeting}"`);
            await speakText(greeting);
          }
        });

        deepgramWs.on('error', (error) => {
          console.error(`>>> [DEEPGRAM-STT] Error:`, error.message);
          reject(error);
        });

        deepgramWs.on('close', () => {
          console.log(`>>> [DEEPGRAM-STT] Connection closed`);
          deepgramConnecting = null;
          deepgramWs = null;
        });

        // Handle transcription results from Deepgram
        deepgramWs.on('message', async (data) => {
          try {
            const message = JSON.parse(data.toString());
            
            if (message.type === 'Results' && message.channel?.alternatives?.[0]) {
              const transcript = message.channel.alternatives[0].transcript;
              const isFinal = message.is_final;
              
              if (transcript && transcript.trim()) {
                console.log(`>>> [DEEPGRAM-STT] ${isFinal ? 'FINAL' : 'interim'}: "${transcript}"`);
                
                if (isFinal) {
                  // Accumulate final transcripts
                  transcriptBuffer += ' ' + transcript;
                  
                  // Clear any existing timer
                  if (silenceTimer) clearTimeout(silenceTimer);
                  
                  // Set timer to process after silence
                  silenceTimer = setTimeout(async () => {
                    const fullTranscript = transcriptBuffer.trim();
                    transcriptBuffer = '';
                    
                    if (fullTranscript.length > 2) {
                      await processTranscript(fullTranscript);
                    }
                  }, 800); // 800ms of silence triggers response
                }
              }
            } else if (message.type === 'UtteranceEnd') {
              // Utterance ended - process any buffered transcript immediately
              console.log(`>>> [DEEPGRAM-STT] Utterance end detected`);
              if (silenceTimer) clearTimeout(silenceTimer);
              
              const fullTranscript = transcriptBuffer.trim();
              transcriptBuffer = '';
              
              if (fullTranscript.length > 2 && !isProcessingResponse) {
                await processTranscript(fullTranscript);
              }
            }
          } catch (err) {
            console.error(`>>> [DEEPGRAM-STT] Message parse error:`, err.message);
          }
        });
      });

      return deepgramConnecting.finally(() => {
        deepgramConnecting = null;
      });
    };

    // Preload payer info
    (async () => {
      try {
        if (payerId) {
          const db = await cds.connect.to('db');
          payer = await db.run(SELECT.one.from('my.collectiq.Payers').where({ PayerId: payerId }));
          console.log(`>>> [MEDIA-STREAM] Preloaded payer: ${payer?.PayerName || 'N/A'}`);
        }
      } catch (err) {
        console.error(`>>> [MEDIA-STREAM] Error preloading payer:`, err.message);
      }
    })();

    // ===== TWILIO CONNECTION HANDLER =====
    ws.on('message', async (message) => {
      try {
        const data = JSON.parse(message);
        const event = data.event;

        // Only log non-media events to reduce noise
        if (event !== 'media') {
          console.log(`>>> [TWILIO] Event: ${event}`);
        }

        switch (event) {
          case 'connected':
            console.log(`>>> [TWILIO] Connected event received`);
            streamSid = data.streamSid;
            callSid = data.callSid;
            payerId = req.query.payerId || payerId;

            await loadPayer();
            
            // Connect to Deepgram (will send greeting)
            if (!deepgramWs || deepgramWs.readyState !== WebSocket.OPEN) {
              try {
                await connectToDeepgram();
                console.log(`>>> [TWILIO] Deepgram connected`);
              } catch (err) {
                console.error(`>>> [TWILIO] Failed to connect to Deepgram:`, err.message);
              }
            }
            break;

          case 'start':
            console.log(`>>> [TWILIO] Media stream started`);
            console.log(`>>> [TWILIO] Start data:`, JSON.stringify(data.start, null, 2));
            streamSid = streamSid || data.streamSid;
            callSid = callSid || (data.start && data.start.callSid) || data.callSid;
            
            // Extract payerId from customParameters (Twilio passes it here)
            if (data.start && data.start.customParameters) {
              payerId = payerId || data.start.customParameters.payerId;
              console.log(`>>> [TWILIO] PayerId from customParameters: ${payerId}`);
            }

            await loadPayer();
            
            // Ensure Deepgram is connected
            if (!deepgramWs || deepgramWs.readyState !== WebSocket.OPEN) {
              try {
                await connectToDeepgram();
                console.log(`>>> [TWILIO] Deepgram connection established (start event)`);
              } catch (err) {
                console.error(`>>> [TWILIO] Failed to connect to Deepgram:`, err.message);
              }
            }
            break;

          case 'media':
            // Audio from Twilio - send to Deepgram for transcription
            if (!deepgramWs || deepgramWs.readyState !== WebSocket.OPEN) {
              // Lazy connect on first media event
              try {
                await connectToDeepgram();
                console.log(`>>> [TWILIO] Deepgram connected (lazy on media)`);
              } catch (err) {
                console.error(`>>> [TWILIO] Failed to connect to Deepgram:`, err.message);
                return;
              }
            }

            // Forward audio to Deepgram (convert from base64)
            if (deepgramWs && deepgramWs.readyState === WebSocket.OPEN && data.media?.payload) {
              const audioBuffer = Buffer.from(data.media.payload, 'base64');
              deepgramWs.send(audioBuffer);
            }
            break;

          case 'dtmf':
            console.log(`>>> [TWILIO] DTMF detected (ignored)`);
            break;

          case 'stop':
            console.log(`>>> [TWILIO] Media stream stopped`);

            // Close Deepgram connection
            if (deepgramWs && deepgramWs.readyState === WebSocket.OPEN) {
              // Send close signal to Deepgram
              deepgramWs.send(JSON.stringify({ type: 'CloseStream' }));
              deepgramWs.close();
            }

            // Update database with call completion
            try {
              const db = await cds.connect.to('db');
              const callDuration = Math.floor((Date.now() - callStartTime) / 1000) || 60;
              const fullTranscript = conversationHistory.map(m => `${m.role === 'user' ? 'Customer' : 'Agent'}: ${m.content}`).join('\n');
              
              await db.run(
                UPDATE(Payers)
                  .set({
                    LastOutreachStatus: 'CALL_ENDED',
                    lastOutreachAt: new Date().toISOString()
                  })
                  .where({ PayerId: payerId })
              );
              
              // Log OutreachHistory entry (always)
              await db.run(INSERT.into('my.collectiq.OutreachHistory').entries({
                ID: cds.utils.uuid(),
                payer_PayerId: payerId,
                outreachType: 'call',
                outreachDate: new Date().toISOString(),
                status: 'delivered',
                responseReceived: conversationHistory.length > 1,
                responseDate: new Date().toISOString(),
                notes: `[Voice Agent] Call ended after ${callDuration} seconds`,
                bodyText: fullTranscript || 'Call ended',
                stageAtGeneration: payer?.Stage || 'STAGE_3'
              }));
              console.log(`>>> [TWILIO] OutreachHistory logged for stop event`);
              
              // Log default transcript if no specific action was taken
              const existing = await db.run(SELECT.one.from('my.collectiq.CallTranscripts').where({ callId: callSid }));
              if (!existing && callSid) {
                await db.run(INSERT.into('my.collectiq.CallTranscripts').entries({
                  ID: cds.utils.uuid(),
                  payer_PayerId: payerId,
                  callId: callSid,
                  callDate: new Date().toISOString(),
                  duration: callDuration,
                  transcriptAgent: "Agent: (Deepgram Voice Call)",
                  transcriptPayer: "Customer: (Voice Call)",
                  fullTranscript: fullTranscript || "[Call ended without conversation]",
                  callConclusion: conversationHistory.length > 1 ? "Call completed with conversation" : "Call ended early",
                  sentimentScore: 0.5,
                  recommendedAction: "Review call"
                }));
                console.log(`>>> [TWILIO] CallTranscript logged for stop event`);
              }
              
              console.log(`>>> [TWILIO] Call completed and database updated`);
            } catch (err) {
              console.error(`>>> [TWILIO] Error updating DB:`, err.message);
            }
            break;

          default:
            console.log(`>>> [TWILIO] Unknown event: ${event}`);
        }
      } catch (err) {
        console.error(`>>> [TWILIO] Message error:`, err.message);
      }
    });

    ws.on('error', (error) => {
      console.error(`>>> [TWILIO] WebSocket Error:`, error.message);
      if (deepgramWs && deepgramWs.readyState === WebSocket.OPEN) {
        deepgramWs.close();
      }
    });

    ws.on('close', () => {
      console.log(`>>> [TWILIO] ========== WEBSOCKET CLOSED ==========`);
      if (deepgramWs && deepgramWs.readyState === WebSocket.OPEN) {
        deepgramWs.close();
      }
    });
  });

  // --- STATISTICS FUNCTIONS ---

  this.on('getOverviewStats', async (req) => {
    const totalPayers = await SELECT.from(Payers).columns('count(*) as count');
    // Summing TotalPastDue from Payers table to ensure consistency with what the Agent sees/updates
    const outstandingAmount = await SELECT.from(Payers).columns('sum(TotalPastDue) as total');

    const today = new Date().toISOString().split('T')[0];
    const callsToday = await SELECT.from(OutreachHistory)
      .where({ outreachType: 'call' })
      .and(`outreachDate >= '${today}'`)
      .columns('count(*) as count');

    const emailsToday = await SELECT.from(OutreachHistory)
      .where({ outreachType: 'email' })
      .and(`outreachDate >= '${today}'`)
      .columns('count(*) as count');

    // Simple success rate calculation (responded / sent)
    // This is a simplified metric
    const totalSent = await SELECT.from(OutreachHistory).columns('count(*) as count');
    const totalResponses = await SELECT.from(OutreachHistory).where({ responseReceived: true }).columns('count(*) as count');
    const successRate = totalSent[0].count > 0 ? (totalResponses[0].count / totalSent[0].count) * 100 : 0;

    return {
      totalPayers: totalPayers[0].count,
      totalOutstanding: outstandingAmount[0]?.total || 0,
      callsToday: callsToday[0].count,
      emailsToday: emailsToday[0].count,
      smsToday: 0, // Placeholder
      successRate: parseFloat(successRate.toFixed(2))
    };
  });

  this.on('getOutreachTimeline', async (req) => {
    const { days } = req.data;
    // SQLite/HANA specific date functions might differ. Using standardized CAP syntax where possible or raw query if needed.
    // For simplicity, fetching recent history and aggregating in JS if DB agnostic is preferred, 
    // but here we will try a standard group by if supported.
    // NOTE: CAP aggregation support varies by database. 
    // Fallback: Fetch all and aggregate in memory for compatibility.

    const limitDate = new Date();
    limitDate.setDate(limitDate.getDate() - (days || 30));

    const history = await SELECT.from(OutreachHistory)
      .where({ outreachDate: { '>=': limitDate.toISOString() } });

    const timeline = {};
    history.forEach(h => {
      const date = new Date(h.outreachDate).toISOString().split('T')[0];
      const key = `${date}|${h.outreachType}`;
      if (!timeline[key]) timeline[key] = { date: date, outreachType: h.outreachType, count: 0 };
      timeline[key].count++;
    });

    return Object.values(timeline);
  });

  this.on('getPaymentDistribution', async (req) => {
    // Group by status
    const invoices = await SELECT.from(Invoices).columns('InvoiceAmount', 'status'); // Ensure 'status' exists or use logic
    const dist = {};

    invoices.forEach(inv => {
      const status = inv.status || (inv.DaysPastDue > 0 ? 'overdue' : 'unpaid');
      if (!dist[status]) dist[status] = { status: status, count: 0, totalAmount: 0 };
      dist[status].count++;
      dist[status].totalAmount += inv.InvoiceAmount;
    });

    return Object.values(dist);
  });

  this.on('getAgingAnalysis', async (req) => {
    const invoices = await SELECT.from(Invoices).where({ InvoiceAmount: { '>': 0 } }); // Assuming > 0 is unpaid/outstanding

    const buckets = { '0-30 days': 0, '31-60 days': 0, '61-90 days': 0, '90+ days': 0 };
    const totals = { '0-30 days': 0, '31-60 days': 0, '61-90 days': 0, '90+ days': 0 };

    invoices.forEach(inv => {
      const days = inv.DaysPastDue || 0;
      let bucket = '90+ days';
      if (days <= 30) bucket = '0-30 days';
      else if (days <= 60) bucket = '31-60 days';
      else if (days <= 90) bucket = '61-90 days';

      buckets[bucket]++;
      totals[bucket] += inv.InvoiceAmount;
    });

    return Object.keys(buckets).map(key => ({
      ageBucket: key,
      invoiceCount: buckets[key],
      totalAmount: totals[key]
    }));
  });

  // --- CALL ANALYSIS FUNCTIONS ---

  this.on('analyzeCallTranscript', async (req) => {
    const { callId, transcript } = req.data;

    if (!process.env.OPENAI_API_KEY) {
      req.error(500, 'OpenAI API Key missing');
      return;
    }

    const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

    try {
      const completion = await openai.chat.completions.create({
        model: 'gpt-4o', // Use GPT-4o
        messages: [{
          role: 'system',
          content: `Analyze this payment collection call transcript. Return ONLY a JSON object with this structure:
                  {
                      "paymentPromiseDate": "YYYY-MM-DD or null",
                      "paymentPromiseConfirmed": boolean,
                      "disputeRaised": boolean,
                      "sentimentScore": -1.0 to 1.0,
                      "conclusionSummary": "2-3 sentence summary",
                      "keyPoints": ["point1", "point2"],
                      "recommendedAction": "next step description"
                  }`
        }, {
          role: 'user',
          content: transcript
        }],
        response_format: { type: 'json_object' }
      });

      const content = completion.choices[0].message.content;
      const result = JSON.parse(content);

      // Save analysis to database
      await UPDATE(CallTranscripts)
        .set({
          callConclusion: result.conclusionSummary,
          paymentPromiseDate: result.paymentPromiseDate,
          paymentPromiseConfirmed: result.paymentPromiseConfirmed,
          disputeRaised: result.disputeRaised,
          sentimentScore: result.sentimentScore,
          keyPoints: JSON.stringify(result.keyPoints),
          recommendedAction: result.recommendedAction
        })
        .where({ callId: callId });

      return result;
    } catch (err) {
      console.error('>>> [OPENAI ANALYSIS ERROR]', err);
      req.error(500, 'Analysis failed: ' + err.message);
    }
  });

  this.on('getCallDetails', async (req) => {
    const { callId } = req.data;
    const call = await SELECT.one.from(CallTranscripts).where({ callId: callId });
    if (!call) return req.error(404, `Call ${callId} not found`);

    const payerInfo = await SELECT.one.from(Payers).where({ PayerId: call.PayerId }); // Assuming PayerId linked

    // Since call.payer is association, we can also use that, but doing manual lookup for safety
    // Actually CallTranscripts has 'payer' association to 'Payers'.
    // If projection exposes it, expanded read is possible.
    // But adhering to function definition:

    const invoiceInfo = await SELECT.from(Invoices).where({ PayerId: payerInfo.PayerId });

    return JSON.stringify({ call, payerInfo, invoiceInfo });
  });

  // --- SCHEDULING FUNCTIONS ---

  this.on('scheduleFollowUp', async (req) => {
    const { payerId, originalCallId, scheduledDate, reason } = req.data;

    const followUp = await INSERT.into(ScheduledFollowups).entries({
      payer_PayerId: payerId, // Adjust if association key is different
      originalCallId: originalCallId,
      scheduledDate: scheduledDate,
      reason: reason,
      status: 'pending'
    });

    return followUp;
  });

  this.on('cancelFollowUp', async (req) => {
    const { followUpId } = req.data;
    await UPDATE(ScheduledFollowups).set({ status: 'cancelled' }).where({ ID: followUpId });
    return true;
  });

  this.on('rescheduleFollowUp', async (req) => {
    const { followUpId, newDate, newTime } = req.data;
    await UPDATE(ScheduledFollowups)
      .set({ scheduledDate: newDate, scheduledTime: newTime, status: 'rescheduled' })
      .where({ ID: followUpId });
    return await SELECT.one.from(ScheduledFollowups).where({ ID: followUpId });
  });

  this.on('getUpcomingFollowUps', async (req) => {
    return await SELECT.from(ScheduledFollowups)
      .where({ status: 'pending' })
      .and({ scheduledDate: { '>=': new Date().toISOString().split('T')[0] } })
      .orderBy('scheduledDate', 'scheduledTime');
  });

  this.on('executeFollowUp', async (req) => {
    const { followUpId } = req.data;
    const followUp = await SELECT.one.from(ScheduledFollowups).where({ ID: followUpId });
    if (!followUp) return { success: false, message: 'Follow-up not found' };

    // Check payment status
    let paymentStatus = await self.checkPaymentStatus({ payerId: followUp.payer_PayerId }); // Use internal call
    if (typeof paymentStatus === 'string') {
      try { paymentStatus = JSON.parse(paymentStatus); } catch (e) { }
    }

    if (paymentStatus && paymentStatus.paymentReceived) {
      await UPDATE(ScheduledFollowups).set({
        status: 'completed',
        result: 'Payment received before follow-up',
        executionDate: new Date().toISOString()
      }).where({ ID: followUpId });

      return { success: true, message: 'Payment received - follow-up cancelled' };
    }

    // Logic to initiate call or notify agent
    // For now, we just mark as executed and return text
    await UPDATE(ScheduledFollowups).set({
      status: 'completed',
      executionDate: new Date().toISOString(),
      result: 'Call executed'
    }).where({ ID: followUpId });

    return { success: true, message: 'Follow-up call initiated', callId: 'CALL_' + Date.now() };
  });

  this.on('checkPaymentStatus', async (req) => {
    const { payerId } = req.data;
    const unpaidInvoices = await SELECT.from(Invoices).where({ PayerId: payerId, InvoiceAmount: { '>': 0 } }); // Assuming >0 is unpaid

    await INSERT.into(PaymentStatusLog).entries({
      payer_PayerId: payerId,
      statusCheckedDate: new Date().toISOString(),
      paymentReceived: unpaidInvoices.length === 0
    });

    return JSON.stringify({
      paymentReceived: unpaidInvoices.length === 0,
      unpaidInvoices: unpaidInvoices
    });
  });

  console.log('>>> [ROUTES] ✓ All webhook routes registered successfully!');
});