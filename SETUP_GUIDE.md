# Environment Setup Guide

## Issues Found

1. **Email SSL Error**: Port/secure mismatch
2. **Twilio Errors**: Missing environment variables
3. **Missing .env file**: No configuration file present

---

## Step-by-Step Setup

### 1. Gmail Configuration (for Email Stage 1 & 2)

#### Get Your App Password:
1. Go to: https://myaccount.google.com/apppasswords
2. Select "Mail" and "Windows Computer"
3. Google will generate a 16-character password
4. Copy this password (NOT your regular Gmail password)

#### Update `.env` file:
```
EMAIL_HOST=smtp.gmail.com
EMAIL_PORT=587
EMAIL_USER=your-email@gmail.com
EMAIL_PASS=your-app-password-16chars
```

**Why port 587 with secure: false?**
- Port 465: Uses implicit TLS (secure: true)
- Port 587: Uses STARTTLS (secure: false) ← Use this for Gmail
- Mixed settings cause "wrong version number" error

### 2. Twilio Configuration (for Voice Stage 3)

#### Get Your Credentials:
1. Go to: https://www.twilio.com/console
2. Find your Account SID and Auth Token
3. Buy a phone number for outbound calls
4. Verify your target phone numbers (for testing)

#### Update `.env` file:
```
TWILIO_ACCOUNT_SID=ACxxxxxxxxxxxxxxxxxxxxxxxx
TWILIO_AUTH_TOKEN=your_auth_token_here
TWILIO_PHONE_NUMBER=+1234567890
NGROK_URL=https://unbranching-finley-unbred.ngrok-free.dev
```

**Testing Phone Numbers:**
- Change phone numbers in CSV to test numbers you own:
  ```csv
  1001,Reliance Industries,50000.00,4,STAGE_1,3,NONE,your-email@gmail.com,+919265218188,INR
  1002,Tata Motors,120000.00,8,STAGE_2,2,NONE,your-email@gmail.com,+919376481607,INR
  1003,Adani Group,85000.00,30,STAGE_3,1,NONE,your-email@gmail.com,+15122154525,INR
  ```

### 3. Update Database CSV Files

Edit `db/data/my.collectiq-Payers.csv`:
```csv
PayerId,PayerName,TotalPastDue,MaxDaysPastDue,Stage,criticality,LastOutreachStatus,ContactEmail,ContactPhone,Currency
1001,Reliance Industries,50000.00,4,STAGE_1,3,NONE,YOUR-EMAIL@gmail.com,+919265218188,INR
1002,Tata Motors,120000.00,8,STAGE_2,2,NONE,YOUR-EMAIL@gmail.com,+919376481607,INR
1003,Adani Group,85000.00,30,STAGE_3,1,NONE,YOUR-EMAIL@gmail.com,+15122154525,INR
```

---

## Full `.env` Template

```bash
# TWILIO
TWILIO_ACCOUNT_SID=ACxxxxxxxxxxxxxxxxxxxxxxxx
TWILIO_AUTH_TOKEN=your_auth_token_here
TWILIO_PHONE_NUMBER=+1234567890
NGROK_URL=https://unbranching-finley-unbred.ngrok-free.dev

# EMAIL (Gmail)
EMAIL_HOST=smtp.gmail.com
EMAIL_PORT=587
EMAIL_USER=your-email@gmail.com
EMAIL_PASS=xxxx-xxxx-xxxx-xxxx

# APPLICATION
appUrl=http://localhost:4004
```

---

## Testing Order

### Test 1: Email (STAGE_1 & STAGE_2)
```bash
# Set payer to STAGE_1 or STAGE_2
# Wait for scheduler (every 2 minutes)
# Check inbox for email
```

✅ **Expected Result**: Email arrives in inbox with payment portal link

### Test 2: Voice Call (STAGE_3)
```bash
# Set payer to STAGE_3
# Make sure phone number is valid and verified in Twilio
# Wait for scheduler
# Your phone should ring
```

✅ **Expected Result**: Phone rings, WebSocket connects (101 status in ngrok)

---

## Troubleshooting

### Email Still Failing?
```
Error: 18140000:error:0A00010B:SSL routines
```
- ✅ Verify EMAIL_PORT=587 and secure=false (already fixed in service.js)
- ✅ Verify EMAIL_PASS is an App Password (not your regular password)
- ✅ Check EMAIL_USER matches the account that generated the App Password
- Test with: `npm run test-email` (optional script below)

### Twilio Not Sending Call?
```
Required parameter "params['from']" missing
```
- ✅ Verify TWILIO_PHONE_NUMBER is set in .env
- ✅ Verify it's a valid Twilio phone number (from console)
- ✅ Verify TWILIO_ACCOUNT_SID and AUTH_TOKEN are correct

### ngrok WebSocket Not Connecting?
```
GET /collect-iq/media-stream 400 Bad Request
```
- ✅ Verify NGROK_URL matches active tunnel (check http://127.0.0.1:4040)
- ✅ Make sure ngrok is running: `ngrok http 4004`
- ✅ Verify express-ws is installed: `npm list express-ws`

---

## Quick Start Checklist

- [ ] Copy `.env.example` to `.env`
- [ ] Fill in TWILIO credentials from https://www.twilio.com/console
- [ ] Fill in Gmail App Password from https://myaccount.google.com/apppasswords
- [ ] Update NGROK_URL with current tunnel
- [ ] Update phone/email in CSV files
- [ ] Run `npm install`
- [ ] Run `npm start`
- [ ] In another terminal: `ngrok http 4004`
- [ ] Monitor ngrok dashboard: http://127.0.0.1:4040
- [ ] Wait for scheduler or trigger manually
- [ ] Check email inbox and/or phone for incoming call

---

## Emails Sent
**From**: Vegah CollectIQ &lt;YOUR-EMAIL@gmail.com&gt;
**To**: Payer's email address
**Link**: Secure payment portal with payment option

## Calls Placed
**From**: Your Twilio Phone Number
**To**: Payer's phone number
**Route**: WebSocket media stream → AI processing (ready for integration)
