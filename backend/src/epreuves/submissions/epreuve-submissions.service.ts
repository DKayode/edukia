import { Injectable, Logger, NotFoundException, ConflictException, BadRequestException } from '@nestjs/common';
import { Repository } from 'typeorm';
import { DataSourceResolver } from '../../config/data-source-resolver.service';
import { MailService } from '../../mail/mail.service';
import { FilesService } from '../../files/files.service';
import { EpreuveSubmission } from './entities/epreuve-submission.entity';
import { Epreuve, EpreuveSection, EpreuveType, normalizeEpreuveType } from '../entities/epreuve.entity';
import { Etablissement } from '../../etablissements/entities/etablissement.entity';
import { Filiere } from '../../filieres/entities/filiere.entity';
import { NiveauEtude } from '../../niveau-etude/entities/niveau-etude.entity';
import { Matiere } from '../../matieres/entities/matiere.entity';
import { ServiceStatusEnum } from '../../common/enums/service-status.enum';
import { applyLevelMatch, findLookupByName } from '../../common/utils/duplicate-match.util';
import { PaginationResponse } from '../../common/interfaces/pagination-response.interface';
import { CreerSubmissionDto } from './dto/creer-submission.dto';
import { ResoudreSubmissionDto } from './dto/resoudre-submission.dto';
import { CreditWalletFromValidatedExamUseCase } from '../../wallet/wallet-balance/use-cases/credit-wallet-from-validated-exam.use-case';
import { RewardSourceTypeCode } from '../../wallet/shared/payment.enums';
import { KessiahService, kessiahStagingKey, type KessiahExtractionState } from '../../kessiah/kessiah.service';

@Injectable()
export class EpreuveSubmissionsService {
  private readonly logger = new Logger(EpreuveSubmissionsService.name);

  constructor(
    private readonly resolver: DataSourceResolver,
    private readonly mailService: MailService,
    private readonly filesService: FilesService,
    private readonly creditWalletFromExam: CreditWalletFromValidatedExamUseCase,
    private readonly kessiah: KessiahService,
  ) { }

  private get submissionsRepository(): Repository<EpreuveSubmission> {
    return this.resolver.getRepository(EpreuveSubmission);
  }
  private get epreuvesRepository(): Repository<Epreuve> {
    return this.resolver.getRepository(Epreuve);
  }
  private get etablissementsRepository(): Repository<Etablissement> {
    return this.resolver.getRepository(Etablissement);
  }
  private get filieresRepository(): Repository<Filiere> {
    return this.resolver.getRepository(Filiere);
  }
  private get niveauxRepository(): Repository<NiveauEtude> {
    return this.resolver.getRepository(NiveauEtude);
  }
  private get matieresRepository(): Repository<Matiere> {
    return this.resolver.getRepository(Matiere);
  }

  // STEP 1 — submit metadata. Each parent level is either an existing id (validated
  // here) or a proposed name (captured for the admin to resolve at approval). The
  // duplicate check runs ONLY when all four parents resolve to existing ids.
  async createSubmission(pays: string, dto: CreerSubmissionDto, soumisParId: number) {
    this.logger.log(`Soumission d'épreuve par utilisateur ${soumisParId}`);

    // Validate each provided id and capture its pays — the DEEPEST resolved parent
    // wins (matiere > niveau > filiere > etablissement); none resolved → request country.
    let derivedPays: string | undefined;
    // Nom de matière pour le titre auto-construit (nom proposé, sinon nom de la matière résolue).
    let matiereNom: string | null = dto.proposed_matiere?.trim() || null;

    if (dto.etablissement_id != null) {
      const e = await this.etablissementsRepository.findOne({ where: { id: dto.etablissement_id } });
      if (!e) throw new NotFoundException(`Établissement #${dto.etablissement_id} introuvable`);
      derivedPays = e.pays;
    }
    if (dto.filiere_id != null) {
      const f = await this.filieresRepository.findOne({ where: { id: dto.filiere_id } });
      if (!f) throw new NotFoundException(`Filière #${dto.filiere_id} introuvable`);
      derivedPays = f.pays;
    }
    if (dto.niveau_etude_id != null) {
      const n = await this.niveauxRepository.findOne({ where: { id: dto.niveau_etude_id } });
      if (!n) throw new NotFoundException(`Niveau d'étude #${dto.niveau_etude_id} introuvable`);
      derivedPays = n.pays;
    }
    if (dto.matiere_id != null) {
      const m = await this.matieresRepository.findOne({ where: { id: dto.matiere_id } });
      if (!m) throw new NotFoundException(`Matière #${dto.matiere_id} introuvable`);
      derivedPays = m.pays;
      matiereNom = m.nom;
    }

    const submissionPays = derivedPays ?? pays ?? 'benin';
    const section = dto.section ?? EpreuveSection.NORMAL;
    // Titre auto-construit à partir de (matière + section + année) — plus saisi par l'utilisateur.
    const titre = [matiereNom ?? 'Épreuve', section, dto.annee != null ? String(dto.annee) : null]
      .map((p) => (p == null ? '' : String(p).trim()))
      .filter((p) => p !== '')
      .join(' — ');

    // Résolution en cascade des noms proposés : « Maths » ne vaut son id que si
    // le parent est connu (le même nom existe sous des dizaines de niveaux).
    const etabRef = dto.etablissement_id != null
      ? { id: dto.etablissement_id, nom: dto.proposed_etablissement ?? null }
      : await findLookupByName(this.etablissementsRepository, submissionPays, dto.proposed_etablissement);
    const filiereRef = dto.filiere_id != null
      ? { id: dto.filiere_id, nom: dto.proposed_filiere ?? null }
      : etabRef
        ? await findLookupByName(this.filieresRepository, submissionPays, dto.proposed_filiere,
            (qb) => qb.andWhere('l.etablissement_id = :parent', { parent: etabRef.id }))
        : null;
    const niveauRef = dto.niveau_etude_id != null
      ? { id: dto.niveau_etude_id, nom: dto.proposed_niveau ?? null }
      : filiereRef
        ? await findLookupByName(this.niveauxRepository, submissionPays, dto.proposed_niveau,
            (qb) => qb.andWhere('l.filiere_id = :parent', { parent: filiereRef.id }))
        : null;
    const matiereRef = dto.matiere_id != null
      ? { id: dto.matiere_id, nom: matiereNom }
      : niveauRef
        ? await findLookupByName(this.matieresRepository, submissionPays, dto.proposed_matiere,
            (qb) => qb.andWhere('l.niveau_etude_id = :parent', { parent: niveauRef.id }))
        : null;

    // Duplicate check dès que la matière est connue — par id fourni ou par nom
    // proposé résolu dans la chaîne. matiere_id pins the whole chain, so
    // matiere_id + annee + section identifies it (titre exclu). Même clé que le
    // garde-fou d'approbation : autant refuser tout de suite.
    if (matiereRef) {
      const dupQb = this.epreuvesRepository.createQueryBuilder('epreuve')
        .where('epreuve.matiere_id = :matiere_id', { matiere_id: matiereRef.id })
        .andWhere('epreuve.section = :section', { section });
      if (dto.annee === null || dto.annee === undefined) {
        dupQb.andWhere('epreuve.annee IS NULL');
      } else {
        dupQb.andWhere('epreuve.annee = :annee', { annee: dto.annee });
      }
      const duplicate = await dupQb.getOne();
      if (duplicate) {
        this.logger.warn(`Doublon refusé: l'épreuve #${duplicate.id} a déjà ce tuple complet`);
        throw new ConflictException(
          "Une épreuve avec ces mêmes établissement, filière, niveau, matière, année et session existe déjà.",
        );
      }
    }

    // Reject a duplicate PENDING submission (same effective parents + année +
    // section) so two users can't queue the same épreuve twice. Chaque parent
    // matche par id OU par nom proposé équivalent (casse et accents ignorés),
    // sinon "absent" des deux côtés.
    const pendDup = this.submissionsRepository.createQueryBuilder('s')
      .where('s.pays = :pays', { pays: submissionPays })
      .andWhere('s.status = :st', { st: ServiceStatusEnum.PENDING_APPROVAL })
      .andWhere('s.section = :sec', { sec: section });
    if (dto.annee == null) pendDup.andWhere('s.annee IS NULL');
    else pendDup.andWhere('s.annee = :an', { an: dto.annee });
    applyLevelMatch(pendDup, 's', 'etablissement_id', 'proposed_etablissement',
      etabRef?.id ?? null, etabRef?.nom ?? dto.proposed_etablissement, 'e');
    applyLevelMatch(pendDup, 's', 'filiere_id', 'proposed_filiere',
      filiereRef?.id ?? null, filiereRef?.nom ?? dto.proposed_filiere, 'f');
    applyLevelMatch(pendDup, 's', 'niveau_etude_id', 'proposed_niveau',
      niveauRef?.id ?? null, niveauRef?.nom ?? dto.proposed_niveau, 'n');
    applyLevelMatch(pendDup, 's', 'matiere_id', 'proposed_matiere',
      matiereRef?.id ?? null, matiereRef?.nom ?? dto.proposed_matiere, 'm');
    const pendingDuplicate = await pendDup.getOne();
    if (pendingDuplicate) {
      this.logger.warn(`Soumission doublon (déjà en attente #${pendingDuplicate.id}) — refusée`);
      throw new ConflictException(
        "Une soumission identique (mêmes établissement, filière, niveau, matière, année et session) est déjà en attente d'approbation.",
      );
    }

    const submission = new EpreuveSubmission();
    submission.etablissement_id = dto.etablissement_id ?? null;
    submission.proposed_etablissement = dto.proposed_etablissement ?? null;
    submission.filiere_id = dto.filiere_id ?? null;
    submission.proposed_filiere = dto.proposed_filiere ?? null;
    submission.niveau_etude_id = dto.niveau_etude_id ?? null;
    submission.proposed_niveau = dto.proposed_niveau ?? null;
    submission.matiere_id = dto.matiere_id ?? null;
    submission.proposed_matiere = dto.proposed_matiere ?? null;
    submission.titre = titre;
    // Seuls EXAMENS / EXAMENS NATIONAUX — tout le reste (ou vide) → EXAMENS.
    // On garde le type tel qu'envoyé (validé par le DTO) : si un client mobile
    // annonce « Examens Nationaux », l'admin doit le voir dans la file pour
    // rediriger l'auteur vers /examens-nationaux. La coercition n'a lieu qu'à
    // l'approbation, sur l'épreuve créée.
    submission.type = dto.type ?? EpreuveType.EXAMENS;
    submission.annee = dto.annee ?? null;
    submission.section = section;
    submission.pays = submissionPays;
    submission.soumis_par_id = soumisParId;
    submission.status = ServiceStatusEnum.PENDING_APPROVAL;

    const saved = await this.submissionsRepository.save(submission);
    this.logger.log(`Soumission créée: #${saved.id} (uuid ${saved.uuid}, pays ${saved.pays})`);
    return saved;
  }

  // Client-facing submission shape. A deeper id IMPLIES its ancestors via the
  // chain (matiere → niveau_etude → filiere → etablissement), so we derive and
  // return the ancestor objects from the deepest set id; a level is `missing`
  // only when neither it nor any deeper level resolves it (i.e. genuinely a
  // proposed-new level). Requires the deep relations to be loaded.
  private toSubmissionResponse(s: EpreuveSubmission) {
    const ref = (x?: { id: number; nom: string } | null) => x ? { id: x.id, nom: x.nom } : null;

    const effMatiere = s.matiere ?? null;
    const effNiveau = s.niveau_etude ?? effMatiere?.niveau_etude ?? null;
    const effFiliere = s.filiere ?? effNiveau?.filiere ?? null;
    const effEtab = s.etablissement ?? effFiliere?.etablissement ?? null;

    return {
      id: s.id,
      uuid: s.uuid,
      pays: s.pays,
      titre: s.titre,
      // Défaut EXAMENS à l'affichage : les anciennes soumissions (type NULL en
      // base, avant migration 071) sont présentées comme « Examens ».
      type: s.type ?? EpreuveType.EXAMENS,
      annee: s.annee,
      section: s.section,
      status: s.status,
      decline_reason: s.decline_reason ?? null,
      date_creation: s.date_creation,
      file_path: s.file_path,
      file_extension: s.file_extension,
      url: s.url,
      soumis_par: s.soumis_par
        ? { id: s.soumis_par.id, nom: s.soumis_par.nom, prenom: s.soumis_par.prenom, email: s.soumis_par.email }
        : null,
      etablissement: ref(effEtab),
      proposed_etablissement: s.proposed_etablissement,
      filiere: ref(effFiliere),
      proposed_filiere: s.proposed_filiere,
      niveau_etude: ref(effNiveau),
      proposed_niveau: s.proposed_niveau,
      matiere: ref(effMatiere),
      proposed_matiere: s.proposed_matiere,
      missing: {
        etablissement: effEtab == null,
        filiere: effFiliere == null,
        niveau_etude: effNiveau == null,
        matiere: effMatiere == null,
      },
    };
  }

  // Shared parent-join chain: eager-loads every ancestor path so
  // toSubmissionResponse can derive a level from its deepest resolved
  // descendant. Does NOT join soumis_par — callers add it only when needed.
  private baseSubmissionQuery() {
    return this.submissionsRepository.createQueryBuilder('submission')
      .leftJoinAndSelect('submission.etablissement', 'etablissement')
      .leftJoinAndSelect('submission.filiere', 'filiere')
      .leftJoinAndSelect('filiere.etablissement', 'f_etab')
      .leftJoinAndSelect('submission.niveau_etude', 'niveau_etude')
      .leftJoinAndSelect('niveau_etude.filiere', 'n_filiere')
      .leftJoinAndSelect('n_filiere.etablissement', 'n_etab')
      .leftJoinAndSelect('submission.matiere', 'matiere')
      .leftJoinAndSelect('matiere.niveau_etude', 'm_niveau')
      .leftJoinAndSelect('m_niveau.filiere', 'm_filiere')
      .leftJoinAndSelect('m_filiere.etablissement', 'm_etab');
  }

  // Type filter (Examens / Examens Nationaux). Only these two values are
  // meaningful; anything else is ignored. « Examens » inclut aussi les anciennes
  // soumissions à type NULL (présentées comme Examens), pour rester cohérent avec
  // le défaut d'affichage.
  private applyTypeFilter(qb: import('typeorm').SelectQueryBuilder<EpreuveSubmission>, type?: string) {
    if (type == null || type === '') return; // absent → aucun filtre
    if (type === EpreuveType.EXAMEN_NATIONAL) {
      qb.andWhere('submission.type = :ftype', { ftype: EpreuveType.EXAMEN_NATIONAL });
    } else if (type === EpreuveType.EXAMENS) {
      qb.andWhere('(submission.type = :ftype OR submission.type IS NULL)', { ftype: EpreuveType.EXAMENS });
    } else {
      // Valeur explicite invalide → 400 (ne pas la traiter comme Examens).
      throw new BadRequestException("Le paramètre 'type' doit être « Examens » ou « Examens Nationaux ».");
    }
  }

  // Admin queue: list submissions (optional status + type filters), with parents
  // resolved and missing ones flagged.
  async findAllForAdmin(
    pays: string,
    opts: { status?: ServiceStatusEnum; type?: string; page?: number; limit?: number },
  ): Promise<PaginationResponse<ReturnType<EpreuveSubmissionsService['toSubmissionResponse']>>> {
    const { status, type, page = 1, limit = 10 } = opts;
    const qb = this.baseSubmissionQuery()
      .leftJoinAndSelect('submission.soumis_par', 'soumis_par')
      .where('submission.pays = :pays', { pays })
      // Du plus récent au plus ancien. En ASC, un dépôt du jour atterrissait
      // sur la DERNIÈRE page de la file : l'admin ne le voyait pas arriver, et
      // concluait à une soumission perdue.
      //
      // Le tri décide aussi de ce que Kessiah lit : prepareTranscriptions ne
      // traite que les lignes de la page affichée. En ASC, les dépôts récents
      // n'étaient donc transcrits qu'une fois l'admin descendu jusqu'à eux —
      // c'est-à-dire jamais, tant que la file n'était pas vidée par le début.
      .orderBy('submission.date_creation', 'DESC')
      .skip((page - 1) * limit)
      .take(limit);

    if (status) {
      qb.andWhere('submission.status = :status', { status });
    }
    this.applyTypeFilter(qb, type);

    const [rows, total] = await qb.getManyAndCount();

    // L'admin ouvre sa file : c'est le signal pour préparer la lecture des
    // soumissions qui n'en ont pas encore. Le temps qu'il en traite une ou
    // deux, les suivantes sont transcrites — et il pourra valider le document
    // et sa lecture d'un même geste. Il n'existe pas de meilleur déclencheur :
    // les fichiers montent directement sur R2 via URL présignée, le backend
    // n'apprend donc jamais qu'un envoi a abouti.
    const states = await this.kessiah.getStates(rows.map(r => kessiahStagingKey(r.uuid)));
    const transcriptions: Record<string, KessiahExtractionState> = states;
    void this.prepareTranscriptions(rows, states);

    return {
      data: rows.map(r => ({
        ...this.toSubmissionResponse(r),
        transcription: transcriptions[kessiahStagingKey(r.uuid)] ?? null,
      })),
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit),
    };
  }

  /**
   * Envoie à Kessiah les soumissions qu'il n'a pas encore lues.
   *
   * Déclenché à l'affichage de la file, jamais attendu : l'écran doit
   * s'ouvrir immédiatement. Chaque document est traité l'un après l'autre
   * plutôt qu'en parallèle — rien ne presse, et une rafale de téléchargements
   * R2 pour une simple ouverture de page serait disproportionnée.
   */
  /**
   * Refuse l'approbation tant que la transcription n'a pas été tranchée.
   *
   * Publier une épreuve dont Ketsia n'a pas encore lu le contenu, c'est
   * publier quelque chose dont personne ne sait si l'assistante saura
   * l'exploiter. Et une transcription relue APRÈS publication ne l'est
   * jamais : l'admin est déjà passé à la file suivante.
   *
   * Le rejet est une décision valable — il signifie « ce scan est
   * inexploitable, l'épreuve reste consultable mais Ketsia n'y touchera
   * pas ». Seule l'absence de décision bloque.
   *
   * Si l'intégration Kessiah n'est pas configurée, cette règle ne s'applique
   * pas : elle transformerait une dépendance optionnelle en dépendance dure,
   * et une panne du service annexe empêcherait toute modération.
   */
  private async assertTranscriptionReviewed(submission: EpreuveSubmission): Promise<void> {
    if (!this.kessiah.enabled) return;

    const cle = kessiahStagingKey(submission.uuid);
    let etat: Record<string, KessiahExtractionState>;
    try {
      etat = await this.kessiah.getStates([cle]);
    } catch (err: any) {
      // Kessiah injoignable : on n'immobilise pas la modération pour autant.
      this.logger.warn(
        `État de transcription indisponible (soumission ${submission.id}), approbation autorisée : ${err?.message ?? err}`,
      );
      return;
    }

    const transcription = etat[cle];
    if (!transcription) {
      throw new BadRequestException(
        "Ketsia n'a pas encore lu ce document. Sa lecture démarre à l'ouverture de la file " +
        "et prend quelques secondes pour un PDF, quelques minutes pour un scan. " +
        "Patientez, puis relisez la transcription avant d'approuver.",
      );
    }
    if (transcription.statut === 'en_cours') {
      const sur = transcription.pages_total ? ` sur ${transcription.pages_total}` : '';
      throw new BadRequestException(
        `Lecture en cours : ${transcription.pages_pretes} page(s)${sur} transcrite(s). ` +
        "Attendez la fin, puis relisez la transcription avant d'approuver.",
      );
    }
    if (transcription.statut !== 'valide' && transcription.statut !== 'rejete') {
      throw new BadRequestException(
        "La transcription de ce document n'a pas encore été relue. Ouvrez-la, comparez-la " +
        "au document, puis validez-la — ou rejetez-la si elle est inexploitable. " +
        "Sans ce verdict, Ketsia s'interdira d'affirmer une correction sur cette épreuve.",
      );
    }
  }

  private async prepareTranscriptions(
    rows: EpreuveSubmission[],
    states: Record<string, KessiahExtractionState>,
  ): Promise<void> {
    if (!this.kessiah.enabled) return;

    for (const row of rows) {
      const key = kessiahStagingKey(row.uuid);
      if (states[key]) continue;                       // déjà lue, ou en cours
      if (!row.file_path || !row.file_extension) continue;  // rien à lire

      try {
        const { url } = await this.filesService.createDownloadUrl(
          'epreuve_submissions', row.uuid, 'file', row.file_extension,
        );
        const response = await fetch(url);
        if (!response.ok) continue;   // upload présigné jamais abouti : on réessaiera
        await this.kessiah.requestExtraction({
          epreuveId: key,
          epreuveUuid: row.uuid,
          pdf: new Uint8Array(await response.arrayBuffer()),
          filename: `soumission-${row.uuid}.${row.file_extension}`,
        });
      } catch (err: any) {
        this.logger.warn(`Préparation Kessiah ignorée (soumission ${row.id}): ${err?.message ?? err}`);
      }
    }
  }

  // Self-service: the caller's OWN épreuve submissions, pays-scoped, newest
  // first, paginated, optional status filter. Same rich rows as the admin list
  // (resolved/proposed parents + missing flags + file/status/date), but scoped
  // to soumis_par_id so a user never sees another user's rows. soumis_par is not
  // joined — the caller already knows it's theirs, and omitting it guarantees no
  // uploader row (hence no password) is ever serialized.
  async findMine(
    pays: string,
    soumisParId: number,
    opts: { status?: ServiceStatusEnum; type?: string; page?: number; limit?: number },
  ): Promise<PaginationResponse<ReturnType<EpreuveSubmissionsService['toSubmissionResponse']>>> {
    const { status, type, page = 1, limit = 10 } = opts;
    const qb = this.baseSubmissionQuery()
      .where('submission.pays = :pays', { pays })
      .andWhere('submission.soumis_par_id = :soumisParId', { soumisParId })
      .orderBy('submission.date_creation', 'DESC')
      .skip((page - 1) * limit)
      .take(limit);

    if (status) {
      qb.andWhere('submission.status = :status', { status });
    }
    this.applyTypeFilter(qb, type);

    const [rows, total] = await qb.getManyAndCount();
    return {
      data: rows.map(r => this.toSubmissionResponse(r)),
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit),
    };
  }

  private async loadSubmissionOrThrow(id: number): Promise<EpreuveSubmission> {
    const submission = await this.submissionsRepository.findOne({
      where: { id },
      relations: [
        'soumis_par',
        'etablissement',
        'filiere', 'filiere.etablissement',
        'niveau_etude', 'niveau_etude.filiere', 'niveau_etude.filiere.etablissement',
        'matiere', 'matiere.niveau_etude', 'matiere.niveau_etude.filiere', 'matiere.niveau_etude.filiere.etablissement',
      ],
    });
    if (!submission) {
      throw new NotFoundException(`Soumission #${id} introuvable`);
    }
    return submission;
  }

  private uploaderName(s: EpreuveSubmission): string {
    const u = s.soumis_par;
    if (!u) return 'Utilisateur';
    return u.prenom && u.nom ? `${u.prenom} ${u.nom}` : (u.prenom || u.nom || 'Utilisateur');
  }

  // Admin resolution: attach validated real parent ids (clearing the matching
  // proposed_* name), then re-derive pays from the deepest resolved parent.
  // Admin edit of a PENDING submission: for each parent, either bind a real id
  // (clears the proposed name) or overwrite the proposed name; année/section are
  // editable too. The titre is re-derived (matière + section + année). Approved/
  // declined submissions are frozen.
  async resolveParents(id: number, dto: ResoudreSubmissionDto) {
    const submission = await this.loadSubmissionOrThrow(id);
    if (submission.status !== ServiceStatusEnum.PENDING_APPROVAL) {
      throw new BadRequestException('Seule une soumission en attente peut être modifiée.');
    }

    // Build a COLUMN-LEVEL patch and use .update() — the loaded `submission`
    // carries its parent relation OBJECTS (matiere, niveau_etude, …). Saving the
    // entity would re-derive each FK from those objects, silently reverting a
    // *changed* _id back to the already-resolved value (that's why changing an
    // already-resolved level had no effect). .update() writes the exact columns.
    const patch: Partial<EpreuveSubmission> = {};

    if (dto.etablissement_id != null) {
      const e = await this.etablissementsRepository.findOne({ where: { id: dto.etablissement_id } });
      if (!e) throw new NotFoundException(`Établissement #${dto.etablissement_id} introuvable`);
      patch.etablissement_id = dto.etablissement_id;
      patch.proposed_etablissement = null;
      patch.pays = e.pays;
    } else if (dto.proposed_etablissement !== undefined) {
      patch.proposed_etablissement = dto.proposed_etablissement?.trim() || null;
      if (patch.proposed_etablissement) patch.etablissement_id = null;
    }

    if (dto.filiere_id != null) {
      const f = await this.filieresRepository.findOne({ where: { id: dto.filiere_id } });
      if (!f) throw new NotFoundException(`Filière #${dto.filiere_id} introuvable`);
      patch.filiere_id = dto.filiere_id;
      patch.proposed_filiere = null;
      patch.pays = f.pays;
    } else if (dto.proposed_filiere !== undefined) {
      patch.proposed_filiere = dto.proposed_filiere?.trim() || null;
      if (patch.proposed_filiere) patch.filiere_id = null;
    }

    if (dto.niveau_etude_id != null) {
      const n = await this.niveauxRepository.findOne({ where: { id: dto.niveau_etude_id } });
      if (!n) throw new NotFoundException(`Niveau d'étude #${dto.niveau_etude_id} introuvable`);
      patch.niveau_etude_id = dto.niveau_etude_id;
      patch.proposed_niveau = null;
      patch.pays = n.pays;
    } else if (dto.proposed_niveau !== undefined) {
      patch.proposed_niveau = dto.proposed_niveau?.trim() || null;
      if (patch.proposed_niveau) patch.niveau_etude_id = null;
    }

    if (dto.matiere_id != null) {
      const m = await this.matieresRepository.findOne({ where: { id: dto.matiere_id } });
      if (!m) throw new NotFoundException(`Matière #${dto.matiere_id} introuvable`);
      patch.matiere_id = dto.matiere_id;
      patch.proposed_matiere = null;
      patch.pays = m.pays;
    } else if (dto.proposed_matiere !== undefined) {
      patch.proposed_matiere = dto.proposed_matiere?.trim() || null;
      if (patch.proposed_matiere) patch.matiere_id = null;
    }

    if (dto.annee !== undefined) patch.annee = dto.annee ?? null;
    if (dto.section !== undefined && dto.section != null) patch.section = dto.section;
    if (dto.type !== undefined) patch.type = dto.type;

    if (Object.keys(patch).length > 0) {
      await this.submissionsRepository.update({ id }, patch);
    }
    const reloaded = await this.loadSubmissionOrThrow(id);

    // Re-derive the auto-title from the edited (matière + section + année).
    const matiereNom = reloaded.matiere?.nom ?? reloaded.proposed_matiere ?? null;
    reloaded.titre = [matiereNom ?? 'Épreuve', reloaded.section, reloaded.annee != null ? String(reloaded.annee) : null]
      .map((p) => (p == null ? '' : String(p).trim()))
      .filter((p) => p !== '')
      .join(' — ');
    await this.submissionsRepository.update({ id }, { titre: reloaded.titre });

    this.logger.log(`Soumission #${id} modifiée (admin)`);
    return this.toSubmissionResponse(reloaded);
  }

  // Admin approve: requires the matière resolved AND a file attached, then creates
  // the real épreuve (professeur = uploader), PROMOTES the file into the épreuve's
  // own R2 folder, marks the submission approved, and emails the uploader.
  async approve(id: number) {
    const submission = await this.loadSubmissionOrThrow(id);

    // Idempotency guard: re-approving must not create a second épreuve.
    if (submission.status === ServiceStatusEnum.APPROVED) {
      throw new ConflictException(`Soumission #${id} déjà approuvée.`);
    }

    // matiere_id alone pins the whole chain and is the only parent the real
    // épreuve stores, so it's the sole gate. Proposed-new ancestors must have
    // been turned into a real matière (via resolution) before approval.
    if (submission.matiere_id == null) {
      throw new BadRequestException(
        "La matière doit être résolue avant approbation (elle détermine toute la chaîne).",
      );
    }

    const matiere = await this.matieresRepository.findOne({ where: { id: submission.matiere_id } });
    if (!matiere) {
      throw new NotFoundException(`Matière #${submission.matiere_id} introuvable`);
    }

    // soumis_par_id is ON DELETE SET NULL but epreuves.professeur_id is NOT NULL.
    if (submission.soumis_par_id == null) {
      throw new BadRequestException("L'auteur de la soumission n'existe plus; impossible de créer l'épreuve.");
    }

    // The submission module exists to collect the épreuve PDF: a file is mandatory.
    if (!submission.file_path && !submission.url) {
      throw new BadRequestException(
        "Aucun fichier attaché — la soumission doit contenir le fichier de l'épreuve avant approbation.",
      );
    }

    await this.assertTranscriptionReviewed(submission);

    // Safety net: never mint a duplicate real épreuve if one already exists for
    // the same matière + année + section (titre exclu — il est déterministe).
    // matiere_id pins the whole parent chain.
    const section = (submission.section as EpreuveSection) ?? EpreuveSection.NORMAL;
    const dupEp = this.epreuvesRepository.createQueryBuilder('e')
      .where('e.matiere_id = :m', { m: submission.matiere_id })
      .andWhere('e.section = :s', { s: section });
    if (submission.annee == null) dupEp.andWhere('e.annee IS NULL');
    else dupEp.andWhere('e.annee = :a', { a: submission.annee });
    const existingEp = await dupEp.getOne();
    if (existingEp) {
      this.logger.warn(`Approbation refusée: épreuve identique #${existingEp.id} existe déjà (soumission ${id})`);
      throw new ConflictException(
        'Une épreuve identique (matière, année, session) existe déjà. Déclinez cette soumission.',
      );
    }

    const epreuve = new Epreuve();
    epreuve.titre = submission.titre;
    epreuve.matiere_id = submission.matiere_id;
    epreuve.professeur_id = submission.soumis_par_id;
    epreuve.annee = submission.annee ?? undefined;
    epreuve.section = section;
    // Seuls EXAMENS / EXAMENS NATIONAUX ; tout autre type (ou absent) → EXAMENS.
    epreuve.type = normalizeEpreuveType(submission.type);
    epreuve.duree_minutes = 0;
    // Seed empty; promoteFile (below) fills these once we have the épreuve uuid.
    epreuve.file_path = '';
    epreuve.file_extension = '';
    epreuve.url = '';
    epreuve.pays = matiere.pays;
    // Save first to obtain the DB-generated uuid the promoted key is built from.
    const savedEpreuve = await this.epreuvesRepository.save(epreuve);

    // Promote the file into the épreuve's OWN folder (epreuves/<uuid>/file.<ext>).
    // If the R2 copy throws, roll back the épreuve so we never persist a real row
    // pointing at a copy that didn't happen.
    let promoted: { file_path: string; file_extension: string; url: string };
    try {
      promoted = await this.filesService.promoteFile(
        'epreuve_submissions', submission.uuid, 'epreuves', savedEpreuve.uuid, 'file', submission.file_extension,
      );
    } catch (err) {
      await this.epreuvesRepository.delete(savedEpreuve.id);
      this.logger.error(`Promotion du fichier échouée pour soumission ${id}: ${err?.message ?? err}`);
      throw err;
    }
    savedEpreuve.file_path = promoted.file_path;
    savedEpreuve.file_extension = promoted.file_extension;
    savedEpreuve.url = promoted.url;
    await this.epreuvesRepository.save(savedEpreuve);

    submission.status = ServiceStatusEnum.APPROVED;
    await this.submissionsRepository.save(submission);

    // Faire lire l'épreuve par Kessiah, dès maintenant. C'est le point
    // d'ingestion naturel : le document vient d'être promu, il ne changera
    // plus, et l'OCR devient ainsi un coût de catalogue payé une fois pour
    // toutes — au lieu d'un coût d'usage qui ferait attendre le premier
    // étudiant plusieurs minutes. Best-effort et non bloquant, comme le crédit
    // du wallet ci-dessous : Kessiah indisponible ne doit pas défaire une
    // approbation.
    this.sendToKessiah(savedEpreuve, submission.uuid)
      .catch(err => this.logger.error(`Lecture Kessiah non déclenchée (épreuve ${savedEpreuve.id}): ${err?.message ?? err}`));

    // Reward the uploader's wallet for the validated épreuve. Best-effort — a
    // failure here must not undo the approval. Idempotent: the use-case keys on
    // reference EXAM_REWARD:<uuid>, so re-approving never double-credits.
    if (submission.soumis_par_id != null) {
      this.creditWalletFromExam
        .execute({ userId: submission.soumis_par_id, sourceType: RewardSourceTypeCode.EPREUVE, examId: savedEpreuve.uuid, description: 'Épreuve validée' })
        .then((res: any) => this.logger.log(`Wallet crédité (épreuve ${savedEpreuve.uuid}) pour user ${submission.soumis_par_id}${res?.duplicated ? ' [déjà crédité]' : ''}`))
        .catch(err => this.logger.error(`Crédit wallet échoué (soumission ${id}): ${err.message}`));
    }

    if (submission.soumis_par?.email) {
      this.mailService.sendServiceStatusUpdateEmail(
        submission.soumis_par.email, this.uploaderName(submission), submission.titre, 'approved', 'épreuve',
      ).catch(err => this.logger.error(`Failed to send approval email for submission ${id}: ${err.message}`));
    }

    this.logger.log(`Soumission #${id} approuvée → épreuve #${savedEpreuve.id} créée`);
    return { submission: this.toSubmissionResponse(submission), epreuve: savedEpreuve };
  }

  /**
   * Transmet le PDF de l'épreuve à Kessiah pour qu'il en produise le texte.
   *
   * On récupère les octets depuis R2 et on les POSTe, plutôt que de passer une
   * URL : au moment de l'approbation aucun jeton étudiant n'existe côté
   * Kessiah pour télécharger lui-même, et lui faire suivre une URL fournie par
   * l'appelant ouvrirait une porte à des requêtes sortantes arbitraires.
   */
  private async sendToKessiah(epreuve: Epreuve, submissionUuid: string): Promise<void> {
    if (!this.kessiah.enabled) return;

    // Cas nominal : la soumission a été lue pendant qu'elle attendait dans la
    // file, il n'y a qu'à rattacher ce texte à l'épreuve créée. Retranscrire
    // ici coûterait un second OCR pour un résultat identique.
    if (await this.kessiah.adoptTranscription(epreuve.id, kessiahStagingKey(submissionUuid))) {
      return;
    }

    const { url } = await this.filesService.createDownloadUrl(
      'epreuves', epreuve.uuid, 'file', epreuve.file_extension,
    );
    const response = await fetch(url);
    if (!response.ok) {
      throw new Error(`téléchargement R2 impossible (HTTP ${response.status})`);
    }

    await this.kessiah.requestExtraction({
      epreuveId: epreuve.id,
      epreuveUuid: epreuve.uuid,
      pdf: new Uint8Array(await response.arrayBuffer()),
      filename: `epreuve-${epreuve.uuid}.${epreuve.file_extension || 'pdf'}`,
    });
  }

  // Admin decline: mark declined + email the uploader. Reason is logged only.
  async decline(id: number, reason?: string) {
    const submission = await this.loadSubmissionOrThrow(id);

    submission.status = ServiceStatusEnum.DECLINED;
    submission.decline_reason = reason?.trim() || null;
    await this.submissionsRepository.save(submission);
    if (submission.decline_reason) {
      this.logger.log(`Soumission #${id} refusée. Motif: ${submission.decline_reason}`);
    }

    if (submission.soumis_par?.email) {
      this.mailService.sendServiceStatusUpdateEmail(
        submission.soumis_par.email, this.uploaderName(submission), submission.titre, 'declined', 'épreuve',
        submission.decline_reason ?? undefined,
      ).catch(err => this.logger.error(`Failed to send decline email for submission ${id}: ${err.message}`));
    }

    this.logger.log(`Soumission #${id} refusée`);
    return this.toSubmissionResponse(submission);
  }
}
