import { Column, CreateDateColumn, Entity, Index, PrimaryGeneratedColumn, UpdateDateColumn } from 'typeorm';

@Entity('plans_abonnement')
@Index(['pays', 'code'], { unique: true })
export class PlanAbonnement {
  @PrimaryGeneratedColumn()
  id: number;

  @Column({ type: 'uuid', generated: 'uuid' })
  uuid: string;

  @Column({ type: 'varchar', length: 50, default: 'benin' })
  pays: string;

  /** `MENSUEL`, `TRIMESTRIEL`, `ANNUEL` — unique par pays. */
  @Column({ type: 'varchar', length: 50 })
  code: string;

  @Column({ type: 'varchar', length: 150 })
  libelle: string;

  @Column({ type: 'text', nullable: true })
  description: string | null;

  /**
   * Ce que l'abonnement débloque, une ligne par avantage.
   *
   * Séparé de `description`, qui dit la durée : au moment de payer, on a besoin
   * de lire ce qu'on gagne, ressource par ressource. Une liste plutôt qu'un
   * texte libre, pour que le mobile l'affiche en puces sans découper de phrase.
   */
  @Column({ type: 'text', array: true, nullable: true })
  avantages: string[] | null;

  // `numeric` revient en chaîne depuis pg : la conversion est explicite pour que
  // le prix reste un nombre côté API et dans les calculs de remise (#247).
  @Column({ type: 'numeric', precision: 14, scale: 2, transformer: { to: (v: number) => v, from: (v: string) => (v === null ? null : Number(v)) } })
  prix: number;

  @Column({ type: 'varchar', length: 10, default: 'XOF' })
  devise: string;

  @Column({ type: 'int' })
  duree_jours: number;

  /** Fermé par défaut : un plan visible sans moyen de payer n'a pas de sens. */
  @Column({ type: 'boolean', default: false })
  est_actif: boolean;

  @Column({ type: 'int', default: 0 })
  ordre_affichage: number;

  @CreateDateColumn({ name: 'date_creation', type: 'timestamptz' })
  date_creation: Date;

  @UpdateDateColumn({ name: 'date_modification', type: 'timestamptz' })
  date_modification: Date;
}
