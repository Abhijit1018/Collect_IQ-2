using my.collectiq from '../db/schema';

service CollectiqService @(path: '/odata/v4/collectiq') {
    
    // Expose entities
    entity Payers as projection on collectiq.Payers {
        *,
        Invoices,
        outreachHistory
    };
    
    entity Invoices as projection on collectiq.Invoices;
    
    entity OutreachHistory as projection on collectiq.OutreachHistory;
    
    // Actions for bulk outreach operations
    action generateOutreachForAll() returns String;
    action sendOutreachToAll() returns String;
    
    // Actions for single payer operations
    action generateOutreach(PayerId: String) returns String;
    action sendOutreach(PayerId: String) returns String;
    
    // Sync AR data action
    action syncAR() returns String;
}
