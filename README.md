# 🚀 Vegah CollectIQ

**AI-Powered Collections Assistant for SAP**

[![SAP BTP](https://img.shields.io/badge/SAP-BTP-0FAAFF?style=for-the-badge&logo=sap)](https://www.sap.com/products/business-technology-platform.html)
[![Node.js](https://img.shields.io/badge/Node.js-18+-339933?style=for-the-badge&logo=node.js&logoColor=white)](https://nodejs.org/)
[![OpenAI](https://img.shields.io/badge/OpenAI-Realtime_API-412991?style=for-the-badge&logo=openai&logoColor=white)](https://openai.com/)

---

## 📖 Overview

**Vegah CollectIQ** is an intelligent accounts receivable (AR) collections platform that leverages AI to automate and optimize the debt collection process. Built on SAP Business Technology Platform (BTP), it integrates seamlessly with SAP S/4HANA to provide a modern, multi-channel outreach solution.

The system automatically escalates collection efforts through three stages based on invoice aging, using **email reminders**, **personalized messages**, and **AI-powered voice calls** via OpenAI's Realtime API and Twilio.

---

## ✨ Key Features

| Feature | Description |
|---------|-------------|
| 🤖 **AI Voice Calls** | Real-time conversational AI powered by OpenAI's GPT-4o Realtime API for natural, empathetic collection calls |
| 📧 **Automated Emails** | Stage-based email templates with secure payment portal links |
| 📊 **Dynamic Staging** | Automatic escalation (Stage 1 → 2 → 3) based on days past due |
| 🔗 **SAP Integration** | Native connection to SAP S/4HANA via OData for real-time AR data sync |
| 🌐 **Secure Payment Portal** | Self-service portal for payers to view and settle outstanding balances |
| ⏰ **Scheduled Outreach** | Configurable cron jobs for automated batch processing |

---

## 🏗️ Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                        SAP S/4HANA                              │
│                   (Accounts Receivable Data)                    │
└───────────────────────────┬─────────────────────────────────────┘
                            │ OData v4
                            ▼
┌─────────────────────────────────────────────────────────────────┐
│                     SAP CAP Service Layer                       │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────────────────┐  │
│  │   Payers    │  │  Invoices   │  │   Outreach History      │  │
│  └─────────────┘  └─────────────┘  └─────────────────────────┘  │
└───────────────────────────┬─────────────────────────────────────┘
                            │
        ┌───────────────────┼───────────────────┐
        ▼                   ▼                   ▼
┌───────────────┐   ┌───────────────┐   ┌───────────────┐
│   Nodemailer  │   │    Twilio     │   │    OpenAI     │
│   (Email)     │   │  (Voice/SMS)  │   │  (Realtime)   │
└───────────────┘   └───────────────┘   └───────────────┘
```

---

## 🛠️ Tech Stack

- **Backend**: SAP Cloud Application Programming Model (CAP) with Node.js
- **Frontend**: SAP UI5 / Fiori Elements
- **Database**: SQLite (local) / SAP HANA Cloud (production)
- **AI Engine**: OpenAI GPT-4o Realtime API
- **Telephony**: Twilio Programmable Voice
- **Email**: Nodemailer with SMTP

---

## 🚀 Getting Started

### Prerequisites

- Node.js 18+ and npm
- SAP BTP Account (for deployment)
- Twilio Account with Voice capabilities
- OpenAI API Key with Realtime API access

### Installation

```bash
# Clone the repository
git clone https://github.com/Abhijit1018/Collect_IQ-2.git
cd Collect_IQ-2

# Install dependencies
npm install

# Start the development server
npm start
```

### Environment Variables

Create a `.env` file in the root directory:

```env
# Email Configuration
EMAIL_HOST=smtp.example.com
EMAIL_PORT=587
EMAIL_USER=your-email@example.com
EMAIL_PASS=your-email-password

# Twilio Configuration
TWILIO_ACCOUNT_SID=your-twilio-sid
TWILIO_AUTH_TOKEN=your-twilio-token
TWILIO_PHONE_NUMBER=+1234567890

# OpenAI Configuration
OPENAI_API_KEY=your-openai-api-key

# Ngrok URL (for local Twilio webhooks)
NGROK_URL=https://your-ngrok-url.ngrok.io
```

---

## 📂 Project Structure

```
collectiq-2/
├── app/                    # SAP UI5 Frontend Application
│   └── collectiq_ui/       # Main Fiori application
├── db/                     # Database schema and seed data
│   ├── data/               # CSV seed files (Payers, Invoices)
│   └── schema.cds          # CDS data model
├── srv/                    # CAP Service Layer
│   ├── service.js          # Main service implementation
│   └── templates/          # Email/Voice script templates
└── package.json
```

---

## 📞 Outreach Stages

| Stage | Trigger | Action |
|-------|---------|--------|
| **Stage 1** | 0-5 days past due | Friendly reminder email with payment portal link |
| **Stage 2** | 6-10 days past due | Escalated email with urgency messaging |
| **Stage 3** | 10+ days past due | AI-powered voice call via Twilio + OpenAI |

---

## 📝 Changelog

### 2026-01-30
#### AI Voice Call Improvements
- **Fixed "Due Amount" Tautology**: Resolved an issue where the AI bot would say "the due amount is the due amount" instead of the actual value.
- **Fixed Wrong Payer Data**: Added robust `payerId` extraction from the WebSocket URL to ensure the AI always loads the correct payer's information.
- **Enhanced Logging**: Added detailed console logs during the media stream connection for easier debugging.

---

## 📄 License

This project is proprietary software developed for Vegah LLC.

---

<p align="center">
  <strong>Built with ❤️ by Vegah LLC</strong>
</p>
