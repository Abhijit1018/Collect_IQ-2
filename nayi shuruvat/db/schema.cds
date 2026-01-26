namespace my.collectiq;

using { managed } from '@sap/cds/common';

entity Payers : managed {
    key PayerId            : String(20);
    PayerName              : String(120);
    TotalPastDue           : Decimal(15,2);
    MaxDaysPastDue         : Integer;
    Stage                  : String(15);
    ContactEmail           : String(120);
    ContactPhone           : String(256);
    Currency               : String(5);
    LastOutreachStatus     : String(30) default 'NONE';
    lastOutreachAt         : Timestamp; 
    latestOutreachDraft    : LargeString; 
    criticality            : Integer;
    
    Invoices               : Association to many Invoices on Invoices.PayerId = $self.PayerId;
    outreachHistory        : Association to many OutreachHistory on outreachHistory.PayerId = $self.PayerId;
}

entity Invoices : managed {
    key InvoiceId          : UUID;
    PayerId                : String(20);
    InvoiceNumber          : String(20);
    InvoiceAmount          : Decimal(15,2);
    DueDate                : Date;
    DaysPastDue            : Integer;
    Currency               : String(5);
    
    Payer                  : Association to Payers on Payer.PayerId = PayerId;
}

entity OutreachHistory : managed {
    key outreachId         : UUID;
    PayerId                : String(20);
    stageAtGeneration      : String(15);
    outreachType           : String(15); 
    bodyText               : LargeString;
    status                 : String(20);
    
    Payer                  : Association to Payers on Payer.PayerId = PayerId;
}
