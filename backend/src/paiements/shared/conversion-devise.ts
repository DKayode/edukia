import { ConflictException } from '@nestjs/common';

// Parités fixes du franc CFA (UEMOA/CEMAC) : 1 EUR = 655,957 XOF = 655,957 XAF.
const PAR_EURO: Record<string, number> = { EUR: 1, XOF: 655.957, XAF: 655.957 };
const SANS_DECIMALES = new Set(['XOF', 'XAF']);

/**
 * Exprime un prix (plan, commande — en XOF) dans la devise du prestataire.
 * Sans elle, Stripe (EUR) facturait 15 000 « EUR » un plan à 15 000 XOF.
 * Une paire sans parité fixe est refusée plutôt que facturée au mauvais montant.
 */
export function convertirMontant(montant: number, source: string, cible: string): number {
  const de = (source || 'XOF').toUpperCase();
  const vers = (cible || 'XOF').toUpperCase();
  if (de === vers) return montant;
  if (!PAR_EURO[de] || !PAR_EURO[vers]) {
    throw new ConflictException(`Conversion ${de} → ${vers} non prise en charge`);
  }
  const converti = (montant / PAR_EURO[de]) * PAR_EURO[vers];
  return SANS_DECIMALES.has(vers) ? Math.round(converti) : Math.round(converti * 100) / 100;
}
