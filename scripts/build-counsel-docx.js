/**
 * Builds the founder/legal review copies for the W-9 counsel packet.
 *
 * Follows the convention already set by Dog_Walking_Agreement_CA_TEMPLATE.docx:
 * merge fields stay visible as {{placeholders}} so counsel can see what's
 * variable, Heading1 title, Key Terms as a table.
 *
 * Output goes to templates/contracts/ alongside the HTML each doc mirrors.
 */
const fs = require('fs');
const path = require('path');
const {
  Document, Packer, Paragraph, TextRun, HeadingLevel, AlignmentType,
  Table, TableRow, TableCell, WidthType, ShadingType, BorderStyle,
} = require('docx');

const OUT = 'C:/Users/itchy/OneDrive/Desktop/PetPro/templates/contracts';

const LETTER = { size: { width: 12240, height: 15840 }, margin: { top: 1080, right: 1080, bottom: 1080, left: 1080 } };
const TABLE_W = 10080; // 12240 - 2*1080 margins

// ---------------------------------------------------------------- helpers ---

const p = (text, opts = {}) => new Paragraph({
  spacing: { after: 120 },
  ...opts,
  children: [new TextRun({ text, size: 20, ...(opts.run || {}) })],
});

const h1 = (text) => new Paragraph({
  heading: HeadingLevel.HEADING_1,
  alignment: AlignmentType.CENTER,
  spacing: { after: 80 },
  children: [new TextRun({ text, bold: true, size: 30 })],
});

const h2 = (text) => new Paragraph({
  heading: HeadingLevel.HEADING_2,
  spacing: { before: 240, after: 80 },
  children: [new TextRun({ text, bold: true, size: 22 })],
});

/** The DRAFT banner. This is the single most important thing on the page: it
 *  stops a draft being mistaken for something signable. */
const draftBanner = (lines) => new Table({
  columnWidths: [TABLE_W],
  rows: [new TableRow({
    children: [new TableCell({
      width: { size: TABLE_W, type: WidthType.DXA },
      shading: { type: ShadingType.CLEAR, fill: 'FFF3CD' },
      margins: { top: 120, bottom: 120, left: 120, right: 120 },
      children: lines.map((t, i) => new Paragraph({
        spacing: { after: i === lines.length - 1 ? 0 : 80 },
        children: [new TextRun({ text: t, size: 19, bold: i === 0, italics: i !== 0 })],
      })),
    })],
  })],
});

// The noun must match the HTML word-for-word ("this Addendum" / "this
// Agreement"), not a generic "this document" — the .docx and the .html are
// required to stay in sync, and the notice is the one clause the README makes
// mandatory.
const noticePara = (noun) => new Paragraph({
  spacing: { before: 120, after: 160 },
  children: [
    new TextRun({ text: 'NOTICE: ', bold: true, size: 19 }),
    new TextRun({
      text: `This template is provided for convenience and is not legal advice. Both parties should have this ${noun} reviewed by their own legal counsel before signing.`,
      italics: true, size: 19,
    }),
  ],
});

/** Two-column Key Terms table, matching the v1 review copy. */
const keyTerms = (rows) => new Table({
  columnWidths: [2900, 7180],
  rows: rows.map(([k, v]) => new TableRow({
    children: [
      new TableCell({
        width: { size: 2900, type: WidthType.DXA },
        shading: { type: ShadingType.CLEAR, fill: 'F2F2F2' },
        margins: { top: 60, bottom: 60, left: 100, right: 100 },
        children: [new Paragraph({ children: [new TextRun({ text: k, bold: true, size: 19 })] })],
      }),
      new TableCell({
        width: { size: 7180, type: WidthType.DXA },
        margins: { top: 60, bottom: 60, left: 100, right: 100 },
        children: [new Paragraph({ children: [new TextRun({ text: v, size: 19 })] })],
      }),
    ],
  })),
});

/** Specimen services table. Counsel needs to see the shape of what renders
 *  here — a literal "{{services_table}}" token would tell them nothing about
 *  the thing they're being asked to approve. Marked as example data. */
const servicesTable = () => {
  const cols = [2700, 1900, 2700, 2780];
  const head = ['Service', 'Pet(s)', 'Fee', 'Notes'];
  const body = [
    ['Private walk — Pepper', 'Pepper', '$30.00 per visit (30 min)', 'Midday walk, back gate.'],
    ['Training session — Biscuit', 'Biscuit', '$400.00 per package (10 sessions)', '—'],
    ['Group walk — Pepper & Biscuit', 'Pepper, Biscuit', '$20.00 per visit (45 min)', 'Both dogs, one walk.'],
  ];
  const cell = (text, i, bold, fill) => new TableCell({
    width: { size: cols[i], type: WidthType.DXA },
    ...(fill ? { shading: { type: ShadingType.CLEAR, fill } } : {}),
    margins: { top: 60, bottom: 60, left: 100, right: 100 },
    children: [new Paragraph({ children: [new TextRun({ text, bold, size: 19 })] })],
  });
  return new Table({
    columnWidths: cols,
    rows: [
      new TableRow({ tableHeader: true, children: head.map((t, i) => cell(t, i, true, 'F2F2F2')) }),
      ...body.map((r) => new TableRow({ children: r.map((t, i) => cell(t, i, false)) })),
    ],
  });
};

const specimenNote = () => new Paragraph({
  spacing: { before: 100, after: 160 },
  children: [new TextRun({
    text: 'The three rows above are EXAMPLE DATA, shown so the table’s shape is reviewable. In a real document this table is generated from the services the walker selected — it may contain one row or several, and the Notes column is free text typed by the walker.',
    italics: true, size: 18,
  })],
});

const sigBlock = () => new Table({
  columnWidths: [5040, 5040],
  borders: {
    top: { style: BorderStyle.NONE }, bottom: { style: BorderStyle.NONE },
    left: { style: BorderStyle.NONE }, right: { style: BorderStyle.NONE },
    insideHorizontal: { style: BorderStyle.NONE }, insideVertical: { style: BorderStyle.NONE },
  },
  rows: [new TableRow({
    children: [
      ['CLIENT', '{{client_signature_image}}', '{{client_name}}'],
      ['SERVICE PROVIDER', '{{provider_signature_image}}', '{{provider_name}}'],
    ].map(([role, sig, name]) => new TableCell({
      width: { size: 5040, type: WidthType.DXA },
      margins: { top: 60, bottom: 60, right: 200 },
      children: [
        new Paragraph({ spacing: { after: 80 }, children: [new TextRun({ text: role, bold: true, size: 19 })] }),
        p(`Signature: ${sig}`, { run: { size: 19 } }),
        p(`Name: ${name}`, { run: { size: 19 } }),
        p('Date: {{signed_date}}', { run: { size: 19 } }),
      ],
    })),
  })],
});

const doc = (children) => new Document({
  styles: { default: { document: { run: { font: 'Georgia', size: 20 } } } },
  sections: [{ properties: { page: LETTER }, children }],
});

async function write(name, document) {
  const buf = await Packer.toBuffer(document);
  fs.writeFileSync(path.join(OUT, name), buf);
  console.log(`wrote ${name} (${(buf.length / 1024).toFixed(1)} KB)`);
}

// -------------------------------------------------------------- addendum ---

const addendum = doc([
  h1('Addendum to Dog Walking Service Agreement'),
  p('California — DRAFT v1', { alignment: AlignmentType.CENTER, run: { italics: true, size: 19 } }),
  draftBanner([
    'DRAFT FOR COUNSEL REVIEW — NOT FOR USE WITH CLIENTS',
    'Prepared 2026-07-17 by the founder’s engineering tooling, not by a lawyer. This is a starting point for review, not a legal opinion. It is not in use: the software cannot generate this document until it is approved.',
    'Open questions are listed in COUNSEL_REVIEW.md, items 1–5 under "Item 4 — Addendum". The mirror of this document that the software reads is dog-walking-addendum-ca.html; the two must stay in sync.',
  ]),
  p('Text in {{double braces}} is a merge field filled with real data at generation.', { run: { italics: true, size: 18 } }),

  p('This Addendum (“Addendum”) is entered into as of {{effective_date}} between {{provider_business_name}} (“Service Provider”) and {{client_name}} (“Client”). It supplements, and does not replace, the Dog Walking Service Agreement between the same parties entered into as of {{original_agreement_date}} (the “Original Agreement”).'),
  noticePara('Addendum'),

  h2('Additional Services'),
  p('The following services are added to the Original Agreement as of {{start_date}}:'),
  servicesTable(),
  specimenNote(),
  p('The services listed above are part of this Addendum. In case of conflict between this table and the sections below, the table controls.', { run: { italics: true, size: 18 } }),

  h2('1. Effect of this Addendum'),
  p('This Addendum adds the services listed above to the Original Agreement. It is the written amendment contemplated by Section 17 (Entire Agreement) of the Original Agreement. Except as expressly modified here, every term of the Original Agreement remains in full force and unchanged, and applies to the services added by this Addendum as if they had been listed in the Original Agreement when it was signed.'),

  h2('2. Services previously agreed'),
  p('The services already in effect under the Original Agreement continue on their existing terms. This Addendum does not change their price, schedule, or cadence.'),

  h2('3. Pets covered'),
  p('The Original Agreement covers: {{original_pet_list}}. The services added by this Addendum cover the pet(s) identified in the table above. Where a pet is covered by this Addendum but was not listed in the Original Agreement, Client makes the same certifications for that pet as in Section 6 (Health Requirements) of the Original Agreement, and the emergency veterinary authorization in the Original Agreement’s Key Terms extends to that pet.'),

  h2('4. Fees'),
  p('Fees for the services added by this Addendum are as listed in the table above. Invoices are due upon receipt unless otherwise agreed in writing. The payment, suspension, cancellation-notice, and late-cancellation / no-show terms of the Original Agreement apply to these services unchanged.'),

  h2('5. Term & Termination'),
  p('The services added by this Addendum begin on {{start_date}} and continue on the same month-to-month basis as the Original Agreement, terminating together with it under Section 4 (Term & Termination) of the Original Agreement. Either party may terminate the services added by this Addendum on the same notice, without terminating the Original Agreement or the services already in effect under it.'),

  h2('6. Risk, Liability & Indemnification'),
  p('Sections 11 (Assumption of Risk), 12 (Limitation of Liability), and 13 (Indemnification) of the Original Agreement apply to the services added by this Addendum. Nothing in this Addendum waives rights that cannot be waived under California law.'),

  h2('7. Governing Law'),
  p('This Addendum is governed by California law and is subject to Sections 15 (Governing Law), 16 (Severability), and 18 (Electronic Signatures) of the Original Agreement.'),

  h2('Signatures'),
  p('By signing below, each party agrees to the terms of this Addendum and confirms that the Original Agreement, as supplemented by this Addendum, remains in effect.'),
  sigBlock(),
]);

// -------------------------------------------------------------- v2 agreement ---

const v2 = doc([
  h1('Dog Walking Service Agreement (California)'),
  p('DRAFT v2 — multi-service variant', { alignment: AlignmentType.CENTER, run: { italics: true, size: 19 } }),
  draftBanner([
    'DRAFT FOR COUNSEL REVIEW — NOT FOR USE WITH CLIENTS',
    'Prepared 2026-07-17 by the founder’s engineering tooling, not by a lawyer. v1 remains the live template until this is approved.',
    'Differs from v1 ONLY in: the Services table (replacing the Key Terms rows "Walk type", "Schedule", and "Fees & payment"), and Sections 1, 3, and 5, which referenced those deleted rows. Every other section is identical to v1 — including Sections 4 and 5, the two substantive terms already flagged, which are carried over verbatim so counsel rules on the words live in production today.',
    'Open questions: COUNSEL_REVIEW.md, items 1–4 under "Item 3 — Services table".',
  ]),
  p('Text in {{double braces}} is a merge field filled with real data at generation.', { run: { italics: true, size: 18 } }),

  p('This Dog Walking Service Agreement (“Agreement”) is entered into as of {{effective_date}} between {{provider_business_name}} (“Service Provider”) and {{client_name}} (“Client”).'),
  noticePara('Agreement'),

  h2('Key Terms'),
  keyTerms([
    ['Client', '{{client_name}} — {{client_address}} — {{client_phone}} — {{client_email}}'],
    ['Pet(s) covered', '{{pet_list}}'],
    ['Schedule', '{{service_schedule}}'],
    ['Cancellation notice', '{{cancellation_window_hours}} hours'],
    ['Late-cancel / no-show fee', '{{no_show_fee}}'],
    ['Keys & access', '{{key_handling}}'],
    ['Emergency vet authorization', 'Up to {{emergency_vet_cap}}. Preferred veterinarian: {{preferred_vet}}. Emergency contact: {{emergency_contact}}'],
    ['Photo consent (marketing)', '{{photo_consent}}'],
    ['Term', 'Begins {{start_date}}; continues month-to-month until terminated per Section 4.'],
  ]),

  h2('Services'),
  servicesTable(),
  specimenNote(),
  p('The Key Terms and the Services table above are part of this Agreement. In case of conflict between them and the sections below, the Key Terms and the Services table control. Fees for each service are as listed in the Services table; invoices are due upon receipt.', { run: { italics: true, size: 18 } }),

  h2('1. Services'),
  p('Service Provider will provide the services listed in the Services table for the pet(s) identified there. Where a service is provided as a group walk, it involves supervised interaction with compatible dogs and carries inherent risks.'),

  h2('2. Scheduling & Rescheduling'),
  p('Walks may be rescheduled with at least {{cancellation_window_hours}} hours’ notice. Alternate times are subject to availability.'),

  h2('3. Late Cancellations & No-Shows'),
  p('Cancellations with less than {{cancellation_window_hours}} hours’ notice, and services missed without notice, are charged the late-cancellation / no-show fee listed in the Key Terms and generally cannot be rescheduled unless due to a genuine emergency.'),

  h2('4. Term & Termination'),
  p('This Agreement begins on {{start_date}} and continues month-to-month. Client may cancel without charge within three (3) business days of signing, provided services have not begun. Thereafter, either party may terminate this Agreement with seven (7) days’ written notice. Fees for completed services remain due.'),

  h2('5. Payment'),
  p('Fees are as listed in the Services table. Invoices are due upon receipt unless otherwise agreed in writing. Service Provider may suspend services while an account is more than fifteen (15) days past due.'),

  h2('6. Health Requirements'),
  p('Client certifies that each pet listed is licensed where required, current on legally required vaccinations, free of contagious disease, and that all medical and behavioral issues have been disclosed to the Service Provider.'),

  h2('7. Behavior'),
  p('Service may be refused or terminated if a dog poses a safety risk to the Service Provider, other animals, or the public.'),

  h2('8. Emergency Veterinary Care'),
  p('If Client cannot be reached after reasonable attempts, Service Provider may obtain emergency veterinary care up to the amount authorized in the Key Terms, or as reasonably necessary to stabilize the pet. Client is responsible for all related costs.'),

  h2('9. Keys & Property Access'),
  p('Client authorizes property access using the method described in the Key Terms. Any keys or fobs provided will be stored securely, will not be labeled with Client’s name or address, and will be returned within seven (7) days of termination of this Agreement.'),

  h2('10. Weather & Safety'),
  p('Walks may be shortened, modified, or rescheduled for safety due to weather, air quality, or environmental hazards.'),

  h2('11. Assumption of Risk'),
  p('Client acknowledges the inherent risks of dog walking, including interactions with other dogs, wildlife, weather, environmental hazards, illness, injury, or escape despite reasonable care.'),

  h2('12. Limitation of Liability'),
  p('Service Provider will exercise reasonable care and is not liable for harm arising from the inherent risks described above, except where caused by Service Provider’s gross negligence, reckless misconduct, or intentional wrongdoing. Nothing in this Agreement waives rights that cannot be waived under California law.'),

  h2('13. Indemnification'),
  p('To the extent permitted by California law, Client will indemnify and hold harmless the Service Provider against third-party claims arising from the pet’s actions or from conditions Client failed to disclose, excluding claims arising from the Service Provider’s gross negligence or intentional misconduct.'),

  h2('14. Photos'),
  p('Photos of the pet(s) may be shared privately with Client (for example, in walk updates) regardless of the consent election in the Key Terms. Use of photos in marketing is permitted only if the Key Terms show photo consent as “Yes.”'),

  h2('15. Governing Law'),
  p('This Agreement is governed by California law. Disputes shall be brought in a California court unless otherwise agreed.'),

  h2('16. Severability'),
  p('If any provision is held invalid, the remainder of this Agreement remains in effect.'),

  h2('17. Entire Agreement'),
  p('This document is the entire agreement between the parties and may only be amended in writing signed by both parties.'),

  h2('18. Electronic Signatures'),
  p('Electronic signatures are valid under applicable California law, including the California Uniform Electronic Transactions Act.'),

  h2('Signatures'),
  p('By signing below, each party agrees to the terms of this Agreement, including the Key Terms and the Services table.'),
  sigBlock(),
]);

(async () => {
  await write('Dog_Walking_Addendum_CA_DRAFT.docx', addendum);
  await write('Dog_Walking_Agreement_CA_v2_DRAFT.docx', v2);
})();
