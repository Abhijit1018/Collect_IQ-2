using CollectIQService as service from '../../srv/service';

annotate service.Payers with @(
    // 1. Table Columns with Actions (Toolbar on 1st Page)
    UI.LineItem : [
        { $Type: 'UI.DataField', Value: payerId, Label: 'Payer ID' },
        { $Type: 'UI.DataField', Value: payerName, Label: 'Customer Name' },
        { $Type: 'UI.DataField', Value: totalPastDue, Label: 'Total Past Due' },
        {
            $Type: 'UI.DataField',
            Value: stage,
            Label: 'Risk Stage',
            Criticality: criticality
        },
        { $Type: 'UI.DataField', Value: lastOutreachStatus, Label: 'Outreach Status' },
        { $Type: 'UI.DataField', Value: lastOutreachAt, Label: 'Last Contacted' },
        // Sync Button
        {
            $Type : 'UI.DataFieldForAction',
            Action : 'CollectIQService.syncAR',
            Label : 'Sync AR Data',
            Inline : false
        },
        // ADDED: Generate AI Draft on 1st Page Toolbar
        {
            $Type : 'UI.DataFieldForAction',
            Action : 'CollectIQService.generateOutreach',
            Label : 'Generate AI Draft',
            Inline : false
        },
        // ADDED: Send Outreach on 1st Page Toolbar
        {
            $Type : 'UI.DataFieldForAction',
            Action : 'CollectIQService.sendOutreach',
            Label : 'Send Outreach',
            Inline : false
        }
    ],

    // 2. Object Page Header Summary
    UI.HeaderInfo : {
        TypeName : 'Payer Details',
        TypeNamePlural : 'Payer Information',
        Title : { Value: payerName },
        Description : { Value: payerId }
    },

    UI.HeaderFacets : [
        { $Type: 'UI.ReferenceFacet', Target: '@UI.FieldGroup#HeaderSummary' }
    ],

    UI.FieldGroup #HeaderSummary : {
        Data : [
            { $Type: 'UI.DataField', Value: totalPastDue, Label: 'Total Past Due' },
            { $Type: 'UI.DataField', Value: stage, Label: 'Risk Stage' },
            { $Type: 'UI.DataField', Value: lastOutreachStatus, Label: 'Current Status' }
        ]
    },

    // 3. Object Page Sections
    UI.Facets : [
        {
            $Type : 'UI.ReferenceFacet',
            Label : 'Invoice Breakdown',
            Target : 'invoices/@UI.LineItem',
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
        { $Type: 'UI.DataField', Value: invoiceNumber, Label: 'Invoice #' },
        { $Type: 'UI.DataField', Value: invoiceAmount, Label: 'Amount' },
        { $Type: 'UI.DataField', Value: currency, Label: 'Currency' },
        { $Type: 'UI.DataField', Value: dueDate, Label: 'Due Date' },
        { $Type: 'UI.DataField', Value: daysPastDue, Label: 'Days Past Due' }
    ]
);

// Actions wired to the Object Page (Buttons on 2nd Page)
annotate service.Payers with @(
    UI.Identification : [
        { $Type: 'UI.DataFieldForAction', Action: 'CollectIQService.generateOutreach', Label: 'Generate AI Draft' },
        { $Type: 'UI.DataFieldForAction', Action: 'CollectIQService.sendOutreach', Label: 'Send Outreach' }
    ]
);

// Refresh UI after Sync, Generation, or Sending
annotate service.generateOutreach with @( Common.SideEffects: { TargetEntities: [service.Payers] } );
annotate service.syncAR with @( Common.SideEffects: { TargetEntities: [service.Payers] } );
annotate service.sendOutreach with @( Common.SideEffects: { TargetEntities: [service.Payers] } );