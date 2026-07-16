import { Contract } from '../types';

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/**
 * Wrap a contract's generated_html in a standalone, print-styled HTML
 * document — the "copy the client keeps" (W-1). The browser's Print → Save
 * as PDF turns it into a PDF, which is why Phase 1 ships print-styled HTML
 * instead of a server-side PDF pipeline (decision recorded in ROADMAP Week 7).
 *
 * The same rendering is used by GET /api/contracts/:id/document and attached
 * to the contract-signed email, so both copies are always identical. It is
 * self-contained by construction: the signature is already embedded in
 * generated_html as a data URI.
 */
export function renderContractDocument(
  contract: Contract,
  options: { businessName?: string | null } = {}
): string {
  const title = options.businessName
    ? `Service Agreement — ${options.businessName}`
    : 'Service Agreement';
  const signedLine =
    contract.status === 'signed' && contract.signed_at
      ? `Signed by ${contract.signer_name ?? 'client'} on ${new Date(contract.signed_at).toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' })} (${contract.signing_method === 'in_person' ? 'in person' : 'electronically'})`
      : `Status: ${contract.status} — not yet signed`;

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(title)}</title>
<style>
  body { margin: 2rem auto; max-width: 56rem; padding: 0 1rem; background: #fff; }
  .doc-footer {
    margin-top: 2rem; padding-top: 0.75rem; border-top: 1px solid #bbb;
    font-family: Georgia, 'Times New Roman', serif; font-size: 0.8rem; color: #444;
  }
  @media print {
    body { margin: 0; max-width: none; }
    .no-print { display: none !important; }
  }
</style>
</head>
<body>
${contract.generated_html}
<footer class="doc-footer">
  <p>${escapeHtml(signedLine)} · Contract reference ${escapeHtml(contract.id)}</p>
</footer>
</body>
</html>`;
}
