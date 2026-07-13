import { IeSignProvider } from './IeSignProvider';

/**
 * Provider factory. Electronic signing (Nitro Sign) is deferred to Phase 1.5
 * per the locked Week 4 decision — launch is in-person signing only, which
 * doesn't go through an eSign provider at all.
 *
 * When Nitro Sign comes back in scope, add NitroSignProvider.ts implementing
 * IeSignProvider and return it here for ESIGN_PROVIDER=nitro. ContractService
 * needs zero changes.
 */
export function getESignProvider(): IeSignProvider {
  const provider = process.env.ESIGN_PROVIDER ?? 'none';
  switch (provider) {
    case 'none':
      return unavailableProvider;
    default:
      throw new Error(`Unknown eSign provider: ${provider}`);
  }
}

const unavailableProvider: IeSignProvider = {
  async sendForSignature() {
    throw new Error('Electronic signing is not available yet (Phase 1.5). Use in-person signing.');
  },
  async getSignatureStatus() {
    throw new Error('Electronic signing is not available yet (Phase 1.5).');
  },
  async retrieveSignedDocument() {
    throw new Error('Electronic signing is not available yet (Phase 1.5).');
  },
  async parseWebhook() {
    throw new Error('Electronic signing is not available yet (Phase 1.5).');
  },
};

export type { IeSignProvider } from './IeSignProvider';
