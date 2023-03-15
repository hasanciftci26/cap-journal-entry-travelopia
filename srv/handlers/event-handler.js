const cds = require("@sap/cds"),
    SOAPClient = require("./soap-client");

class JournalEventHandler {
    async updateJournalEntry(message) {
        const db = await cds.connect.to("db"),
            { JournalEntries } = db.entities;
        let aGLAccountLineItems = [],
            oGLAccountLineItem = {},
            oReferenceFields = {},
            oLogMessage = {
                message: "Successfully updated!",
                isUpdatedSuccessfully: true
            };

        try {
            aGLAccountLineItems = await this.#getGLAccountLineItem(message);
            oGLAccountLineItem = aGLAccountLineItems[0];
            oReferenceFields = await this.#getReferenceFields(oGLAccountLineItem);
            await this.#runJournalEntryUpdate(aGLAccountLineItems, oReferenceFields, message);
        } catch (error) {
            oLogMessage.message = error.message;
            oLogMessage.isUpdatedSuccessfully = false;
        }

        await db.run(UPDATE(JournalEntries, {
            ID: message.ID
        }).with(oLogMessage));
    }

    async #getGLAccountLineItem(message) {
        const oGLAccountAPI = await cds.connect.to("API_GLACCOUNTLINEITEM"),
            { GLAccountLineItem } = oGLAccountAPI.entities;
        let aGLAccountLineItems = [];

        try {
            aGLAccountLineItems = await oGLAccountAPI.run(SELECT.from(GLAccountLineItem).where({
                AccountingDocument: message.accountingDocument,
                CompanyCode: message.companyCode,
                FiscalYear: message.fiscalYear
            }));
        } catch (error) {
            throw error;
        }

        return aGLAccountLineItems;
    }

    async #getReferenceFields(oGLAccountLineItem) {
        const oBillingDocumentAPI = await cds.connect.to("API_BILLING_DOCUMENT_SRV"),
            oSupplierInvoiceAPI = await cds.connect.to("API_SUPPLIERINVOICE_PROCESS_SRV"),
            { A_BillingDocument } = oBillingDocumentAPI.entities,
            { A_SupplierInvoice } = oSupplierInvoiceAPI.entities;
        let oReferenceFields = {};

        switch (oGLAccountLineItem.AccountingDocumentType) {
            case "RE":
                try {
                    let oSupplierInvoice = await oSupplierInvoiceAPI.run(SELECT.from(A_SupplierInvoice, {
                        SupplierInvoice: oGLAccountLineItem.ReferenceDocument,
                        FiscalYear: oGLAccountLineItem.FiscalYear
                    }));

                    oReferenceFields = {
                        XREF2: oSupplierInvoice.YY1_SIHTravelBookRef_MIH,
                        XREF3: oSupplierInvoice.YY1_SIHTravelDepDate_MIH
                    };
                } catch (error) {
                    throw error;
                }

                break;
            case "RV":
                try {
                    let oBillingDocument = await oBillingDocumentAPI.run(SELECT.from(A_BillingDocument, {
                        BillingDocument: oGLAccountLineItem.ReferenceDocument
                    }));

                    oReferenceFields = {
                        XREF2: oBillingDocument.YY1_SDTravelBookRef_BDH,
                        XREF3: oBillingDocument.YY1_SDTravelDepDate_BDH
                    };
                } catch (error) {
                    throw error;
                }
                break;
        }

        return oReferenceFields;
    }

    async #runJournalEntryUpdate(aGLAccountLineItems, oReferenceFields, message) {
        let oJournalEntryServiceEndpoint = { url: null },
            oResponse = {},
            sDate = new Date().toISOString(),
            rRegex = /(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})\.(\d{3})Z/,
            sMessageHeaderID = sDate.replace(rRegex, "$1$2$3_$4$5$6_") + aGLAccountLineItems[0].AccountingDocument,
            oBody = {
                MessageHeader: {
                    ID: sMessageHeaderID,
                    CreationDateTime: sDate
                },
                JournalEntryGLItem: [],
                JournalEntryDebtorCreditorItem: []
            };
        const oSOAPClient = new SOAPClient(),
            oJournalEntryService = await oSOAPClient.getSoapService("JOURNAL_ENTRY_CHANGE",
                "./srv/external/JOURNALENTRYBULKCHANGEREQUEST_.wsdl",
                oJournalEntryServiceEndpoint
            );

        if (!oReferenceFields.hasOwnProperty("XREF2")) {
            return;
        }

        aGLAccountLineItems.forEach((lineItem) => {
            let sAccountingDocumentItem = lineItem.AccountingDocumentItem;

            while (sAccountingDocumentItem.length < 3) {
                sAccountingDocumentItem = "0" + sAccountingDocumentItem;
            }

            switch (lineItem.GLAccount) {
                case "12100000":
                    oBody.JournalEntryDebtorCreditorItem.push({
                        MessageHeader: {
                            ID: sMessageHeaderID + "_" + sAccountingDocumentItem,
                            CreationDateTime: sDate
                        },
                        ItemKey: {
                            AccountingDocument: lineItem.AccountingDocument,
                            CompanyCode: lineItem.CompanyCode,
                            FiscalYear: lineItem.FiscalYear,
                            AccountingDocumentItemID: sAccountingDocumentItem
                        },
                        Reference2IDByBusinessPartnerChange: {
                            Reference2IDByBusinessPartner: oReferenceFields.XREF2,
                            FieldValueChangeIsRequested: true
                        },
                        Reference3IDByBusinessPartnerChange: {
                            Reference3IDByBusinessPartner: oReferenceFields.XREF3,
                            FieldValueChangeIsRequested: true
                        }
                    });
                    break;
                case "12540000":
                    oBody.JournalEntryGLItem.push({
                        MessageHeader: {
                            ID: sMessageHeaderID + "_" + sAccountingDocumentItem,
                            CreationDateTime: sDate
                        },
                        ItemKey: {
                            AccountingDocument: lineItem.AccountingDocument,
                            CompanyCode: lineItem.CompanyCode,
                            FiscalYear: lineItem.FiscalYear,
                            AccountingDocumentItemID: sAccountingDocumentItem
                        },
                        Reference2IDByBusinessPartnerChange: {
                            Reference2IDByBusinessPartner: oReferenceFields.XREF2,
                            FieldValueChangeIsRequested: true
                        },
                        Reference3IDByBusinessPartnerChange: {
                            Reference3IDByBusinessPartner: oReferenceFields.XREF3,
                            FieldValueChangeIsRequested: true
                        }
                    });
                    break;
            }
        });

        if (!oBody.JournalEntryGLItem.length) {
            delete oBody.JournalEntryGLItem;
        }

        if (!oBody.JournalEntryDebtorCreditorItem.length) {
            delete oBody.JournalEntryDebtorCreditorItem;
        }

        try {
            oJournalEntryService.setEndpoint(oJournalEntryServiceEndpoint.url);

            // Add Message ID with corresponding xmlns. Otherwise it fails
            oJournalEntryService.addSoapHeader({
                messageId: "urn:uuid:" + message.ID
            }, undefined, undefined, "http://www.w3.org/2005/08/addressing");

            // Invoke JournalEntryBulkChangeRequest_In method asynchronously and wait for the response
            oResponse = await oJournalEntryService.JournalEntryBulkChangeRequest_InAsync(oBody);
        } catch (error) {
            throw error;
        }
    }
}

module.exports = JournalEventHandler;