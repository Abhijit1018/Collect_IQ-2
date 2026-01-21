const cds = require('@sap/cds');
const axios = require('axios');
const nodemailer = require('nodemailer');
const twilio = require('twilio');
const { CronJob } = require('cron');
const stage1Template = require('./templates/stage1');
const stage2Template = require('./templates/stage2');
const stage3Template = require('./templates/stage3');
require('dotenv').config();

module.exports = cds.service.impl(async function () {
  const { Invoices, Payers, OutreachHistory } = this.entities;
  const self = this;

  // 1. Setup Real Email Transporter (SECURE PORTAL EMAILS INTACT)
  const transporter = nodemailer.createTransport({
    host: process.env.EMAIL_HOST,
    port: process.env.EMAIL_PORT,
    secure: true,
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
  const { SELECT, UPDATE, UPSERT } = cds.ql;

  async function _generateOutreach(payerId) {
    console.log(`>>> [generateOutreach] Processing PayerId: ${payerId}`);
    const payer = await SELECT.one.from(Payers).where({ PayerId: payerId });
    console.log(`>>> [generateOutreach] Found payer: ${payer ? payer.PayerName : 'NOT FOUND'}`);

    if (!payer) throw new Error('Payer not found.');

    let finalDraft = '';
    let subjectLine = '';

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
      } catch (err) {
        console.error('>>> [TWILIO ERROR]: Call failed to trigger!');
        console.error(`>>> Reason: ${err.message}`);
        console.error(`>>> Code: ${err.code}`);
        console.error(`>>> Status: ${err.status}`);
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
        console.log(`>>> [EMAIL] Sent to ${payer.ContactEmail}`);
      } catch (err) {
        console.error('>>> [EMAIL ERROR]:', err.message);
        throw err;
      }
    } else {
      console.log(`>>> [sendOutreach] Unknown stage: ${payer.Stage}`);
    }
  }

  // --- A. CRON SCHEDULER WITH VERBOSE DIAGNOSTICS ---
  const job = new CronJob(
    '*/200 * * * *', // Every 2 minutes for testing; change to '0 0 11 * * *' for 11:00 AM IST
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
    true,
    'Asia/Kolkata'
  );

  console.log('[SCHEDULER] Cron job started: every 2 minutes (testing mode)');
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
        Currency: item.CurrencyCode || 'INR',
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

  // --- E. WEBHOOK HANDLERS (INSIDE SERVICE FUNCTION) ---
  const app = cds.app;
  const bodyParser = require('body-parser');
  app.use(bodyParser.urlencoded({ extended: false }));

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
      const gather = twiml.gather({
        numDigits: 1,
        action: `${ngrokUrl}/collect-iq/handle-reminder?payerId=${payerId}`,
        method: 'POST',
        timeout: 10,
      });

      gather.say({ voice: 'alice' }, 'Hello, this is Vegah CollectIQ. Press 1 to confirm and hear your payment details.');
      twiml.say({ voice: 'alice' }, 'We did not receive any input. Goodbye.');

      const response = twiml.toString();
      console.log(`>>> [VOICE] Sending TwiML response`);
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

  console.log('>>> [ROUTES] ✓ All webhook routes registered successfully!');
});