# CollectIQ - HANA Database & BAS Deployment Guide

## Overview
This guide covers deploying the CollectIQ SAP CAP application to SAP Business Application Studio (BAS) with HANA database connectivity.

---

## Pre-requisites

1. **SAP BTP Account** with access to:
   - Cloud Foundry Environment
   - HANA Cloud Instance
   - SAP Business Application Studio

2. **Required Services:**
   - HANA Cloud (hdi-shared plan)
   - XSUAA (application plan)
   - Destination Service (lite plan)
   - HTML5 Application Repository

---

## Project Structure

```
collectiq/
├── app/                    # UI5 Application
│   ├── collectiq_ui/       # Main UI Application
│   │   ├── webapp/         # UI5 Source Files
│   │   ├── package.json    # UI Build Dependencies
│   │   ├── ui5.yaml        # UI5 Development Config
│   │   ├── ui5-deploy.yaml # UI5 Deployment Config
│   │   └── xs-app.json     # App Router Config (for HTML5 repo)
│   └── router/             # App Router Module
│       └── xs-app.json     # Main Routing Rules
├── db/                     # Database Schema
│   ├── schema.cds          # Entity Definitions
│   └── data/               # Initial Data (CSV)
├── srv/                    # Service Layer
│   ├── service.cds         # OData Service Definition
│   ├── service.js          # Custom Handlers
│   └── external/           # External Service Integration
├── gen/                    # Generated Deployment Artifacts
│   ├── db/                 # HANA Artifacts
│   └── srv/                # Node.js Server
├── .cdsrc.json             # CDS Configuration
├── mta.yaml                # MTA Deployment Descriptor
├── package.json            # Project Dependencies
└── xs-security.json        # XSUAA Configuration
```

---

## Step 1: Open in SAP Business Application Studio

1. Open SAP Business Application Studio
2. Create a **Dev Space** with:
   - SAP HANA Native Development
   - SAP Fiori Tools
   - Full Stack Cloud Application Development

3. Clone/Upload this project

---

## Step 2: Login to Cloud Foundry

```bash
# Login to CF
cf login -a https://api.cf.us10-001.hana.ondemand.com

# Set target org and space
cf target -o <your-org> -s <your-space>
```

---

## Step 3: Create Required Services (if not exists)

```bash
# Create HANA HDI Container
cf create-service hana hdi-shared collectiq-db

# Create XSUAA Service
cf create-service xsuaa application collectiq-auth -c xs-security.json

# Create Destination Service
cf create-service destination lite collectiq-destination

# Create HTML5 App Repository
cf create-service html5-apps-repo app-host collectiq-html5-repo-host
cf create-service html5-apps-repo app-runtime collectiq-html5-runtime
```

---

## Step 4: Build the Project

```bash
# Install dependencies
npm install

# Build for production (generates gen/ folder)
npm run build

# OR use CDS directly
npx cds build --production
```

This generates:
- `gen/db/` - HANA artifacts (.hdbtable, .hdbview, etc.)
- `gen/srv/` - Node.js server with compiled models

---

## Step 5: Build MTA Archive

```bash
# Build MTA archive for deployment
mbt build --mtar collectiq.mtar
```

This creates `mta_archives/collectiq.mtar`

---

## Step 6: Deploy to Cloud Foundry

```bash
# Deploy the MTA archive
cf deploy mta_archives/collectiq.mtar

# OR use the npm script
npm run deploy
```

---

## Step 7: Configure Destinations

After deployment, configure the S/4HANA destination in BTP Cockpit:

1. Go to **Subaccount → Destinations**
2. Create/Update destination `ZUI_COLLECTIQ_04`:

| Property | Value |
|----------|-------|
| Name | ZUI_COLLECTIQ_04 |
| URL | https://fa13318e-1cb9-41eb-b81d-1759ca1e28d3.abap.us10.hana.ondemand.com |
| Authentication | BasicAuthentication or OAuth2ClientCredentials |
| User | Your SAP User |
| Password | Your Password |
| ProxyType | Internet |

---

## OData Service Endpoints

After deployment, your OData V4 service will be available at:

```
https://<your-app>.<region>.hana.ondemand.com/odata/v4/collect-iq/
```

### Available Entities:
- `/Payers` - Customer/Payer information
- `/Invoices` - Invoice details
- `/OutreachHistory` - Communication history
- `/CallTranscripts` - AI Call transcripts
- `/ScheduledFollowups` - Scheduled callbacks
- `/PaymentStatusLog` - Payment tracking

### Available Functions:
- `/getOverviewStats()` - Dashboard statistics
- `/getOutreachTimeline(days)` - Outreach timeline
- `/getPaymentDistribution()` - Payment distribution
- `/getAgingAnalysis()` - AR aging analysis

### Available Actions:
- `/Payers('{PayerId}')/CollectIQService.generateOutreach` - Generate AI draft
- `/Payers('{PayerId}')/CollectIQService.sendOutreach` - Send outreach
- `/syncAR()` - Sync AR data from S/4HANA
- `/scheduleFollowUp(...)` - Schedule follow-up call

---

## Local Development

### Run locally with SQLite (in-memory):
```bash
npm run watch
# or
npx cds watch --profile development
```

### Run locally with HANA Cloud:
```bash
# First, bind to HANA service
cds bind --to collectiq-db:collectiq-db

# Then run
cds watch --profile production
```

---

## Environment Variables

Create a `.env` file for local development:

```env
# OpenAI / Gemini for AI features
OPENAI_API_KEY=sk-...
GEMINI_API_KEY=...

# Twilio for voice calls
TWILIO_ACCOUNT_SID=AC...
TWILIO_AUTH_TOKEN=...
TWILIO_PHONE_NUMBER=+1...

# Deepgram for STT
DEEPGRAM_API_KEY=...

# SMTP for emails
SMTP_HOST=smtp.gmail.com
SMTP_PORT=587
SMTP_USER=...
SMTP_PASS=...

# Ngrok for webhook tunnel
NGROK_URL=https://...ngrok-free.dev
```

---

## Troubleshooting

### Issue: HANA connection fails
```bash
# Check service binding
cf env collectiq-srv | grep hana

# Rebind if needed
cf unbind-service collectiq-srv collectiq-db
cf bind-service collectiq-srv collectiq-db
cf restage collectiq-srv
```

### Issue: External OData service fails
```bash
# Check destination configuration
cf service-key collectiq-destination collectiq-destination-key

# Verify destination in BTP cockpit
```

### Issue: Authentication fails
```bash
# Recreate XSUAA service
cf delete-service collectiq-auth -f
cf create-service xsuaa application collectiq-auth -c xs-security.json
```

---

## Useful Commands

```bash
# View logs
cf logs collectiq-srv --recent

# SSH into running app
cf ssh collectiq-srv

# Check app status
cf apps

# Undeploy everything
cf undeploy collectiq --delete-services --delete-service-keys
```

---

## Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                    SAP BTP Cloud Foundry                    │
├─────────────────────────────────────────────────────────────┤
│  ┌─────────────┐    ┌─────────────────────────────────────┐ │
│  │  App Router │    │        collectiq-srv (Node.js)      │ │
│  │  (UI5 Apps) │───▶│  ┌───────────────────────────────┐  │ │
│  └─────────────┘    │  │   OData V4 Service Layer     │  │ │
│                     │  │   /odata/v4/collect-iq/      │  │ │
│                     │  └───────────────────────────────┘  │ │
│                     └─────────────┬───────────────────────┘ │
│                                   │                         │
│  ┌─────────────────┐    ┌─────────┴─────────┐              │
│  │   XSUAA        │    │   HANA Cloud      │              │
│  │  (Auth)        │    │  (HDI Container)  │              │
│  └─────────────────┘    └───────────────────┘              │
│                                   │                         │
│                         ┌─────────┴─────────┐              │
│                         │  Destination Svc  │              │
│                         │  (S/4HANA Link)   │              │
│                         └─────────────────────┘             │
└─────────────────────────────────────────────────────────────┘
                               │
                               ▼
              ┌────────────────────────────────┐
              │    S/4HANA Cloud (ABAP)       │
              │   ZUI_COLLECTIQ_V4 OData      │
              └────────────────────────────────┘
```

---

## Next Steps

1. Assign roles to users in BTP Cockpit
2. Configure real S/4HANA destination with OAuth
3. Set up CI/CD pipeline
4. Configure monitoring and alerting
