# SAP BTP CAP + UI5 PROJECT PROMPT - OUTREACH AUTOMATION FEATURES

## PROJECT CONTEXT
I'm building an SAP outreach automation system using:
- **Backend**: SAP Cloud Application Programming Model (CAP) with Node.js
- **Frontend**: SAP UI5 (SAPUI5/OpenUI5)
- **Database**: SAP HANA Cloud / SQLite (development)
- **Platform**: SAP Business Technology Platform (BTP)
- **Integrations**: Nodemailer, Twilio, OpenAI GPT Realtime API

**Existing Features:**
- Main page with past due invoices in table format
- Payer information detail page
- Basic CDS data model for Payers and Invoices

## WHAT I NEED TO BUILD

I need to add three new features to my existing CAP project:

### 1. Statistics Dashboard Page
- Display overview metrics (total payers, outstanding amount, success rates)
- Show interactive charts (outreach timeline, payment distribution, aging analysis)
- Auto-refresh data every 5 minutes
- Filter by date range and outreach type

### 2. AI Call Results & Transcript Viewer Page
- Display call details and transcripts
- Show AI-generated call conclusion
- Highlight payment promises and follow-up dates
- Sentiment analysis visualization
- Export transcript functionality

### 3. Smart Scheduling System
- Auto-schedule follow-up calls based on AI call results
- Monitor payment status before executing follow-ups
- Cancel follow-up if payment received, send thank you email
- Execute follow-up calls if payment not received
- Calendar view and list view for scheduled follow-ups

---

## DETAILED REQUIREMENTS

## PART 1: CAP DATA MODEL (CDS Schema)

Please create or extend the following CDS entities in `db/schema.cds`:

```cds
namespace com.sap.outreach;

using {
    managed,
    cuid
} from '@sap/cds/common';

// EXISTING ENTITIES (for reference)
entity Payers : managed, cuid {
    name              : String(100);
    company           : String(200);
    email             : String(100);
    phone             : String(20);
    address           : String(500);
    invoices          : Composition of many Invoices on invoices.payer = $self;
    outreachHistory   : Composition of many OutreachHistory on outreachHistory.payer = $self;
    callTranscripts   : Composition of many CallTranscripts on callTranscripts.payer = $self;
    scheduledFollowups: Composition of many ScheduledFollowups on scheduledFollowups.payer = $self;
}

entity Invoices : managed, cuid {
    payer         : Association to Payers;
    invoiceNumber : String(50);
    amount        : Decimal(10, 2);
    dueDate       : Date;
    status        : String(20) enum {
        unpaid;
        paid;
        overdue;
        disputed;
        partial;
    };
    paidDate      : Date;
    paidAmount    : Decimal(10, 2);
}

// NEW ENTITIES TO CREATE

entity OutreachHistory : managed, cuid {
    payer            : Association to Payers;
    outreachType     : String(20) enum {
        email;
        call;
        sms;
    };
    outreachDate     : DateTime;
    status           : String(20) enum {
        sent;
        delivered;
        failed;
        responded;
    };
    responseReceived : Boolean default false;
    responseDate     : DateTime;
    notes            : String(1000);
}

entity CallTranscripts : managed, cuid {
    payer                  : Association to Payers;
    callId                 : String(100) @readonly;
    callDate               : DateTime;
    duration               : Integer; // in seconds
    transcriptAgent        : LargeString;
    transcriptPayer        : LargeString;
    fullTranscript         : LargeString;
    callConclusion         : String(1000);
    paymentPromiseDate     : Date;
    paymentPromiseConfirmed: Boolean default false;
    disputeRaised          : Boolean default false;
    sentimentScore         : Decimal(3, 2); // -1.00 to 1.00
    keyPoints              : LargeString; // JSON array as string
    recommendedAction      : String(500);
}

entity ScheduledFollowups : managed, cuid {
    payer           : Association to Payers;
    originalCall    : Association to CallTranscripts;
    scheduledDate   : Date;
    scheduledTime   : Time default '10:00:00';
    reason          : String(500);
    status          : String(20) enum {
        pending;
        completed;
        cancelled;
        failed;
        rescheduled;
    } default 'pending';
    executionDate   : DateTime;
    result          : String(1000);
}

entity PaymentStatusLog : managed, cuid {
    payer              : Association to Payers;
    invoice            : Association to Invoices;
    statusCheckedDate  : DateTime;
    paymentReceived    : Boolean default false;
    amountPaid         : Decimal(10, 2);
}
```

---

## PART 2: CAP SERVICE DEFINITIONS

Please create these services in `srv/service.cds`:

```cds
using {com.sap.outreach as db} from '../db/schema';

// Main Service
service OutreachService @(path: '/outreach') {

    // Existing entities
    entity Payers as projection on db.Payers;
    entity Invoices as projection on db.Invoices;
    
    // New entities
    entity OutreachHistory as projection on db.OutreachHistory;
    entity CallTranscripts as projection on db.CallTranscripts;
    entity ScheduledFollowups as projection on db.ScheduledFollowups;
    entity PaymentStatusLog as projection on db.PaymentStatusLog;

    // Statistics Actions
    @readonly
    function getOverviewStats() returns {
        totalPayers           : Integer;
        totalOutstanding      : Decimal(12, 2);
        callsToday            : Integer;
        emailsToday           : Integer;
        smsToday              : Integer;
        successRate           : Decimal(5, 2);
        averageResponseTime   : Decimal(8, 2);
    };

    @readonly
    function getOutreachTimeline(days : Integer) returns array of {
        date         : Date;
        outreachType : String;
        count        : Integer;
    };

    @readonly
    function getAgingAnalysis() returns array of {
        ageBucket   : String;
        invoiceCount: Integer;
        totalAmount : Decimal(12, 2);
    };

    @readonly
    function getPaymentDistribution() returns array of {
        status      : String;
        count       : Integer;
        totalAmount : Decimal(12, 2);
    };

    @readonly
    function getTopOutstandingPayers(limit : Integer) returns array of {
        payerId     : String;
        payerName   : String;
        totalAmount : Decimal(12, 2);
        invoiceCount: Integer;
    };

    @readonly
    function getMethodEffectiveness() returns array of {
        outreachType: String;
        totalSent   : Integer;
        totalResponses: Integer;
        successRate : Decimal(5, 2);
    };

    // Call Analysis Actions
    @readonly
    function getCallDetails(callId : String) returns {
        call        : db.CallTranscripts;
        payerInfo   : db.Payers;
        invoiceInfo : db.Invoices;
    };

    action analyzeCallTranscript(
        callId     : String,
        transcript : String
    ) returns {
        paymentPromiseDate     : Date;
        paymentPromiseConfirmed: Boolean;
        disputeRaised          : Boolean;
        sentiment              : String;
        sentimentScore         : Decimal(3, 2);
        conclusionSummary      : String;
        keyPoints              : String; // JSON array
        recommendedAction      : String;
        financialHardship      : Boolean;
    };

    // Scheduling Actions
    action scheduleFollowUp(
        payerId       : String,
        originalCallId: String,
        scheduledDate : Date,
        reason        : String
    ) returns db.ScheduledFollowups;

    action cancelFollowUp(followUpId : String) returns Boolean;

    action rescheduleFollowUp(
        followUpId : String,
        newDate    : Date,
        newTime    : Time
    ) returns db.ScheduledFollowups;

    @readonly
    function getUpcomingFollowUps() returns array of db.ScheduledFollowups;

    @readonly
    function getTodayFollowUps() returns array of db.ScheduledFollowups;

    action executeFollowUp(followUpId : String) returns {
        success: Boolean;
        message: String;
        callId : String;
    };

    action checkPaymentStatus(payerId : String) returns {
        paymentReceived: Boolean;
        unpaidInvoices : array of db.Invoices;
    };
}
```

---

## PART 3: CAP SERVICE IMPLEMENTATION

Please implement the service handlers in `srv/service.js`:

```javascript
const cds = require('@sap/cds');
const axios = require('axios');

module.exports = cds.service.impl(async function() {
    const { 
        Payers, 
        Invoices, 
        OutreachHistory, 
        CallTranscripts, 
        ScheduledFollowups,
        PaymentStatusLog
    } = this.entities;

    // STATISTICS FUNCTIONS

    this.on('getOverviewStats', async (req) => {
        // TODO: Implement overview statistics
        // Count total payers
        // Sum outstanding amounts from unpaid invoices
        // Count calls/emails/sms today
        // Calculate success rate from OutreachHistory
        
        const totalPayers = await SELECT.from(Payers).columns('count(*) as count');
        const outstandingAmount = await SELECT.from(Invoices)
            .where({ status: 'unpaid' })
            .columns('sum(amount) as total');
        
        const today = new Date().toISOString().split('T')[0];
        const callsToday = await SELECT.from(OutreachHistory)
            .where({ outreachType: 'call' })
            .and(`outreachDate >= '${today}'`)
            .columns('count(*) as count');
            
        // Return aggregated stats
        return {
            totalPayers: totalPayers[0].count,
            totalOutstanding: outstandingAmount[0]?.total || 0,
            callsToday: callsToday[0].count,
            // ... implement other metrics
        };
    });

    this.on('getOutreachTimeline', async (req) => {
        const { days } = req.data;
        
        // TODO: Query OutreachHistory grouped by date and type
        // Return timeline data for last N days
        
        const results = await SELECT.from(OutreachHistory)
            .where(`outreachDate >= CURRENT_DATE - ${days}`)
            .columns('outreachDate as date', 'outreachType', 'count(*) as count')
            .groupBy('outreachDate', 'outreachType')
            .orderBy('outreachDate');
            
        return results;
    });

    this.on('getAgingAnalysis', async (req) => {
        // TODO: Calculate aging buckets for unpaid invoices
        // Group by: 0-30 days, 31-60 days, 61-90 days, 90+ days
        
        const query = `
            SELECT 
                CASE 
                    WHEN DAYS_BETWEEN(dueDate, CURRENT_DATE) <= 30 THEN '0-30 days'
                    WHEN DAYS_BETWEEN(dueDate, CURRENT_DATE) <= 60 THEN '31-60 days'
                    WHEN DAYS_BETWEEN(dueDate, CURRENT_DATE) <= 90 THEN '61-90 days'
                    ELSE '90+ days'
                END as ageBucket,
                COUNT(*) as invoiceCount,
                SUM(amount) as totalAmount
            FROM Invoices
            WHERE status = 'unpaid'
            GROUP BY ageBucket
        `;
        
        return await cds.run(query);
    });

    this.on('getPaymentDistribution', async (req) => {
        // TODO: Group invoices by status
        return await SELECT.from(Invoices)
            .columns('status', 'count(*) as count', 'sum(amount) as totalAmount')
            .groupBy('status');
    });

    this.on('getTopOutstandingPayers', async (req) => {
        const { limit } = req.data;
        
        // TODO: Get top payers by outstanding amount
        const query = `
            SELECT 
                p.ID as payerId,
                p.name as payerName,
                SUM(i.amount) as totalAmount,
                COUNT(i.ID) as invoiceCount
            FROM Payers p
            JOIN Invoices i ON i.payer_ID = p.ID
            WHERE i.status = 'unpaid'
            GROUP BY p.ID, p.name
            ORDER BY totalAmount DESC
            LIMIT ${limit || 10}
        `;
        
        return await cds.run(query);
    });

    this.on('getMethodEffectiveness', async (req) => {
        // TODO: Calculate success rate by outreach type
        const query = `
            SELECT 
                outreachType,
                COUNT(*) as totalSent,
                SUM(CASE WHEN responseReceived = true THEN 1 ELSE 0 END) as totalResponses,
                (SUM(CASE WHEN responseReceived = true THEN 1 ELSE 0 END) * 100.0 / COUNT(*)) as successRate
            FROM OutreachHistory
            WHERE outreachDate >= CURRENT_DATE - 30
            GROUP BY outreachType
        `;
        
        return await cds.run(query);
    });

    // CALL ANALYSIS FUNCTIONS

    this.on('analyzeCallTranscript', async (req) => {
        const { callId, transcript } = req.data;
        
        // TODO: Call OpenAI GPT-4 to analyze transcript
        const openai = new (require('openai'))({
            apiKey: process.env.OPENAI_API_KEY
        });
        
        const analysis = await openai.chat.completions.create({
            model: 'gpt-4',
            messages: [{
                role: 'system',
                content: `Analyze this payment collection call transcript and extract:
                {
                    "paymentPromiseDate": "YYYY-MM-DD or null",
                    "paymentPromiseConfirmed": boolean,
                    "disputeRaised": boolean,
                    "sentiment": "positive|neutral|negative",
                    "sentimentScore": -1.0 to 1.0,
                    "conclusionSummary": "2-3 sentence summary",
                    "keyPoints": ["point1", "point2"],
                    "recommendedAction": "next step",
                    "financialHardship": boolean
                }`
            }, {
                role: 'user',
                content: transcript
            }],
            response_format: { type: 'json_object' }
        });
        
        const result = JSON.parse(analysis.choices[0].message.content);
        
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
    });

    this.on('getCallDetails', async (req) => {
        const { callId } = req.data;
        
        const call = await SELECT.one.from(CallTranscripts)
            .where({ callId: callId });
        
        if (!call) {
            req.error(404, `Call ${callId} not found`);
        }
        
        const payerInfo = await SELECT.one.from(Payers)
            .where({ ID: call.payer_ID });
            
        const invoiceInfo = await SELECT.from(Invoices)
            .where({ payer_ID: call.payer_ID, status: 'unpaid' });
        
        return { call, payerInfo, invoiceInfo };
    });

    // SCHEDULING FUNCTIONS

    this.on('scheduleFollowUp', async (req) => {
        const { payerId, originalCallId, scheduledDate, reason } = req.data;
        
        // TODO: Create new scheduled follow-up
        const followUp = await INSERT.into(ScheduledFollowups).entries({
            payer_ID: payerId,
            originalCall_ID: originalCallId,
            scheduledDate: scheduledDate,
            reason: reason,
            status: 'pending'
        });
        
        console.log(`Follow-up scheduled for ${scheduledDate}`);
        return followUp;
    });

    this.on('cancelFollowUp', async (req) => {
        const { followUpId } = req.data;
        
        await UPDATE(ScheduledFollowups)
            .set({ status: 'cancelled' })
            .where({ ID: followUpId });
        
        return true;
    });

    this.on('rescheduleFollowUp', async (req) => {
        const { followUpId, newDate, newTime } = req.data;
        
        await UPDATE(ScheduledFollowups)
            .set({ 
                scheduledDate: newDate,
                scheduledTime: newTime,
                status: 'rescheduled'
            })
            .where({ ID: followUpId });
        
        return await SELECT.one.from(ScheduledFollowups).where({ ID: followUpId });
    });

    this.on('getUpcomingFollowUps', async (req) => {
        return await SELECT.from(ScheduledFollowups)
            .where({ status: 'pending' })
            .and(`scheduledDate >= CURRENT_DATE`)
            .orderBy('scheduledDate', 'scheduledTime');
    });

    this.on('getTodayFollowUps', async (req) => {
        const today = new Date().toISOString().split('T')[0];
        
        return await SELECT.from(ScheduledFollowups)
            .where({ status: 'pending', scheduledDate: today })
            .orderBy('scheduledTime');
    });

    this.on('checkPaymentStatus', async (req) => {
        const { payerId } = req.data;
        
        const unpaidInvoices = await SELECT.from(Invoices)
            .where({ payer_ID: payerId, status: 'unpaid' });
        
        // Log the check
        await INSERT.into(PaymentStatusLog).entries({
            payer_ID: payerId,
            statusCheckedDate: new Date().toISOString(),
            paymentReceived: unpaidInvoices.length === 0
        });
        
        return {
            paymentReceived: unpaidInvoices.length === 0,
            unpaidInvoices: unpaidInvoices
        };
    });

    this.on('executeFollowUp', async (req) => {
        const { followUpId } = req.data;
        
        const followUp = await SELECT.one.from(ScheduledFollowups)
            .where({ ID: followUpId });
        
        // Check payment status first
        const paymentStatus = await this.checkPaymentStatus({ 
            payerId: followUp.payer_ID 
        });
        
        if (paymentStatus.paymentReceived) {
            // Payment received - mark as completed
            await UPDATE(ScheduledFollowups)
                .set({ 
                    status: 'completed',
                    result: 'Payment received before follow-up',
                    executionDate: new Date().toISOString()
                })
                .where({ ID: followUpId });
            
            // TODO: Send thank you email
            
            return {
                success: true,
                message: 'Payment received - follow-up cancelled',
                callId: null
            };
        }
        
        // Payment not received - initiate call
        // TODO: Integrate with Twilio + OpenAI Realtime API
        
        await UPDATE(ScheduledFollowups)
            .set({ 
                status: 'completed',
                executionDate: new Date().toISOString()
            })
            .where({ ID: followUpId });
        
        return {
            success: true,
            message: 'Follow-up call initiated',
            callId: 'CALL_' + Date.now()
        };
    });
});
```

---

## PART 4: UI5 APPLICATION STRUCTURE

Please create the following UI5 views and controllers:

### 4.1 Statistics Dashboard

**View: `webapp/view/StatisticsDashboard.view.xml`**

```xml
<mvc:View
    controllerName="com.sap.outreach.controller.StatisticsDashboard"
    xmlns:mvc="sap.ui.core.mvc"
    xmlns="sap.m"
    xmlns:core="sap.ui.core"
    xmlns:layout="sap.ui.layout"
    xmlns:viz="sap.viz.ui5.controls"
    xmlns:viz.feeds="sap.viz.ui5.controls.common.feeds"
    xmlns:viz.data="sap.viz.ui5.data"
    height="100%">
    
    <Page id="statisticsPage" title="Statistics Dashboard">
        <content>
            <ScrollContainer height="100%" vertical="true">
                
                <!-- Summary Cards Section -->
                <layout:Grid defaultSpan="L3 M6 S12" class="sapUiSmallMargin">
                    
                    <!-- Total Payers Card -->
                    <GenericTile
                        header="Total Payers"
                        subheader="Active Accounts"
                        press="onCardPress">
                        <TileContent>
                            <NumericContent
                                value="{stats>/totalPayers}"
                                valueColor="Good"
                                icon="sap-icon://customer"/>
                        </TileContent>
                    </GenericTile>
                    
                    <!-- Total Outstanding Card -->
                    <GenericTile
                        header="Total Outstanding"
                        subheader="Unpaid Invoices">
                        <TileContent>
                            <NumericContent
                                value="{stats>/totalOutstanding}"
                                valueColor="Error"
                                scale="M"
                                icon="sap-icon://cart"
                                withMargin="false"/>
                        </TileContent>
                    </GenericTile>
                    
                    <!-- Calls Today Card -->
                    <GenericTile
                        header="Calls Today"
                        subheader="Outreach Activity">
                        <TileContent>
                            <NumericContent
                                value="{stats>/callsToday}"
                                valueColor="Neutral"
                                icon="sap-icon://phone"/>
                        </TileContent>
                    </GenericTile>
                    
                    <!-- Success Rate Card -->
                    <GenericTile
                        header="Success Rate"
                        subheader="Response Rate">
                        <TileContent>
                            <NumericContent
                                value="{stats>/successRate}"
                                valueColor="Good"
                                scale="%"
                                icon="sap-icon://sales-quote"/>
                        </TileContent>
                    </GenericTile>
                </layout:Grid>
                
                <!-- Charts Section -->
                <VBox class="sapUiMediumMarginTop">
                    
                    <!-- Outreach Timeline Chart -->
                    <Panel headerText="Outreach Activity (Last 30 Days)" class="sapUiSmallMargin">
                        <viz:VizFrame
                            id="outreachTimelineChart"
                            width="100%"
                            height="400px"
                            vizType="timeseries_line">
                            <viz:dataset>
                                <viz.data:FlattenedDataset data="{timeline>/}">
                                    <viz.data:dimensions>
                                        <viz.data:DimensionDefinition 
                                            name="Date" 
                                            value="{timeline>date}"/>
                                    </viz.data:dimensions>
                                    <viz.data:measures>
                                        <viz.data:MeasureDefinition 
                                            name="Email" 
                                            value="{timeline>email}"/>
                                        <viz.data:MeasureDefinition 
                                            name="Call" 
                                            value="{timeline>call}"/>
                                        <viz.data:MeasureDefinition 
                                            name="SMS" 
                                            value="{timeline>sms}"/>
                                    </viz.data:measures>
                                </viz.data:FlattenedDataset>
                            </viz:dataset>
                            <viz:feeds>
                                <viz.feeds:FeedItem 
                                    uid="valueAxis" 
                                    type="Measure" 
                                    values="Email,Call,SMS"/>
                                <viz.feeds:FeedItem 
                                    uid="timeAxis" 
                                    type="Dimension" 
                                    values="Date"/>
                            </viz:feeds>
                        </viz:VizFrame>
                    </Panel>
                    
                    <!-- Payment Distribution Chart -->
                    <Panel headerText="Payment Status Distribution" class="sapUiSmallMargin">
                        <viz:VizFrame
                            id="paymentDistChart"
                            width="100%"
                            height="400px"
                            vizType="donut">
                            <viz:dataset>
                                <viz.data:FlattenedDataset data="{paymentDist>/}">
                                    <viz.data:dimensions>
                                        <viz.data:DimensionDefinition 
                                            name="Status" 
                                            value="{paymentDist>status}"/>
                                    </viz.data:dimensions>
                                    <viz.data:measures>
                                        <viz.data:MeasureDefinition 
                                            name="Count" 
                                            value="{paymentDist>count}"/>
                                    </viz.data:measures>
                                </viz.data:FlattenedDataset>
                            </viz:dataset>
                            <viz:feeds>
                                <viz.feeds:FeedItem 
                                    uid="size" 
                                    type="Measure" 
                                    values="Count"/>
                                <viz.feeds:FeedItem 
                                    uid="color" 
                                    type="Dimension" 
                                    values="Status"/>
                            </viz:feeds>
                        </viz:VizFrame>
                    </Panel>
                    
                    <!-- Aging Analysis Chart -->
                    <Panel headerText="Outstanding Amount by Age" class="sapUiSmallMargin">
                        <viz:VizFrame
                            id="agingAnalysisChart"
                            width="100%"
                            height="400px"
                            vizType="column">
                            <viz:dataset>
                                <viz.data:FlattenedDataset data="{aging>/}">
                                    <viz.data:dimensions>
                                        <viz.data:DimensionDefinition 
                                            name="Age Bucket" 
                                            value="{aging>ageBucket}"/>
                                    </viz.data:dimensions>
                                    <viz.data:measures>
                                        <viz.data:MeasureDefinition 
                                            name="Amount" 
                                            value="{aging>totalAmount}"/>
                                        <viz.data:MeasureDefinition 
                                            name="Invoice Count" 
                                            value="{aging>invoiceCount}"/>
                                    </viz.data:measures>
                                </viz.data:FlattenedDataset>
                            </viz:dataset>
                            <viz:feeds>
                                <viz.feeds:FeedItem 
                                    uid="valueAxis" 
                                    type="Measure" 
                                    values="Amount,Invoice Count"/>
                                <viz.feeds:FeedItem 
                                    uid="categoryAxis" 
                                    type="Dimension" 
                                    values="Age Bucket"/>
                            </viz:feeds>
                        </viz:VizFrame>
                    </Panel>
                    
                </VBox>
            </ScrollContainer>
        </content>
    </Page>
</mvc:View>
```

**Controller: `webapp/controller/StatisticsDashboard.controller.js`**

```javascript
sap.ui.define([
    "sap/ui/core/mvc/Controller",
    "sap/ui/model/json/JSONModel",
    "sap/m/MessageToast"
], function (Controller, JSONModel, MessageToast) {
    "use strict";

    return Controller.extend("com.sap.outreach.controller.StatisticsDashboard", {

        onInit: function () {
            // Initialize models
            this.getView().setModel(new JSONModel({}), "stats");
            this.getView().setModel(new JSONModel([]), "timeline");
            this.getView().setModel(new JSONModel([]), "paymentDist");
            this.getView().setModel(new JSONModel([]), "aging");
            
            // Load initial data
            this.loadAllStatistics();
            
            // Set up auto-refresh (every 5 minutes)
            setInterval(() => {
                this.loadAllStatistics();
            }, 300000);
        },

        loadAllStatistics: function () {
            this.loadOverviewStats();
            this.loadOutreachTimeline();
            this.loadPaymentDistribution();
            this.loadAgingAnalysis();
        },

        loadOverviewStats: function () {
            const oModel = this.getView().getModel();
            
            oModel.callFunction("/getOverviewStats", {
                method: "GET",
                success: (oData) => {
                    this.getView().getModel("stats").setData(oData);
                },
                error: (oError) => {
                    MessageToast.show("Error loading statistics");
                    console.error(oError);
                }
            });
        },

        loadOutreachTimeline: function () {
            const oModel = this.getView().getModel();
            
            oModel.callFunction("/getOutreachTimeline", {
                method: "GET",
                urlParameters: {
                    days: 30
                },
                success: (oData) => {
                    // Transform data for chart
                    const timelineData = this.transformTimelineData(oData.results);
                    this.getView().getModel("timeline").setData(timelineData);
                },
                error: (oError) => {
                    console.error(oError);
                }
            });
        },

        transformTimelineData: function (data) {
            // Group by date and pivot outreach types
            const grouped = {};
            
            data.forEach(item => {
                if (!grouped[item.date]) {
                    grouped[item.date] = {
                        date: item.date,
                        email: 0,
                        call: 0,
                        sms: 0
                    };
                }
                grouped[item.date][item.outreachType] = item.count;
            });
            
            return Object.values(grouped);
        },

        loadPaymentDistribution: function () {
            const oModel = this.getView().getModel();
            
            oModel.callFunction("/getPaymentDistribution", {
                method: "GET",
                success: (oData) => {
                    this.getView().getModel("paymentDist").setData(oData.results);
                },
                error: (oError) => {
                    console.error(oError);
                }
            });
        },

        loadAgingAnalysis: function () {
            const oModel = this.getView().getModel();
            
            oModel.callFunction("/getAgingAnalysis", {
                method: "GET",
                success: (oData) => {
                    this.getView().getModel("aging").setData(oData.results);
                },
                error: (oError) => {
                    console.error(oError);
                }
            });
        },

        onCardPress: function (oEvent) {
            // Navigate to detailed view if needed
            MessageToast.show("Card pressed");
        }
    });
});
```

---

### 4.2 Call Results Viewer

**View: `webapp/view/CallResults.view.xml`**

```xml
<mvc:View
    controllerName="com.sap.outreach.controller.CallResults"
    xmlns:mvc="sap.ui.core.mvc"
    xmlns="sap.m"
    xmlns:l="sap.ui.layout"
    xmlns:f="sap.ui.layout.form"
    height="100%">
    
    <Page 
        id="callResultsPage" 
        title="Call Results"
        showNavButton="true"
        navButtonPress="onNavBack">
        
        <content>
            <ScrollContainer height="100%" vertical="true">
                
                <!-- Call Summary Card -->
                <Panel 
                    headerText="Call Summary" 
                    class="sapUiSmallMargin">
                    <f:SimpleForm
                        layout="ResponsiveGridLayout"
                        editable="false">
                        <f:content>
                            <Label text="Payer Name"/>
                            <Text text="{call>/payerInfo/name}"/>
                            
                            <Label text="Company"/>
                            <Text text="{call>/payerInfo/company}"/>
                            
                            <Label text="Call Date"/>
                            <Text text="{
                                path: 'call>/call/callDate',
                                type: 'sap.ui.model.type.DateTime',
                                formatOptions: { 
                                    pattern: 'dd/MM/yyyy HH:mm' 
                                }
                            }"/>
                            
                            <Label text="Duration"/>
                            <Text text="{
                                parts: ['call>/call/duration'],
                                formatter: '.formatDuration'
                            }"/>
                            
                            <Label text="Invoice Number"/>
                            <Text text="{call>/invoiceInfo/0/invoiceNumber}"/>
                            
                            <Label text="Outstanding Amount"/>
                            <ObjectNumber
                                number="{call>/invoiceInfo/0/amount}"
                                unit="USD"
                                state="Error"/>
                        </f:content>
                    </f:SimpleForm>
                </Panel>
                
                <!-- Call Conclusion Card -->
                <Panel 
                    headerText="Call Conclusion" 
                    class="sapUiSmallMargin">
                    <VBox class="sapUiSmallMargin">
                        <Text 
                            text="{call>/call/callConclusion}"
                            class="sapUiSmallMarginBottom"/>
                        
                        <!-- Payment Promise -->
                        <VBox visible="{= ${call>/call/paymentPromiseDate} !== null}">
                            <HBox alignItems="Center" class="sapUiTinyMarginBottom">
                                <core:Icon 
                                    src="sap-icon://calendar" 
                                    color="green"
                                    class="sapUiTinyMarginEnd"/>
                                <Label text="Payment Promised:"/>
                                <Text 
                                    text="{
                                        path: 'call>/call/paymentPromiseDate',
                                        type: 'sap.ui.model.type.Date',
                                        formatOptions: { 
                                            pattern: 'EEEE, MMMM dd, yyyy' 
                                        }
                                    }"
                                    class="sapUiSmallMarginBegin"/>
                            </HBox>
                        </VBox>
                        
                        <!-- Follow-up Scheduled -->
                        <VBox visible="{= ${call>/followUpScheduled} === true}">
                            <HBox alignItems="Center">
                                <core:Icon 
                                    src="sap-icon://appointment" 
                                    color="blue"
                                    class="sapUiTinyMarginEnd"/>
                                <Label text="Follow-up Scheduled:"/>
                                <Text 
                                    text="{call>/followUpDate}"
                                    class="sapUiSmallMarginBegin"/>
                            </HBox>
                        </VBox>
                        
                        <!-- Recommended Action -->
                        <VBox class="sapUiSmallMarginTop">
                            <Label text="Recommended Action:" class="sapUiTinyMarginBottom"/>
                            <MessageStrip
                                text="{call>/call/recommendedAction}"
                                type="Information"
                                showIcon="true"/>
                        </VBox>
                    </VBox>
                </Panel>
                
                <!-- Sentiment Analysis -->
                <Panel 
                    headerText="Sentiment Analysis" 
                    class="sapUiSmallMargin">
                    <VBox class="sapUiSmallMargin">
                        <ProgressIndicator
                            percentValue="{
                                parts: ['call>/call/sentimentScore'],
                                formatter: '.formatSentimentPercent'
                            }"
                            displayValue="{
                                parts: ['call>/call/sentimentScore'],
                                formatter: '.formatSentimentLabel'
                            }"
                            state="{
                                parts: ['call>/call/sentimentScore'],
                                formatter: '.formatSentimentState'
                            }"
                            width="100%"/>
                        <Text 
                            text="{
                                parts: ['call>/call/sentimentScore'],
                                formatter: '.formatSentimentDescription'
                            }"
                            class="sapUiSmallMarginTop"/>
                    </VBox>
                </Panel>
                
                <!-- Transcript Viewer -->
                <Panel 
                    headerText="Call Transcript" 
                    class="sapUiSmallMargin"
                    expandable="true"
                    expanded="false">
                    <l:Grid defaultSpan="L6 M12 S12">
                        
                        <!-- Agent Transcript -->
                        <VBox class="sapUiSmallMargin">
                            <Title text="Agent" level="H4" class="sapUiTinyMarginBottom"/>
                            <TextArea
                                value="{call>/call/transcriptAgent}"
                                rows="15"
                                editable="false"
                                width="100%"/>
                        </VBox>
                        
                        <!-- Payer Transcript -->
                        <VBox class="sapUiSmallMargin">
                            <Title text="Payer Response" level="H4" class="sapUiTinyMarginBottom"/>
                            <TextArea
                                value="{call>/call/transcriptPayer}"
                                rows="15"
                                editable="false"
                                width="100%"/>
                        </VBox>
                    </l:Grid>
                </Panel>
                
                <!-- Key Points -->
                <Panel 
                    headerText="Key Points" 
                    class="sapUiSmallMargin"
                    visible="{= ${call>/call/keyPoints} !== null}">
                    <List items="{
                        path: 'call>/keyPointsArray'
                    }">
                        <StandardListItem 
                            title="{call>}"
                            icon="sap-icon://bullet-text"/>
                    </List>
                </Panel>
                
            </ScrollContainer>
        </content>
        
        <footer>
            <OverflowToolbar>
                <ToolbarSpacer/>
                <Button 
                    text="Export Transcript" 
                    icon="sap-icon://download"
                    press="onExportTranscript"/>
                <Button 
                    text="Schedule Follow-up" 
                    icon="sap-icon://appointment"
                    type="Emphasized"
                    press="onScheduleFollowUp"/>
            </OverflowToolbar>
        </footer>
    </Page>
</mvc:View>
```

**Controller: `webapp/controller/CallResults.controller.js`**

```javascript
sap.ui.define([
    "sap/ui/core/mvc/Controller",
    "sap/ui/model/json/JSONModel",
    "sap/m/MessageToast",
    "sap/ui/core/routing/History"
], function (Controller, JSONModel, MessageToast, History) {
    "use strict";

    return Controller.extend("com.sap.outreach.controller.CallResults", {

        onInit: function () {
            const oRouter = this.getOwnerComponent().getRouter();
            oRouter.getRoute("callResults").attachPatternMatched(this._onRouteMatched, this);
        },

        _onRouteMatched: function (oEvent) {
            const sCallId = oEvent.getParameter("arguments").callId;
            this.loadCallDetails(sCallId);
        },

        loadCallDetails: function (sCallId) {
            const oModel = this.getView().getModel();
            
            oModel.callFunction("/getCallDetails", {
                method: "GET",
                urlParameters: {
                    callId: sCallId
                },
                success: (oData) => {
                    // Parse key points JSON
                    if (oData.call.keyPoints) {
                        oData.keyPointsArray = JSON.parse(oData.call.keyPoints);
                    }
                    
                    const oCallModel = new JSONModel(oData);
                    this.getView().setModel(oCallModel, "call");
                },
                error: (oError) => {
                    MessageToast.show("Error loading call details");
                    console.error(oError);
                }
            });
        },

        formatDuration: function (seconds) {
            if (!seconds) return "0m 0s";
            const minutes = Math.floor(seconds / 60);
            const secs = seconds % 60;
            return `${minutes}m ${secs}s`;
        },

        formatSentimentPercent: function (score) {
            // Convert -1 to 1 scale to 0-100
            return ((score + 1) / 2) * 100;
        },

        formatSentimentLabel: function (score) {
            if (score > 0.3) return "Positive";
            if (score > -0.3) return "Neutral";
            return "Negative";
        },

        formatSentimentState: function (score) {
            if (score > 0.3) return "Success";
            if (score > -0.3) return "Warning";
            return "Error";
        },

        formatSentimentDescription: function (score) {
            if (score > 0.3) return "Payer was cooperative and receptive";
            if (score > -0.3) return "Standard interaction";
            return "Payer was resistant or upset";
        },

        onNavBack: function () {
            const oHistory = History.getInstance();
            const sPreviousHash = oHistory.getPreviousHash();

            if (sPreviousHash !== undefined) {
                window.history.go(-1);
            } else {
                this.getOwnerComponent().getRouter().navTo("main", {}, true);
            }
        },

        onExportTranscript: function () {
            // TODO: Implement export functionality
            MessageToast.show("Export functionality coming soon");
        },

        onScheduleFollowUp: function () {
            // TODO: Open dialog to schedule follow-up
            MessageToast.show("Schedule follow-up dialog");
        }
    });
});
```

---

### 4.3 Scheduled Follow-ups

**View: `webapp/view/ScheduledFollowups.view.xml`**

```xml
<mvc:View
    controllerName="com.sap.outreach.controller.ScheduledFollowups"
    xmlns:mvc="sap.ui.core.mvc"
    xmlns="sap.m"
    xmlns:core="sap.ui.core"
    height="100%">
    
    <Page id="followupsPage" title="Scheduled Follow-ups">
        <content>
            
            <!-- Toolbar with filters -->
            <OverflowToolbar>
                <Title text="Upcoming Follow-ups" level="H2"/>
                <ToolbarSpacer/>
                <SegmentedButton 
                    selectedKey="{view>/viewMode}"
                    select="onViewModeChange">
                    <items>
                        <SegmentedButtonItem key="list" icon="sap-icon://list"/>
                        <SegmentedButtonItem key="calendar" icon="sap-icon://calendar"/>
                    </items>
                </SegmentedButton>
                <Button 
                    text="Schedule New" 
                    icon="sap-icon://add"
                    type="Emphasized"
                    press="onScheduleNew"/>
            </OverflowToolbar>
            
            <!-- List View -->
            <Table
                id="followupsTable"
                items="{
                    path: '/ScheduledFollowups',
                    parameters: {
                        $expand: 'payer',
                        $filter: 'status eq \'pending\''
                    }
                }"
                visible="{= ${view>/viewMode} === 'list'}"
                mode="SingleSelectMaster"
                selectionChange="onFollowUpSelect">
                
                <columns>
                    <Column width="12em">
                        <Text text="Payer"/>
                    </Column>
                    <Column width="10em">
                        <Text text="Scheduled Date"/>
                    </Column>
                    <Column width="8em">
                        <Text text="Time"/>
                    </Column>
                    <Column minScreenWidth="Tablet" demandPopin="true">
                        <Text text="Reason"/>
                    </Column>
                    <Column width="8em">
                        <Text text="Status"/>
                    </Column>
                    <Column width="12em" hAlign="End">
                        <Text text="Actions"/>
                    </Column>
                </columns>
                
                <items>
                    <ColumnListItem>
                        <cells>
                            <ObjectIdentifier
                                title="{payer/name}"
                                text="{payer/company}"/>
                            <Text text="{
                                path: 'scheduledDate',
                                type: 'sap.ui.model.type.Date',
                                formatOptions: {
                                    pattern: 'dd/MM/yyyy'
                                }
                            }"/>
                            <Text text="{
                                path: 'scheduledTime',
                                type: 'sap.ui.model.type.Time',
                                formatOptions: {
                                    pattern: 'HH:mm'
                                }
                            }"/>
                            <Text text="{reason}"/>
                            <ObjectStatus
                                text="{status}"
                                state="{
                                    parts: ['status'],
                                    formatter: '.formatStatusState'
                                }"/>
                            <HBox justifyContent="End">
                                <Button
                                    icon="sap-icon://edit"
                                    type="Transparent"
                                    press="onReschedule"
                                    tooltip="Reschedule"/>
                                <Button
                                    icon="sap-icon://decline"
                                    type="Transparent"
                                    press="onCancel"
                                    tooltip="Cancel"/>
                            </HBox>
                        </cells>
                    </ColumnListItem>
                </items>
            </Table>
            
            <!-- Calendar View (Placeholder) -->
            <VBox 
                visible="{= ${view>/viewMode} === 'calendar'}"
                alignItems="Center"
                justifyContent="Center"
                height="400px">
                <core:Icon 
                    src="sap-icon://calendar" 
                    size="4rem"
                    color="#666"/>
                <Title 
                    text="Calendar View" 
                    level="H3"
                    class="sapUiSmallMarginTop"/>
                <Text 
                    text="Calendar integration coming soon"
                    class="sapUiTinyMarginTop"/>
            </VBox>
            
        </content>
    </Page>
</mvc:View>
```

**Controller: `webapp/controller/ScheduledFollowups.controller.js`**

```javascript
sap.ui.define([
    "sap/ui/core/mvc/Controller",
    "sap/ui/model/json/JSONModel",
    "sap/m/MessageToast",
    "sap/m/MessageBox"
], function (Controller, JSONModel, MessageToast, MessageBox) {
    "use strict";

    return Controller.extend("com.sap.outreach.controller.ScheduledFollowups", {

        onInit: function () {
            // Initialize view model
            const oViewModel = new JSONModel({
                viewMode: "list"
            });
            this.getView().setModel(oViewModel, "view");
        },

        onViewModeChange: function (oEvent) {
            const sKey = oEvent.getParameter("item").getKey();
            this.getView().getModel("view").setProperty("/viewMode", sKey);
        },

        formatStatusState: function (status) {
            const statusMap = {
                "pending": "Warning",
                "completed": "Success",
                "cancelled": "Error",
                "failed": "Error",
                "rescheduled": "Information"
            };
            return statusMap[status] || "None";
        },

        onFollowUpSelect: function (oEvent) {
            const oItem = oEvent.getParameter("listItem");
            const oContext = oItem.getBindingContext();
            
            // Navigate to detail view or show details
            MessageToast.show("Follow-up selected: " + oContext.getProperty("ID"));
        },

        onScheduleNew: function () {
            // TODO: Open dialog to create new follow-up
            MessageToast.show("Schedule new follow-up dialog");
        },

        onReschedule: function (oEvent) {
            const oItem = oEvent.getSource().getParent().getParent();
            const oContext = oItem.getBindingContext();
            const sFollowUpId = oContext.getProperty("ID");
            
            // TODO: Open reschedule dialog
            MessageToast.show("Reschedule follow-up: " + sFollowUpId);
        },

        onCancel: function (oEvent) {
            const oItem = oEvent.getSource().getParent().getParent();
            const oContext = oItem.getBindingContext();
            const sFollowUpId = oContext.getProperty("ID");
            
            MessageBox.confirm("Are you sure you want to cancel this follow-up?", {
                onClose: (sAction) => {
                    if (sAction === MessageBox.Action.OK) {
                        this.cancelFollowUp(sFollowUpId);
                    }
                }
            });
        },

        cancelFollowUp: function (sFollowUpId) {
            const oModel = this.getView().getModel();
            
            oModel.callFunction("/cancelFollowUp", {
                method: "POST",
                urlParameters: {
                    followUpId: sFollowUpId
                },
                success: () => {
                    MessageToast.show("Follow-up cancelled");
                    oModel.refresh();
                },
                error: (oError) => {
                    MessageToast.show("Error cancelling follow-up");
                    console.error(oError);
                }
            });
        }
    });
});
```

---

## PART 5: INTEGRATION SETUP

### 5.1 Background Job for Follow-up Execution

Create `srv/jobs/followUpExecutor.js`:

```javascript
const cds = require('@sap/cds');
const cron = require('node-cron');

class FollowUpExecutor {
    constructor() {
        this.running = false;
    }

    start() {
        if (this.running) {
            console.log('Follow-up executor already running');
            return;
        }

        // Run every hour
        cron.schedule('0 * * * *', async () => {
            console.log('[FollowUpExecutor] Checking for scheduled follow-ups...');
            await this.processScheduledFollowUps();
        });

        // Daily summary at 8 AM
        cron.schedule('0 8 * * *', async () => {
            console.log('[FollowUpExecutor] Sending daily summary...');
            await this.sendDailySummary();
        });

        this.running = true;
        console.log('[FollowUpExecutor] Started successfully');
    }

    async processScheduledFollowUps() {
        try {
            const db = await cds.connect.to('db');
            const { ScheduledFollowups } = db.entities;

            const now = new Date();
            const currentDate = now.toISOString().split('T')[0];
            const currentHour = now.getHours();

            // Find follow-ups scheduled for this hour
            const followUps = await SELECT.from(ScheduledFollowups)
                .where({
                    scheduledDate: currentDate,
                    status: 'pending'
                });

            console.log(`Found ${followUps.length} follow-ups for today`);

            for (const followUp of followUps) {
                const scheduledHour = parseInt(followUp.scheduledTime.split(':')[0]);
                
                if (scheduledHour === currentHour) {
                    await this.executeFollowUp(followUp.ID);
                }
            }
        } catch (error) {
            console.error('[FollowUpExecutor] Error processing follow-ups:', error);
        }
    }

    async executeFollowUp(followUpId) {
        try {
            const OutreachService = await cds.connect.to('OutreachService');
            
            const result = await OutreachService.send({
                method: 'POST',
                path: '/executeFollowUp',
                data: { followUpId }
            });

            console.log(`Follow-up ${followUpId} executed:`, result.message);
        } catch (error) {
            console.error(`Error executing follow-up ${followUpId}:`, error);
        }
    }

    async sendDailySummary() {
        // TODO: Send email summary of today's follow-ups
        console.log('Daily summary sent');
    }
}

module.exports = new FollowUpExecutor();
```

### 5.2 Initialize Background Jobs in `srv/server.js`:

```javascript
const cds = require('@sap/cds');
const followUpExecutor = require('./jobs/followUpExecutor');

cds.on('served', () => {
    console.log('Services started');
    
    // Start background jobs
    followUpExecutor.start();
});

module.exports = cds.server;
```

---

## PART 6: ROUTING CONFIGURATION

Update `webapp/manifest.json` to add routes:

```json
{
    "sap.ui5": {
        "routing": {
            "routes": [
                {
                    "name": "main",
                    "pattern": "",
                    "target": "main"
                },
                {
                    "name": "dashboard",
                    "pattern": "dashboard",
                    "target": "dashboard"
                },
                {
                    "name": "callResults",
                    "pattern": "calls/{callId}",
                    "target": "callResults"
                },
                {
                    "name": "followups",
                    "pattern": "followups",
                    "target": "followups"
                }
            ],
            "targets": {
                "main": {
                    "viewName": "Main",
                    "viewLevel": 1
                },
                "dashboard": {
                    "viewName": "StatisticsDashboard",
                    "viewLevel": 1
                },
                "callResults": {
                    "viewName": "CallResults",
                    "viewLevel": 2
                },
                "followups": {
                    "viewName": "ScheduledFollowups",
                    "viewLevel": 1
                }
            }
        }
    }
}
```

---

## PART 7: INSTALLATION & SETUP

### Dependencies to Install:

```json
// package.json
{
    "dependencies": {
        "@sap/cds": "^7",
        "express": "^4",
        "openai": "^4.0.0",
        "twilio": "^4.0.0",
        "nodemailer": "^6.0.0",
        "node-cron": "^3.0.0",
        "ws": "^8.0.0"
    }
}
```

Install with:
```bash
npm install
```

### Environment Variables (.env):

```env
OPENAI_API_KEY=your_openai_api_key
TWILIO_ACCOUNT_SID=your_twilio_sid
TWILIO_AUTH_TOKEN=your_twilio_token
TWILIO_PHONE_NUMBER=+1234567890
EMAIL_USER=your_email@gmail.com
EMAIL_PASSWORD=your_app_password
BASE_URL=https://yourdomain.com
```

---

## SUMMARY OF DELIVERABLES

### Backend (CAP):
1. ✅ CDS data model with 5 new entities
2. ✅ Service definitions with 15+ functions/actions
3. ✅ Service implementation with statistics, call analysis, scheduling
4. ✅ Background job executor for follow-ups
5. ✅ OpenAI GPT-4 integration
6. ✅ Payment monitoring logic

### Frontend (UI5):
1. ✅ Statistics Dashboard view with charts
2. ✅ Call Results viewer with transcript display
3. ✅ Scheduled Follow-ups list/calendar view
4. ✅ Controllers with data binding
5. ✅ Routing configuration

### Features:
1. ✅ Auto-refresh statistics every 5 minutes
2. ✅ AI-powered call analysis
3. ✅ Smart scheduling based on payment promises
4. ✅ Payment status monitoring
5. ✅ Cron jobs for automated follow-ups
6. ✅ Sentiment analysis visualization

---

## TESTING CHECKLIST

- [ ] Deploy CDS model to database
- [ ] Test all service functions via API
- [ ] Verify statistics calculations
- [ ] Test call analysis with sample transcripts
- [ ] Verify follow-up scheduling logic
- [ ] Test payment monitoring
- [ ] Check UI5 views render correctly
- [ ] Verify charts display data
- [ ] Test navigation between views
- [ ] Verify background jobs execute on schedule

---

## BUILD & DEPLOY

```bash
# Build the project
npm run build

# Deploy to SAP BTP
cf push

# Or for local testing
npm start
```
