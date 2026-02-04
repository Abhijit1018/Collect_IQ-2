namespace my.collectiq;

using { managed } from '@sap/cds/common';

entity Payers : managed {
    key PayerId            : String(20); // Changed from payerId
    PayerName              : String(120); // Changed from payerName
    TotalPastDue           : Double; // Changed from Decimal(15,2)
    MaxDaysPastDue         : Integer; // Changed from maxDaysPastDue
    Stage                  : String(15); // Changed from stage
    ContactEmail           : String(120); // Added from metadata
    ContactPhone           : String(256); // <--- Yeh field add kari thi
    Currency               : String(5); // Added from metadata
    LastOutreachStatus     : String(30) default 'NONE';
    lastOutreachAt         : Timestamp; 
    latestOutreachDraft    : LargeString; 
    criticality            : Integer; // Local field for UI colors
    
    Invoices               : Association to many Invoices on Invoices.PayerId = $self.PayerId;
    outreachHistory        : Composition of many OutreachHistory on outreachHistory.payer = $self;
    callTranscripts        : Composition of many CallTranscripts on callTranscripts.payer = $self;
    scheduledFollowups     : Composition of many ScheduledFollowups on scheduledFollowups.payer = $self;
}

entity Invoices : managed {
    key InvoiceId          : UUID;
    PayerId                : String(20);
    payer                  : Association to Payers on payer.PayerId = PayerId;
    InvoiceNumber          : String(20);
    InvoiceAmount          : Double;
    DueDate                : Date;
    DaysPastDue            : Integer;
    Currency               : String(5);
    status                 : String(20); // Added for status tracking
}

entity OutreachHistory : managed {
    key ID                 : UUID;
    payer                  : Association to Payers;
    PayerId                : String(20); // Maintain legacy field if needed, otherwise use association
    outreachType           : String(20) enum {
        email;
        call;
        sms;
    };
    outreachDate           : DateTime;
    status                 : String(20) enum {
        sent;
        delivered;
        failed;
        responded;
    };
    responseReceived       : Boolean default false;
    responseDate           : DateTime;
    notes                  : String(1000);
    bodyText               : LargeString; // Keep legacy field
    stageAtGeneration      : String(15); // Added to track stage history
}

entity CallTranscripts : managed {
    key ID                 : UUID;
    payer                  : Association to Payers;
    callId                 : String(100);
    callDate               : DateTime;
    duration               : Integer;
    transcriptAgent        : LargeString;
    transcriptPayer        : LargeString;
    fullTranscript         : LargeString;
    callConclusion         : String(1000);
    paymentPromiseDate     : Date;
    paymentPromiseConfirmed: Boolean default false;
    disputeRaised          : Boolean default false;
    sentimentScore         : Decimal(3, 2);
    keyPoints              : LargeString;
    recommendedAction      : String(500);
}

entity ScheduledFollowups : managed {
    key ID                 : UUID;
    payer                  : Association to Payers;
    // originalCall        : Association to CallTranscripts; // Optional linkage
    originalCallId         : String(100);
    scheduledDate          : Date;
    scheduledTime          : Time default '10:00:00';
    reason                 : String(500);
    status                 : String(20) enum {
        pending;
        completed;
        cancelled;
        failed;
        rescheduled;
    } default 'pending';
    executionDate          : DateTime;
    result                 : String(1000);
}

entity PaymentStatusLog : managed {
    key ID                 : UUID;
    payer                  : Association to Payers;
    statusCheckedDate      : DateTime;
    paymentReceived        : Boolean default false;
    amountPaid             : Decimal(10, 2);
}