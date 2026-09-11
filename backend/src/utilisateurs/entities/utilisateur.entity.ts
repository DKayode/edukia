import { Entity, PrimaryGeneratedColumn, Column, ManyToOne, JoinColumn, OneToMany, OneToOne, CreateDateColumn } from 'typeorm';
import { ApiProperty } from '@nestjs/swagger';
import { Etablissement } from '../../etablissements/entities/etablissement.entity';
import { Filiere } from '../../filieres/entities/filiere.entity';
import { NiveauEtude } from '../../niveau-etude/entities/niveau-etude.entity';
import { Departement } from '../../departements/entities/departement.entity';
import { Ville } from '../../villes/entities/ville.entity';
import { Commentaire } from 'src/commentaires/entities/commentaire.entity';
import { Exclude } from 'class-transformer';
import { NotificationUtilisateur } from 'src/notifications/entities/notification-utilisateur.entity';
import { Forum } from '../../forum/entities/forum.entity';
import { Offre } from '../../offres/entities/offre.entity';
import { Service } from '../../services/entities/service.entity';
import { Prestataire } from '../../prestataires/entities/prestataire.entity';
import { Avis } from '../../avis/entities/avis.entity';
import { Recruteur } from '../../recruteurs/entities/recruteur.entity';

export enum RoleType {
  ADMIN = 'admin',
  ETUDIANT = 'étudiant',
  PROFESSEUR = 'professeur',
  AUTRE = 'autre'
}

export enum SexeType {
  M = 'M',
  F = 'F',
  AUTRE = 'Autre'
}

// Tranches d'âge prédéfinies — remplacent la date de naissance.
export enum AgeGroup {
  UNDER_18 = '< 18',
  FROM_18_25 = '18 - 25',
  FROM_26_35 = '26 - 35',
  FROM_36_50 = '36 - 50',
  OVER_50 = '> 50',
}

// Tranches considérées « ≤ 35 ans » pour les KPI démographiques.
export const AGE_GROUPS_UNDER_35: AgeGroup[] = [
  AgeGroup.UNDER_18,
  AgeGroup.FROM_18_25,
  AgeGroup.FROM_26_35,
];

@Entity('utilisateurs')
export class Utilisateur {
  @PrimaryGeneratedColumn()
  id: number;


  @Column({ type: 'text', default: '' })
  profil_photo_path: string;

  @Column({ type: 'varchar', length: 10, default: '' })
  profil_photo_extension: string;
  @Column()
  nom: string;

  @Column()
  prenom: string;

  @Column({ nullable: true, unique: true })
  pseudo: string;

  @Column({ type: 'uuid', nullable: true, unique: true })
  uuid: string;

  @Column({ nullable: true, unique: true })
  mon_code_parrainage: string;

  // Referral code the user typed at signup, kept verbatim even if it
  // matches no user (parrain_id then stays null). Not unique.
  @Column({ nullable: true })
  code_parrainage_saisi: string;

  @Column({ unique: true })
  email: string;

  @Column()
  @Exclude()
  mot_de_passe: string;

  @Column({ default: false })
  est_desactive: boolean;

  @Column({ default: false })
  verifier: boolean;

  @Column({ type: 'timestamp', nullable: true })
  date_suppression_prevue: Date;

  @ApiProperty({ description: 'Date de création de l\'utilisateur' })
  @CreateDateColumn()
  date_creation: Date;

  @Column({ nullable: true })
  photo: string;

  @Column({ type: 'enum', enum: SexeType, nullable: true })
  sexe: SexeType;

  // Tranche d'âge (valeurs prédéfinies AgeGroup) — remplace la date de naissance.
  @Column({ type: 'varchar', length: 30, nullable: true })
  age_group: AgeGroup;

  @Column({ type: 'varchar', length: 20, nullable: true })
  zone_residence: string;

  // Situation de handicap : booléen (oui/non). Remplace l'ancienne chaîne (visuel/auditif/…).
  @Column({ type: 'boolean', nullable: true, default: false })
  situation_handicap: boolean;

  @Column({ nullable: true })
  telephone: string;

  @Column({ type: 'text', nullable: true })
  fcm_token: string;

  @Column({ type: 'varchar', length: 255, nullable: true })
  digit_code: string;

  @Column({ type: 'timestamp', nullable: true })
  date_expiration_code: Date;

  @Column({ type: 'timestamp', nullable: true })
  code_dernier_envoi: Date;

  @Column({ type: 'smallint', default: 0 })
  code_envois: number;

  @Column({ type: 'smallint', default: 0 })
  code_tentatives: number;

  @Column({ type: 'enum', enum: RoleType })
  role: RoleType;

  @Column({ type: 'varchar', length: 50, default: 'benin' })
  pays: string;

  @Column({ nullable: true })
  etablissement_id: number;

  @ManyToOne(() => Etablissement, { nullable: true })
  @JoinColumn({ name: 'etablissement_id' })
  etablissement: Etablissement;

  @Column({ nullable: true })
  filiere_id: number;

  @ManyToOne(() => Filiere, { nullable: true })
  @JoinColumn({ name: 'filiere_id' })
  filiere: Filiere;

  @Column({ nullable: true })
  niveau_etude_id: number;

  @ManyToOne(() => NiveauEtude, { nullable: true })
  @JoinColumn({ name: 'niveau_etude_id' })
  niveau_etude: NiveauEtude;

  // geo-profile: cascade pays -> departement -> ville (both nullable uuid FKs)
  @Column({ type: 'uuid', nullable: true })
  departement_id: string;

  @ManyToOne(() => Departement, { nullable: true })
  @JoinColumn({ name: 'departement_id' })
  departement: Departement;

  @Column({ type: 'uuid', nullable: true })
  ville_id: string;

  @ManyToOne(() => Ville, { nullable: true })
  @JoinColumn({ name: 'ville_id' })
  ville: Ville;

  // Type de profil (personnalisation) — un seul par utilisateur, nullable.
  // Scalaire seul (pas de relation) pour garder l'édition de cette entité
  // partagée minimale ; l'objet type_profil est résolu côté service.
  @Column({ nullable: true })
  type_profil_id: number;

  @OneToMany(() => Commentaire, commentaire => commentaire.utilisateur)
  commentaires: Commentaire[];

  @OneToMany(
    () => NotificationUtilisateur,
    (notificationUtilisateur) => notificationUtilisateur.utilisateur,
  )
  notificationUtilisateurs: NotificationUtilisateur[];

  notifications?: Notification[];

  @ManyToOne(() => Utilisateur, (utilisateur) => utilisateur.filleuls, { nullable: true })
  @JoinColumn({ name: 'parrain_id' })
  parrain: Utilisateur;

  @OneToMany(() => Utilisateur, (utilisateur) => utilisateur.parrain)
  filleuls: Utilisateur[];

  @OneToMany(() => Forum, forum => forum.user)
  forums: Forum[];

  @OneToMany(() => Offre, offre => offre.utilisateur)
  offres: Offre[];

  @OneToMany(() => Service, service => service.utilisateur)
  services: Service[];

  @OneToOne(() => Prestataire, prestataire => prestataire.utilisateur)
  prestataire: Prestataire;

  @OneToOne(() => Recruteur, recruteur => recruteur.utilisateur)
  recruteur: Recruteur;

  @OneToMany(() => Avis, avis => avis.utilisateur)
  avis: Avis[];

  unreadNotificationsCount?: number;
}