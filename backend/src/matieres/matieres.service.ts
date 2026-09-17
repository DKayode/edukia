import { Injectable, NotFoundException, Logger, ConflictException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, Brackets } from 'typeorm';
import { Matiere } from './entities/matiere.entity';
import { NiveauEtude } from '../niveau-etude/entities/niveau-etude.entity';
import { CreerMatiereDto } from './dto/creer-matiere.dto';
import { MajMatiereDto } from './dto/maj-matiere.dto';
import { PaginationDto } from '../common/dto/pagination.dto';
import { PaginationResponse } from '../common/interfaces/pagination-response.interface';
import { FilterMatiereDto } from './dto/filter-matiere.dto';
import { memeLibelle, normaliserLibelle } from '../common/utils/libelles';

@Injectable()
export class MatieresService {
  private readonly logger = new Logger(MatieresService.name);

  constructor(
    @InjectRepository(Matiere)
    private readonly matieresRepository: Repository<Matiere>,
    @InjectRepository(NiveauEtude)
    private readonly niveauEtudeRepository: Repository<NiveauEtude>,
  ) { }

  // Note: `pays` (from @CurrentCountry) is intentionally ignored as the saved
  // value — it stays in the signature so the controller/middleware scoping is
  // unaffected, but the stored pays is DERIVED from the parent NiveauEtude.
  async create(pays: string, creerMatiereDto: CreerMatiereDto) {
    this.logger.log(`Création d'une matière: ${creerMatiereDto.nom} (Niveau d'étude ID: ${creerMatiereDto.niveau_etude_id})`);
    const niveauEtude = await this.niveauEtudeRepository.findOne({
      where: { id: creerMatiereDto.niveau_etude_id },
    });
    if (!niveauEtude) {
      this.logger.warn(`Niveau d'étude ID ${creerMatiereDto.niveau_etude_id} introuvable`);
      throw new NotFoundException('Niveau d\'étude non trouvé');
    }
    // Le libellé vient d'une saisie libre — souvent celle d'un professeur, ou
    // la reprise d'une matière proposée par un utilisateur. On normalise les
    // espaces sans toucher au sens : contrairement aux niveaux d'étude, les
    // matières n'ont pas de nomenclature fermée, « Macroéconomie » ne se
    // réécrit pas.
    const nom = normaliserLibelle(creerMatiereDto.nom);

    // Un niveau ne doit pas porter deux fois la même matière. Rien ne
    // l'empêchait : la production compte 125 lignes strictement identiques.
    // On rend la ligne existante plutôt que d'en ajouter une, ce qui rend la
    // création idempotente pour un appelant qui ignore si la matière existe.
    const existante = await this.trouverEquivalente(creerMatiereDto.niveau_etude_id, nom);
    if (existante) {
      this.logger.log(
        `Matière « ${nom} » déjà présente sur le niveau ${creerMatiereDto.niveau_etude_id} ` +
          `(ID ${existante.id}) : réutilisée plutôt que dupliquée.`,
      );
      return existante;
    }

    const newMatiere = this.matieresRepository.create({ ...creerMatiereDto, nom, pays: niveauEtude.pays });
    const saved = await this.matieresRepository.save(newMatiere);
    this.logger.log(`Matière créée: ${saved.nom} (ID: ${saved.id}, pays: ${saved.pays})`);
    return saved;
  }

  /**
   * La matière déjà présente sous ce niveau et désignant la même chose.
   *
   * Comparaison en mémoire : la règle vit dans le code, et la dupliquer en SQL
   * la ferait diverger. Un niveau porte quelques dizaines de matières.
   */
  private async trouverEquivalente(niveauEtudeId: number, nom: string) {
    const existantes = await this.matieresRepository.find({ where: { niveau_etude_id: niveauEtudeId } });
    return existantes.find((m) => memeLibelle(m.nom, nom)) ?? null;
  }

  async findAll(pays: string, filterDto: FilterMatiereDto): Promise<PaginationResponse<any>> {
    const { page = 1, limit = 10, search } = filterDto;
    this.logger.log(`Récupération des matières (pays=${pays}) - Page: ${page}, Limite: ${limit}, Search: ${search}`);

    const queryBuilder = this.matieresRepository.createQueryBuilder('matiere')
      .leftJoinAndSelect('matiere.niveau_etude', 'niveau_etude')
      .leftJoinAndSelect('niveau_etude.filiere', 'filiere')
      .leftJoinAndSelect('filiere.etablissement', 'etablissement')
      .where('matiere.pays = :pays', { pays })
      .skip((page - 1) * limit)
      .take(limit)
      .orderBy('matiere.nom', filterDto.sort_order || 'ASC');

    if (search) {
      queryBuilder.andWhere(
        new Brackets((qb) => {
          qb.where('unaccent(matiere.nom) ILIKE unaccent(:search)', { search: `%${search}%` })
            .orWhere('unaccent(niveau_etude.nom) ILIKE unaccent(:search)', { search: `%${search}%` })
            .orWhere('unaccent(filiere.nom) ILIKE unaccent(:search)', { search: `%${search}%` });
        }),
      );
    }

    // Filtrer par identifiant plutôt que par nom quand le client le peut :
    // l'égalité sur le nom est stricte, et 17 filières portent une apostrophe
    // typographique qu'un clavier remplace par une apostrophe droite.
    if (filterDto.filiere_id) {
      queryBuilder.andWhere('filiere.id = :filiereId', { filiereId: filterDto.filiere_id });
    }

    // Sans ce filtre, l'écran de dépôt ne pouvait demander que les matières de
    // TOUTE la filière, tous niveaux confondus — 68 pour Médecine Générale,
    // dont 10 seulement remontaient.
    if (filterDto.niveau_etude_id) {
      queryBuilder.andWhere('niveau_etude.id = :niveauId', { niveauId: filterDto.niveau_etude_id });
    }

    // Comparaison insensible à la casse et aux accents : le nom transite par
    // l'interface, où il peut être ressaisi ou normalisé. Une liste vide sans
    // message coûte plus cher qu'une correspondance un peu large.
    if (filterDto.filiere) {
      queryBuilder.andWhere('unaccent(lower(filiere.nom)) = unaccent(lower(:filiere))', { filiere: filterDto.filiere });
    }

    const [matieres, total] = await queryBuilder.getManyAndCount();

    this.logger.log(`${matieres.length} matière(s) trouvée(s) sur ${total} total`);

    // Transform to response DTO format
    const data = matieres.map(matiere => ({
      id: matiere.id,
      nom: matiere.nom,
      description: matiere.description,
      niveau_etude: {
        id: matiere?.niveau_etude?.id,
        nom: matiere?.niveau_etude?.nom,
        duree_mois: matiere?.niveau_etude?.duree_mois,
        filiere: {
          id: matiere?.niveau_etude?.filiere?.id,
          nom: matiere?.niveau_etude?.filiere?.nom,
          etablissement: matiere?.niveau_etude?.filiere?.etablissement,
        },
      },
    }));

    return {
      data,
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit),
    };
  }

  async findOne(id: string) {
    this.logger.log(`Recherche de la matière ID: ${id}`);
    const matiere = await this.matieresRepository.findOne({
      where: { id: parseInt(id) },
      relations: ['niveau_etude', 'niveau_etude.filiere', 'niveau_etude.filiere.etablissement'],
    });

    if (!matiere) {
      this.logger.warn(`Matière ID ${id} introuvable`);
      throw new NotFoundException('Matière non trouvée');
    }

    this.logger.log(`Matière trouvée: ${matiere.nom} (ID: ${id})`);

    // Transform to response DTO format
    return {
      id: matiere.id,
      nom: matiere.nom,
      description: matiere.description,
      niveau_etude: {
        id: matiere.niveau_etude.id,
        nom: matiere.niveau_etude.nom,
        duree_mois: matiere.niveau_etude.duree_mois,
        filiere: {
          id: matiere.niveau_etude.filiere.id,
          nom: matiere.niveau_etude.filiere.nom,
          etablissement: matiere.niveau_etude.filiere.etablissement,
        },
      },
    };
  }

  async update(id: string, majMatiereDto: MajMatiereDto) {
    this.logger.log(`Mise à jour de la matière ID: ${id}`);
    const matiere = await this.matieresRepository.findOne({
      where: { id: parseInt(id) },
    });

    if (!matiere) {
      this.logger.warn(`Mise à jour échouée: matière ID ${id} introuvable`);
      throw new NotFoundException('Matière non trouvée');
    }

    Object.assign(matiere, majMatiereDto);

    // Parent changed → re-derive pays from the new NiveauEtude (canonical parent).
    if (majMatiereDto.niveau_etude_id) {
      const niveauEtude = await this.niveauEtudeRepository.findOne({
        where: { id: majMatiereDto.niveau_etude_id },
      });
      if (!niveauEtude) {
        this.logger.warn(`Niveau d'étude ID ${majMatiereDto.niveau_etude_id} introuvable`);
        throw new NotFoundException('Niveau d\'étude non trouvé');
      }
      matiere.pays = niveauEtude.pays;
    }

    const updated = await this.matieresRepository.save(matiere);
    this.logger.log(`Matière mise à jour: ${updated.nom} (ID: ${id})`);
    return updated;
  }

  async remove(id: string) {
    this.logger.log(`Suppression de la matière ID: ${id}`);
    const matiere = await this.matieresRepository.findOne({
      where: { id: parseInt(id) },
    });

    if (!matiere) {
      this.logger.warn(`Suppression échouée: matière ID ${id} introuvable`);
      throw new NotFoundException('Matière non trouvée');
    }

    try {
      await this.matieresRepository.remove(matiere);
      this.logger.log(`Matière supprimée: ${matiere.nom} (ID: ${id})`);
      return { message: 'Matière supprimée avec succès' };
    } catch (error) {
      if (error.code === '23503') {
        throw new ConflictException('Impossible de supprimer cette matière car des épreuves ou autres contenus y sont associés. Veuillez d\'abord supprimer ces contenus.');
      }
      throw error;
    }
  }

  async findByNiveauEtude(niveauEtudeId: string) {
    this.logger.log(`Recherche des matières pour niveau d'étude ID: ${niveauEtudeId}`);
    const matieres = await this.matieresRepository.find({
      where: { niveau_etude: { id: parseInt(niveauEtudeId) } },
    });
    this.logger.log(`${matieres.length} matière(s) trouvée(s) pour niveau d'étude ${niveauEtudeId}`);
    return matieres;
  }

  async findGroupedByName(pays: string, paginationDto: PaginationDto): Promise<PaginationResponse<any>> {
    const { page = 1, limit = 10, search } = paginationDto;
    this.logger.log(`Récupération des matières groupées par nom (pays=${pays}, Page: ${page}, Limit: ${limit}, Search: ${search})`);

    // 1. Compter le total des noms distincts
    const countQuery = this.matieresRepository.createQueryBuilder('matiere')
      .select('COUNT(DISTINCT(matiere.nom))', 'count')
      .where('matiere.pays = :pays', { pays });

    if (search) {
      countQuery.andWhere('unaccent(matiere.nom) ILIKE unaccent(:search)', { search: `%${search}%` });
    }

    const countResult = await countQuery.getRawOne();
    const total = parseInt(countResult.count, 10);

    // 2. Récupérer les noms de la page courante
    const namesQuery = this.matieresRepository.createQueryBuilder('matiere')
      .select('DISTINCT(matiere.nom)', 'nom')
      .where('matiere.pays = :pays', { pays })
      .orderBy('nom', 'ASC')
      .limit(limit)
      .offset((page - 1) * limit);

    if (search) {
      namesQuery.andWhere('unaccent(matiere.nom) ILIKE unaccent(:search)', { search: `%${search}%` });
    }

    const rawNames = await namesQuery.getRawMany();
    const names = rawNames.map(r => r.nom);

    if (names.length === 0) {
      return {
        data: [],
        total: 0,
        page,
        limit,
        totalPages: 0
      };
    }

    // 3. Récupérer les données complètes pour ces noms
    const details = await this.matieresRepository.createQueryBuilder('matiere')
      .leftJoinAndSelect('matiere.niveau_etude', 'niveau_etude')
      .leftJoinAndSelect('niveau_etude.filiere', 'filiere')
      .leftJoinAndSelect('filiere.etablissement', 'etablissement')
      .where('matiere.pays = :pays', { pays })
      .andWhere("matiere.nom IN (:...names)", { names })
      .orderBy('matiere.nom', 'ASC')
      .getMany();

    const grouped = new Map<string, any[]>();

    names.forEach(name => grouped.set(name, []));

    details.forEach(matiere => {
      const existing = grouped.get(matiere.nom);
      if (existing) {
        existing.push({
          id: matiere.id,
          nom: matiere.nom,
          description: matiere.description,
          niveau_etude: {
            id: matiere?.niveau_etude?.id,
            nom: matiere?.niveau_etude?.nom,
            filiere: {
              id: matiere?.niveau_etude?.filiere?.id,
              nom: matiere?.niveau_etude?.filiere?.nom,
              etablissement: matiere?.niveau_etude?.filiere?.etablissement
            }
          }
        });
      }
    });

    const data = Array.from(grouped.entries()).map(([nom, matieres]) => ({
      nom,
      matieres
    }));

    return {
      data,
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit),
    };
  }
}