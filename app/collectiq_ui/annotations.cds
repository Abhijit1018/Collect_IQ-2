using CollectIQService as service from '../../srv/service';

annotate service.Payers with @(
    UI.LineItem : [
        { $Type: 'UI.DataField', Value: PayerId, Label: 'Payer ID' },
        { $Type: 'UI.DataField', Value: PayerName, Label: 'Customer Name' },
        { $Type: 'UI.DataField', Value: TotalPastDue, Label: 'Total Past Due' },
        {
            $Type: 'UI.DataField',
            Value: Stage,
            Label: 'Risk Stage',
            Criticality: criticality
        },
        { $Type: 'UI.DataField', Value: LastOutreachStatus, Label: 'Outreach Status' },
        { $Type: 'UI.DataField', Value: lastOutreachAt, Label: 'Last Contacted' },
        { $Type : 'UI.DataFieldForAction', Action : 'CollectIQService.syncAR', Label : 'Sync AR Data' },
        { $Type : 'UI.DataFieldForAction', Action : 'CollectIQService.generateOutreach', Label : 'Generate AI Draft' },
        { $Type : 'UI.DataFieldForAction', Action : 'CollectIQService.sendOutreach', Label : 'Send Outreach' }
    ],

    UI.Facets : [
        {
            $Type : 'UI.ReferenceFacet',
            Label : 'Invoice Breakdown',
            Target : 'Invoices/@UI.LineItem',
        },
        {
            $Type : 'UI.ReferenceFacet',
            Label : 'AI Outreach Intelligence',
            Target : '@UI.FieldGroup#OutreachInfo',
        }
    ],

    UI.FieldGroup #OutreachInfo : {
        Data : [
            { $Type: 'UI.DataField', Value: latestOutreachDraft, Label: 'Latest AI Draft' }
        ]
    }
);

annotate service.Invoices with @(
    UI.LineItem : [
        { $Type: 'UI.DataField', Value: InvoiceNumber, Label: 'Invoice #' },
        { $Type: 'UI.DataField', Value: InvoiceAmount, Label: 'Amount' },
        { $Type: 'UI.DataField', Value: Currency, Label: 'Currency' },
        { $Type: 'UI.DataField', Value: DueDate, Label: 'Due Date' },
        { $Type: 'UI.DataField', Value: DaysPastDue, Label: 'Days Past Due' }
    ]
);
