import { itauExtrato } from './importers/itau-extrato';
import { itauFatura } from './importers/itau-fatura';
import { nubankAccount, nubankCard } from './importers/nubank';
import { ofx } from './importers/ofx';
import type { Importer, InputFile } from './types';

/** Para adicionar um banco/formato: crie o importador em ./importers e registre aqui. */
export const IMPORTERS: Importer[] = [itauExtrato, itauFatura, nubankCard, nubankAccount, ofx];

export function detectImporter(f: InputFile): Importer | null {
  let best: { imp: Importer; score: number } | null = null;
  for (const imp of IMPORTERS) {
    const score = imp.detect(f);
    if (score > (best?.score ?? 0)) best = { imp, score };
  }
  return best && best.score >= 0.5 ? best.imp : null;
}

export const importerById = (id: string) => IMPORTERS.find(i => i.id === id) ?? null;
