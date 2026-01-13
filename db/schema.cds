namespace my.collectiq;

using { managed } from '@sap/cds/common';

entity Payers : managed {
    key PayerId            : String(20);
    PayerName              : String(120);
    TotalPastDue           : Decimal(15, 2);
    MaxDaysPastDue         : Integer;
    Stage                  : String(15);
    ContactEmail           : String(120);
    LastOutreachStatus     : String(30);
    Currency               : String(5);
    latestOutreachDraft    : String; // Local field for LLM drafts
    lastOutreachAt         : DateTime; // Local tracking
    criticality            : Integer;  // For UI coloring
    Invoices               : Association to many Invoices on Invoices.PayerId = $self.PayerId;
}

entity Invoices : managed {
    key InvoiceId          : UUID;
    PayerId                : String(20);
    InvoiceNumber          : String(20);
    InvoiceAmount          : Decimal(15, 2);
    DueDate                : Date;
    DaysPastDue            : Integer;
    Currency               : String(5);
    Payer                  : Association to Payers on Payer.PayerId = PayerId;
}