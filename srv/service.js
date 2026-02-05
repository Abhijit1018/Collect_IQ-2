const cds = require('@sap/cds');
const axios = require('axios');
const nodemailer = require('nodemailer');
const twilio = require('twilio');
const { CronJob } = require('cron');
const expressWs = require('express-ws');
const WebSocket = require('ws');
const stage1Template = require('./templates/stage1');
const stage2Template = require('./templates/stage2');
const stage3Template = require('./templates/stage3');
const OpenAI = require('openai');
const { GoogleGenerativeAI } = require("@google/generative-ai");
require('dotenv').config();

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
      const t = stage3Template(payer.PayerName, payer.TotalPastDue, payer.Currency);
      finalDraft = t.body;
      subjectLine = t.subject;
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
      const mediaStream = twiml.connect();
      mediaStream.stream({
        url: `wss://${req.get('host')}/collect-iq/media-stream?payerId=${payerId}`,
      });

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

      // Using 'gemini-flash-latest' as it is explicitly available in the API list
      const model = genAI.getGenerativeModel({
        model: "gemini-flash-latest",
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

  // ========== TWILIO MEDIA STREAM + OPENAI REALTIME API ==========
  // Real-time voice conversation powered by OpenAI
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
    console.log(`>>> [MEDIA-STREAM] Final PayerID: ${payerId}`); // Explicit Log

    let openaiWs = null;
    let openaiConnecting = null;
    const openaiQueue = [];
    let payer = null;

    // Fetch payer details once and cache so prompts always include name/amount
    const loadPayer = async () => {
      if (payer) return payer;
      if (!payerId) return null;
      try {
        const db = await cds.connect.to('db');
        payer = await db.run(SELECT.one.from('my.collectiq.Payers').where({ PayerId: payerId }));
        console.log(`>>> [MEDIA-STREAM] Loaded payer for AI prompt: ${payer?.PayerName || 'N/A'}`);
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

    // Helper to send/queue to OpenAI until socket is OPEN
    const safeSendToOpenAI = (payload) => {
      if (openaiWs && openaiWs.readyState === WebSocket.OPEN) {
        openaiWs.send(JSON.stringify(payload));
        return true;
      }
      // queue and will flush on open
      openaiQueue.push(payload);
      return false;
    };

    // ===== OPENAI REALTIME CONNECTION =====
    const connectToOpenAI = async () => {
      if (openaiWs && openaiWs.readyState === WebSocket.OPEN) return;
      if (openaiConnecting) return openaiConnecting;

      openaiConnecting = new Promise((resolve, reject) => {
        const openaiUrl = 'wss://api.openai.com/v1/realtime?model=gpt-4o-realtime-preview-2024-12-17';
        const authHeader = `Bearer ${process.env.OPENAI_API_KEY}`;

        console.log(`>>> [OPENAI] Connecting to OpenAI Realtime API...`);

        openaiWs = new WebSocket(openaiUrl, {
          headers: {
            'Authorization': authHeader,
            'OpenAI-Beta': 'realtime=v1'
          }
        });

        openaiWs.on('open', async () => {
          console.log(`>>> [OPENAI] ✓ Connected to OpenAI Realtime API`);
          // flush queued messages
          while (openaiQueue.length && openaiWs.readyState === WebSocket.OPEN) {
            const msg = openaiQueue.shift();
            openaiWs.send(JSON.stringify(msg));
          }

          // Ensure payer data is present before configuring the session so the model can speak the name/amount
          await loadPayer();

          const payerName = payer?.PayerName || 'the customer';

          // Fix for "amount is the amount" tautology
          let amountContext = '';
          if (payer?.TotalPastDue) {
            const amount = `${payer.TotalPastDue} ${payer.Currency || ''}`.trim();
            amountContext = `The specific overdue amount is ${amount}.`;
          } else {
            amountContext = `The exact amount is not available, so refer to it generally as "your outstanding balance".`;
          }

          const callDetails = `
- Customer Name: ${payerName}
- Amount Info: ${amountContext}
- Status: ${payer?.LastOutreachStatus || 'unknown'}
          `.trim();

          // Send session configuration to OpenAI
          const sessionConfig = {
            type: 'session.update',
            session: {
              model: 'gpt-4o-realtime-preview-2024-12-17',
              modalities: ['text', 'audio'],
              instructions: `You are a professional collections agent for Vegah CollectIQ.
              
Your Goal: professionally remind the customer about their payment.
1. Start by greeting ${payerName} and clearly stating the purpose of the call.
2. ${amountContext}
3. Keep responses concise (under 2 sentences) unless answering a question.
4. Be empathetic but professional.
5. IF the user asks for a human, say "I am transferring you to a specialist now."
6. IF the customer agrees to pay later or asks for a callback, USE the "schedule_followup" tool.
7. NEGOTIATION RULE: Do NOT accept payment promises or follow-ups more than 30 days in the future. If they ask for "next year" or "6 months", firmly refuse and ask for a date within this month.
8. When the conversation is concluded (e.g., they agree to pay, or refuse and say goodbye), YOU MUST use the "end_call" tool to terminate the connection.

Context:
${callDetails}`,
              voice: 'alloy',
              tools: [{
                type: 'function',
                name: 'end_call',
                description: 'Ends the call immediately. Use this when the conversation is over.',
                parameters: {
                  type: 'object',
                  properties: {},
                  required: []
                }
              }, {
                type: 'function',
                name: 'transfer_agent',
                description: 'Transfers the customer to a human agent. Use this when they explicitly ask for a human or are very frustrated.',
                parameters: {
                  type: 'object',
                  properties: {},
                  required: []
                }
              }, {
                type: 'function',
                name: 'schedule_followup',
                description: 'Schedules a follow-up call or reminder for the customer. Use this when they agree to pay later or ask for a callback.',
                parameters: {
                  type: 'object',
                  properties: {
                    date: {
                      type: 'string',
                      description: 'The date for the follow-up in YYYY-MM-DD format. If the user says "Monday", calculate the date of the next Monday.'
                    },
                    reason: {
                      type: 'string',
                      description: 'The reason for the follow-up (e.g., "Payment promise", "Call back requested").'
                    }
                  },
                  required: ['date']
                }
              }],
              tool_choice: 'auto',
              temperature: 0.7,
              max_response_output_tokens: 1024,
              input_audio_format: 'g711_ulaw',
              output_audio_format: 'g711_ulaw',
              turn_detection: {
                type: 'server_vad',
                threshold: 0.6, // Higher threshold avoids cutting off user
                prefix_padding_ms: 300,
                silence_duration_ms: 800 // Wait longer before responding
              }
            }
          };
          safeSendToOpenAI(sessionConfig);
          console.log(`>>> [OPENAI] Session configured`);
          resolve();
        });

        openaiWs.on('error', (error) => {
          console.error(`>>> [OPENAI] Connection Error:`, error.message);
          reject(error);
        });

        openaiWs.on('close', async () => {
          console.log(`>>> [OPENAI] Connection closed`);
          openaiConnecting = null;
          openaiWs = null;

          // DEFAULT LOGGING: If the call ended without a specific tool action (like schedule_followup),
          // we still need to log it so the UI updates (History, Status, Details).
          if (payerId && callSid) {
            try {
              const db = await cds.connect.to('db');

              // Check if a transcript already exists for this call (to avoid duplicates if tool was used)
              const existing = await db.run(SELECT.one.from('my.collectiq.CallTranscripts').where({ callId: callSid }));

              if (!existing) {
                console.log(`>>> [VOICE-AGENT] Call ended without specific action. Logging default transcript...`);

                // 1. Log to Outreach History
                await db.run(INSERT.into('my.collectiq.OutreachHistory').entries({
                  ID: cds.utils.uuid(),
                  payer_PayerId: payerId,
                  outreachType: 'call',
                  outreachDate: new Date().toISOString(),
                  status: 'delivered', // Call connected but no resolution
                  responseReceived: true,
                  responseDate: new Date().toISOString(),
                  notes: `[Voice Agent] Call completed. No specific action taken.`,
                  bodyText: `Call completed. No specific outcome recorded.`, // Message column
                  stageAtGeneration: payer?.Stage || 'STAGE_1'
                }));

                // 2. Update Payer Status
                await db.run(UPDATE('my.collectiq.Payers').set({
                  LastOutreachStatus: 'Call Completed',
                  lastOutreachAt: new Date().toISOString()
                }).where({ PayerId: payerId }));

                // 3. Create General Transcript Analysis
                await db.run(INSERT.into('my.collectiq.CallTranscripts').entries({
                  ID: cds.utils.uuid(),
                  payer_PayerId: payerId,
                  callId: callSid,
                  callDate: new Date().toISOString(),
                  duration: 60, // Default duration if not tracked
                  transcriptAgent: "Agent: (Voice Call)",
                  transcriptPayer: "Customer: (Voice Call)",
                  fullTranscript: "[Voice Agent Call] Call ended without specific action.",
                  callConclusion: "General Inquiry / No Resolution",
                  paymentPromiseDate: null,
                  paymentPromiseConfirmed: false,
                  sentimentScore: 0.5, // Neutral
                  recommendedAction: "Review call recording"
                }));
              }
            } catch (err) {
              console.error(">>> [VOICE-AGENT] Error logging default transcript:", err.message);
            }
          }
        });

        // Handle messages from OpenAI
        openaiWs.on('message', (data) => {
          try {
            const message = JSON.parse(data.toString());
            console.log(`>>> [OPENAI] Event: ${message.type}`);

            switch (message.type) {
              case 'response.audio.delta':
                // Audio response from OpenAI - send to Twilio
                if (!message.delta) break;
                if (ws.readyState !== WebSocket.OPEN) {
                  console.warn('>>> [OPENAI] Dropping audio delta because Twilio WS not open');
                  break;
                }
                if (!streamSid) {
                  console.warn('>>> [OPENAI] Dropping audio delta because streamSid not set');
                  break;
                }
                console.log(`>>> [OPENAI] Audio delta (${message.delta.length} bytes base64)`);
                // message.delta is already base64-encoded g711_ulaw audio; forward directly to Twilio
                safeSendToTwilio({
                  event: 'media',
                  streamSid: streamSid,
                  media: { payload: message.delta }
                });
                break;

              case 'response.text.delta':
                console.log(`>>> [OPENAI] AI Response: ${message.delta}`);
                break;

              case 'response.done':
                console.log(`>>> [OPENAI] Response completed`);
                if (message.response && message.response.output) {
                  message.response.output.forEach(item => {
                    if (item.type === 'function_call') {
                      if (item.name === 'end_call') {
                        console.log('>>> [OPENAI] Tool call detected: end_call. Terminating connection.');
                        if (ws.readyState === WebSocket.OPEN) {
                          ws.close();
                        }
                      } else if (item.name === 'transfer_agent') {
                        console.log(`>>> [OPENAI] Tool call detected: transfer_agent. Forwarding call to ${process.env.TRANSFER_PHONE_NUMBER}...`);

                        // Use Twilio REST API to modify the live call
                        if (callSid) {
                          const transferTwiml = `<Response>
                                                  <Say voice="alice">Please hold while I connect you to a specialist.</Say>
                                                  <Dial>${process.env.TRANSFER_PHONE_NUMBER}</Dial>
                                                </Response>`;

                          twilioClient.calls(callSid)
                            .update({ twiml: transferTwiml })
                            .then(call => console.log(`>>> [TWILIO] Call forwarded to human agent. Status: ${call.status}`))
                            .catch(err => console.error(`>>> [TWILIO] Error forwarding call: ${err.message}`));

                          // Close WebSocket as Twilio will handle the rest via PSTN
                          if (ws.readyState === WebSocket.OPEN) {
                            ws.close();
                          }
                        } else {
                          console.error(">>> [OPENAI] Impossible to transfer: callSid is missing.");
                        }
                      } else if (item.name === 'schedule_followup') {
                        const args = JSON.parse(item.arguments);
                        const { date, reason } = args;
                        console.log(`>>> [OPENAI] Tool call detected: schedule_followup`, args);

                        // Execute DB Insert (MATCHING SHADOW MODE LOGIC)
                        (async () => {
                          try {
                            const db = await cds.connect.to('db');

                            // 1. Insert Scheduled Follow-up
                            const followUpID = cds.utils.uuid();
                            await db.run(INSERT.into('my.collectiq.ScheduledFollowups').entries({
                              ID: followUpID,
                              payer_PayerId: payerId,
                              scheduledDate: date,
                              scheduledTime: new Date().toTimeString().split(' ')[0], // Local system time (e.g., 15:30:00)
                              reason: reason || "Scheduled via Voice Agent",
                              status: 'pending'
                            }));
                            console.log(`>>> [VOICE-AGENT] Follow-up scheduled in DB for ${date}`);

                            // 2. Log to Outreach History
                            await db.run(INSERT.into('my.collectiq.OutreachHistory').entries({
                              ID: cds.utils.uuid(),
                              payer_PayerId: payerId,
                              outreachType: 'call',
                              outreachDate: new Date().toISOString(),
                              status: 'responded',
                              responseReceived: true,
                              responseDate: new Date().toISOString(),
                              notes: `[Voice Agent] Follow-up scheduled: ${reason}`,
                              bodyText: `Customer agreed to pay later. Follow-up scheduled for ${date}. Reason: ${reason}`,
                              stageAtGeneration: payer?.Stage || 'STAGE_1'
                            }));

                            // 3. Update Payer Status
                            await db.run(UPDATE('my.collectiq.Payers').set({
                              LastOutreachStatus: 'Follow-up Scheduled',
                              lastOutreachAt: new Date().toISOString()
                            }).where({ PayerId: payerId }));

                            // 4. Create Transcript Analysis
                            await db.run(INSERT.into('my.collectiq.CallTranscripts').entries({
                              ID: cds.utils.uuid(),
                              payer_PayerId: payerId,
                              callId: callSid || `VOICE-${Date.now()}`,
                              callDate: new Date().toISOString(),
                              duration: 120, // Mock duration or calc real duration if tracked
                              transcriptAgent: "Agent: (Voice Call)",
                              transcriptPayer: `Customer: (Voice Call - ${reason})`,
                              fullTranscript: `[Voice Agent Call]\nOutcome: Follow-up scheduled for ${date}.\nReason: ${reason}`,
                              callConclusion: `Follow-up scheduled: ${reason}`,
                              paymentPromiseDate: date,
                              paymentPromiseConfirmed: true,
                              sentimentScore: 0.85,
                              recommendedAction: "Verify payment on scheduled date"
                            }));

                          } catch (dbErr) {
                            console.error(">>> [VOICE-AGENT] DB Error:", dbErr.message);
                          }
                        })();
                      }
                    }
                  });
                }
                break;

              case 'error':
                console.error(`>>> [OPENAI] Error:`, message.error);
                break;

              default:
                // Silently ignore other message types
                break;
            }
          } catch (err) {
            console.error(`>>> [OPENAI] Message parse error:`, err.message);
          }
        });
      });

      return openaiConnecting.finally(() => {
        openaiConnecting = null;
      });
    };

    // Preload payer info so we can prompt immediately even if Twilio skips "connected"
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

        console.log(`>>> [TWILIO] Event: ${event}`);

        let payerName = 'the customer';
        let amountText = 'the outstanding balance';
        let voiceScript = '';

        switch (event) {
          case 'connected':
            console.log(`>>> [TWILIO] Connected event received`);
            console.log(`>>> [TWILIO] Stream SID: ${data.streamSid}`);
            streamSid = data.streamSid;
            callSid = data.callSid;
            payerId = req.query.payerId || payerId;
            console.log(`>>> [TWILIO] PayerId: ${payerId}`);

            await loadPayer();
            payerName = payer?.PayerName || 'the customer';
            amountText = payer?.TotalPastDue
              ? `${payer.TotalPastDue} ${payer.Currency || ''}`.trim()
              : 'the outstanding balance';
            voiceScript = stage3Template(payerName, payer?.TotalPastDue || amountText, payer?.Currency || '').body;

            // Connect to OpenAI (idempotent safeguard)
            if (!openaiWs || openaiWs.readyState !== WebSocket.OPEN) {
              try {
                await connectToOpenAI();
                console.log(`>>> [TWILIO] OpenAI connection established (connected event)`);
                // Kick off conversation
                const initialGreeting = {
                  type: 'response.create',
                  response: {
                    modalities: ['audio', 'text'],
                    instructions: `You are Vegah CollectIQ calling ${payerName}. Open warmly, clearly state the overdue amount of ${amountText}, and ask if now is a good time to talk. Use this phrasing as a base: ${voiceScript}`
                  }
                };
                safeSendToOpenAI(initialGreeting);
                const startText = {
                  type: 'input_text',
                  text: `Start speaking now with a brief greeting to ${payerName} about the overdue balance of ${amountText}. Include the name and amount in the first sentence.`
                };
                safeSendToOpenAI(startText);
              } catch (err) {
                console.error(`>>> [TWILIO] Failed to connect to OpenAI:`, err.message);
                ws.send(JSON.stringify({
                  event: 'media',
                  streamSid: streamSid,
                  media: { payload: 'QVVEJg==' }
                }));
              }
            }
            break;

          case 'start':
            console.log(`>>> [TWILIO] Media stream started`);
            console.log(`>>> [TWILIO] Media Format:`, data.mediaFormat);
            // Capture streamSid/callSid from start event too (some regions skip "connected")
            streamSid = streamSid || data.streamSid;
            callSid = callSid || (data.start && data.start.callSid) || data.callSid;

            await loadPayer();
            payerName = payer?.PayerName || 'the customer';
            amountText = payer?.TotalPastDue
              ? `${payer.TotalPastDue} ${payer.Currency || ''}`.trim()
              : 'the outstanding balance';
            voiceScript = stage3Template(payerName, payer?.TotalPastDue || amountText, payer?.Currency || '').body;

            // Ensure OpenAI is connected even if "connected" was skipped
            if (!openaiWs || openaiWs.readyState !== WebSocket.OPEN) {
              try {
                await connectToOpenAI();
                console.log(`>>> [TWILIO] OpenAI connection established (start event)`);
                const initialGreeting = {
                  type: 'response.create',
                  response: {
                    modalities: ['audio', 'text'],
                    instructions: `You are Vegah CollectIQ calling ${payerName}. Open warmly, clearly state the overdue amount of ${amountText}, and ask if now is a good time to talk. Use this phrasing as a base: ${voiceScript}`
                  }
                };
                safeSendToOpenAI(initialGreeting);
                const startText = {
                  type: 'input_text',
                  text: `Start speaking now with a brief greeting to ${payerName} about the overdue balance of ${amountText}. Include the name and amount in the first sentence.`
                };
                safeSendToOpenAI(startText);
              } catch (err) {
                console.error(`>>> [TWILIO] Failed to connect to OpenAI (start event):`, err.message);
              }
            }
            break;

          case 'media':
            // Audio from Twilio - send to OpenAI
            // If OpenAI not yet connected (e.g., missing connected/start), connect now lazily
            if (!openaiWs || openaiWs.readyState !== WebSocket.OPEN) {
              try {
                await connectToOpenAI();
                console.log(`>>> [TWILIO] OpenAI connection established (lazy on media)`);
                await loadPayer();
                payerName = payer?.PayerName || 'the customer';
                amountText = payer?.TotalPastDue
                  ? `${payer.TotalPastDue} ${payer.Currency || ''}`.trim()
                  : 'the outstanding balance';
                voiceScript = stage3Template(payerName, payer?.TotalPastDue || amountText, payer?.Currency || '').body;
                const initialGreeting = {
                  type: 'response.create',
                  response: {
                    modalities: ['audio', 'text'],
                    instructions: `You are Vegah CollectIQ calling ${payerName}. Open warmly, clearly state the overdue amount of ${amountText}, and ask if now is a good time to talk. Use this phrasing as a base: ${voiceScript}`
                  }
                };
                safeSendToOpenAI(initialGreeting);
                const startText = {
                  type: 'input_text',
                  text: `Start speaking now with a brief greeting to ${payerName} about the overdue balance of ${amountText}. Include the name and amount in the first sentence.`
                };
                safeSendToOpenAI(startText);
              } catch (err) {
                console.error(`>>> [TWILIO] Failed to connect to OpenAI (media event):`, err.message);
              }
            }

            if (openaiWs && openaiWs.readyState === WebSocket.OPEN && data.media?.payload) {
              const audioData = {
                type: 'input_audio_buffer.append',
                audio: data.media.payload
              };
              openaiWs.send(JSON.stringify(audioData));
            }
            break;

          case 'dtmf':
            // Ignore DTMF for now; could be used later
            console.log(`>>> [TWILIO] DTMF detected (ignored)`);
            break;

          case 'stop':
            console.log(`>>> [TWILIO] Media stream stopped`);

            // Close OpenAI connection
            if (openaiWs && openaiWs.readyState === WebSocket.OPEN) {
              openaiWs.close();

              // If streamSid still missing, stash from mediaFormat if present
              if (!streamSid && data.mediaFormat?.streamSid) {
                streamSid = data.mediaFormat.streamSid;
              }

            }

            // Update database with call completion
            try {
              const db = await cds.connect.to('db');
              await db.run(
                UPDATE(Payers)
                  .set({
                    LastOutreachStatus: 'CALL_ENDED',
                    lastOutreachAt: new Date().toISOString()
                  })
                  .where({ PayerId: payerId })
              );
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
      if (openaiWs && openaiWs.readyState === WebSocket.OPEN) {
        openaiWs.close();
      }
    });

    ws.on('close', () => {
      console.log(`>>> [TWILIO] ========== WEBSOCKET CLOSED ==========`);
      if (openaiWs && openaiWs.readyState === WebSocket.OPEN) {
        openaiWs.close();
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