namespace my.collectiq;

using { managed } from '@sap/cds/common';

entity Payers : managed {
    key payerId          : String(20);
    payerName            : String(120);
    totalPastDue         : Decimal(15,2);
    maxDaysPastDue       : Integer;
    stage                : String(10); 
    lastOutreachStatus   : String(30) default 'NONE';
    lastOutreachAt       : Timestamp;
    latestOutreachDraft  : LargeString; 
    
    invoices             : Association to many Invoices on invoices.payerId = $self.payerId;
    outreachHistory      : Association to many OutreachHistory on outreachHistory.payerId = $self.payerId;
}

entity Invoices : managed {
    key invoiceId        : UUID;
    payerId              : String(20); 
    invoiceNumber        : String(20);
    invoiceAmount        : Decimal(15,2);
    dueDate              : Date;
    daysPastDue          : Integer;
    currency             : String(5);
}

entity OutreachHistory : managed {
    key outreachId       : UUID;
    payerId              : String(20);
    stageAtGeneration    : String(10);
    outreachType         : String(15); 
    bodyText             : LargeString;
    status               : String(20); 
}