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
    outreachHistory        : Association to many OutreachHistory on outreachHistory.PayerId = $self.PayerId;
}

entity Invoices : managed {
    key InvoiceId          : UUID; // Changed from invoiceId
    PayerId                : String(20); // Changed from payerId
    InvoiceNumber          : String(20); // Changed from invoiceNumber
    InvoiceAmount          : Double; // Changed from Decimal(15,2)
    DueDate                : Date;
    DaysPastDue            : Integer; // Changed from daysPastDue
    Currency               : String(5);
}

entity OutreachHistory : managed {
    key outreachId         : UUID;
    PayerId                : String(20); // Updated for consistency
    stageAtGeneration      : String(15);
    outreachType           : String(15); 
    bodyText               : LargeString;
    status                 : String(20); 
}