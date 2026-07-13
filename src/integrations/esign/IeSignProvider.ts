/**
 * Marketplace Seam 3 (adapter pattern): ContractService only ever talks to
 * this interface — never to a vendor SDK/API directly. Nitro Sign, DocuSign,
 * etc. are swappable implementations selected in the factory (index.ts).
 */

export interface SignatureRequest {
  contractId: string;
  documentHtml: string;
  signerName: string;
  signerEmail: string;
}

export type SignatureStatus = 'pending' | 'signed' | 'declined' | 'expired';

export interface SignatureEnvelope {
  /** Provider-side reference for this signing flow. */
  envelopeId: string;
  status: SignatureStatus;
  /** URL the signer visits to sign, if the provider exposes one. */
  signingUrl?: string;
}

export interface WebhookResult {
  envelopeId: string;
  status: SignatureStatus;
  signedAt?: string;
}

export interface IeSignProvider {
  sendForSignature(request: SignatureRequest): Promise<SignatureEnvelope>;
  getSignatureStatus(envelopeId: string): Promise<SignatureStatus>;
  /** Returns the signed PDF bytes for storage in Supabase Storage. */
  retrieveSignedDocument(envelopeId: string): Promise<Buffer>;
  /** Verifies the webhook signature and parses the payload. */
  parseWebhook(headers: Record<string, string | string[] | undefined>, rawBody: Buffer): Promise<WebhookResult>;
}
