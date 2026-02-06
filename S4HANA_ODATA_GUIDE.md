# S/4HANA On-Premise OData Service Creation Guide
## Complete Step-by-Step Guide for CollectIQ Integration

---

## 📋 Overview

This guide explains how to create an **OData V4 Service** in SAP S/4HANA On-Premise using the **ABAP RESTful Application Programming Model (RAP)**. The service will expose Invoice, Payer, and Outreach History data for the CollectIQ application.

---

## 🏗️ Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                     S/4HANA On-Premise                          │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  ┌──────────────────┐    ┌──────────────────┐                  │
│  │  Database Tables │    │  Standard Tables │                  │
│  │  ZCOLLECTIQ_*    │    │  BKPF, BSID, etc │                  │
│  └────────┬─────────┘    └────────┬─────────┘                  │
│           │                       │                             │
│           └───────────┬───────────┘                             │
│                       ▼                                         │
│           ┌───────────────────────┐                             │
│           │   CDS Interface Views │                             │
│           │   ZI_COLLECTIQ_*      │                             │
│           └───────────┬───────────┘                             │
│                       ▼                                         │
│           ┌───────────────────────┐                             │
│           │  CDS Consumption Views│                             │
│           │  ZC_COLLECTIQ_*       │                             │
│           └───────────┬───────────┘                             │
│                       ▼                                         │
│           ┌───────────────────────┐                             │
│           │   Service Definition  │                             │
│           │  ZUI_COLLECTIQ_V4     │                             │
│           └───────────┬───────────┘                             │
│                       ▼                                         │
│           ┌───────────────────────┐                             │
│           │    Service Binding    │                             │
│           │  ZUI_COLLECTIQ_V4_O4  │                             │
│           └───────────────────────┘                             │
│                       │                                         │
└───────────────────────┼─────────────────────────────────────────┘
                        ▼
              OData V4 Endpoint
    /sap/opu/odata4/sap/zui_collectiq_v4/srvd/sap/zui_collectiq_v4/0001
```

---

## 📊 Required Database Tables

### Step 1: Create Custom Tables in SE11

#### Table 1: ZCOLLECTIQ_PAYER (Payers/Customers)

Go to **Transaction SE11** → Create Table

```abap
Table: ZCOLLECTIQ_PAYER
Description: CollectIQ Payer Master Data

Fields:
┌──────────────────┬──────────────┬────────┬─────────────────────────────────┐
│ Field Name       │ Data Element │ Length │ Description                     │
├──────────────────┼──────────────┼────────┼─────────────────────────────────┤
│ MANDT            │ MANDT        │ 3      │ Client (Key)                    │
│ PAYER_ID         │ CHAR20       │ 20     │ Payer ID (Key)                  │
│ PAYER_NAME       │ CHAR120      │ 120    │ Payer/Customer Name             │
│ TOTAL_PAST_DUE   │ WRBTR        │ 15,2   │ Total Past Due Amount           │
│ MAX_DAYS_PAST    │ INT4         │ 10     │ Maximum Days Past Due           │
│ STAGE            │ CHAR15       │ 15     │ Collection Stage                │
│ CONTACT_EMAIL    │ AD_SMTPADR   │ 241    │ Contact Email Address           │
│ CONTACT_PHONE    │ TELNR_LONG   │ 30     │ Contact Phone Number            │
│ CURRENCY         │ WAERS        │ 5      │ Currency Code                   │
│ LAST_OUTREACH_ST │ CHAR30       │ 30     │ Last Outreach Status            │
│ LAST_OUTREACH_AT │ TIMESTAMPL   │ 21,7   │ Last Outreach Timestamp         │
│ OUTREACH_DRAFT   │ STRING       │ -      │ Latest AI Generated Draft       │
│ CRITICALITY      │ INT4         │ 10     │ UI Criticality (1=High,2,3=Low) │
│ CREATED_BY       │ SYUNAME      │ 12     │ Created By User                 │
│ CREATED_AT       │ TIMESTAMPL   │ 21,7   │ Created Timestamp               │
│ CHANGED_BY       │ SYUNAME      │ 12     │ Changed By User                 │
│ CHANGED_AT       │ TIMESTAMPL   │ 21,7   │ Changed Timestamp               │
└──────────────────┴──────────────┴────────┴─────────────────────────────────┘

Technical Settings:
- Data Class: APPL1
- Size Category: 2
- Delivery Class: A
```

#### Table 2: ZCOLLECTIQ_INV (Invoices)

```abap
Table: ZCOLLECTIQ_INV
Description: CollectIQ Invoice Data

Fields:
┌──────────────────┬──────────────┬────────┬─────────────────────────────────┐
│ Field Name       │ Data Element │ Length │ Description                     │
├──────────────────┼──────────────┼────────┼─────────────────────────────────┤
│ MANDT            │ MANDT        │ 3      │ Client (Key)                    │
│ INVOICE_ID       │ SYSUUID_X16  │ 16     │ Invoice UUID (Key)              │
│ PAYER_ID         │ CHAR20       │ 20     │ Payer ID (Foreign Key)          │
│ INVOICE_NUMBER   │ CHAR20       │ 20     │ Invoice Number                  │
│ INVOICE_AMOUNT   │ WRBTR        │ 15,2   │ Invoice Amount                  │
│ DUE_DATE         │ DATS         │ 8      │ Due Date                        │
│ DAYS_PAST_DUE    │ INT4         │ 10     │ Days Past Due                   │
│ CURRENCY         │ WAERS        │ 5      │ Currency Code                   │
│ STATUS           │ CHAR20       │ 20     │ Invoice Status                  │
│ CREATED_BY       │ SYUNAME      │ 12     │ Created By User                 │
│ CREATED_AT       │ TIMESTAMPL   │ 21,7   │ Created Timestamp               │
│ CHANGED_BY       │ SYUNAME      │ 12     │ Changed By User                 │
│ CHANGED_AT       │ TIMESTAMPL   │ 21,7   │ Changed Timestamp               │
└──────────────────┴──────────────┴────────┴─────────────────────────────────┘
```

#### Table 3: ZCOLLECTIQ_OUTRCH (Outreach History)

```abap
Table: ZCOLLECTIQ_OUTRCH
Description: CollectIQ Outreach History

Fields:
┌──────────────────┬──────────────┬────────┬─────────────────────────────────┐
│ Field Name       │ Data Element │ Length │ Description                     │
├──────────────────┼──────────────┼────────┼─────────────────────────────────┤
│ MANDT            │ MANDT        │ 3      │ Client (Key)                    │
│ OUTREACH_ID      │ SYSUUID_X16  │ 16     │ Outreach UUID (Key)             │
│ PAYER_ID         │ CHAR20       │ 20     │ Payer ID (Foreign Key)          │
│ STAGE_AT_GEN     │ CHAR15       │ 15     │ Stage at Generation             │
│ OUTREACH_TYPE    │ CHAR15       │ 15     │ Type (EMAIL/CALL/SMS)           │
│ BODY_TEXT        │ STRING       │ -      │ Outreach Body Text              │
│ STATUS           │ CHAR20       │ 20     │ Status (SENT/DELIVERED/FAILED)  │
│ CREATED_AT       │ TIMESTAMPL   │ 21,7   │ Created Timestamp               │
│ CREATED_BY       │ SYUNAME      │ 12     │ Created By User                 │
└──────────────────┴──────────────┴────────┴─────────────────────────────────┘
```

---

## 📝 Step 2: Create Data Elements (SE11)

If standard data elements don't exist, create custom ones:

```abap
Data Element: ZCOLLECTIQ_PAYER_ID
- Domain: CHAR20
- Short Description: Payer ID
- Field Labels: Payer ID

Data Element: ZCOLLECTIQ_STAGE  
- Domain: CHAR15
- Short Description: Collection Stage
- Fixed Values:
  - STAGE_1 = Early Stage
  - STAGE_2 = Mid Stage  
  - STAGE_3 = Late Stage

Data Element: ZCOLLECTIQ_OUTREACH_TYPE
- Domain: CHAR15
- Short Description: Outreach Type
- Fixed Values:
  - EMAIL = Email
  - CALL = Phone Call
  - SMS = Text Message

Data Element: ZCOLLECTIQ_STATUS
- Domain: CHAR20
- Short Description: Outreach Status
- Fixed Values:
  - NONE = Not Contacted
  - SENT = Sent
  - DELIVERED = Delivered
  - FAILED = Failed
  - RESPONDED = Responded
```

---

## 🔷 Step 3: Create CDS Interface Views (Eclipse ADT)

Open **Eclipse ADT** → Right-click on package → New → Other ABAP Repository Object → Core Data Services → Data Definition

### View 1: ZI_COLLECTIQ_PAYER (Interface View for Payer)

```abap
@AbapCatalog.viewEnhancementCategory: [#NONE]
@AccessControl.authorizationCheck: #NOT_REQUIRED
@EndUserText.label: 'Payer Interface View'
@Metadata.ignorePropagatedAnnotations: true
@ObjectModel.usageType:{
    serviceQuality: #X,
    sizeCategory: #S,
    dataClass: #MIXED
}
define view entity ZI_COLLECTIQ_PAYER
  as select from zcollectiq_payer
  composition [0..*] of ZI_COLLECTIQ_INV      as _Invoices
  composition [0..*] of ZI_COLLECTIQ_OUTRCH   as _OutreachHistory
{
  key payer_id                as PayerId,
      payer_name              as PayerName,
      @Semantics.amount.currencyCode: 'Currency'
      total_past_due          as TotalPastDue,
      max_days_past           as MaxDaysPastDue,
      stage                   as Stage,
      contact_email           as ContactEmail,
      contact_phone           as ContactPhone,
      @Semantics.currencyCode: true
      currency                as Currency,
      last_outreach_st        as LastOutreachStatus,
      @Semantics.systemDateTime.lastChangedAt: true
      last_outreach_at        as LastOutreachAt,
      outreach_draft          as LatestOutreachDraft,
      criticality             as Criticality,
      
      @Semantics.user.createdBy: true
      created_by              as CreatedBy,
      @Semantics.systemDateTime.createdAt: true
      created_at              as CreatedAt,
      @Semantics.user.lastChangedBy: true
      changed_by              as ChangedBy,
      @Semantics.systemDateTime.lastChangedAt: true
      changed_at              as ChangedAt,
      
      /* Associations */
      _Invoices,
      _OutreachHistory
}
```

### View 2: ZI_COLLECTIQ_INV (Interface View for Invoices)

```abap
@AbapCatalog.viewEnhancementCategory: [#NONE]
@AccessControl.authorizationCheck: #NOT_REQUIRED
@EndUserText.label: 'Invoice Interface View'
@Metadata.ignorePropagatedAnnotations: true
@ObjectModel.usageType:{
    serviceQuality: #X,
    sizeCategory: #S,
    dataClass: #MIXED
}
define view entity ZI_COLLECTIQ_INV
  as select from zcollectiq_inv
  association to parent ZI_COLLECTIQ_PAYER as _Payer 
    on $projection.PayerId = _Payer.PayerId
{
  key invoice_id              as InvoiceId,
      payer_id                as PayerId,
      invoice_number          as InvoiceNumber,
      @Semantics.amount.currencyCode: 'Currency'
      invoice_amount          as InvoiceAmount,
      due_date                as DueDate,
      days_past_due           as DaysPastDue,
      @Semantics.currencyCode: true
      currency                as Currency,
      status                  as Status,
      
      @Semantics.user.createdBy: true
      created_by              as CreatedBy,
      @Semantics.systemDateTime.createdAt: true
      created_at              as CreatedAt,
      @Semantics.user.lastChangedBy: true
      changed_by              as ChangedBy,
      @Semantics.systemDateTime.lastChangedAt: true
      changed_at              as ChangedAt,
      
      /* Associations */
      _Payer
}
```

### View 3: ZI_COLLECTIQ_OUTRCH (Interface View for Outreach History)

```abap
@AbapCatalog.viewEnhancementCategory: [#NONE]
@AccessControl.authorizationCheck: #NOT_REQUIRED
@EndUserText.label: 'Outreach History Interface View'
@Metadata.ignorePropagatedAnnotations: true
@ObjectModel.usageType:{
    serviceQuality: #X,
    sizeCategory: #S,
    dataClass: #MIXED
}
define view entity ZI_COLLECTIQ_OUTRCH
  as select from zcollectiq_outrch
  association to parent ZI_COLLECTIQ_PAYER as _Payer 
    on $projection.PayerId = _Payer.PayerId
{
  key outreach_id             as OutreachId,
      payer_id                as PayerId,
      stage_at_gen            as StageAtGeneration,
      outreach_type           as OutreachType,
      body_text               as BodyText,
      status                  as Status,
      
      @Semantics.systemDateTime.createdAt: true
      created_at              as CreatedAt,
      @Semantics.user.createdBy: true
      created_by              as CreatedBy,
      
      /* Associations */
      _Payer
}
```

---

## 🎨 Step 4: Create CDS Consumption Views (with UI Annotations)

### View 1: ZC_COLLECTIQ_PAYER (Consumption View for Payer)

```abap
@AbapCatalog.viewEnhancementCategory: [#NONE]
@AccessControl.authorizationCheck: #NOT_REQUIRED
@EndUserText.label: 'Payer Consumption View'
@Metadata.allowExtensions: true

@UI: {
  headerInfo: {
    typeName: 'Payer',
    typeNamePlural: 'Payers',
    title: { type: #STANDARD, value: 'PayerName' },
    description: { type: #STANDARD, value: 'PayerId' }
  }
}

@Search.searchable: true

define view entity ZC_COLLECTIQ_PAYER
  as projection on ZI_COLLECTIQ_PAYER
{
      @UI.facet: [
        { id: 'GeneralInfo', purpose: #STANDARD, type: #IDENTIFICATION_REFERENCE, label: 'General Information', position: 10 },
        { id: 'Invoices', purpose: #STANDARD, type: #LINEITEM_REFERENCE, label: 'Invoices', position: 20, targetElement: '_Invoices' },
        { id: 'OutreachHistory', purpose: #STANDARD, type: #LINEITEM_REFERENCE, label: 'Outreach History', position: 30, targetElement: '_OutreachHistory' }
      ]
      
      @UI: { lineItem: [{ position: 10, importance: #HIGH }],
             identification: [{ position: 10 }],
             selectionField: [{ position: 10 }] }
      @Search.defaultSearchElement: true
  key PayerId,
  
      @UI: { lineItem: [{ position: 20, importance: #HIGH }],
             identification: [{ position: 20 }] }
      @Search.defaultSearchElement: true
      PayerName,
      
      @UI: { lineItem: [{ position: 30, importance: #HIGH }],
             identification: [{ position: 30 }] }
      TotalPastDue,
      
      @UI: { lineItem: [{ position: 40, importance: #MEDIUM }],
             identification: [{ position: 40 }] }
      MaxDaysPastDue,
      
      @UI: { lineItem: [{ position: 50, importance: #HIGH, criticality: 'Criticality' }],
             identification: [{ position: 50 }],
             selectionField: [{ position: 20 }] }
      Stage,
      
      @UI: { identification: [{ position: 60 }] }
      ContactEmail,
      
      @UI: { identification: [{ position: 70 }] }
      ContactPhone,
      
      Currency,
      
      @UI: { lineItem: [{ position: 60, importance: #MEDIUM }],
             identification: [{ position: 80 }] }
      LastOutreachStatus,
      
      @UI: { lineItem: [{ position: 70, importance: #LOW }],
             identification: [{ position: 90 }] }
      LastOutreachAt,
      
      @UI: { identification: [{ position: 100 }] }
      LatestOutreachDraft,
      
      @UI.hidden: true
      Criticality,
      
      /* Administrative Fields */
      @UI.hidden: true
      CreatedBy,
      @UI.hidden: true
      CreatedAt,
      @UI.hidden: true
      ChangedBy,
      @UI.hidden: true
      ChangedAt,
      
      /* Associations */
      _Invoices : redirected to composition child ZC_COLLECTIQ_INV,
      _OutreachHistory : redirected to composition child ZC_COLLECTIQ_OUTRCH
}
```

### View 2: ZC_COLLECTIQ_INV (Consumption View for Invoices)

```abap
@AbapCatalog.viewEnhancementCategory: [#NONE]
@AccessControl.authorizationCheck: #NOT_REQUIRED
@EndUserText.label: 'Invoice Consumption View'
@Metadata.allowExtensions: true

@UI: {
  headerInfo: {
    typeName: 'Invoice',
    typeNamePlural: 'Invoices',
    title: { type: #STANDARD, value: 'InvoiceNumber' },
    description: { type: #STANDARD, value: 'InvoiceId' }
  }
}

define view entity ZC_COLLECTIQ_INV
  as projection on ZI_COLLECTIQ_INV
{
      @UI: { lineItem: [{ position: 10, importance: #HIGH }],
             identification: [{ position: 10 }] }
  key InvoiceId,
  
      @UI.hidden: true
      PayerId,
      
      @UI: { lineItem: [{ position: 20, importance: #HIGH }],
             identification: [{ position: 20 }] }
      InvoiceNumber,
      
      @UI: { lineItem: [{ position: 30, importance: #HIGH }],
             identification: [{ position: 30 }] }
      InvoiceAmount,
      
      @UI: { lineItem: [{ position: 40, importance: #HIGH }],
             identification: [{ position: 40 }] }
      DueDate,
      
      @UI: { lineItem: [{ position: 50, importance: #MEDIUM }],
             identification: [{ position: 50 }] }
      DaysPastDue,
      
      Currency,
      
      @UI: { lineItem: [{ position: 60, importance: #MEDIUM }],
             identification: [{ position: 60 }] }
      Status,
      
      /* Administrative Fields */
      @UI.hidden: true
      CreatedBy,
      @UI.hidden: true
      CreatedAt,
      @UI.hidden: true
      ChangedBy,
      @UI.hidden: true
      ChangedAt,
      
      /* Association */
      _Payer : redirected to parent ZC_COLLECTIQ_PAYER
}
```

### View 3: ZC_COLLECTIQ_OUTRCH (Consumption View for Outreach History)

```abap
@AbapCatalog.viewEnhancementCategory: [#NONE]
@AccessControl.authorizationCheck: #NOT_REQUIRED
@EndUserText.label: 'Outreach History Consumption View'
@Metadata.allowExtensions: true

@UI: {
  headerInfo: {
    typeName: 'Outreach Record',
    typeNamePlural: 'Outreach History',
    title: { type: #STANDARD, value: 'OutreachType' },
    description: { type: #STANDARD, value: 'OutreachId' }
  }
}

define view entity ZC_COLLECTIQ_OUTRCH
  as projection on ZI_COLLECTIQ_OUTRCH
{
      @UI: { lineItem: [{ position: 10, importance: #HIGH }],
             identification: [{ position: 10 }] }
  key OutreachId,
  
      @UI.hidden: true
      PayerId,
      
      @UI: { lineItem: [{ position: 20, importance: #MEDIUM }],
             identification: [{ position: 20 }] }
      StageAtGeneration,
      
      @UI: { lineItem: [{ position: 30, importance: #HIGH }],
             identification: [{ position: 30 }] }
      OutreachType,
      
      @UI: { identification: [{ position: 40 }] }
      BodyText,
      
      @UI: { lineItem: [{ position: 40, importance: #HIGH }],
             identification: [{ position: 50 }] }
      Status,
      
      @UI: { lineItem: [{ position: 50, importance: #MEDIUM }],
             identification: [{ position: 60 }] }
      CreatedAt,
      
      @UI.hidden: true
      CreatedBy,
      
      /* Association */
      _Payer : redirected to parent ZC_COLLECTIQ_PAYER
}
```

---

## 🔌 Step 5: Create Service Definition

In **Eclipse ADT** → Right-click on package → New → Other ABAP Repository Object → Business Services → Service Definition

```abap
@EndUserText.label: 'CollectIQ OData V4 Service'
define service ZUI_COLLECTIQ_V4 {
  expose ZC_COLLECTIQ_PAYER   as Payer;
  expose ZC_COLLECTIQ_INV     as Invoice;
  expose ZC_COLLECTIQ_OUTRCH  as OutreachHistory;
}
```

---

## 🔗 Step 6: Create Service Binding

In **Eclipse ADT** → Right-click on Service Definition → New Service Binding

```
Name: ZUI_COLLECTIQ_V4_O4
Description: CollectIQ OData V4 Binding
Binding Type: OData V4 - UI
Service Definition: ZUI_COLLECTIQ_V4
```

After creation:
1. Click **Activate**
2. Click **Publish**
3. Click **Preview** to test in browser

---

## 🧪 Step 7: Test the Service

### Get Service URL

After publishing, the service URL will be:
```
https://<your-s4hana-host>/sap/opu/odata4/sap/zui_collectiq_v4/srvd/sap/zui_collectiq_v4/0001
```

### Test Endpoints

```bash
# Get metadata
GET /sap/opu/odata4/sap/zui_collectiq_v4/srvd/sap/zui_collectiq_v4/0001/$metadata

# Get all payers
GET /sap/opu/odata4/sap/zui_collectiq_v4/srvd/sap/zui_collectiq_v4/0001/Payer

# Get payer with invoices (expand)
GET /sap/opu/odata4/sap/zui_collectiq_v4/srvd/sap/zui_collectiq_v4/0001/Payer?$expand=_Invoices

# Get single payer by ID
GET /sap/opu/odata4/sap/zui_collectiq_v4/srvd/sap/zui_collectiq_v4/0001/Payer('1001')

# Filter by stage
GET /sap/opu/odata4/sap/zui_collectiq_v4/srvd/sap/zui_collectiq_v4/0001/Payer?$filter=Stage eq 'STAGE_3'
```

---

## 📦 Step 8: Configure ICF Service (Transaction SICF)

1. Go to **Transaction SICF**
2. Navigate to: `/sap/opu/odata4/sap/zui_collectiq_v4/`
3. Right-click → **Activate Service**
4. Ensure the service is active (green light)

---

## 🔐 Step 9: Authorization (Optional but Recommended)

### Create Authorization Object

In **Transaction SU21**:

```abap
Authorization Object: Z_COLLECTIQ
Description: CollectIQ Authorization

Fields:
- ACTVT (Activity): 01=Create, 02=Change, 03=Display
- ZPAYER_ID (Payer ID Range)
```

### Add Access Control to CDS Views

Create DCL file for `ZI_COLLECTIQ_PAYER`:

```abap
@EndUserText.label: 'Access Control for Payer'
@MappingRole: true
define role ZI_COLLECTIQ_PAYER_AC {
  grant select on ZI_COLLECTIQ_PAYER
  where ( PayerId ) = aspect pfcg_auth( Z_COLLECTIQ, ZPAYER_ID );
}
```

---

## 🔄 Step 10: Load Sample Data

Create a report to load test data:

```abap
REPORT zcollectiq_load_data.

DATA: lt_payer TYPE TABLE OF zcollectiq_payer,
      lt_inv   TYPE TABLE OF zcollectiq_inv.

* Sample Payer Data
APPEND VALUE #(
  mandt           = sy-mandt
  payer_id        = '1001'
  payer_name      = 'Reliance Industries'
  total_past_due  = 50000
  max_days_past   = 45
  stage           = 'STAGE_2'
  contact_email   = 'finance@reliance.com'
  contact_phone   = '+911234567890'
  currency        = 'INR'
  last_outreach_st = 'NONE'
  criticality     = 2
  created_by      = sy-uname
  created_at      = utclong_current( )
) TO lt_payer.

APPEND VALUE #(
  mandt           = sy-mandt
  payer_id        = '1002'
  payer_name      = 'Tata Steel'
  total_past_due  = 120000
  max_days_past   = 90
  stage           = 'STAGE_3'
  contact_email   = 'accounts@tatasteel.com'
  contact_phone   = '+919876543210'
  currency        = 'INR'
  last_outreach_st = 'NONE'
  criticality     = 1
  created_by      = sy-uname
  created_at      = utclong_current( )
) TO lt_payer.

* Insert Payers
INSERT zcollectiq_payer FROM TABLE lt_payer.

* Sample Invoice Data
APPEND VALUE #(
  mandt          = sy-mandt
  invoice_id     = cl_system_uuid=>create_uuid_x16_static( )
  payer_id       = '1001'
  invoice_number = 'INV-2024-001'
  invoice_amount = 25000
  due_date       = sy-datum - 45
  days_past_due  = 45
  currency       = 'INR'
  status         = 'OVERDUE'
  created_by     = sy-uname
  created_at     = utclong_current( )
) TO lt_inv.

APPEND VALUE #(
  mandt          = sy-mandt
  invoice_id     = cl_system_uuid=>create_uuid_x16_static( )
  payer_id       = '1001'
  invoice_number = 'INV-2024-002'
  invoice_amount = 25000
  due_date       = sy-datum - 30
  days_past_due  = 30
  currency       = 'INR'
  status         = 'OVERDUE'
  created_by     = sy-uname
  created_at     = utclong_current( )
) TO lt_inv.

* Insert Invoices
INSERT zcollectiq_inv FROM TABLE lt_inv.

COMMIT WORK.
WRITE: / 'Data loaded successfully!'.
```

---

## 🌐 Step 11: Configure Destination in BTP

After the S/4HANA service is ready, configure it in SAP BTP:

1. Go to **SAP BTP Cockpit** → Subaccount → Connectivity → Destinations
2. Create new destination:

| Property | Value |
|----------|-------|
| Name | `ZUI_COLLECTIQ_04` |
| Type | HTTP |
| URL | `https://<s4hana-host>/sap/opu/odata4/sap/zui_collectiq_v4/srvd/sap/zui_collectiq_v4/0001` |
| Proxy Type | OnPremise (if using Cloud Connector) OR Internet |
| Authentication | BasicAuthentication OR OAuth2SAMLBearerAssertion |
| User | Your S/4HANA user |
| Password | Your password |

### Additional Properties:
```
sap-client = <your client number, e.g., 100>
HTML5.DynamicDestination = true
WebIDEEnabled = true
WebIDEUsage = odata_gen,odata_abap
```

---

## ✅ Summary Checklist

| Step | Description | Transaction/Tool | Status |
|------|-------------|------------------|--------|
| 1 | Create Database Tables | SE11 | ☐ |
| 2 | Create Data Elements | SE11 | ☐ |
| 3 | Create Interface CDS Views | Eclipse ADT | ☐ |
| 4 | Create Consumption CDS Views | Eclipse ADT | ☐ |
| 5 | Create Service Definition | Eclipse ADT | ☐ |
| 6 | Create Service Binding (OData V4) | Eclipse ADT | ☐ |
| 7 | Activate & Publish Service | Eclipse ADT | ☐ |
| 8 | Activate ICF Service | SICF | ☐ |
| 9 | Configure Authorization (Optional) | SU21/DCL | ☐ |
| 10 | Load Sample Data | SE38 | ☐ |
| 11 | Configure BTP Destination | BTP Cockpit | ☐ |
| 12 | Test with CAP Application | Browser/Postman | ☐ |

---

## 🔧 Troubleshooting

### Issue: Service not found (404)
```
Solution: Check SICF activation and service binding publish status
```

### Issue: Authorization error (403)
```
Solution: 
1. Check user has S_SERVICE authorization
2. Check Access Control (DCL) configuration
3. Add user to proper role
```

### Issue: CORS error
```
Solution: Configure ICM parameters in RZ10 or use Cloud Connector
```

### Issue: Metadata not loading
```
Solution: 
1. Activate all CDS views
2. Regenerate service binding
3. Clear browser cache
```

---

## 📚 Additional Resources

- [ABAP RESTful Application Programming Model](https://help.sap.com/docs/ABAP_PLATFORM_NEW/fc4c71aa50014fd1b43721701471913d/289477a81eec4d4e84c0302fb6835035.html)
- [CDS View Documentation](https://help.sap.com/doc/abapdocu_latest_index_htm/latest/en-US/index.htm?file=abencds.htm)
- [OData V4 in SAP](https://help.sap.com/docs/SAP_S4HANA_CLOUD/0f69f8fb28ac4bf48d2b57b9637e81fa/5de4d1c5c4e54e66a2b7f6f08c5f3e3c.html)
