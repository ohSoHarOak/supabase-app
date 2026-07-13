import { getESignProvider, IeSignProvider } from '../integrations/esign';

/**
 * Contract lifecycle — skeleton for Week 3 (generation + in-person signing).
 *
 * HARD CONSTRAINTS when implementing:
 * - Electronic signing goes through IeSignProvider only (never a vendor API
 *   directly). It is deferred to Phase 1.5.
 * - Once status = 'signed', generated_html never changes; the database
 *   trigger in 005_create_contracts.sql enforces it, and this service must
 *   never attempt it.
 */
export class ContractService {
  private esign: IeSignProvider = getESignProvider();

  // Week 3: generateContract(templateId, clientId, serviceId) — substitute
  // {{variables}} from real client/pet/service data into template body_html.

  // Week 3: signInPerson(contractId, signerName, signatureImage) — store the
  // drawn signature in Supabase Storage, set status='signed', lock the record,
  // publish 'contract_signed' event.

  // Phase 1.5: initiateElectronicSigning(contractId) via this.esign.
}

export const contractService = new ContractService();
