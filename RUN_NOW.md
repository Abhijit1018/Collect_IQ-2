# IMMEDIATE ACTIONS REQUIRED

## 1. FILL IN THE `.env` FILE

Edit `.env` file in your project root and replace these values:

```bash
# Get from https://www.twilio.com/console
TWILIO_ACCOUNT_SID=ACxxxxxxxxxxxxxxxxxxxxxxxx  
TWILIO_AUTH_TOKEN=your_auth_token_here
TWILIO_PHONE_NUMBER=+1234567890

# Your ngrok URL (from ngrok terminal output)
NGROK_URL=https://unbranching-finley-unbred.ngrok-free.dev

# Gmail App Password (from https://myaccount.google.com/apppasswords)
EMAIL_HOST=smtp.gmail.com
EMAIL_PORT=587
EMAIL_USER=your-email@gmail.com
EMAIL_PASS=xxxx-xxxx-xxxx-xxxx

# Keep this
appUrl=http://localhost:4004
```

---

## 2. GET YOUR TWILIO CREDENTIALS

1. Go to: https://www.twilio.com/console
2. Copy your **Account SID**
3. Copy your **Auth Token**
4. Navigate to "Phone Numbers" → "Manage Numbers"
5. Buy or use an existing phone number (this is your TWILIO_PHONE_NUMBER)
6. Add verified phone numbers for testing

**Phone Number Format**: `+1234567890` (with + and country code)

---

## 3. GET YOUR GMAIL APP PASSWORD

1. Enable 2-Factor Authentication in Google Account if not done
2. Go to: https://myaccount.google.com/apppasswords
3. Select "Mail" → "Windows Computer"
4. Google generates a 16-character password
5. Copy it (without spaces) as EMAIL_PASS

**Example**: 
- App Password from Google: `abcd efgh ijkl mnop`
- In .env: `EMAIL_PASS=abcdefghijklmnop`

---

## 4. TEST WITH YOUR OWN EMAIL/PHONE

Update `db/data/my.collectiq-Payers.csv` with your details:

```csv
PayerId,PayerName,TotalPastDue,MaxDaysPastDue,Stage,criticality,LastOutreachStatus,ContactEmail,ContactPhone,Currency
1001,Test Payer 1,50000.00,4,STAGE_1,3,NONE,YOUR-EMAIL@gmail.com,+919265218188,INR
1002,Test Payer 2,120000.00,8,STAGE_2,2,NONE,YOUR-EMAIL@gmail.com,+919376481607,INR
1003,Test Payer 3,85000.00,30,STAGE_3,1,NONE,YOUR-EMAIL@gmail.com,+15122154525,INR
```

⚠️ **Important**: 
- Use YOUR email address for STAGE_1 & STAGE_2 testing
- For STAGE_3 (voice call), use a phone number you own and have verified in Twilio console

---

## 5. START THE APPLICATION

### Terminal 1: Start ngrok (keep running)
```bash
ngrok http 4004
```
Copy the HTTPS URL and update NGROK_URL in .env

### Terminal 2: Start your CAP service
```bash
npm start
```

You should see:
```
[SCHEDULER] Cron job started: every 2 minutes (testing mode)
[SCHEDULER] Sends: STAGE_1 & STAGE_2 = Email, STAGE_3 = Twilio Call
```

---

## 6. MONITOR EXECUTION

### Check Email (STAGE_1 & STAGE_2)
- Wait 2 minutes for scheduler
- Check YOUR-EMAIL@gmail.com inbox
- Look for: "Friendly Reminder: Outstanding Balance..." (STAGE_1)
- Look for: "URGENT: Overdue Payment Notice..." (STAGE_2)
- Email contains secure payment portal link

### Check Voice Call (STAGE_3)
- Wait 2 minutes for scheduler
- Your phone should ring
- Open ngrok dashboard: http://127.0.0.1:4040
- Look for requests to `/collect-iq/media-stream`
- Status should be: **101 Switching Protocols** ✓

---

## ERRORS & FIXES

### ❌ Email Error: "wrong version number"
- **Fix**: Verify EMAIL_PORT=587 and secure=false in service.js (already done)
- **Check**: EMAIL_PASS is App Password, not regular password

### ❌ Twilio Error: "Required parameter 'params['from']' missing"
- **Fix**: Fill in TWILIO_PHONE_NUMBER in .env
- **Verify**: It's a valid Twilio phone number from console

### ❌ WebSocket Error: "webSocket upgrade required"  
- **Fix**: Already implemented in service.js
- **Verify**: NGROK_URL is correct and matches active tunnel

---

## WHAT HAPPENS NEXT

1. **STAGE_1**: Email sent → Payer clicks secure payment portal link
2. **STAGE_2**: Urgent email sent → Payer gets payment reminder  
3. **STAGE_3**: Voice call → WebSocket connects → AI agent ready (needs speech-to-text integration)

---

## Ready to Run?

1. ✅ Fill `.env` with your credentials
2. ✅ Update phone/email in CSV  
3. ✅ Run `npm start`
4. ✅ Run `ngrok http 4004` in another terminal
5. ✅ Wait 2 minutes for scheduler to run
6. ✅ Check email and phone for messages
