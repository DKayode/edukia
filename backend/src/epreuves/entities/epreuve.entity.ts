import { Entity, PrimaryGeneratedColumn, Column, ManyToOne, JoinColumn } from 'typeorm';
import { Matiere } from '../../matieres/entities/matiere.entity';
import { Utilisateur } from '../../utilisateurs/entities/utilisateur.entity';

export enum EpreuveType {
  INTERROGATION = 'Interrogation',
  DEVOIRS = 'Devoirs',
  CONCOURS = 'Concours',
  EXAMENS = 'Examens',
  EXAMEN_NATIONAL = 'Examens Nationaux',
}

export enum EpreuveSection {
  NORMAL = 'normal',
  RATTRAPAGE = 'rattrapage',
}

// Une épreuve ne peut plus être écrite qu'en « Examens ».
//
// « Examens Nationaux » était une étape intermédiaire (migrations 070/071) pour
// marquer un examen national sur une épreuve. Ces contenus ont désormais leur
// propre ressource — table examens_nationaux et endpoints /examens-nationaux —
// et la valeur n'a jamais servi en production : 0 épreuve la porte. On cesse
// donc de l'accepter en écriture, y compris sur les soumissions : un examen
// national se dépose via POST /examens-nationaux/submissions, pas ici.
export const WRITABLE_EPREUVE_TYPES = [EpreuveType.EXAMENS] as const;

/**
 * Type de l'épreuve réellement créée. Toujours « Examens » : les examens
 * nationaux ne sont plus des épreuves, ils ont leur propre ressource. Conservé
 * comme point unique de vérité pour les écritures (création dashboard, mise à
 * jour, approbation d'une soumission).
 */
export function normalizeEpreuveType(_type?: EpreuveType | string | null): EpreuveType {
    return EpreuveType.EXAMENS;
}

@Entity('epreuves')
export class Epreuve {
  @PrimaryGeneratedColumn()
  id: number;



  @Column({ type: 'text', default: '' })
  file_path: string;

  @Column({ type: 'varchar', length: 10, default: '' })
  file_extension: string;
  @Column({ type: "varchar", length: 50, default: "benin" })
  pays: string;
    @Column({ type: 'uuid', unique: true, default: () => 'gen_random_uuid()' })
    uuid: string;

  @Column()
  titre: string;

  @Column({ type: 'enum', enum: EpreuveType, nullable: true })
  type: EpreuveType;

  @Column({ type: 'int', nullable: true })
  annee: number;

  // DB column is varchar(20) + CHECK (not a native pg enum like `type`);
  // value space is enforced by EpreuveSection / IsEnum + the CHECK constraint.
  @Column({ type: 'varchar', length: 20, default: EpreuveSection.NORMAL })
  section: EpreuveSection;

  @Column()
  url: string;

  @Column({ nullable: true })
  duree_minutes: number;

  @Column({ type: 'int', default: 0 })
  nombre_pages: number;

  @Column({ type: 'int', default: 0 })
  nombre_telechargements: number;

  @Column({ type: 'timestamp with time zone', default: () => 'CURRENT_TIMESTAMP' })
  date_creation: Date;

  @Column({ type: 'timestamp with time zone', nullable: true })
  date_publication: Date;

  @Column()
  professeur_id: number;

  @Column()
  matiere_id: number;

  @ManyToOne(() => Utilisateur, { nullable: false })
  @JoinColumn({ name: 'professeur_id' })
  professeur: Utilisateur;

  @ManyToOne(() => Matiere, { nullable: false })
  @JoinColumn({ name: 'matiere_id' })
  matiere: Matiere;
}