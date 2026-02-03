using { my.collectiq as my } from '../db/schema';
// 1. Reference the new V4 service correctly
using { ZUI_COLLECTIQ_V4 as external } from './external/ZUI_COLLECTIQ_V4';

service CollectIQService {
    @readonly
    // 2. Changed from external.Invoices (plural) to external.Invoice (singular) 
    // to match your V4 metadata EntitySet name
    entity InvoicesS4 as projection on external.Invoice;

    entity Payers as projection on my.Payers actions {
        action generateOutreach() returns LargeString;
        action sendOutreach()     returns String;
    };

    entity Invoices as projection on my.Invoices;
    entity OutreachHistory as projection on my.OutreachHistory;
    entity CallTranscripts as projection on my.CallTranscripts;
    entity ScheduledFollowups as projection on my.ScheduledFollowups;
    entity PaymentStatusLog as projection on my.PaymentStatusLog;

    action syncAR() returns String;

    // Statistics Actions
    @readonly
    function getOverviewStats() returns {
        totalPayers           : Integer;
        totalOutstanding      : Decimal(12, 2);
        callsToday            : Integer;
        emailsToday           : Integer;
        smsToday              : Integer;
        successRate           : Decimal(5, 2);
    };

    @readonly
    function getOutreachTimeline(days : Integer) returns array of {
        date         : Date;
        outreachType : String;
        count        : Integer;
    };

    @readonly
    function getPaymentDistribution() returns array of {
        status      : String;
        count       : Integer;
        totalAmount : Decimal(12, 2);
    };

    @readonly
    function getAgingAnalysis() returns array of {
        ageBucket   : String;
        invoiceCount: Integer;
        totalAmount : Decimal(12, 2);
    };

    // Call Analysis Actions
    @readonly
    function getCallDetails(callId : String) returns LargeString; // Returning JSON string to avoid Entity-Type mapping issues

    action analyzeCallTranscript(
        callId     : String,
        transcript : String
    ) returns {
        paymentPromiseDate     : Date;
        paymentPromiseConfirmed: Boolean;
        disputeRaised          : Boolean;
        sentimentScore         : Decimal(3, 2);
        conclusionSummary      : String;
        keyPoints              : String; // JSON array
        recommendedAction      : String;
    };

    // Scheduling Actions
    action scheduleFollowUp(
        payerId       : String,
        originalCallId: String,
        scheduledDate : Date,
        reason        : String
    ) returns ScheduledFollowups;

    action cancelFollowUp(followUpId : String) returns Boolean;

    action rescheduleFollowUp(
        followUpId : String,
        newDate    : Date,
        newTime    : Time
    ) returns ScheduledFollowups;

    @readonly
    function getUpcomingFollowUps() returns array of ScheduledFollowups;

    action executeFollowUp(followUpId : String) returns {
        success: Boolean;
        message: String;
        callId : String;
    };

    action checkPaymentStatus(payerId : String) returns LargeString; // Returning JSON string for complex structure
}